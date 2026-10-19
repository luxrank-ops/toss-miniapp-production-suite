/**
 * ============================================================================
 * 파일명: backend/services/supabaseClient.js
 * 역할: [무(無)의존성 Supabase(PostgREST) 클라이언트]
 * ----------------------------------------------------------------------------
 * 왜 npm 패키지(@supabase/supabase-js)를 쓰지 않는가?
 *   - 본 프로젝트는 "Node 기본 모듈만으로 즉시 실행"되는 제로 디펜던시 아키텍처입니다.
 *   - Supabase 는 내부적으로 PostgREST REST API 를 그대로 노출하므로,
 *     `fetch` + `apikey` / `Authorization: Bearer` 헤더만으로 완전히 동일하게 동작합니다.
 *   - 덕분에 `npm install` 없이도 .env 키 주입만으로 즉시 DB 영속화가 켜집니다.
 *
 * 안정성 설계 (절대 throw 하지 않음):
 *   - 모든 함수는 { ok, data, error } 형태로 결과를 반환합니다.
 *   - 네트워크 오류·타임아웃·HTTP 오류는 모두 ok:false 로 흡수되어
 *     상위 계층이 인메모리 폴백으로 자연스럽게 전환됩니다. (서비스 중단 방지)
 *   - 연속 실패 시 서킷 브레이커(Circuit Breaker)가 열려 장애 구간 동안
 *     불필요한 재시도로 요청 지연이 늘어나는 것을 막습니다.
 * ============================================================================
 */

const { getSupabaseConfig } = require('../config/envLoader');

/** 연속 실패 허용 횟수 (초과 시 서킷 브레이커 오픈) */
const FAILURE_THRESHOLD = 3;
/** 서킷 브레이커 오픈 후 재시도까지의 대기 시간(ms) */
const COOLDOWN_MS = 30000;

const state = {
    consecutiveFailures: 0,
    circuitOpenUntil: 0,
    lastError: null,
    lastSuccessAt: null,
    totalRequests: 0,
    totalFailures: 0
};

function isCircuitOpen() {
    return Date.now() < state.circuitOpenUntil;
}

function registerSuccess() {
    state.consecutiveFailures = 0;
    state.circuitOpenUntil = 0;
    state.lastError = null;
    state.lastSuccessAt = new Date().toISOString();
}

function registerFailure(errorMessage) {
    state.consecutiveFailures += 1;
    state.totalFailures += 1;
    state.lastError = errorMessage;

    if (state.consecutiveFailures >= FAILURE_THRESHOLD) {
        state.circuitOpenUntil = Date.now() + COOLDOWN_MS;
        console.warn(`[Supabase] 연속 ${state.consecutiveFailures}회 실패 → ${COOLDOWN_MS / 1000}초간 인메모리 폴백으로 전환합니다. (마지막 오류: ${errorMessage})`);
    }
}

/**
 * PostgREST 공통 호출 함수
 * @param {string} method HTTP 메서드
 * @param {string} path '/테이블명?쿼리' 형식
 * @param {Object} options { body, prefer }
 */
async function call(method, path, options = {}) {
    const config = getSupabaseConfig();

    if (!config.enabled) {
        return { ok: false, error: config.reason || 'Supabase가 설정되지 않았습니다.', code: 'NOT_CONFIGURED' };
    }

    if (isCircuitOpen()) {
        return { ok: false, error: '서킷 브레이커가 열려 있어 일시적으로 인메모리 모드로 동작합니다.', code: 'CIRCUIT_OPEN' };
    }

    const headers = {
        apikey: config.serviceKey,
        Authorization: `Bearer ${config.serviceKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
    };

    if (options.prefer) {
        headers.Prefer = options.prefer;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    state.totalRequests += 1;

    try {
        const response = await fetch(`${config.restUrl}${path}`, {
            method,
            headers,
            body: options.body ? JSON.stringify(options.body) : undefined,
            signal: controller.signal
        });

        const rawBody = await response.text();
        let parsed = null;
        try {
            parsed = rawBody ? JSON.parse(rawBody) : null;
        } catch (err) {
            parsed = null;
        }

        if (!response.ok) {
            const message = (parsed && (parsed.message || parsed.error || parsed.hint))
                || rawBody.slice(0, 300)
                || `HTTP ${response.status}`;
            registerFailure(`HTTP ${response.status} ${message}`);
            return { ok: false, error: message, status: response.status, code: 'HTTP_ERROR' };
        }

        registerSuccess();
        return { ok: true, data: parsed };
    } catch (err) {
        const isAbort = err && err.name === 'AbortError';
        const message = isAbort
            ? `Supabase 요청 타임아웃(${config.timeoutMs}ms)`
            : `Supabase 네트워크 오류: ${err.message}`;
        registerFailure(message);
        return { ok: false, error: message, code: isAbort ? 'TIMEOUT' : 'NETWORK_ERROR' };
    } finally {
        clearTimeout(timer);
    }
}

/** PostgREST 필터 객체를 쿼리스트링으로 변환 (eq 필터 전용 경량 구현) */
function buildFilterQuery(filters = {}) {
    const pairs = Object.entries(filters)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([column, value]) => `${column}=eq.${encodeURIComponent(String(value))}`);
    return pairs.length > 0 ? `?${pairs.join('&')}` : '';
}

/** 행 삽입 (이미 존재하면 병합 upsert) */
async function upsertRow(table, row, conflictColumn) {
    const config = getSupabaseConfig();
    if (!config.enabled) {
        return { ok: false, error: 'Supabase 미설정', code: 'NOT_CONFIGURED' };
    }

    const query = conflictColumn ? `?on_conflict=${encodeURIComponent(conflictColumn)}` : '';

    return call('POST', `/${table}${query}`, {
        body: row,
        // 중복 키 충돌 시 병합(업데이트) + 결과 표현 반환
        prefer: 'resolution=merge-duplicates,return=representation'
    });
}

/** 단일 행 조회 */
async function selectOne(table, filters = {}) {
    const query = buildFilterQuery(filters);
    const result = await call('GET', `/${table}${query}${query ? '&' : '?'}limit=1`, {
        prefer: 'count=none'
    });

    if (!result.ok) {
        return result;
    }

    const rows = Array.isArray(result.data) ? result.data : [];
    return { ok: true, data: rows[0] || null };
}

/** 여러 행 조회 */
async function selectMany(table, { filters = {}, limit = 100, order = null } = {}) {
    const params = buildFilterQuery(filters).replace(/^\?/, '').split('&').filter(Boolean);
    params.push(`limit=${limit}`);
    if (order) {
        params.push(`order=${encodeURIComponent(order)}`);
    }
    const query = params.length > 0 ? `?${params.join('&')}` : '';

    const result = await call('GET', `/${table}${query}`, { prefer: 'count=none' });
    if (!result.ok) {
        return result;
    }
    return { ok: true, data: Array.isArray(result.data) ? result.data : [] };
}

/** 행 갱신 */
async function updateRow(table, filters, patch) {
    const query = buildFilterQuery(filters);
    if (!query) {
        return { ok: false, error: '업데이트에는 최소 1개의 필터가 필요합니다.', code: 'NO_FILTER' };
    }

    const result = await call('PATCH', `${table ? `/${table}` : ''}${query}`, {
        body: patch,
        prefer: 'return=representation'
    });

    if (!result.ok) {
        return result;
    }
    const rows = Array.isArray(result.data) ? result.data : [];
    return { ok: true, data: rows[0] || null };
}

/** 행 삭제 (캐시 만료 정리·빌링키 폐기 등) */
async function deleteRows(table, filters = {}) {
    const query = buildFilterQuery(filters);
    if (!query) {
        return { ok: false, error: '삭제에는 최소 1개의 필터가 필요합니다.', code: 'NO_FILTER' };
    }
    return call('DELETE', `/${table}${query}`, { prefer: 'return=minimal' });
}

/**
 * 연결 상태 헬스 체크 (서버 부팅 시 1회 + 서킷 쿨다운 종료 후 재시도 시 사용)
 * - 실제 테이블 1건 조회로 "키 권한·스키마 존재"까지 함께 확인합니다.
 */
async function healthCheck() {
    const config = getSupabaseConfig();
    if (!config.enabled) {
        return { ok: false, mode: 'IN_MEMORY_FALLBACK', error: config.reason, code: 'NOT_CONFIGURED' };
    }

    const result = await selectOne(config.tables.sessions, { session_token: '__healthcheck__' });

    return {
        ok: result.ok,
        mode: result.ok ? 'SUPABASE' : 'IN_MEMORY_FALLBACK',
        error: result.ok ? null : result.error,
        code: result.ok ? null : (result.code || 'UNKNOWN'),
        restUrl: config.restUrl,
        timeoutMs: config.timeoutMs
    };
}

/** 운영 관제용 상태 스냅샷 (민감 키는 마스킹) */
function getClientStatus() {
    const config = getSupabaseConfig();
    return {
        enabled: config.enabled,
        mode: config.mode,
        reason: config.reason,
        restUrlMasked: config.url ? `${config.url.replace(/^https?:\/\//, '').slice(0, 12)}***` : null,
        serviceKeyMasked: config.serviceKeyMasked,
        circuitOpen: isCircuitOpen(),
        circuitRetryAt: isCircuitOpen() ? new Date(state.circuitOpenUntil).toISOString() : null,
        consecutiveFailures: state.consecutiveFailures,
        lastError: state.lastError,
        lastSuccessAt: state.lastSuccessAt,
        totalRequests: state.totalRequests,
        totalFailures: state.totalFailures,
        tables: config.tables
    };
}

/** 테스트·운영용: 서킷 브레이커 및 카운터 초기화 */
function resetCircuit() {
    state.consecutiveFailures = 0;
    state.circuitOpenUntil = 0;
    state.lastError = null;
}

module.exports = {
    upsertRow,
    selectOne,
    selectMany,
    updateRow,
    deleteRows,
    healthCheck,
    getClientStatus,
    resetCircuit,
    isCircuitOpen
};
