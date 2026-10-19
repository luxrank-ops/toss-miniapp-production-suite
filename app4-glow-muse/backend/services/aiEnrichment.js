/**
 * ============================================================================
 * 파일명: backend/services/aiEnrichment.js
 * 역할: [실제 AI 프롬프트 설계 + 응답 검증·병합(Sanitize & Merge) 계층]
 * ----------------------------------------------------------------------------
 * 설계 원칙 (절대 타협 불가):
 *   1) **AI는 "텍스트"만 생성하고, "돈·점수 원장"은 서버가 통제한다.**
 *      - 환불/절약 금액(preventedWasteKrw), 글로우 지수(glowIndexScore) 등
 *        비즈니스 지표는 결정론적 엔진 값을 유지해 데이터 정합성을 보장합니다.
 *      - AI가 임의로 "연 5억 원 절약" 같은 허위 수치를 만들지 못하게 차단합니다.
 *   2) AI 응답은 **반드시 스키마 검증 + 타입 강제 + 길이 제한**을 거칩니다.
 *      (LLM 환각·프롬프트 인젝션으로 인한 프론트엔드 렌더링 파괴 원천 차단)
 *   3) AI 실패 시 항상 기존 결과를 그대로 반환합니다. (무중단 폴백)
 * ============================================================================
 */

const { generateJsonObject, getAiStatus } = require('./aiProvider');
const { buildRecoveryCurves } = require('./glowEngine');

/** 문자열 배열로 안전하게 변환 (최대 maxItems개, 항목당 maxLen자) */
function sanitizeStringArray(value, maxItems = 4, maxLen = 220) {
    if (!Array.isArray(value)) {
        return null;
    }
    const cleaned = value
        .map((item) => String(item || '').replace(/\s+/g, ' ').trim())
        .filter((item) => item.length > 0)
        .slice(0, maxItems)
        .map((item) => (item.length > maxLen ? `${item.slice(0, maxLen)}…` : item));
    return cleaned.length > 0 ? cleaned : null;
}

/** 0~100 정수로 강제 변환 (잘못된 값이면 null) */
function sanitizeScore(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
        return null;
    }
    return Math.max(0, Math.min(100, Math.round(num)));
}

/** 일반 문자열 정제 */
function sanitizeText(value, maxLen = 400, fallback = null) {
    if (value === undefined || value === null) {
        return fallback;
    }
    const text = String(value).replace(/\s+/g, ' ').trim();
    if (!text) {
        return fallback;
    }
    // 말줄임표(…)까지 포함해 maxLen을 넘지 않도록 절단 (LLM 초과 출력 방어)
    return text.length > maxLen ? `${text.slice(0, Math.max(1, maxLen - 1))}…` : text;
}

// ============================================================================
// [1] AI 피부 장벽 스캔 (Vision)
// ============================================================================

const SKIN_SCAN_SYSTEM_PROMPT = [
    '당신은 서울 청담동 프리미엄 피부과에서 15년 이상 근무한 피부 분석 전문가입니다.',
    '제공된 얼굴 사진을 분석해 피부 장벽(Skin Barrier) 상태를 진단합니다.',
    '반드시 아래 JSON 스키마를 만족하는 유효한 JSON 객체만 출력하세요. 설명문, 마크다운, 코드블록은 절대 포함하지 마세요.',
    '',
    'JSON 스키마:',
    '{',
    '  "skinType": "피부 타입 요약 (30자 이내)",',
    '  "skinAge": 추정 피부 나이(정수 18~70),',
    '  "skinBarrierScore": 피부 장벽 점수(정수 0~100),',
    '  "barrierStatus": "양호" | "주의" | "위험" 중 하나,',
    '  "aiAnalysisText": "전문가 분석 소견 (250자 이내, 한국어, 친근하지만 전문적인 톤)",',
    '  "metrics": [',
    '    { "id": "hydration", "score": 0~100, "summary": "한 줄 설명(80자 이내)" },',
    '    { "id": "oil_balance", "score": 0~100, "summary": "..." },',
    '    { "id": "ceramide_density", "score": 0~100, "summary": "..." },',
    '    { "id": "pore_elasticity", "score": 0~100, "summary": "..." },',
    '    { "id": "redness_defense", "score": 0~100, "summary": "..." }',
    '  ],',
    '  "sosCareRoutine": ["오늘 밤 실행할 1단계", "2단계", "3단계"],',
    '  "recommendedIngredients": [',
    '    { "name": "성분명/제품 카테고리", "benefit": "기대 효과", "matchingProductType": "제품 유형", "oliveYoungKeyword": "올리브영 검색 키워드" }',
    '  ]',
    '}',
    '',
    '의료 행위가 아닌 뷰티 컨설팅 목적이므로 단정적 질병 진단 표현은 피하고,',
    '사진이 흐릿하거나 얼굴이 명확하지 않으면 "aiAnalysisText"에 정중히 재촬영을 안내하세요.'
].join('\n');

function buildSkinScanUserPrompt(context) {
    return [
        `사용자 실제 나이: ${context.userAge}세`,
        context.skinConcern ? `사용자가 직접 선택한 주요 고민: ${context.skinConcern}` : '',
        '',
        '위 사진을 분석하여 JSON 스키마에 맞춰 진단 결과를 출력하세요.',
        'metrics 배열은 반드시 5개 항목을 모두 포함하고, id 값은 스키마와 정확히 일치해야 합니다.'
    ].filter(Boolean).join('\n');
}

/**
 * AI Vision 스캔 결과를 기존 결과에 안전하게 병합합니다.
 * - 점수/지표는 AI 값을 신뢰하되 범위 검증
 * - 4주 회복 곡선은 AI 점수 기반으로 서버가 재계산(수학적 정합성 보장)
 * - 최저가 배지·CPA 오퍼는 기존 비즈니스 로직 유지
 */
function mergeSkinScanResult(baseResult, aiJson) {
    if (!aiJson || typeof aiJson !== 'object') {
        return { merged: baseResult, appliedFields: [] };
    }

    const appliedFields = [];
    const merged = { ...baseResult };

    const skinType = sanitizeText(aiJson.skinType, 60);
    if (skinType) {
        merged.skinType = skinType;
        appliedFields.push('skinType');
    }

    const rawSkinAge = Number(aiJson.skinAge);
    if (Number.isFinite(rawSkinAge)) {
        merged.skinAge = Math.max(18, Math.min(70, Math.round(rawSkinAge)));
        appliedFields.push('skinAge');
    }

    const barrierScore = sanitizeScore(aiJson.skinBarrierScore);
    if (barrierScore !== null) {
        merged.skinBarrierScore = barrierScore;
        merged.barrierStatus = barrierScore >= 80 ? '양호' : (barrierScore >= 65 ? '주의' : '위험');
        appliedFields.push('skinBarrierScore', 'barrierStatus');
    } else if (['양호', '주의', '위험'].includes(aiJson.barrierStatus)) {
        merged.barrierStatus = aiJson.barrierStatus;
        appliedFields.push('barrierStatus');
    }

    const analysisText = sanitizeText(aiJson.aiAnalysisText, 400);
    if (analysisText) {
        merged.aiAnalysisText = analysisText;
        appliedFields.push('aiAnalysisText');
    }

    // 5대 지표 병합 (id 매칭, 없으면 기존 값 유지)
    if (Array.isArray(aiJson.metrics) && Array.isArray(baseResult.metrics)) {
        const metricLabelMap = baseResult.metrics.reduce((acc, m) => {
            acc[m.id] = m.label;
            return acc;
        }, {});

        const aiMetrics = aiJson.metrics
            .filter((m) => m && metricLabelMap[m.id])
            .map((m) => {
                const score = sanitizeScore(m.score);
                const summary = sanitizeText(m.summary, 160);
                if (score === null && !summary) {
                    return null;
                }
                const baseMetric = baseResult.metrics.find((x) => x.id === m.id);
                return {
                    id: m.id,
                    label: metricLabelMap[m.id],
                    score: score !== null ? score : baseMetric.score,
                    status: score === null ? baseMetric.status : (score >= 80 ? '양호' : (score >= 65 ? '주의' : '위험')),
                    summary: summary || baseMetric.summary
                };
            })
            .filter(Boolean);

        if (aiMetrics.length >= 3) {
            merged.metrics = aiMetrics;
            appliedFields.push('metrics');
        }
    }

    const sosRoutine = sanitizeStringArray(aiJson.sosCareRoutine, 3, 260);
    if (sosRoutine) {
        merged.sosCareRoutine = sosRoutine;
        appliedFields.push('sosCareRoutine');
    }

    if (Array.isArray(aiJson.recommendedIngredients) && aiJson.recommendedIngredients.length > 0) {
        const ingredients = aiJson.recommendedIngredients.slice(0, 3).map((item, index) => {
            const name = sanitizeText(item && item.name, 60);
            if (!name) {
                return null;
            }
            const baseItem = (baseResult.recommendedIngredients || [])[index] || {};
            return {
                name,
                benefit: sanitizeText(item.benefit, 140, baseItem.benefit || '피부 장벽 개선'),
                reason: sanitizeText(item.benefit, 140, baseItem.reason || 'AI 맞춤 추천'),
                matchingProductType: sanitizeText(item.matchingProductType, 40, baseItem.matchingProductType || '스킨케어'),
                oliveYoungKeyword: sanitizeText(item.oliveYoungKeyword, 40, name),
                lowestPriceBadge: baseItem.lowestPriceBadge || '최저가 비교 중'
            };
        }).filter(Boolean);

        if (ingredients.length > 0) {
            merged.recommendedIngredients = ingredients;
            appliedFields.push('recommendedIngredients');
        }
    }

    // 회복 곡선은 서버가 점수 기반으로 재계산 (AI가 임의 배열을 넣어도 무시)
    const curves = buildRecoveryCurves(merged.skinBarrierScore);
    merged.recoveryComparison = {
        ...(baseResult.recoveryComparison || {}),
        ...curves,
        clinicCpaOffer: (baseResult.recoveryComparison && baseResult.recoveryComparison.clinicCpaOffer) || ''
    };
    appliedFields.push('recoveryComparison');

    return { merged, appliedFields };
}

/**
 * [공개] 실제 AI Vision으로 피부 스캔 수행
 * @returns {Promise<{ result: Object, aiMeta: Object }>} 실패 시 원본 그대로 반환
 */
async function runAiSkinScan({ imageBase64, userAge, skinConcern, baseResult }) {
    const aiStatus = getAiStatus();

    if (!aiStatus.enabled) {
        return { result: baseResult, aiMeta: { ...aiStatus, applied: false, fallbackUsed: true } };
    }

    const aiResponse = await generateJsonObject({
        systemPrompt: SKIN_SCAN_SYSTEM_PROMPT,
        userPrompt: buildSkinScanUserPrompt({ userAge, skinConcern }),
        imageBase64,
        temperature: 0.4,
        timeoutMs: aiStatus.timeoutMs
    });

    if (!aiResponse.ok || !aiResponse.data) {
        return {
            result: baseResult,
            aiMeta: {
                provider: aiStatus.provider,
                model: aiStatus.model,
                applied: false,
                fallbackUsed: true,
                error: aiResponse.error,
                latencyMs: (aiResponse.meta && aiResponse.meta.latencyMs) || 0
            }
        };
    }

    const { merged, appliedFields } = mergeSkinScanResult(baseResult, aiResponse.data);

    return {
        result: merged,
        aiMeta: {
            provider: aiStatus.provider,
            model: aiStatus.model,
            applied: appliedFields.length > 0,
            appliedFields,
            fallbackUsed: false,
            latencyMs: aiResponse.meta.latencyMs,
            imageSource: aiResponse.meta.imageSource
        }
    };
}

// ============================================================================
// [2] AI 프리미엄 처방전 생성 (Text LLM)
// ============================================================================

const REPORT_SYSTEM_PROMPT = [
    '당신은 한국 2030 여성 뷰티 트렌드에 정통한 "청담동 시크릿 뷰티 큐레이터"입니다.',
    '사용자의 프로필을 바탕으로 개인화된 뷰티 처방전의 "텍스트"만 작성합니다.',
    '톤앤매너: 친근하고 자신감 넘치며, 구체적인 실행 행동(Action Item)을 제시합니다.',
    '금액·점수·의학적 단정 표현은 절대 생성하지 마세요(서버가 별도 계산합니다).',
    '반드시 아래 JSON 스키마만 출력하세요. 코드블록·설명문 금지.',
    '',
    '{',
    '  "museAuraTitle": "아우라 한 줄 타이틀(24자 이내)",',
    '  "museAuraBadge": "상위 N% ... 형식의 배지 문구(28자 이내)",',
    '  "summaryComment": "종합 코멘트(180자 이내)",',
    '  "bioSkinAgeDiff": "예: -4.2세 동안 잠재력 (18자 이내)",',
    '  "prescription1": {',
    '    "coreInsight": "추구미 핵심 인사이트(160자 이내)",',
    '    "actionItems": ["실행 팁 1", "실행 팁 2", "실행 팁 3"],',
    '    "worstWarning": "최악의 스타일링 경고(120자 이내)"',
    '  },',
    '  "prescription3": {',
    '    "goldenWindow": "황금기 설명(120자 이내)",',
    '    "dangerWindow": "위험기 설명(120자 이내)",',
    '    "calendarPlan": ["1~7일차", "8~14일차", "15~21일차", "22~28일차"]',
    '  },',
    '  "prescription4": { "secretInnerBeauty": "이너뷰티 시크릿(180자 이내)" },',
    '  "aiModelNote": "이 리포트를 생성한 모델 관점의 짧은 메모(80자 이내)"',
    '}'
].join('\n');

function buildReportUserPrompt(profile, baseReport) {
    const overview = baseReport.overview || {};
    return [
        `닉네임: ${profile.nickname}`,
        `연령대: ${profile.ageGroup}`,
        `관심 모드: ${profile.focusMode}`,
        `추구미(페이스 바이브): ${profile.faceVibe}`,
        `피부 고민: ${profile.skinConcern}`,
        `생체 주기: ${profile.cyclePhase}`,
        `월 뷰티 지출: ${profile.monthlyBeautySpendManwon}만 원`,
        '',
        `기준 아우라: ${overview.museAuraTitle || ''}`,
        `추천 시술: ${(baseReport.prescriptions && baseReport.prescriptions.prescription2_MedicalHomeLoop && baseReport.prescriptions.prescription2_MedicalHomeLoop.recommendedClinic) || ''}`,
        '',
        '위 정보를 근거로 JSON 스키마에 맞춰 개인화 리포트를 작성하세요.'
    ].join('\n');
}

/**
 * AI 리포트를 기존 리포트에 병합 (숫자/금액은 절대 AI 값을 쓰지 않음)
 */
function mergeAiReport(baseReport, aiJson) {
    if (!aiJson || typeof aiJson !== 'object') {
        return { merged: baseReport, appliedFields: [] };
    }

    const appliedFields = [];
    const merged = JSON.parse(JSON.stringify(baseReport));

    const auraTitle = sanitizeText(aiJson.museAuraTitle, 40);
    if (auraTitle) {
        merged.overview.museAuraTitle = auraTitle;
        appliedFields.push('overview.museAuraTitle');
    }

    const auraBadge = sanitizeText(aiJson.museAuraBadge, 44);
    if (auraBadge) {
        merged.overview.museAuraBadge = auraBadge;
        appliedFields.push('overview.museAuraBadge');
    }

    const summaryComment = sanitizeText(aiJson.summaryComment, 260);
    if (summaryComment) {
        // 금액 수치는 서버 계산값(결정론적 엔진)을 유지한 채 문장만 교체
        merged.overview.summaryComment = summaryComment;
        appliedFields.push('overview.summaryComment');
    }

    const bioAge = sanitizeText(aiJson.bioSkinAgeDiff, 24);
    if (bioAge && /\d/.test(bioAge)) {
        merged.overview.bioSkinAgeDiff = bioAge;
        appliedFields.push('overview.bioSkinAgeDiff');
    }

    if (aiJson.prescription1) {
        const p1 = aiJson.prescription1;
        const insight = sanitizeText(p1.coreInsight, 240);
        const items = sanitizeStringArray(p1.actionItems, 4, 200);
        const warning = sanitizeText(p1.worstWarning, 180);
        if (insight) {
            merged.prescriptions.prescription1_Chugumi.coreInsight = insight;
            appliedFields.push('prescription1.coreInsight');
        }
        if (items) {
            merged.prescriptions.prescription1_Chugumi.actionItems = items;
            appliedFields.push('prescription1.actionItems');
        }
        if (warning) {
            merged.prescriptions.prescription1_Chugumi.worstWarning = warning;
            appliedFields.push('prescription1.worstWarning');
        }
    }

    if (aiJson.prescription3) {
        const p3 = aiJson.prescription3;
        const golden = sanitizeText(p3.goldenWindow, 180);
        const danger = sanitizeText(p3.dangerWindow, 180);
        const calendar = sanitizeStringArray(p3.calendarPlan, 4, 200);
        if (golden) {
            merged.prescriptions.prescription3_HormoneGoldenCalendar.goldenWindow = golden;
            appliedFields.push('prescription3.goldenWindow');
        }
        if (danger) {
            merged.prescriptions.prescription3_HormoneGoldenCalendar.dangerWindow = danger;
            appliedFields.push('prescription3.dangerWindow');
        }
        if (calendar) {
            merged.prescriptions.prescription3_HormoneGoldenCalendar.stepByStepCalendar = calendar;
            appliedFields.push('prescription3.stepByStepCalendar');
        }
    }

    if (aiJson.prescription4) {
        const secret = sanitizeText(aiJson.prescription4.secretInnerBeauty, 260);
        if (secret) {
            merged.prescriptions.prescription4_DePuffAndBloodSugar.secretInnerBeauty = secret;
            appliedFields.push('prescription4.secretInnerBeauty');
        }
    }

    const modelNote = sanitizeText(aiJson.aiModelNote, 140);
    if (modelNote) {
        merged.aiModelNote = modelNote;
    }

    return { merged, appliedFields };
}

/**
 * [공개] 실제 LLM으로 프리미엄 처방전 생성
 */
async function runAiReport({ profile, baseReport }) {
    const aiStatus = getAiStatus();

    if (!aiStatus.enabled) {
        return { report: baseReport, aiMeta: { ...aiStatus, applied: false, fallbackUsed: true } };
    }

    const aiResponse = await generateJsonObject({
        systemPrompt: REPORT_SYSTEM_PROMPT,
        userPrompt: buildReportUserPrompt(profile, baseReport),
        temperature: 0.8,
        timeoutMs: aiStatus.timeoutMs
    });

    if (!aiResponse.ok || !aiResponse.data) {
        return {
            report: baseReport,
            aiMeta: {
                provider: aiStatus.provider,
                model: aiStatus.model,
                applied: false,
                fallbackUsed: true,
                error: aiResponse.error,
                latencyMs: (aiResponse.meta && aiResponse.meta.latencyMs) || 0
            }
        };
    }

    const { merged, appliedFields } = mergeAiReport(baseReport, aiResponse.data);

    return {
        report: merged,
        aiMeta: {
            provider: aiStatus.provider,
            model: aiStatus.model,
            applied: appliedFields.length > 0,
            appliedFields,
            fallbackUsed: false,
            latencyMs: aiResponse.meta.latencyMs
        }
    };
}

module.exports = {
    runAiSkinScan,
    runAiReport,
    mergeSkinScanResult,
    mergeAiReport,
    sanitizeStringArray,
    sanitizeScore,
    sanitizeText,
    SKIN_SCAN_SYSTEM_PROMPT,
    REPORT_SYSTEM_PROMPT
};
