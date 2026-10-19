/**
 * ============================================================================
 * 파일명: backend/services/iapService.js
 * 역할: [App-in-Toss 인앱 결제 SDK 서버 연동] 주문 검증 → 상품 지급(멱등) → 환불 동기화
 * ----------------------------------------------------------------------------
 * 클라이언트(SDK)와 서버의 역할 분담
 *   [클라이언트] IAP.createOneTimePurchaseOrder({ options: { sku, processProductGrant } })
 *     → processProductGrant({ orderId }) 안에서 **파트너 서버 /api/iap/grant** 호출
 *     → 서버가 true 를 반환해야 상품 지급 완료로 인정 (30초 내 false/무응답 시 자동 환불)
 *   [서버] Apps in Toss 주문 상태 조회 API 로 실제 결제 여부를 검증한 뒤 크레딧 지급
 *     POST https://apps-in-toss-api.toss.im/api-partner/v1/apps-in-toss/order/get-order-status
 *     - 서버 간 통신은 **mTLS(클라이언트 인증서)** 필수
 *     - 헤더 x-toss-user-key: 토스 로그인으로 획득한 userKey
 *   [토스 로그인] appLogin() → authorizationCode → 서버가 generate-token → login-me
 *
 * 보안 원칙
 *   1) 클라이언트가 보낸 결제 완료 주장을 절대 신뢰하지 않고 토스 API 로 재조회합니다.
 *   2) loginToken 은 HMAC 서명 + 세션 바인딩 + 만료(10분)로 위조를 방지합니다.
 *   3) orderId 단위 멱등 처리 → 재시도/복원(getPendingOrders)에도 크레딧 중복 지급 없음.
 *   4) 환불(REFUNDED) 확인 시 권한을 회수합니다.
 *   5) API 키·mTLS 개인키는 서버에만 존재하며 클라이언트로 절대 전송하지 않습니다.
 * ============================================================================
 */

const fs = require('fs');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

const { getIapConfig, getDynamicConfig } = require('../config/envLoader');
const persistence = require('./persistenceStore');
const {
    createOrder,
    markOrderPaid,
    resolvePlan,
    ORDER_STATUS
} = require('./paymentGateway');
const { grantEntitlementForOrder, revokeEntitlementForOrder } = require('./entitlementService');

/** mTLS 인증서 파일 캐시 (매 요청 디스크 I/O 방지) */
let mtlsMaterialCache = null;

function sha256Hex(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function base64UrlEncode(input) {
    return Buffer.from(input).toString('base64url');
}

function signLoginToken(payload) {
    const config = getIapConfig();
    const dynamic = getDynamicConfig();
    const secret = config.sessionSecret
        || dynamic.encryptionMasterKey
        || 'MUSEGLOW_AIT_LOGIN_TOKEN_DEFAULT_SECRET';
    const encoded = base64UrlEncode(JSON.stringify(payload));
    const signature = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
    return `${encoded}.${signature}`;
}

function verifyLoginToken(token, sessionToken) {
    if (!token || typeof token !== 'string' || token.split('.').length !== 2) {
        return { ok: false, code: 'INVALID_LOGIN_TOKEN' };
    }
    const [encoded, signature] = token.split('.');
    const config = getIapConfig();
    const dynamic = getDynamicConfig();
    const secret = config.sessionSecret
        || dynamic.encryptionMasterKey
        || 'MUSEGLOW_AIT_LOGIN_TOKEN_DEFAULT_SECRET';
    const expected = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');

    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
        return { ok: false, code: 'INVALID_LOGIN_TOKEN_SIGNATURE' };
    }

    let payload;
    try {
        payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    } catch (err) {
        return { ok: false, code: 'INVALID_LOGIN_TOKEN_PAYLOAD' };
    }

    if (!payload || Number(payload.exp) < Date.now()) {
        return { ok: false, code: 'LOGIN_TOKEN_EXPIRED' };
    }
    if (payload.sessionHash !== sha256Hex(sessionToken)) {
        return { ok: false, code: 'LOGIN_TOKEN_SESSION_MISMATCH' };
    }

    return { ok: true, payload };
}

/** mTLS 인증서 로딩 (경로 미설정 시 null) */
function loadMtlsMaterial() {
    const config = getIapConfig();
    if (!config.mtls.configured) {
        return null;
    }
    if (mtlsMaterialCache && mtlsMaterialCache.certPath === config.mtls.certPath) {
        return mtlsMaterialCache;
    }

    try {
        mtlsMaterialCache = {
            certPath: config.mtls.certPath,
            keyPath: config.mtls.keyPath,
            cert: fs.readFileSync(config.mtls.certPath),
            key: fs.readFileSync(config.mtls.keyPath),
            ca: config.mtls.caPath ? fs.readFileSync(config.mtls.caPath) : undefined,
            passphrase: config.mtls.passphrase || undefined
        };
        return mtlsMaterialCache;
    } catch (err) {
        console.error('[IAP] mTLS 인증서 로드 실패:', err.message);
        return null;
    }
}

/**
 * Apps in Toss 파트너 API 호출 (http/https + mTLS)
 * @returns {Promise<{ ok: boolean, status: number, data: Object|null, error?: string, code?: string }>}
 */
function requestPartnerApi(method, apiPath, { body = null, headers = {}, timeoutMs } = {}) {
    const config = getIapConfig();
    const targetUrl = new URL(`${config.baseUrl}${apiPath}`);
    const isHttps = targetUrl.protocol === 'https:';
    const transport = isHttps ? https : http;
    const mtls = isHttps ? loadMtlsMaterial() : null;

    const requestHeaders = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...headers
    };
    if (config.apiKey && !requestHeaders.Authorization) {
        requestHeaders.Authorization = `Bearer ${config.apiKey}`;
    }

    return new Promise((resolve) => {
        const options = {
            method,
            hostname: targetUrl.hostname,
            port: targetUrl.port || (isHttps ? 443 : 80),
            path: `${targetUrl.pathname}${targetUrl.search}`,
            headers: requestHeaders,
            timeout: Math.max(2000, Number(timeoutMs) || config.timeoutMs)
        };

        if (mtls) {
            options.cert = mtls.cert;
            options.key = mtls.key;
            if (mtls.ca) {
                options.ca = mtls.ca;
            }
            if (mtls.passphrase) {
                options.passphrase = mtls.passphrase;
            }
        }

        const req = transport.request(options, (res) => {
            let raw = '';
            res.on('data', (chunk) => { raw += chunk.toString('utf8'); });
            res.on('end', () => {
                let parsed = null;
                try {
                    parsed = raw ? JSON.parse(raw) : null;
                } catch (err) {
                    parsed = null;
                }

                if (res.statusCode < 200 || res.statusCode >= 300) {
                    resolve({
                        ok: false,
                        status: res.statusCode,
                        data: parsed,
                        error: (parsed && (parsed.errorMessage || parsed.message)) || raw.slice(0, 300),
                        code: (parsed && parsed.errorCode) || `HTTP_${res.statusCode}`
                    });
                    return;
                }
                resolve({ ok: true, status: res.statusCode, data: parsed });
            });
        });

        req.on('timeout', () => {
            req.destroy();
            resolve({ ok: false, status: 0, data: null, error: `Apps in Toss API 타임아웃(${options.timeout}ms)`, code: 'TIMEOUT' });
        });

        req.on('error', (err) => {
            resolve({ ok: false, status: 0, data: null, error: `Apps in Toss API 네트워크 오류: ${err.message}`, code: 'NETWORK_ERROR' });
        });

        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

/** Toss 응답의 { resultType, success } 래퍼와 평면 응답 모두 지원 */
function unwrapPartnerResponse(result) {
    if (!result || !result.ok || !result.data) {
        return null;
    }
    if (result.data.success) {
        return result.data.success;
    }
    return result.data;
}

/**
 * 토스 로그인 authorizationCode → userKey (서버 mTLS)
 */
async function exchangeLogin({ authorizationCode, referrer = 'DEFAULT' } = {}) {
    const config = getIapConfig();

    if (!authorizationCode) {
        return { ok: false, code: 'AUTHORIZATION_CODE_REQUIRED', error: 'authorizationCode가 필요합니다.' };
    }

    if (config.mode !== 'LIVE') {
        // [샌드박스] 실제 토스 로그인 없이 개발할 수 있도록 시뮬레이션 토큰만 발급합니다.
        if (!config.sandboxGrantAllowed) {
            return { ok: false, code: 'IAP_NOT_CONFIGURED', error: 'AIT_API_KEY / mTLS 인증서가 설정되지 않았습니다.' };
        }
        const sandboxUserKey = `SANDBOX_${sha256Hex(authorizationCode).slice(0, 12)}`;
        return {
            ok: true,
            sandbox: true,
            userKey: sandboxUserKey,
            userKeyHash: sha256Hex(sandboxUserKey),
            loginToken: null
        };
    }

    const tokenRes = await requestPartnerApi('POST', '/api-partner/v1/apps-in-toss/user/oauth2/generate-token', {
        body: { authorizationCode, referrer }
    });
    const tokenBody = unwrapPartnerResponse(tokenRes);
    const accessToken = tokenBody && (tokenBody.accessToken || tokenBody.access_token);

    if (!accessToken) {
        return {
            ok: false,
            code: tokenRes.code || 'TOKEN_EXCHANGE_FAILED',
            error: tokenRes.error || 'AccessToken 발급에 실패했습니다.'
        };
    }

    const meRes = await requestPartnerApi('GET', '/api-partner/v1/apps-in-toss/user/oauth2/login-me', {
        headers: { Authorization: `Bearer ${accessToken}` }
    });
    const me = unwrapPartnerResponse(meRes);

    if (!meRes.ok || !me || me.userKey === undefined || me.userKey === null) {
        return {
            ok: false,
            code: meRes.code || 'USER_KEY_FETCH_FAILED',
            error: meRes.error || 'userKey 조회에 실패했습니다.'
        };
    }

    return {
        ok: true,
        sandbox: false,
        userKey: me.userKey,
        userKeyHash: sha256Hex(me.userKey),
        scopes: me.scope || null
    };
}

/**
 * Toss 로그인 완료 후 세션에 바인딩된 단기 토큰을 발급합니다.
 * @param {{ sessionToken: string, authorizationCode: string, referrer?: string }} input
 */
async function loginAndBind(input = {}) {
    const { sessionToken } = input;
    if (!sessionToken) {
        return { ok: false, code: 'SESSION_REQUIRED', error: '세션 토큰이 필요합니다.' };
    }

    const session = persistence.sessions.get(sessionToken) || await persistence.sessions.hydrate(sessionToken);
    if (!session) {
        return { ok: false, code: 'SESSION_NOT_FOUND', error: '유효하지 않은 진단 세션입니다.' };
    }

    const exchanged = await exchangeLogin(input);
    if (!exchanged.ok) {
        return exchanged;
    }

    const issuedAt = Date.now();
    const expiresAt = issuedAt + 10 * 60 * 1000; // 10분
    const loginToken = signLoginToken({
        userKeyHash: exchanged.userKeyHash,
        sessionHash: sha256Hex(sessionToken),
        iat: issuedAt,
        exp: expiresAt
    });

    return {
        ok: true,
        sandbox: Boolean(exchanged.sandbox),
        userKey: exchanged.userKey,
        userKeyMasked: `***${String(exchanged.userKey).slice(-4)}`,
        loginToken,
        expiresAt: new Date(expiresAt).toISOString()
    };
}

/** SKU → 내부 플랜 매핑 */
function resolvePlanBySku(sku) {
    const config = getIapConfig();
    if (!sku) {
        return null;
    }
    if (config.skus.vipAnnual && sku === config.skus.vipAnnual) {
        return { planTier: 'VIP_ANNUAL', productType: 'NON_CONSUMABLE' };
    }
    if (config.skus.starterPack && sku === config.skus.starterPack) {
        return { planTier: 'STARTER_PACK', productType: 'CONSUMABLE' };
    }
    if (config.skus.vipSubscription && sku === config.skus.vipSubscription) {
        return { planTier: 'VIP_ANNUAL', productType: 'SUBSCRIPTION' };
    }
    return null;
}

/** Apps in Toss 주문 상태 조회 (mTLS + x-toss-user-key) */
async function getOrderStatus({ orderId, userKey }) {
    const config = getIapConfig();
    if (config.mode !== 'LIVE') {
        return { ok: false, code: 'IAP_NOT_LIVE', error: '실결제 모드가 아닙니다.' };
    }
    if (!orderId || !userKey) {
        return { ok: false, code: 'MISSING_PARAMETERS', error: 'orderId와 userKey가 필요합니다.' };
    }

    const result = await requestPartnerApi('POST', '/api-partner/v1/apps-in-toss/order/get-order-status', {
        body: { orderId },
        headers: { 'x-toss-user-key': String(userKey) }
    });

    const success = unwrapPartnerResponse(result);
    if (!result.ok) {
        return {
            ok: false,
            code: result.code || 'ORDER_STATUS_FAILED',
            error: result.error || '주문 상태 조회에 실패했습니다.',
            status: result.status
        };
    }

    return {
        ok: true,
        orderId: (success && success.orderId) || orderId,
        sku: (success && success.sku) || null,
        status: (success && success.status) || 'ERROR',
        reason: (success && success.reason) || null,
        statusDeterminedAt: (success && success.statusDeterminedAt) || null
    };
}

function findIapOrder(orderId) {
    return persistence.iapOrders.get(orderId);
}

/**
 * 인앱결제 상품 지급 — processProductGrant 콜백에서 호출됩니다.
 * @param {{ sessionToken: string, orderId: string, sku: string, userKey?: string, loginToken?: string, subscriptionId?: string }} input
 */
async function grantIapOrder(input = {}) {
    const config = getIapConfig();
    const dynamic = getDynamicConfig();
    const { sessionToken, orderId, sku, userKey, loginToken } = input;

    if (!sessionToken) {
        return { ok: false, code: 'SESSION_REQUIRED', error: '세션 토큰이 필요합니다.' };
    }
    if (!orderId || typeof orderId !== 'string' || orderId.length < 3 || orderId.length > 120) {
        return { ok: false, code: 'INVALID_ORDER_ID', error: '유효한 orderId가 필요합니다.' };
    }

    const mapping = resolvePlanBySku(sku);
    if (!mapping) {
        return {
            ok: false,
            code: 'SKU_NOT_CONFIGURED',
            error: `앱인토스 콘솔에 등록된 SKU 와 일치하지 않습니다: ${sku || '(empty)'}`
        };
    }

    const session = persistence.sessions.get(sessionToken) || await persistence.sessions.hydrate(sessionToken);
    if (!session) {
        return { ok: false, code: 'SESSION_NOT_FOUND', error: '유효하지 않은 진단 세션입니다.' };
    }

    const existing = findIapOrder(orderId);
    if (existing && existing.status === 'GRANTED') {
        return {
            ok: true,
            status: 'GRANTED',
            alreadyGranted: true,
            creditsGranted: existing.creditsGranted,
            remainingCredits: Number(session.remainingCredits) || 0,
            internalOrderId: existing.internalOrderId || null
        };
    }
    if (existing && existing.status === 'REFUNDED') {
        return { ok: false, code: 'ORDER_REFUNDED', error: '환불된 주문입니다.' };
    }

    const plan = resolvePlan(mapping.planTier);
    if (!plan) {
        return { ok: false, code: 'PLAN_NOT_FOUND', error: '플랜을 찾을 수 없습니다.' };
    }

    let verification = {
        mode: config.mode,
        skuMatched: true,
        userKeyHash: userKey ? sha256Hex(userKey) : null
    };

    if (config.mode === 'LIVE') {
        if (!userKey) {
            return { ok: false, code: 'TOSS_USER_KEY_REQUIRED', error: '토스 로그인 userKey가 필요합니다.' };
        }

        if (!loginToken && !config.allowUnboundGrant) {
            return {
                ok: false,
                code: 'LOGIN_TOKEN_REQUIRED',
                error: '토스 로그인으로 발급받은 loginToken이 필요합니다.'
            };
        }

        if (loginToken) {
            const tokenCheck = verifyLoginToken(loginToken, sessionToken);
            if (!tokenCheck.ok) {
                return { ok: false, code: tokenCheck.code, error: '로그인 토큰 검증에 실패했습니다.' };
            }
            if (tokenCheck.payload.userKeyHash !== sha256Hex(userKey)) {
                return { ok: false, code: 'USER_KEY_TOKEN_MISMATCH', error: 'userKey와 loginToken이 일치하지 않습니다.' };
            }
        }

        const remote = await getOrderStatus({ orderId, userKey });
        if (!remote.ok) {
            return {
                ok: false,
                code: remote.code,
                error: remote.error,
                retryable: remote.code === 'NETWORK_ERROR' || remote.code === 'TIMEOUT'
            };
        }

        if (!['PAYMENT_COMPLETED', 'PURCHASED'].includes(remote.status)) {
            return {
                ok: false,
                code: `ORDER_STATUS_${remote.status}`,
                error: `지급 가능한 주문 상태가 아닙니다: ${remote.status} (${remote.reason || ''})`
            };
        }

        if (remote.sku && remote.sku !== sku) {
            return { ok: false, code: 'SKU_MISMATCH', error: '주문 SKU와 요청 SKU가 일치하지 않습니다.' };
        }

        verification = {
            ...verification,
            remoteStatus: remote.status,
            statusDeterminedAt: remote.statusDeterminedAt || null,
            skuMatched: !remote.sku || remote.sku === sku
        };
    } else if (!config.sandboxGrantAllowed) {
        return { ok: false, code: 'IAP_NOT_CONFIGURED', error: 'AIT_API_KEY / mTLS 인증서가 설정되지 않았습니다.' };
    }

    // 1) 내부 주문 원장 생성 (결제 승인과 동일한 감사 추적)
    const internalOrder = createOrder({
        sessionToken,
        planTier: plan.planTier,
        paymentMethod: 'CARD',
        paymentSource: 'APP_IN_TOSS_IAP'
    });

    if (!internalOrder.ok) {
        return { ok: false, code: 'INTERNAL_ORDER_FAILED', error: internalOrder.error };
    }

    const internalOrderId = internalOrder.order.orderId;
    markOrderPaid(internalOrderId, {
        paymentKey: `AIT_${orderId.slice(0, 24)}`,
        tossReceipt: {
            paymentKey: null,
            orderId: internalOrderId,
            method: 'APP_IN_TOSS_IAP',
            status: 'DONE',
            approvedAt: new Date().toISOString(),
            totalAmount: plan.amountKrw,
            appInTossOrderId: orderId,
            sku,
            verifiedBy: config.mode === 'LIVE' ? 'APPS_IN_TOSS_ORDER_STATUS_API' : 'SANDBOX'
        }
    });

    const entitlement = await grantEntitlementForOrder(internalOrderId, {
        source: 'APP_IN_TOSS_IAP',
        initialDiagnosisCost: session.isPremiumUnlocked ? 0 : 10
    });

    if (!entitlement.ok) {
        return {
            ok: false,
            code: entitlement.code || 'ENTITLEMENT_FAILED',
            error: entitlement.error
        };
    }

    const record = {
        aitOrderId: orderId,
        sessionToken,
        sku,
        planTier: plan.planTier,
        productType: mapping.productType,
        creditsGranted: plan.creditsGranted,
        status: 'GRANTED',
        userKeyHash: verification.userKeyHash,
        userKeyMasked: userKey ? `***${String(userKey).slice(-4)}` : null,
        internalOrderId,
        subscriptionId: input.subscriptionId || null,
        verification,
        grantedAt: new Date().toISOString(),
        appId: dynamic.miniappId,
        updatedAt: new Date().toISOString()
    };

    await persistence.iapOrders.set(orderId, record);

    // 매출 원장 (IAP 정산은 Apple/Google 정책을 따르므로 별도 표기)
    await persistence.payments.set(internalOrderId, {
        tossOrderId: internalOrderId,
        sessionToken,
        planTier: entitlement.planLabel,
        paidAmountKrw: plan.amountKrw,
        creditsGranted: plan.creditsGranted,
        remainingCredits: entitlement.remainingCredits,
        paymentMode: config.mode === 'LIVE' ? 'APP_IN_TOSS_IAP' : 'SANDBOX_SIMULATION',
        paymentSource: 'APP_IN_TOSS_IAP',
        aitOrderId: orderId,
        sku,
        tossReceipt: { status: 'DONE', method: 'APP_IN_TOSS_IAP', approvedAt: record.grantedAt },
        paidAt: record.grantedAt
    });

    return {
        ok: true,
        status: 'GRANTED',
        alreadyGranted: false,
        creditsGranted: plan.creditsGranted,
        remainingCredits: entitlement.remainingCredits,
        internalOrderId,
        mode: config.mode
    };
}

/**
 * 주문 상태 재동기화 (환불 회수·지급 누락 복구). 관리자/배치에서 호출.
 */
async function syncIapOrder({ orderId, userKey } = {}) {
    const record = findIapOrder(orderId);
    if (!record) {
        return { ok: false, code: 'IAP_ORDER_NOT_FOUND', error: 'IAP 주문 원장에 없습니다.' };
    }

    const config = getIapConfig();
    if (config.mode !== 'LIVE') {
        return { ok: true, sandbox: true, record, changed: false };
    }

    const remote = await getOrderStatus({ orderId, userKey });
    if (!remote.ok) {
        return { ok: false, code: remote.code, error: remote.error };
    }

    if (remote.status === 'REFUNDED') {
        if (record.status !== 'REFUNDED') {
            await revokeEntitlementForOrder(record.internalOrderId, { reason: 'IAP_REFUNDED' });
            record.status = 'REFUNDED';
            record.refundedAt = new Date().toISOString();
            record.updatedAt = new Date().toISOString();
            await persistence.iapOrders.set(orderId, record);
        }
        return { ok: true, status: 'REFUNDED', changed: true, record };
    }

    if (['PAYMENT_COMPLETED', 'PURCHASED'].includes(remote.status) && record.status !== 'GRANTED') {
        // 지급 누락 복구: 기존 내부 주문으로 멱등 지급
        const entitlement = await grantEntitlementForOrder(record.internalOrderId, {
            source: 'IAP_SYNC',
            initialDiagnosisCost: 0
        });
        record.status = 'GRANTED';
        record.recoveredAt = new Date().toISOString();
        record.updatedAt = new Date().toISOString();
        await persistence.iapOrders.set(orderId, record);
        return { ok: true, status: 'GRANTED', changed: true, entitlement };
    }

    if (['FAILED', 'NOT_FOUND', 'MINIAPP_MISMATCH', 'ERROR'].includes(remote.status) && record.status === 'GRANTED') {
        await revokeEntitlementForOrder(record.internalOrderId, { reason: `IAP_${remote.status}` });
        record.status = 'REVOKED';
        record.revokeReason = remote.status;
        record.updatedAt = new Date().toISOString();
        await persistence.iapOrders.set(orderId, record);
        return { ok: true, status: 'REVOKED', changed: true, record };
    }

    return { ok: true, status: record.status, remoteStatus: remote.status, changed: false };
}

/** 클라이언트에 노출할 상품 카탈로그 (콘솔 SKU 매핑) */
function getProductCatalog() {
    const config = getIapConfig();
    const dynamic = getDynamicConfig();
    const catalog = [];

    if (config.skus.vipAnnual) {
        catalog.push({
            sku: config.skus.vipAnnual,
            planTier: 'VIP_ANNUAL',
            productType: 'NON_CONSUMABLE',
            priceKrw: dynamic.vipAnnualPrice,
            creditsGranted: dynamic.vipCreditCap,
            title: `${dynamic.trialDays}일 무료 체험 + 연간 VIP 패스`
        });
    }
    if (config.skus.starterPack) {
        catalog.push({
            sku: config.skus.starterPack,
            planTier: 'STARTER_PACK',
            productType: 'CONSUMABLE',
            priceKrw: dynamic.monetizationPrice,
            creditsGranted: dynamic.starterCreditCap,
            title: `스타터 ${dynamic.starterCreditCap} 크레딧 팩`
        });
    }
    if (config.skus.vipSubscription) {
        catalog.push({
            sku: config.skus.vipSubscription,
            planTier: 'VIP_ANNUAL',
            productType: 'SUBSCRIPTION',
            priceKrw: dynamic.vipAnnualPrice,
            creditsGranted: dynamic.vipCreditCap,
            title: 'VIP 정기 구독 (앱인토스 인앱결제)'
        });
    }

    return catalog;
}

function getIapStatus() {
    const config = getIapConfig();
    const orders = persistence.iapOrders.list();
    return {
        enabled: config.enabled,
        mode: config.mode,
        appId: config.appId,
        apiBaseUrl: config.baseUrl,
        apiKeyMasked: config.apiKeyMasked,
        mtlsConfigured: config.mtls.configured,
        loginBindingRequired: !config.allowUnboundGrant,
        sandboxGrantAllowed: config.sandboxGrantAllowed,
        skusConfigured: config.configuredSkus.length,
        skuMap: {
            vipAnnual: config.skus.vipAnnual ? 'CONFIGURED' : null,
            starterPack: config.skus.starterPack ? 'CONFIGURED' : null,
            vipSubscription: config.skus.vipSubscription ? 'CONFIGURED' : null
        },
        counts: {
            total: orders.length,
            granted: orders.filter((o) => o.status === 'GRANTED').length,
            refunded: orders.filter((o) => o.status === 'REFUNDED').length
        },
        sdkVersionGuide: '클라이언트 SDK @apps-in-toss/web-framework 3.x 의 IAP 도메인 사용'
    };
}

module.exports = {
    exchangeLogin,
    loginAndBind,
    verifyLoginToken,
    signLoginToken,
    getOrderStatus,
    grantIapOrder,
    syncIapOrder,
    resolvePlanBySku,
    getProductCatalog,
    getIapStatus,
    findIapOrder
};
