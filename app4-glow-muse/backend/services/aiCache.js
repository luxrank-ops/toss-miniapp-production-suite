/**
 * ============================================================================
 * 파일명: backend/services/aiCache.js
 * 역할: [AI 응답 캐싱 계층] 동일 입력 재요청 시 LLM/Vision 호출 비용을 절감합니다.
 * ----------------------------------------------------------------------------
 * 왜 필요한가?
 *   - 피부 스캔·프리미엄 처방전은 "같은 사진 + 같은 프롬프트"로 다시 요청되는 경우가
 *     생각보다 많습니다(새로고침·재시도·다중 탭·동일 사용자 재진입).
 *   - 매 호출마다 과금되는 LLM API 에서 캐시 히트 1건은 곧 원가 절감 1건입니다.
 *     (Thin Wrapper 역마진 방어 = app-business-evaluator 1순위 요구사항)
 *
 * 설계 원칙:
 *   1) 캐시 키 = SHA-256(프롬프트 버전 + provider + model + temperature + maxTokens
 *      + 시스템 프롬프트 해시 + 사용자 프롬프트 해시 + 이미지 바이트 해시)
 *      → 모델·프롬프트가 바뀌면 자동으로 미스가 나서 stale 응답을 재사용하지 않습니다.
 *   2) 응답 본문은 개인화 정보(피부 분석 등)를 포함할 수 있어 **AES-256-GCM 암호화**로만
 *      저장합니다. 원본 이미지·프롬프트는 어디에도 저장하지 않고 해시만 남깁니다.
 *   3) 메모리 LRU + Supabase Read-Through. DB 미설정·장애 시에도 인메모리로 정상 동작.
 *   4) 동일 키 동시 요청은 **Single-Flight** 로 병합해 중복 과금을 막습니다.
 *   5) TTL 만료 레코드는 조회 시 즉시 폐기하고, 메모리 LRU 상한을 강제합니다.
 * ============================================================================
 */

const crypto = require('crypto');
const { getAiCacheConfig, getAiConfig } = require('../config/envLoader');
const persistence = require('./persistenceStore');

/** 런타임 통계 (운영 관제용 — /api/ai/cache/status) */
const stats = {
    hits: 0,
    misses: 0,
    stores: 0,
    dbHits: 0,
    singleFlightJoins: 0,
    evictions: 0,
    expiredPurges: 0,
    skippedTooLarge: 0,
    errors: 0,
    savedCalls: 0
};

/** cacheKey → Promise (동일 키 동시 요청 병합) */
const inflight = new Map();

function sha256Hex(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * 이미지 입력에서 바이트 해시를 계산합니다.
 * - data URL / 순수 base64 / http(s) URL 모두 지원
 * - URL 은 문자열 자체를 해시(원격 다운로드 없이 키 생성) → 호출 경로에서 normalize 후 사용 권장
 * @param {string} imageInput
 * @returns {string|null}
 */
function hashImageInput(imageInput) {
    const raw = String(imageInput || '').trim();
    if (!raw) {
        return null;
    }

    const dataUrlMatch = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (dataUrlMatch) {
        return sha256Hex(Buffer.from(dataUrlMatch[2].replace(/\s+/g, ''), 'base64'));
    }

    const compact = raw.replace(/\s+/g, '');
    if (/^[A-Za-z0-9+/=]{200,}$/.test(compact)) {
        try {
            return sha256Hex(Buffer.from(compact, 'base64'));
        } catch (err) {
            return sha256Hex(compact);
        }
    }

    return sha256Hex(raw);
}

/**
 * 결정론적 캐시 키를 생성합니다.
 * @param {Object} input
 * @param {string} input.requestKind SKIN_SCAN | PREMIUM_REPORT
 * @param {string} input.systemPrompt
 * @param {string} input.userPrompt
 * @param {{base64:string, mimeType:string}|null} input.image 정규화된 이미지
 * @param {number} input.temperature
 * @param {number} input.maxTokens
 * @param {string} input.provider
 * @param {string} input.model
 * @returns {{ cacheKey: string, imageHash: string|null }}
 */
function buildCacheKey(input) {
    const config = getAiCacheConfig();
    const imageHash = input.image
        ? sha256Hex(`${input.image.mimeType}:${input.image.base64}`)
        : null;

    const material = JSON.stringify({
        ns: config.namespace,
        kind: input.requestKind || 'GENERIC',
        provider: input.provider || null,
        model: input.model || null,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        system: sha256Hex(String(input.systemPrompt || '')),
        user: sha256Hex(String(input.userPrompt || '')),
        image: imageHash
    });

    return { cacheKey: sha256Hex(material), imageHash };
}

/** TTL 계산 (요청 종류별 차등) */
function resolveTtlMs(requestKind) {
    const config = getAiCacheConfig();
    return (config.ttlByKind && config.ttlByKind[requestKind]) || config.ttlMs;
}

/** 메모리 LRU 상한 강제 */
function enforceMaxEntries() {
    const config = getAiCacheConfig();
    const memory = persistence.aiCache.memory;
    while (memory.size > config.maxEntries) {
        const oldestKey = memory.keys().next().value;
        if (oldestKey === undefined) {
            break;
        }
        memory.delete(oldestKey);
        stats.evictions += 1;
    }
}

/**
 * 캐시 조회 (메모리 → Supabase Read-Through)
 * @param {string} cacheKey
 * @returns {Promise<{ hit: boolean, data?: Object, layer?: string }>}
 */
async function get(cacheKey) {
    const config = getAiCacheConfig();
    if (!config.enabled) {
        return { hit: false, layer: 'DISABLED' };
    }

    const now = Date.now();
    const cached = persistence.aiCache.memory.get(cacheKey);

    if (cached) {
        const expiresAtMs = Date.parse(cached.expiresAt || 0);
        if (Number.isFinite(expiresAtMs) && expiresAtMs > now) {
            // LRU 갱신
            persistence.aiCache.memory.delete(cacheKey);
            persistence.aiCache.memory.set(cacheKey, cached);
            stats.hits += 1;
            stats.savedCalls += 1;
            return { hit: true, data: cached.data, layer: 'MEMORY' };
        }
        persistence.aiCache.memory.delete(cacheKey);
        stats.expiredPurges += 1;
    }

    if (config.persist) {
        try {
            const hydrated = await persistence.aiCache.hydrate(cacheKey);
            if (hydrated && hydrated.data) {
                const expiresAtMs = Date.parse(hydrated.expiresAt || 0);
                if (Number.isFinite(expiresAtMs) && expiresAtMs > now) {
                    hydrated.hitCount = Number(hydrated.hitCount || 0) + 1;
                    hydrated.lastHitAt = new Date().toISOString();
                    persistence.aiCache.memory.set(cacheKey, hydrated);
                    enforceMaxEntries();
                    stats.hits += 1;
                    stats.dbHits += 1;
                    stats.savedCalls += 1;
                    // 히트 카운터는 best-effort 로 DB 에 반영
                    persistence.aiCache.set(cacheKey, hydrated).catch(() => {});
                    return { hit: true, data: hydrated.data, layer: 'SUPABASE' };
                }
                // 만료된 DB 레코드는 지연 정리
                persistence.aiCache.remove(cacheKey).catch(() => {});
                stats.expiredPurges += 1;
            }
        } catch (err) {
            stats.errors += 1;
        }
    }

    stats.misses += 1;
    return { hit: false, layer: config.persist ? 'MISS' : 'MISS_MEMORY_ONLY' };
}

/**
 * 캐시 저장
 * @param {Object} input
 * @param {string} input.cacheKey
 * @param {string} input.requestKind
 * @param {string} input.provider
 * @param {string} input.model
 * @param {string|null} input.imageHash
 * @param {Object} input.data AI가 반환한 JSON 객체
 * @param {number} [input.ttlMs]
 * @returns {Promise<{ stored: boolean, reason?: string }>}
 */
async function set(input) {
    const config = getAiCacheConfig();
    if (!config.enabled || !input || !input.cacheKey || !input.data) {
        return { stored: false, reason: 'DISABLED_OR_EMPTY' };
    }

    const serialized = JSON.stringify(input.data);
    if (Buffer.byteLength(serialized, 'utf8') > config.maxPayloadBytes) {
        stats.skippedTooLarge += 1;
        return { stored: false, reason: 'PAYLOAD_TOO_LARGE' };
    }

    const ttlMs = Number(input.ttlMs) || resolveTtlMs(input.requestKind);
    const record = {
        cacheKey: input.cacheKey,
        requestKind: input.requestKind || 'GENERIC',
        provider: input.provider || null,
        model: input.model || null,
        imageHash: input.imageHash || null,
        data: input.data,
        expiresAt: new Date(Date.now() + ttlMs).toISOString(),
        hitCount: 0,
        createdAt: new Date().toISOString(),
        lastHitAt: null
    };

    persistence.aiCache.memory.set(input.cacheKey, record);
    enforceMaxEntries();
    stats.stores += 1;

    if (config.persist) {
        try {
            await persistence.aiCache.set(input.cacheKey, record);
        } catch (err) {
            stats.errors += 1;
        }
    }

    return { stored: true };
}

/**
 * 동일 키 동시 요청을 병합합니다. (Single-Flight)
 * - 두 번째 요청은 첫 번째 요청의 결과를 공유하므로 벤더 호출이 1회만 발생합니다.
 * @template T
 * @param {string} cacheKey
 * @param {() => Promise<T>} producer
 * @returns {Promise<{ value: T, shared: boolean }>}
 */
async function withSingleFlight(cacheKey, producer) {
    if (inflight.has(cacheKey)) {
        stats.singleFlightJoins += 1;
        stats.savedCalls += 1;
        const value = await inflight.get(cacheKey);
        return { value, shared: true };
    }

    const promise = (async () => producer())();
    inflight.set(cacheKey, promise);

    try {
        const value = await promise;
        return { value, shared: false };
    } finally {
        inflight.delete(cacheKey);
    }
}

/** 메모리 만료 항목 정리 (스케줄러/관리 API 용) */
function purgeExpiredMemory() {
    const now = Date.now();
    let purged = 0;
    for (const [key, record] of persistence.aiCache.memory.entries()) {
        const expiresAtMs = Date.parse(record.expiresAt || 0);
        if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) {
            persistence.aiCache.memory.delete(key);
            purged += 1;
        }
    }
    stats.expiredPurges += purged;
    return purged;
}

/** 관리자 전체 비우기 (메모리 + DB best-effort) */
async function clear() {
    const keys = [...persistence.aiCache.memory.keys()];
    persistence.aiCache.memory.clear();
    for (const key of keys) {
        persistence.aiCache.remove(key).catch(() => {});
    }
    return { cleared: keys.length };
}

/**
 * 캐시 상태 스냅샷 — 절대 비밀키·프롬프트·이미지를 노출하지 않습니다.
 */
function getCacheStatus() {
    const config = getAiCacheConfig();
    const aiConfig = getAiConfig();
    const memorySize = persistence.aiCache.size;
    const lookups = stats.hits + stats.misses;
    const hitRate = lookups > 0 ? Number(((stats.hits / lookups) * 100).toFixed(2)) : 0;

    return {
        enabled: config.enabled,
        mode: config.enabled ? 'CACHE_ACTIVE' : 'CACHE_DISABLED',
        namespace: config.namespace,
        ttlMs: config.ttlMs,
        ttlByKind: config.ttlByKind,
        maxEntries: config.maxEntries,
        persistence: config.persist && persistence.getStatus().configured ? 'SUPABASE' : 'MEMORY_ONLY',
        aiProvider: aiConfig.provider,
        aiModel: aiConfig.model,
        memoryEntries: memorySize,
        metrics: {
            ...stats,
            lookups,
            hitRatePercent: hitRate,
            estimatedUsdSaved: Number((stats.savedCalls * config.unitCostUsd).toFixed(4)),
            unitCostUsd: config.unitCostUsd
        }
    };
}

module.exports = {
    buildCacheKey,
    hashImageInput,
    resolveTtlMs,
    get,
    set,
    withSingleFlight,
    purgeExpiredMemory,
    clear,
    getCacheStatus,
    stats
};
