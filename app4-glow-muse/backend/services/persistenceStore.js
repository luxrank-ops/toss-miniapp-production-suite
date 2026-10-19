/**
 * ============================================================================
 * 파일명: backend/services/persistenceStore.js
 * 역할: [런타임 원장 영속화 계층] 인메모리(Map) ↔ Supabase 이중 기록 저장소
 * ----------------------------------------------------------------------------
 * 왜 이 구조인가?
 *   - 기존 백엔드는 세션·주문·결제 원장을 전부 `Map`(인메모리)에 보관했습니다.
 *     → 서버 재시작 시 매출·세션 데이터가 전부 증발하고, 인스턴스를 2개 이상 띄우면
 *       요청이 다른 인스턴스로 가는 순간 "세션 없음" 오류가 발생합니다.
 *   - 여기서는 **Write-Through(동시 기록) + Read-Through(캐시 미스 시 DB 조회)** 구조로
 *     바꾸되, DB 가 없거나 죽어도 서비스가 멈추지 않도록 **항상 인메모리 우선**으로 동작합니다.
 *
 * 동작 규칙:
 *   1) 읽기: 메모리 → (미스 시) Supabase 조회·복호화 → 메모리에 적재 후 반환
 *   2) 쓰기: 메모리 반영 → Supabase upsert (실패해도 메모리 값은 유지, 오류만 기록)
 *   3) 장애: 연속 실패 시 서킷 브레이커가 열려 30초간 DB 접근을 생략(지연 방지)
 *
 * 보안: 모든 원장은 AES-256-GCM으로 암호화된 페이로드로만 DB에 저장됩니다.
 *       (토스 영수증의 카드번호·승인정보 포함)
 * ============================================================================
 */

const { getSupabaseConfig } = require('../config/envLoader');
const { encryptSensitiveData, decryptSensitiveData } = require('../security/cryptoManager');
const supabase = require('./supabaseClient');

/** 부팅 시 1회 수행되는 헬스체크 결과 */
const runtimeState = {
    initialized: false,
    mode: 'IN_MEMORY_FALLBACK',
    healthyAtBoot: false,
    lastHealthError: null,
    writes: 0,
    writeFailures: 0,
    hydrations: 0
};

/**
 * 컬렉션 정의
 * - memory          : 인메모리 캐시(Map)
 * - tableKey        : envLoader 의 tables 객체 키
 * - pk              : DB 기본키 컬럼명
 * - recordKey       : 레코드에서 기본키 값을 꺼내는 getter
 * - toRow           : 레코드 → DB 행 변환(암호화 포함)
 * - fromRow         : DB 행 → 레코드 복원(복호화 포함)
 */
const collections = {};

/**
 * 암호화 페이로드를 담는 공통 행 빌더
 * @param {Object} plainObject 암호화할 원본 객체
 * @param {Object} plainColumns 평문으로 저장할(인덱싱 대상) 컬럼
 */
function buildEncryptedRow(plainObject, plainColumns = {}) {
    const bundle = encryptSensitiveData(plainObject);
    return {
        encrypted_payload: bundle.encryptedData,
        iv_hex: bundle.iv,
        auth_tag_hex: bundle.authTag,
        encryption_algorithm: bundle.algorithm,
        ...plainColumns
    };
}

/** 암호화된 행을 원본 객체로 복원 */
function parseEncryptedRow(row) {
    if (!row || !row.encrypted_payload) {
        return null;
    }
    try {
        return decryptSensitiveData({
            encryptedData: row.encrypted_payload,
            iv: row.iv_hex,
            authTag: row.auth_tag_hex
        });
    } catch (err) {
        console.error('[Persistence] 암호화 페이로드 복호화 실패(키 변경 또는 데이터 손상):', err.message);
        return null;
    }
}

/** 직렬화 불가능한 필드(Promise 등)를 제거한 복사본 */
function stripRuntimeOnly(record) {
    const clone = { ...record };
    delete clone.aiEnrichmentPromise;
    return clone;
}

// ============================================================================
// 컬렉션 생성 팩토리
// ============================================================================
function createCollection({ name, tableKey, pk, recordKey, toRow, fromRow }) {
    const memory = new Map();

    const collection = {
        name,
        memory,

        /** 동기 조회 (메모리 전용) */
        get(key) {
            return memory.get(key) || null;
        },

        has(key) {
            return memory.has(key);
        },

        set(key, record) {
            memory.set(key, record);
            return collection.persist(key, record);
        },

        get size() {
            return memory.size;
        },

        values() {
            return [...memory.values()];
        },

        /**
         * Supabase 에 저장(upsert). 실패해도 예외를 던지지 않습니다.
         * @returns {Promise<{ ok: boolean, error?: string, skipped?: string }>}
         */
        async persist(key, record) {
            const config = getSupabaseConfig();
            if (!config.enabled) {
                return { ok: false, skipped: 'NOT_CONFIGURED' };
            }

            const table = config.tables[tableKey];
            const row = toRow(stripRuntimeOnly(record), record);
            if (!row) {
                return { ok: false, skipped: 'EMPTY_ROW' };
            }

            row[pk] = recordKey(record) || key;
            runtimeState.writes += 1;

            const result = await supabase.upsertRow(table, row, pk);
            if (!result.ok && !result.skipped) {
                runtimeState.writeFailures += 1;
                console.warn(`[Persistence] ${name} 저장 실패(${key}): ${result.error}`);
            }
            return result;
        },

        /**
         * 캐시 미스 시 Supabase 에서 조회해 메모리에 적재합니다. (Read-Through)
         * @returns {Promise<Object|null>} 복원된 레코드 또는 null
         */
        async hydrate(key) {
            if (memory.has(key)) {
                return memory.get(key);
            }

            const config = getSupabaseConfig();
            if (!config.enabled) {
                return null;
            }

            const table = config.tables[tableKey];
            const result = await supabase.selectOne(table, { [pk]: key });

            if (!result.ok || !result.data) {
                return null;
            }

            const restored = fromRow(result.data, key);
            if (!restored) {
                return null;
            }

            memory.set(key, restored);
            runtimeState.hydrations += 1;
            return restored;
        }
    };

    collections[name] = collection;
    return collection;
}

// ============================================================================
// [1] 진단 세션
// ============================================================================
const sessions = createCollection({
    name: 'sessions',
    tableKey: 'sessions',
    pk: 'session_token',
    recordKey: (record) => record.sessionToken,
    toRow: (record) => buildEncryptedRow(record, {
        is_premium_unlocked: Boolean(record.isPremiumUnlocked),
        selected_plan_tier: record.selectedPlanTier || null,
        remaining_credits: Number(record.remainingCredits) || 0,
        last_order_id: record.lastOrderId || null,
        ai_status: record.aiStatus || null,
        ai_provider: (record.aiEnrichment && record.aiEnrichment.aiMeta && record.aiEnrichment.aiMeta.provider) || null,
        updated_at: new Date().toISOString()
    }),
    fromRow: (row) => parseEncryptedRow(row)
});

// ============================================================================
// [2] 결제 주문
// ============================================================================
const orders = createCollection({
    name: 'orders',
    tableKey: 'orders',
    pk: 'order_id',
    recordKey: (record) => record.orderId,
    toRow: (record) => {
        // 토스 영수증(카드번호 포함)은 반드시 암호화하여 저장합니다.
        let encryptedReceipt = { encrypted_payload: null, receipt_iv_hex: null, receipt_auth_tag_hex: null };
        if (record.tossReceipt) {
            const bundle = encryptSensitiveData(record.tossReceipt);
            encryptedReceipt = {
                encrypted_receipt: bundle.encryptedData,
                receipt_iv_hex: bundle.iv,
                receipt_auth_tag_hex: bundle.authTag
            };
        }

        return {
            session_token: record.sessionToken,
            plan_tier: record.planTier,
            amount_krw: record.amountKrw,
            credits_granted: record.creditsGranted,
            trial_days: record.trialDays || 0,
            order_name: record.orderName || null,
            status: record.status,
            payment_mode: record.mode || null,
            payment_key_masked: record.paymentKey ? `${String(record.paymentKey).slice(0, 6)}***` : null,
            app_owner_id_masked: record.appOwnerIdMasked || null,
            updated_at: new Date().toISOString(),
            ...encryptedReceipt
        };
    },
    fromRow: (row) => {
        let tossReceipt = null;
        if (row.encrypted_receipt) {
            try {
                tossReceipt = decryptSensitiveData({
                    encryptedData: row.encrypted_receipt,
                    iv: row.receipt_iv_hex,
                    authTag: row.receipt_auth_tag_hex
                });
            } catch (err) {
                tossReceipt = null;
            }
        }

        return {
            orderId: row.order_id,
            sessionToken: row.session_token,
            planTier: row.plan_tier,
            amountKrw: row.amount_krw,
            creditsGranted: row.credits_granted,
            trialDays: row.trial_days,
            orderName: row.order_name,
            status: row.status,
            mode: row.payment_mode,
            paymentKey: null, // 보안: 원본 paymentKey 는 복원하지 않음(승인 API 전용)
            tossReceipt,
            appOwnerIdMasked: row.app_owner_id_masked,
            settlementHolderMasked: row.settlement_holder_masked,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
});

// ============================================================================
// [3] 결제 완료 원장
// ============================================================================
const payments = createCollection({
    name: 'payments',
    tableKey: 'payments',
    pk: 'toss_order_id',
    recordKey: (record) => record.tossOrderId,
    toRow: (record) => buildEncryptedRow(record, {
        session_token: record.sessionToken || null,
        plan_tier: record.planTier || null,
        paid_amount_krw: Number(record.paidAmountKrw) || 0,
        credits_granted: Number(record.creditsGranted) || 0,
        remaining_credits: Number(record.remainingCredits) || 0,
        payment_mode: record.paymentMode || null,
        ai_provider: record.aiProvider || null,
        ai_applied: Boolean(record.aiApplied),
        app_owner_id_masked: record.appOwnerIdMasked || null,
        settlement_holder_masked: record.settlementHolderMasked || null,
        paid_at: record.paidAt || new Date().toISOString()
    }),
    fromRow: (row) => parseEncryptedRow(row)
});

// ============================================================================
// [4] 피부 스캔 결과
// ============================================================================
const skinScans = createCollection({
    name: 'skinScans',
    tableKey: 'skinScans',
    pk: 'scan_id',
    recordKey: (record) => record.scanId,
    toRow: (record) => {
        const meta = record.encryptedMetadata || encryptSensitiveData({});
        return {
            session_token: record.sessionToken || null,
            encrypted_payload: meta.encryptedData,
            iv_hex: meta.iv,
            auth_tag_hex: meta.authTag,
            skin_type: record.skinType || null,
            skin_barrier_score: record.skinBarrierScore ?? null,
            barrier_status: record.barrierStatus || null,
            ai_provider: record.aiProvider || null,
            ai_applied: Boolean(record.aiApplied),
            raw_photo_retained: false,
            created_at: record.createdAt || new Date().toISOString()
        };
    },
    fromRow: (row) => ({
        scanId: row.scan_id,
        encryptedMetadata: {
            encryptedData: row.encrypted_payload,
            iv: row.iv_hex,
            authTag: row.auth_tag_hex,
            algorithm: 'AES-256-GCM'
        },
        skinType: row.skin_type,
        skinBarrierScore: row.skin_barrier_score,
        barrierStatus: row.barrier_status,
        rawPhotoRetained: false,
        createdAt: row.created_at
    })
});

// ============================================================================
// [5] 포토 스튜디오 렌더링 로그
// ============================================================================
const studioLogs = createCollection({
    name: 'studioLogs',
    tableKey: 'studioLogs',
    pk: 'studio_log_id',
    recordKey: (record) => record.studioLogId,
    toRow: (record) => {
        const bundle = record.encryptedStudioRecord
            ? record.encryptedStudioRecord
            : encryptSensitiveData(record);
        return {
            session_token: record.sessionToken || null,
            vibe_key: record.vibeKey || null,
            encrypted_payload: bundle.encryptedData,
            iv_hex: bundle.iv,
            auth_tag_hex: bundle.authTag,
            created_at: record.renderedAt || new Date().toISOString()
        };
    },
    fromRow: (row) => ({
        studioLogId: row.studio_log_id,
        encryptedStudioRecord: {
            encryptedData: row.encrypted_payload,
            iv: row.iv_hex,
            authTag: row.auth_tag_hex,
            algorithm: 'AES-256-GCM'
        },
        createdAt: row.created_at
    })
});

// ============================================================================
// [6] AI 추론 관제 로그 (개인정보 없음 → 평문 저장, 원가·지연 추적 목적)
// ============================================================================
async function logAiInference(entry) {
    const config = getSupabaseConfig();
    if (!config.enabled) {
        return { ok: false, skipped: 'NOT_CONFIGURED' };
    }

    return supabase.upsertRow(config.tables.aiLogs, {
        session_token: entry.sessionToken || null,
        provider: entry.provider || null,
        model: entry.model || null,
        request_kind: entry.requestKind || null,
        applied: Boolean(entry.applied),
        fallback_used: Boolean(entry.fallbackUsed),
        latency_ms: Number(entry.latencyMs) || 0,
        error_message: entry.error ? String(entry.error).slice(0, 300) : null
    });
}

// ============================================================================
// 초기화 & 상태
// ============================================================================
async function initialize() {
    const config = getSupabaseConfig();

    if (!config.enabled) {
        runtimeState.initialized = true;
        runtimeState.mode = 'IN_MEMORY_FALLBACK';
        runtimeState.lastHealthError = config.reason;
        return { mode: runtimeState.mode, ok: false, error: config.reason };
    }

    const health = await supabase.healthCheck();

    runtimeState.initialized = true;
    runtimeState.healthyAtBoot = Boolean(health.ok);
    runtimeState.mode = health.ok ? 'SUPABASE' : 'IN_MEMORY_FALLBACK';
    runtimeState.lastHealthError = health.ok ? null : health.error;

    return {
        mode: runtimeState.mode,
        ok: Boolean(health.ok),
        error: health.ok ? null : health.error,
        restUrl: health.restUrl
    };
}

function getStatus() {
    const config = getSupabaseConfig();
    const clientStatus = supabase.getClientStatus();

    return {
        mode: runtimeState.mode,
        initialized: runtimeState.initialized,
        healthyAtBoot: runtimeState.healthyAtBoot,
        configured: config.enabled,
        reason: config.reason,
        lastHealthError: runtimeState.lastHealthError,
        counts: {
            sessions: sessions.size,
            orders: orders.size,
            payments: payments.size,
            skinScans: skinScans.size,
            studioLogs: studioLogs.size
        },
        metrics: {
            writes: runtimeState.writes,
            writeFailures: runtimeState.writeFailures,
            hydrations: runtimeState.hydrations
        },
        client: clientStatus
    };
}

module.exports = {
    initialize,
    getStatus,
    logAiInference,
    sessions,
    orders,
    payments,
    skinScans,
    studioLogs,
    buildEncryptedRow,
    parseEncryptedRow
};
