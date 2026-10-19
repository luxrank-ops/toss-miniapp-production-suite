/**
 * ============================================================================
 * 파일명: backend/services/aiProvider.js
 * 역할: [실제 AI 모델 연동 게이트웨이] MuseGlow AI v5.0 전용 LLM/Vision 추상화 레이어
 * ----------------------------------------------------------------------------
 * 왜 이 모듈이 필요한가?
 *   - 기존 glowEngine.js는 "입력값 → 결정론적 시드 난수"로 결과를 만들어내는
 *     오프라인 목업 엔진이었습니다. 실제 상용 서비스에서는 반드시
 *     ① 실제 멀티모달(Vision) 모델의 피부 스캔 분석
 *     ② 실제 LLM의 개인화 처방전 생성
 *     이 필요합니다.
 *   - 이 모듈은 Gemini / OpenAI / Anthropic 3개 벤더를 **동일한 인터페이스**로
 *     호출하고, API 키가 없거나 호출이 실패하면 **자동으로 로컬 목업 엔진으로
 *     폴백(Fallback)** 하여 장애를 절대 사용자에게 전가하지 않습니다(무중단 설계).
 *
 * 지원 환경변수 (.env):
 *   AI_PROVIDER        = auto | gemini | openai | anthropic | none   (기본 auto)
 *   GEMINI_API_KEY     / GEMINI_MODEL     / GEMINI_BASE_URL
 *   OPENAI_API_KEY     / OPENAI_MODEL     / OPENAI_BASE_URL
 *   ANTHROPIC_API_KEY  / ANTHROPIC_MODEL  / ANTHROPIC_BASE_URL
 *   AI_TIMEOUT_MS      (기본 20000)   AI_MAX_TOKENS (기본 2048)   AI_TEMPERATURE (기본 0.7)
 *   *_BASE_URL 오버라이드가 가능하므로 로컬 프록시·사내 게이트웨이·목 서버 테스트가 가능합니다.
 * ============================================================================
 */

const { getAiConfig, maskSensitiveString } = require('../config/envLoader');

/** 재시도 대상 HTTP 상태 코드 (일시적 오류) */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/**
 * AI가 생성한 텍스트에서 JSON 객체만 안전하게 추출합니다.
 * (모델이 ```json ... ``` 코드블록이나 설명 문구를 섞어 보내도 복구합니다)
 * @param {string} rawText 모델 원본 응답 텍스트
 * @returns {Object|null} 파싱된 객체 (실패 시 null)
 */
function extractJsonObject(rawText) {
    if (!rawText || typeof rawText !== 'string') {
        return null;
    }

    let cleaned = rawText.trim();

    // 1) 마크다운 코드블록 제거 (```json ... ``` / ``` ... ```)
    const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (codeBlockMatch && codeBlockMatch[1]) {
        cleaned = codeBlockMatch[1].trim();
    }

    // 2) 그대로 파싱 시도
    try {
        const parsed = JSON.parse(cleaned);
        if (parsed && typeof parsed === 'object') {
            return parsed;
        }
    } catch (err) {
        /* 아래 단계로 진행 */
    }

    // 3) 첫 번째 '{' ~ 마지막 '}' 구간만 잘라서 파싱 시도
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        const sliced = cleaned.slice(firstBrace, lastBrace + 1);
        try {
            const parsed = JSON.parse(sliced);
            if (parsed && typeof parsed === 'object') {
                return parsed;
            }
        } catch (err) {
            return null;
        }
    }

    return null;
}

/**
 * AbortController 기반 타임아웃이 적용된 fetch 래퍼입니다.
 * @param {string} url 요청 URL
 * @param {Object} options fetch 옵션
 * @param {number} timeoutMs 타임아웃(ms)
 */
async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

/**
 * 지수 백오프(Exponential Backoff)를 적용한 HTTP 호출 (최대 attempts회)
 */
async function callWithRetry(url, options, timeoutMs, attempts = 2) {
    let lastError = null;

    for (let i = 0; i < attempts; i += 1) {
        try {
            const response = await fetchWithTimeout(url, options, timeoutMs);
            const rawBody = await response.text();

            if (!response.ok) {
                // 재시도 가능한 상태코드면 잠시 대기 후 재시도
                if (RETRYABLE_STATUS.has(response.status) && i < attempts - 1) {
                    await new Promise((r) => setTimeout(r, 400 * (i + 1) + 200));
                    continue;
                }
                return {
                    ok: false,
                    status: response.status,
                    error: `AI 제공자 HTTP ${response.status}: ${rawBody.slice(0, 300)}`
                };
            }

            return { ok: true, status: response.status, rawBody };
        } catch (err) {
            lastError = err;
            const isAbort = err && err.name === 'AbortError';
            if (i < attempts - 1) {
                await new Promise((r) => setTimeout(r, 400 * (i + 1) + 200));
                continue;
            }
            return {
                ok: false,
                status: 0,
                error: isAbort
                    ? `AI 제공자 응답 타임아웃(${timeoutMs}ms 초과)`
                    : `AI 제공자 네트워크 오류: ${err.message}`
            };
        }
    }

    return { ok: false, status: 0, error: lastError ? lastError.message : '알 수 없는 AI 호출 오류' };
}

/**
 * 이미지 입력을 벤더 공통 규격으로 정규화합니다.
 * - data URL (data:image/jpeg;base64,....)
 * - 순수 base64 문자열
 * - http(s) 원격 URL (서버에서 1회 다운로드 후 base64로 변환)
 * @returns {Promise<{ base64: string, mimeType: string, source: string }|null>}
 */
async function normalizeImageInput(imageInput) {
    const raw = String(imageInput || '').trim();
    if (!raw) {
        return null;
    }

    // 1) data URL 형태
    const dataUrlMatch = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (dataUrlMatch) {
        return { base64: dataUrlMatch[2], mimeType: dataUrlMatch[1], source: 'DATA_URL' };
    }

    // 2) 순수 base64 (공백·개행 제거 후 판정)
    const compact = raw.replace(/\s+/g, '');
    if (/^[A-Za-z0-9+/=]{200,}$/.test(compact)) {
        return { base64: compact, mimeType: 'image/jpeg', source: 'RAW_BASE64' };
    }

    // 3) 원격 URL → 서버에서 내려받아 base64 변환
    if (/^https?:\/\//i.test(raw)) {
        try {
            const timeoutMs = 8000;
            const response = await fetchWithTimeout(raw, { method: 'GET' }, timeoutMs);
            if (!response.ok) {
                return null;
            }
            const buffer = Buffer.from(await response.arrayBuffer());
            const contentType = (response.headers.get('content-type') || 'image/jpeg').split(';')[0];
            return {
                base64: buffer.toString('base64'),
                mimeType: contentType.startsWith('image/') ? contentType : 'image/jpeg',
                source: 'REMOTE_URL'
            };
        } catch (err) {
            return null;
        }
    }

    return null;
}

// ============================================================================
// [벤더별 구현] OpenAI (Chat Completions + Vision)
// ============================================================================
async function callOpenAi(config, { systemPrompt, userPrompt, image, temperature, maxTokens, timeoutMs }) {
    const userContent = [{ type: 'text', text: userPrompt }];
    if (image) {
        userContent.push({
            type: 'image_url',
            image_url: { url: `data:${image.mimeType};base64,${image.base64}` }
        });
    }

    const payload = {
        model: config.model,
        temperature,
        max_tokens: maxTokens,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent }
        ]
    };

    // OpenAI는 JSON 모드(response_format)를 공식 지원합니다.
    payload.response_format = { type: 'json_object' };

    const result = await callWithRetry(
        `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${config.apiKey}`
            },
            body: JSON.stringify(payload)
        },
        timeoutMs
    );

    if (!result.ok) {
        return result;
    }

    try {
        const json = JSON.parse(result.rawBody);
        const text = json && json.choices && json.choices[0] && json.choices[0].message
            ? json.choices[0].message.content
            : '';
        return { ok: true, text, raw: json };
    } catch (err) {
        return { ok: false, error: `OpenAI 응답 파싱 실패: ${err.message}` };
    }
}

// ============================================================================
// [벤더별 구현] Google Gemini (generateContent + inline_data Vision)
// ============================================================================
async function callGemini(config, { systemPrompt, userPrompt, image, temperature, maxTokens, timeoutMs }) {
    const parts = [{ text: userPrompt }];
    if (image) {
        parts.push({ inline_data: { mime_type: image.mimeType, data: image.base64 } });
    }

    const payload = {
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts }],
        generationConfig: {
            temperature,
            maxOutputTokens: maxTokens,
            responseMimeType: 'application/json'
        }
    };

    const url = `${config.baseUrl.replace(/\/+$/, '')}/models/${config.model}:generateContent?key=${encodeURIComponent(config.apiKey)}`;

    const result = await callWithRetry(
        url,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        },
        timeoutMs
    );

    if (!result.ok) {
        return result;
    }

    try {
        const json = JSON.parse(result.rawBody);
        const candidate = json && json.candidates && json.candidates[0];
        const textParts = candidate && candidate.content && Array.isArray(candidate.content.parts)
            ? candidate.content.parts.map((p) => p.text || '').join('')
            : '';
        return { ok: true, text: textParts, raw: json };
    } catch (err) {
        return { ok: false, error: `Gemini 응답 파싱 실패: ${err.message}` };
    }
}

// ============================================================================
// [벤더별 구현] Anthropic Claude (Messages + base64 Vision)
// ============================================================================
async function callAnthropic(config, { systemPrompt, userPrompt, image, temperature, maxTokens, timeoutMs }) {
    const content = [];
    if (image) {
        content.push({
            type: 'image',
            source: { type: 'base64', media_type: image.mimeType, data: image.base64 }
        });
    }
    content.push({ type: 'text', text: userPrompt });

    const payload = {
        model: config.model,
        max_tokens: maxTokens,
        temperature,
        system: systemPrompt,
        messages: [{ role: 'user', content }]
    };

    const result = await callWithRetry(
        `${config.baseUrl.replace(/\/+$/, '')}/messages`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': config.apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify(payload)
        },
        timeoutMs
    );

    if (!result.ok) {
        return result;
    }

    try {
        const json = JSON.parse(result.rawBody);
        const blocks = Array.isArray(json && json.content) ? json.content : [];
        const text = blocks.map((b) => (b && b.type === 'text' ? b.text : '')).join('');
        return { ok: true, text, raw: json };
    } catch (err) {
        return { ok: false, error: `Anthropic 응답 파싱 실패: ${err.message}` };
    }
}

const VENDOR_CALLS = {
    openai: callOpenAi,
    gemini: callGemini,
    anthropic: callAnthropic
};

/**
 * [핵심 공개 함수 1] JSON 객체를 생성하는 AI 호출
 * @param {Object} params
 * @param {string} params.systemPrompt 시스템 역할 프롬프트
 * @param {string} params.userPrompt 사용자 프롬프트
 * @param {string} [params.imageBase64] Vision 분석용 이미지(선택)
 * @param {number} [params.temperature]
 * @param {number} [params.maxTokens]
 * @param {number} [params.timeoutMs]
 * @returns {Promise<{ ok: boolean, data: Object|null, error?: string, meta: Object }>}
 */
async function generateJsonObject(params = {}) {
    const config = getAiConfig();
    const startedAt = Date.now();

    const meta = {
        mode: config.mode,
        provider: config.provider,
        model: config.model,
        requestedAt: new Date(startedAt).toISOString()
    };

    if (!config.enabled) {
        return {
            ok: false,
            data: null,
            error: config.reason || 'AI 제공자 키가 설정되지 않아 로컬 결정론적 엔진으로 동작합니다.',
            meta: { ...meta, fallbackUsed: true }
        };
    }

    const image = params.imageBase64 ? await normalizeImageInput(params.imageBase64) : null;
    const callArgs = {
        systemPrompt: params.systemPrompt || '당신은 한국 최고 수준의 뷰티·피부 큐레이터입니다. 반드시 유효한 JSON만 출력하세요.',
        userPrompt: params.userPrompt || '',
        image,
        temperature: params.temperature !== undefined ? params.temperature : config.temperature,
        maxTokens: params.maxTokens || config.maxTokens,
        timeoutMs: params.timeoutMs || config.timeoutMs
    };

    const vendorCall = VENDOR_CALLS[config.provider];
    if (!vendorCall) {
        return {
            ok: false,
            data: null,
            error: `지원하지 않는 AI_PROVIDER 입니다: ${config.provider}`,
            meta: { ...meta, fallbackUsed: true }
        };
    }

    const result = await vendorCall(config, callArgs);
    const latencyMs = Date.now() - startedAt;

    if (!result || !result.ok) {
        return {
            ok: false,
            data: null,
            error: (result && result.error) || 'AI 호출 실패',
            meta: { ...meta, latencyMs, fallbackUsed: true }
        };
    }

    const parsed = extractJsonObject(result.text);
    if (!parsed) {
        return {
            ok: false,
            data: null,
            error: 'AI 응답을 JSON으로 파싱하지 못했습니다.',
            meta: { ...meta, latencyMs, fallbackUsed: true }
        };
    }

    return {
        ok: true,
        data: parsed,
        meta: { ...meta, latencyMs, fallbackUsed: false, imageSource: image ? image.source : null }
    };
}

/**
 * [핵심 공개 함수 2] 외부/클라이언트에 노출해도 안전한 AI 연동 상태 정보
 */
function getAiStatus() {
    const config = getAiConfig();
    return {
        enabled: config.enabled,
        mode: config.mode,
        provider: config.provider,
        model: config.model,
        apiKeyMasked: config.apiKey ? maskSensitiveString(config.apiKey) : null,
        timeoutMs: config.timeoutMs,
        reason: config.reason || null,
        supportedProviders: ['gemini', 'openai', 'anthropic'],
        fallbackEngine: 'LOCAL_DETERMINISTIC_ENGINE (glowEngine.js)'
    };
}

module.exports = {
    generateJsonObject,
    getAiStatus,
    extractJsonObject,
    normalizeImageInput
};
