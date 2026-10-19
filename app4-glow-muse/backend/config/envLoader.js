/**
 * ============================================================================
 * 파일명: backend/config/envLoader.js
 * 역할: [App Business Evaluator 최우선 결정(Override) 반영]
 *       외부 환경변수(.env) 파일에서 고LTV 연간 VIP 패스 금액(VIP_ANNUAL_PRICE),
 *       장기 무료 체험 기간(TRIAL_DAYS), 보조 스타터 크레딧 팩 금액(MONETIZATION_PRICE),
 *       AI 추론 크레딧 한도(VIP_CREDIT_CAP / STARTER_CREDIT_CAP), 그리고
 *       정산 소유자 식별 정보(APP_OWNER_ID / USER_IDENTITY)를 동적으로 읽어오는 로더입니다.
 * 교육용 설명:
 *   - 코드 내부에 판매 가격이나 개인정보를 직접 하드코딩하지 않습니다.
 *   - 배포 직전 사용자가 .env 파일만 수정하면 서버가 자동으로 새로운 가격과 크레딧 한도,
 *     정산자 정보를 읽어들여 하드 페이월과 결제 검증 로직에 즉시 반영합니다.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');

/**
 * .env 파일을 읽어서 process.env 객체에 주입하는 함수입니다.
 */
function loadDotEnv() {
    const envPath = path.resolve(__dirname, '../../.env');
    if (!fs.existsSync(envPath)) {
        return;
    }

    const rawContent = fs.readFileSync(envPath, 'utf8');
    const lines = rawContent.split(/\r?\n/);

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }
        const equalIndex = trimmed.indexOf('=');
        if (equalIndex === -1) {
            continue;
        }
        const key = trimmed.slice(0, equalIndex).trim();
        const value = trimmed.slice(equalIndex + 1).trim();

        if (key) {
            process.env[key] = value;
        }
    }
}

/**
 * 민감한 식별자 문자열의 가운데 글자를 별표(*)로 가려주는(마스킹) 보안 함수입니다.
 * @param {string} rawText 원본 문자열
 * @returns {string} 마스킹 처리된 안전한 문자열
 */
function maskSensitiveString(rawText) {
    if (!rawText || typeof rawText !== 'string') {
        return 'UNCONFIGURED_OWNER';
    }
    const clean = rawText.trim();
    if (clean.length <= 4) {
        return clean[0] + '***';
    }
    const prefix = clean.slice(0, 3);
    const suffix = clean.slice(-3);
    const maskedMiddle = '*'.repeat(Math.min(clean.length - 6, 8));
    return `${prefix}${maskedMiddle}${suffix}`;
}

/**
 * 현재 설정된 동적 환경변수 구성을 읽어서 반환합니다.
 */
function getDynamicConfig() {
    loadDotEnv();

    // 1순위 주력 상품: 21일 장기 무료 체험 + 연간 VIP 패스 ($62.19 벤치마크 매칭, RLTV 6배 극대화)
    const parsedVipPrice = parseInt(process.env.VIP_ANNUAL_PRICE || '79000', 10);
    const vipAnnualPrice = (!Number.isNaN(parsedVipPrice) && parsedVipPrice > 0) ? parsedVipPrice : 79000;

    // 17~32일 장기 무료 체험 일수 (벤치마크 전환율 42.5%)
    const parsedTrialDays = parseInt(process.env.TRIAL_DAYS || '21', 10);
    const trialDays = (!Number.isNaN(parsedTrialDays) && parsedTrialDays >= 17) ? parsedTrialDays : 21;

    // 2순위 보조(Decoy) 상품: 스타터 크레딧 팩 (process.env.MONETIZATION_PRICE / REVENUE_PRICE 호환)
    const rawStarterPrice = process.env.MONETIZATION_PRICE || process.env.REVENUE_PRICE || '9900';
    const parsedStarterPrice = parseInt(rawStarterPrice, 10);
    const monetizationPrice = (!Number.isNaN(parsedStarterPrice) && parsedStarterPrice > 0) ? parsedStarterPrice : 9900;

    // Thin Wrapper 역마진 방어용 크레딧 한도(Credit Cap)
    const vipCreditCap = parseInt(process.env.VIP_CREDIT_CAP || '100', 10) || 100;
    const starterCreditCap = parseInt(process.env.STARTER_CREDIT_CAP || '30', 10) || 30;

    // 정산 소유자 식별 정보
    const appOwnerId = process.env.APP_OWNER_ID || process.env.USER_IDENTITY || 'DYNAMIC_OWNER_PLACEHOLDER';
    const settlementHolder = process.env.SETTLEMENT_ACCOUNT_HOLDER || '동적정산계좌_미지정';
    const miniappId = process.env.TOSS_MINIAPP_ID || 'toss-miniapp-glow-muse-2026-v4';
    const port = parseInt(process.env.PORT || '3003', 10);

    return {
        appOwnerId,
        appOwnerIdMasked: maskSensitiveString(appOwnerId),
        settlementHolderMasked: maskSensitiveString(settlementHolder),
        vipAnnualPrice,
        ai: getAiConfig(),
        payments: getPaymentConfig(),
        persistence: getSupabaseConfig(),
        webhook: getWebhookConfig(),
        billing: getBillingConfig(),
        iap: getIapConfig(),
        aiCache: getAiCacheConfig(),
        formattedVipAnnualPrice: `₩${vipAnnualPrice.toLocaleString('ko-KR')}`,
        monthlyEquivalentFormatted: `월 ₩${Math.round(vipAnnualPrice / 12).toLocaleString('ko-KR')}`,
        trialDays,
        monetizationPrice,
        formattedPrice: `₩${monetizationPrice.toLocaleString('ko-KR')}`,
        vipCreditCap,
        starterCreditCap,
        miniappId,
        port,
        encryptionMasterKey: process.env.ENCRYPTION_MASTER_KEY || ''
    };
}

/**
 * [AI 연동 설정] 실제 LLM/Vision 제공자 구성 정보를 동적으로 읽어옵니다.
 * - .env에 API 키가 하나도 없으면 enabled=false가 되며, 서버는 기존 로컬
 *   결정론적 엔진(glowEngine.js)으로 자동 폴백합니다. (서비스 중단 방지)
 * - *_BASE_URL 오버라이드를 지원하므로 사내 프록시·로컬 목 서버 테스트가 가능합니다.
 */
function getAiConfig() {
    loadDotEnv();

    const requested = (process.env.AI_PROVIDER || 'auto').toLowerCase().trim();

    const candidates = {
        gemini: {
            apiKey: (process.env.GEMINI_API_KEY || '').trim(),
            model: (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim(),
            baseUrl: (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').trim()
        },
        openai: {
            apiKey: (process.env.OPENAI_API_KEY || '').trim(),
            model: (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim(),
            baseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').trim()
        },
        anthropic: {
            apiKey: (process.env.ANTHROPIC_API_KEY || '').trim(),
            model: (process.env.ANTHROPIC_MODEL || 'claude-3-7-sonnet-latest').trim(),
            baseUrl: (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1').trim()
        }
    };

    const priority = ['gemini', 'openai', 'anthropic'];
    let resolvedProvider = null;

    if (requested === 'none' || requested === 'off' || requested === 'mock') {
        resolvedProvider = null;
    } else if (candidates[requested]) {
        resolvedProvider = requested;
    } else {
        // auto: 키가 주입된 첫 번째 제공자를 자동 선택
        resolvedProvider = priority.find((name) => Boolean(candidates[name].apiKey)) || null;
    }

    const selected = resolvedProvider ? candidates[resolvedProvider] : null;
    const enabled = Boolean(selected && selected.apiKey);

    const parsedTimeout = parseInt(process.env.AI_TIMEOUT_MS || '20000', 10);
    const parsedMaxTokens = parseInt(process.env.AI_MAX_TOKENS || '2048', 10);
    const parsedTemperature = parseFloat(process.env.AI_TEMPERATURE || '0.7');

    return {
        provider: resolvedProvider,
        enabled,
        mode: enabled ? 'LIVE_AI' : 'LOCAL_DETERMINISTIC_FALLBACK',
        apiKey: selected ? selected.apiKey : '',
        model: selected ? selected.model : null,
        baseUrl: selected ? selected.baseUrl : null,
        timeoutMs: (!Number.isNaN(parsedTimeout) && parsedTimeout >= 1000) ? parsedTimeout : 20000,
        maxTokens: (!Number.isNaN(parsedMaxTokens) && parsedMaxTokens > 0) ? parsedMaxTokens : 2048,
        temperature: (!Number.isNaN(parsedTemperature) && parsedTemperature >= 0 && parsedTemperature <= 2)
            ? parsedTemperature
            : 0.7,
        reason: enabled
            ? null
            : 'AI_PROVIDER 키가 설정되지 않아 로컬 결정론적 엔진(glowEngine.js)으로 동작합니다. .env에 GEMINI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY 중 하나를 주입하세요.'
    };
}

/**
 * [토스페이먼츠 결제 설정]
 * - 클라이언트 키 + 시크릿 키가 모두 주입되면 실결제(TOSS_LIVE) 모드로 동작합니다.
 * - 하나라도 없으면 기존 샌드박스 시뮬레이션(SANDBOX_SIMULATION) 모드로 폴백합니다.
 * - 시크릿 키는 절대 클라이언트로 내려보내지 않습니다(마스킹만 노출).
 */
function getPaymentConfig() {
    loadDotEnv();

    const clientKey = (process.env.TOSS_PAYMENTS_CLIENT_KEY || '').trim();
    const secretKey = (process.env.TOSS_PAYMENTS_SECRET_KEY || '').trim();
    const baseUrl = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');

    const live = Boolean(clientKey && secretKey);

    return {
        mode: live ? 'TOSS_LIVE' : 'SANDBOX_SIMULATION',
        enabled: live,
        clientKey,
        clientKeyMasked: clientKey ? maskSensitiveString(clientKey) : null,
        secretKey,
        secretKeyMasked: secretKey ? maskSensitiveString(secretKey) : null,
        apiBaseUrl: (process.env.TOSS_PAYMENTS_API_BASE_URL || 'https://api.tosspayments.com/v1').trim().replace(/\/+$/, ''),
        publicBaseUrl: baseUrl,
        successUrl: `${baseUrl}/payments/success`,
        failUrl: `${baseUrl}/payments/fail`
    };
}

/**
 * [Supabase 영속화 설정]
 * - URL + Service Role Key 가 모두 주입되면 DB 영속화(SUPABASE) 모드로 동작합니다.
 * - 미주입 또는 SUPABASE_PERSISTENCE=off 이면 인메모리(IN_MEMORY_FALLBACK) 모드로 동작합니다.
 * - 런타임에 DB 장애가 감지되면 자동으로 인메모리로 폴백합니다(무중단 설계).
 * - ※ Service Role Key 는 RLS 를 우회하는 서버 전용 키이므로 클라이언트에 절대 노출 금지
 */
function getSupabaseConfig() {
    loadDotEnv();

    const url = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
    const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    const switchValue = (process.env.SUPABASE_PERSISTENCE || 'auto').trim().toLowerCase();

    const parsedTimeout = parseInt(process.env.SUPABASE_TIMEOUT_MS || '5000', 10);

    const forcedOff = switchValue === 'off' || switchValue === 'false' || switchValue === 'none';
    const configured = Boolean(url && serviceKey) && !forcedOff;

    return {
        url,
        restUrl: url ? `${url}/rest/v1` : null,
        serviceKey,
        serviceKeyMasked: serviceKey ? maskSensitiveString(serviceKey) : null,
        enabled: configured,
        forcedOff,
        mode: configured ? 'SUPABASE' : 'IN_MEMORY_FALLBACK',
        timeoutMs: (!Number.isNaN(parsedTimeout) && parsedTimeout >= 500) ? parsedTimeout : 5000,
        tables: {
            sessions: 'glow_muse_runtime_sessions',
            orders: 'glow_muse_runtime_orders',
            payments: 'glow_muse_runtime_payments',
            skinScans: 'glow_muse_runtime_skin_scans',
            studioLogs: 'glow_muse_runtime_studio_logs',
            aiLogs: 'glow_muse_ai_inference_logs',
            webhookLogs: 'glow_muse_payment_webhook_logs',
            billingSubscriptions: 'glow_muse_billing_subscriptions',
            iapOrders: 'glow_muse_iap_orders',
            aiCache: 'glow_muse_ai_response_cache'
        },
        reason: configured
            ? null
            : (forcedOff
                ? 'SUPABASE_PERSISTENCE=off 로 설정되어 인메모리 모드로 동작합니다.'
                : 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 미설정 — 인메모리 모드로 동작합니다(데이터는 재시작 시 소실).')
    };
}

/**
 * [공통] 환경변수 boolean 파서 (auto/true/false 허용)
 * @param {string} raw 원본 값
 * @param {boolean} fallback 값이 비어있거나 해석 불가할 때 기본값
 * @returns {boolean}
 */
function parseBoolean(raw, fallback) {
    if (raw === undefined || raw === null || String(raw).trim() === '') {
        return fallback;
    }
    const value = String(raw).trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(value)) {
        return true;
    }
    if (['0', 'false', 'no', 'n', 'off'].includes(value)) {
        return false;
    }
    return fallback;
}

/**
 * [공통] 정수 범위 파서 (범위를 벗어나면 기본값)
 */
function parseIntInRange(raw, fallback, min, max) {
    const parsed = parseInt(raw, 10);
    if (Number.isNaN(parsed) || parsed < min || parsed > max) {
        return fallback;
    }
    return parsed;
}

/**
 * ============================================================================
 * [토스페이먼츠 웹훅 설정]
 * ----------------------------------------------------------------------------
 * - PAYMENT_STATUS_CHANGED / DEPOSIT_CALLBACK / BILLING_DELETED 이벤트를
 *   /api/webhooks/toss 로 수신합니다.
 * - 결제 웹훅에는 서명 헤더가 없으므로(토스 공식 문서), 본문을 신뢰하지 않고
 *   **서버가 토스 API로 결제 상태를 재조회(canonical verification)** 하여 검증합니다.
 * - TOSS_WEBHOOK_PATH_TOKEN 을 설정하면 등록 URL 에 ?token=... 을 요구하여
 *   무작위 스캐너 트래픽을 1차 차단합니다. (토스 콘솔 웹훅 URL 에 동일하게 등록)
 * ============================================================================
 */
function getWebhookConfig() {
    loadDotEnv();

    const pathToken = (process.env.TOSS_WEBHOOK_PATH_TOKEN || '').trim();
    const parsedTimeout = parseInt(process.env.TOSS_WEBHOOK_TIMEOUT_MS || '8000', 10);

    return {
        enabled: true,
        pathToken,
        pathTokenConfigured: Boolean(pathToken),
        verifyCanonical: parseBoolean(process.env.TOSS_WEBHOOK_VERIFY_CANONICAL, true),
        timeoutMs: parseIntInRange(parsedTimeout, 8000, 1000, 30000),
        maxBodyBytes: 256 * 1024,
        eventTypes: ['PAYMENT_STATUS_CHANGED', 'DEPOSIT_CALLBACK', 'BILLING_DELETED', 'CANCEL_STATUS_CHANGED']
    };
}

/**
 * ============================================================================
 * [토스페이먼츠 자동결제(빌링) 설정]
 * ----------------------------------------------------------------------------
 * - 빌링키 발급: POST /v1/billing/authorizations/issue
 * - 자동결제 승인: POST /v1/billing/{billingKey}
 * - 빌링키 삭제: DELETE /v1/billing/{billingKey}
 * - 자동결제는 토스페이먼츠와 **별도 계약(자동결제 계약)** 이 필요합니다.
 *   미계약 상태에서 테스트 키로 호출하면 NOT_SUPPORTED_METHOD 가 반환됩니다.
 * - 갱신 스케줄러는 기본 auto(실결제 모드에서만 가동)이며, 테스트에서는 끌 수 있습니다.
 * ============================================================================
 */
function getBillingConfig() {
    loadDotEnv();

    const payments = getPaymentConfig();
    const switchValue = (process.env.TOSS_BILLING_ENABLED || 'auto').trim().toLowerCase();
    const forcedOff = ['off', 'false', 'none', 'disabled'].includes(switchValue);
    const enabled = !forcedOff && payments.mode === 'TOSS_LIVE';

    const schedulerSwitch = (process.env.BILLING_SCHEDULER_ENABLED || 'auto').trim().toLowerCase();
    const schedulerEnabled = enabled && !['off', 'false', 'none', 'disabled'].includes(schedulerSwitch);

    const parsedInterval = parseInt(process.env.BILLING_SCHEDULER_INTERVAL_MS || '3600000', 10);
    const parsedRetryMax = parseInt(process.env.BILLING_RETRY_MAX || '3', 10);
    const parsedRetryDelay = parseInt(process.env.BILLING_RETRY_DELAY_HOURS || '24', 10);
    const parsedPeriod = parseInt(process.env.BILLING_RENEWAL_PERIOD_DAYS || '365', 10);

    return {
        enabled,
        mode: enabled ? 'TOSS_LIVE' : (payments.mode === 'TOSS_LIVE' ? 'DISABLED_BY_ENV' : 'SANDBOX_SIMULATION'),
        schedulerEnabled,
        schedulerIntervalMs: parseIntInRange(parsedInterval, 3600000, 60000, 86400000),
        retryMax: parseIntInRange(parsedRetryMax, 3, 1, 10),
        retryDelayHours: parseIntInRange(parsedRetryDelay, 24, 1, 168),
        renewalPeriodDays: parseIntInRange(parsedPeriod, 365, 1, 730),
        adminToken: (process.env.TOSS_BILLING_ADMIN_TOKEN || '').trim(),
        adminTokenConfigured: Boolean((process.env.TOSS_BILLING_ADMIN_TOKEN || '').trim()),
        chargeTimeoutMs: 65000
    };
}

/**
 * ============================================================================
 * [App-in-Toss 인앱 결제(IAP) 설정]
 * ----------------------------------------------------------------------------
 * - 클라이언트: @apps-in-toss/web-framework 의 IAP.createOneTimePurchaseOrder /
 *   createSubscriptionPurchaseOrder / getProductItemList / getPendingOrders
 * - 서버 검증: POST https://apps-in-toss-api.toss.im/api-partner/v1/apps-in-toss/
 *   order/get-order-status (mTLS + Authorization: Bearer {API Key})
 * - 상품 SKU 는 앱인토스 콘솔에 등록한 값과 1:1로 매핑합니다(VIP 연간/스타터 팩/구독).
 * - AIT_API_KEY 가 없으면 SANDBOX_SIMULATION 으로 동작합니다(개발/데모 전용).
 * ============================================================================
 */
function getIapConfig() {
    loadDotEnv();

    const apiKey = (process.env.AIT_API_KEY || process.env.TOSS_IAP_API_KEY || '').trim();
    const baseUrl = (process.env.AIT_API_BASE_URL || 'https://apps-in-toss-api.toss.im').trim().replace(/\/+$/, '');
    const certPath = (process.env.AIT_MTLS_CERT_PATH || process.env.TOSS_MTLS_CERT_PATH || '').trim();
    const keyPath = (process.env.AIT_MTLS_KEY_PATH || process.env.TOSS_MTLS_KEY_PATH || '').trim();

    const skus = {
        vipAnnual: (process.env.AIT_IAP_SKU_VIP_ANNUAL || '').trim(),
        starterPack: (process.env.AIT_IAP_SKU_STARTER_PACK || '').trim(),
        vipSubscription: (process.env.AIT_IAP_SKU_VIP_SUBSCRIPTION || '').trim()
    };

    const configuredSkus = Object.values(skus).filter(Boolean);
    const live = Boolean(apiKey);

    const parsedTimeout = parseInt(process.env.AIT_IAP_TIMEOUT_MS || '15000', 10);

    return {
        mode: live ? 'LIVE' : 'SANDBOX_SIMULATION',
        enabled: live || configuredSkus.length > 0,
        apiKey,
        apiKeyMasked: apiKey ? maskSensitiveString(apiKey) : null,
        appId: (process.env.AIT_APP_ID || '').trim() || null,
        baseUrl,
        mtls: {
            certPath,
            keyPath,
            caPath: (process.env.AIT_MTLS_CA_PATH || '').trim(),
            passphrase: (process.env.AIT_MTLS_KEY_PASSPHRASE || '').trim(),
            configured: Boolean(certPath && keyPath)
        },
        skus,
        configuredSkus,
        allowUnboundGrant: parseBoolean(process.env.AIT_IAP_ALLOW_UNBOUND_GRANT, false),
        sandboxGrantAllowed: parseBoolean(process.env.AIT_IAP_SANDBOX_GRANT, false),
        adminToken: (process.env.AIT_IAP_ADMIN_TOKEN || process.env.TOSS_BILLING_ADMIN_TOKEN || '').trim(),
        sessionSecret: (process.env.AIT_SESSION_SECRET || '').trim(),
        timeoutMs: parseIntInRange(parsedTimeout, 15000, 2000, 60000)
    };
}

/**
 * ============================================================================
 * [AI 응답 캐싱 설정]
 * ----------------------------------------------------------------------------
 * - 동일 입력(프롬프트 + 이미지 해시 + 모델) 재요청 시 LLM 호출을 생략합니다.
 * - 캐시 키에는 provider/model/temperature/maxTokens/프롬프트 버전을 포함해
 *   모델·프롬프트가 바뀌면 자동으로 미스가 나도록 합니다.
 * - 응답 본문은 개인화 정보를 포함할 수 있으므로 AES-256-GCM 으로 암호화 저장합니다.
 * - DB 미설정 시 인메모리 LRU 캐시로만 동작합니다(서비스 중단 없음).
 * ============================================================================
 */
function getAiCacheConfig() {
    loadDotEnv();

    const parsedTtl = parseInt(process.env.AI_CACHE_TTL_MS || '86400000', 10);
    const parsedSkinTtl = parseInt(process.env.AI_CACHE_SKIN_SCAN_TTL_MS || '21600000', 10);
    const parsedReportTtl = parseInt(process.env.AI_CACHE_REPORT_TTL_MS || '86400000', 10);
    const parsedMaxEntries = parseInt(process.env.AI_CACHE_MAX_ENTRIES || '500', 10);
    const parsedMaxPayload = parseInt(process.env.AI_CACHE_MAX_PAYLOAD_BYTES || '65536', 10);
    const parsedUnitCost = parseFloat(process.env.AI_CACHE_UNIT_COST_USD || '0.0035');

    return {
        enabled: parseBoolean(process.env.AI_CACHE_ENABLED, true),
        namespace: (process.env.AI_CACHE_VERSION || 'v1').trim(),
        ttlMs: parseIntInRange(parsedTtl, 86400000, 60000, 604800000),
        ttlByKind: {
            SKIN_SCAN: parseIntInRange(parsedSkinTtl, 21600000, 60000, 604800000),
            PREMIUM_REPORT: parseIntInRange(parsedReportTtl, 86400000, 60000, 604800000)
        },
        maxEntries: parseIntInRange(parsedMaxEntries, 500, 10, 5000),
        maxPayloadBytes: parseIntInRange(parsedMaxPayload, 65536, 1024, 1024 * 1024),
        unitCostUsd: (!Number.isNaN(parsedUnitCost) && parsedUnitCost >= 0) ? parsedUnitCost : 0.0035,
        persist: parseBoolean(process.env.AI_CACHE_PERSIST, true)
    };
}

module.exports = {
    loadDotEnv,
    maskSensitiveString,
    getDynamicConfig,
    getAiConfig,
    getPaymentConfig,
    getSupabaseConfig,
    getWebhookConfig,
    getBillingConfig,
    getIapConfig,
    getAiCacheConfig
};
