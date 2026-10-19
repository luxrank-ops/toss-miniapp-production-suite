/**
 * ============================================================================
 * 파일명: backend/services/paymentGateway.js
 * 역할: [토스페이먼츠 실결제 게이트웨이] 주문 생성 → 결제 승인(confirm) → 취소(cancel)
 * ----------------------------------------------------------------------------
 * [왜 서버 승인(Server Confirm)이 필수인가?]
 *   토스페이먼츠 결제는 반드시 두 단계로 진행됩니다.
 *     ① 브라우저(결제위젯) 에서 "인증 완료" → paymentKey / orderId / amount 발급
 *     ② ①에서 받은 값으로 **서버가 토스페이먼츠 API에 최종 승인(confirm) 요청**
 *   이 때 서버가 금액(amount)을 검증하지 않으면 클라이언트가 결제 금액을 조작해
 *   ₩100으로 VIP 연간 패스를 구매하는 치명적인 보안 사고가 발생합니다.
 *   따라서 본 모듈은 **.env 설정 금액과 1원 단위로 일치하는지 서버에서 재검증**합니다.
 *
 * [모드]
 *   - TOSS_LIVE          : 클라이언트 키 + 시크릿 키 모두 주입된 실결제 모드
 *   - SANDBOX_SIMULATION : 키 미주입 시 기존 데모 흐름(금액 일치 검증만 수행)
 *
 * [환경변수]
 *   TOSS_PAYMENTS_CLIENT_KEY  (예: test_ck_...)  → 브라우저 노출 O
 *   TOSS_PAYMENTS_SECRET_KEY  (예: test_sk_...)  → 브라우저 노출 절대 금지
 *   PUBLIC_BASE_URL           (예: https://my-app.e2b.app) → successUrl/failUrl 생성용
 * ============================================================================
 */

const crypto = require('crypto');
const { getDynamicConfig, maskSensitiveString } = require('../config/envLoader');

/**
 * 주문 원장 (실서비스에서는 Supabase/PostgreSQL orders 테이블로 이관)
 * orderId → { orderId, sessionToken, planTier, amountKrw, status, ... }
 */
const paymentOrdersStore = new Map();

/** 주문 상태 상수 */
const ORDER_STATUS = {
    CREATED: 'CREATED',
    PAID: 'PAID',
    FAILED: 'FAILED',
    CANCELED: 'CANCELED'
};

/**
 * 플랜 티어 문자열을 서버 설정 금액으로 변환합니다(클라이언트 금액 신뢰 금지).
 * @param {string} planTier 'VIP_ANNUAL' | 'STARTER_PACK'
 * @returns {{ planTier: string, amountKrw: number, creditsGranted: number, trialDays: number, orderName: string }|null}
 */
function resolvePlan(planTier) {
    const config = getDynamicConfig();

    if (planTier === 'VIP_ANNUAL') {
        return {
            planTier: 'VIP_ANNUAL',
            amountKrw: config.vipAnnualPrice,
            creditsGranted: config.vipCreditCap,
            trialDays: config.trialDays,
            orderName: `뮤즈글로우 AI 연간 VIP 패스 (${config.trialDays}일 무료 체험)`
        };
    }

    if (planTier === 'STARTER_PACK') {
        return {
            planTier: 'STARTER_PACK',
            amountKrw: config.monetizationPrice,
            creditsGranted: config.starterCreditCap,
            trialDays: 0,
            orderName: `뮤즈글로우 AI 스타터 ${config.starterCreditCap} 크레딧 팩`
        };
    }

    return null;
}

/**
 * 주문 ID 생성 (토스 규격: 영문 대소문자·숫자·특수문자(-,_) 6~64자)
 */
function createOrderId(planTier) {
    const stamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
    const random = crypto.randomBytes(4).toString('hex').toUpperCase();
    const prefix = planTier === 'VIP_ANNUAL' ? 'MGVIP' : 'MGST';
    return `${prefix}_${stamp}_${random}`;
}

/**
 * [STEP 1] 결제 주문 생성 — 서버가 금액을 확정하므로 클라이언트 조작이 불가능합니다.
 * @param {{ sessionToken: string, planTier: string }} input
 * @returns {{ ok: boolean, order?: Object, error?: string }}
 */
function createOrder(input = {}) {
    const { sessionToken, planTier } = input;

    if (!sessionToken) {
        return { ok: false, error: '세션 토큰이 없습니다. 먼저 온보딩 스캔을 진행해 주세요.' };
    }

    const plan = resolvePlan(planTier);
    if (!plan) {
        return { ok: false, error: `지원하지 않는 플랜입니다: ${planTier}` };
    }

    const config = getDynamicConfig();
    const orderId = createOrderId(plan.planTier);

    const order = {
        orderId,
        sessionToken,
        planTier: plan.planTier,
        amountKrw: plan.amountKrw,
        creditsGranted: plan.creditsGranted,
        trialDays: plan.trialDays,
        orderName: plan.orderName,
        status: ORDER_STATUS.CREATED,
        mode: config.payments.mode,
        appOwnerIdMasked: config.appOwnerIdMasked,
        settlementHolderMasked: config.settlementHolderMasked,
        paymentKey: null,
        tossReceipt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    paymentOrdersStore.set(orderId, order);

    return {
        ok: true,
        order,
        checkout: {
            mode: config.payments.mode,
            orderId: order.orderId,
            orderName: order.orderName,
            amountKrw: order.amountKrw,
            currency: 'KRW',
            clientKey: config.payments.mode === 'TOSS_LIVE' ? config.payments.clientKey : null,
            successUrl: config.payments.publicBaseUrl ? config.payments.successUrl : null,
            failUrl: config.payments.publicBaseUrl ? config.payments.failUrl : null
        }
    };
}

/**
 * [STEP 2] 토스페이먼츠 최종 결제 승인(Confirm) API 호출
 * 공식 스펙: POST https://api.tosspayments.com/v1/payments/confirm
 * 인증: Basic base64(secretKey + ':')
 * @param {{ paymentKey: string, orderId: string, amount: number }} input
 * @returns {Promise<{ ok: boolean, receipt?: Object, error?: string, code?: string }>}
 */
async function confirmPayment(input = {}) {
    const config = getDynamicConfig();
    const payments = config.payments;

    if (payments.mode !== 'TOSS_LIVE') {
        return { ok: false, error: '실결제 모드가 아닙니다(샌드박스 시뮬레이션).', code: 'SANDBOX_MODE' };
    }

    const { paymentKey, orderId, amount } = input;
    const order = paymentOrdersStore.get(orderId);

    if (!order) {
        return { ok: false, error: '존재하지 않는 주문입니다.', code: 'ORDER_NOT_FOUND' };
    }

    if (order.status === ORDER_STATUS.PAID) {
        return { ok: true, receipt: order.tossReceipt, alreadyPaid: true };
    }

    // [보안] 서버가 확정한 금액과 1원이라도 다르면 즉시 거절
    if (Number(amount) !== order.amountKrw) {
        return {
            ok: false,
            error: `결제 금액 불일치(요청 ${amount}원 / 서버 확정 ${order.amountKrw}원)`,
            code: 'AMOUNT_MISMATCH'
        };
    }

    const authHeader = 'Basic ' + Buffer.from(`${payments.secretKey}:`).toString('base64');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    try {
        const response = await fetch(`${payments.apiBaseUrl}/payments/confirm`, {
            method: 'POST',
            headers: {
                Authorization: authHeader,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ paymentKey, orderId, amount: order.amountKrw }),
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
            order.status = ORDER_STATUS.FAILED;
            order.updatedAt = new Date().toISOString();
            order.failureReason = (parsed && parsed.message) || rawBody.slice(0, 300);
            return {
                ok: false,
                error: `토스페이먼츠 승인 실패: ${order.failureReason}`,
                code: (parsed && parsed.code) || `HTTP_${response.status}`
            };
        }

        order.status = ORDER_STATUS.PAID;
        order.paymentKey = paymentKey;
        order.updatedAt = new Date().toISOString();
        order.tossReceipt = {
            paymentKey,
            orderId: parsed && parsed.orderId ? parsed.orderId : orderId,
            method: parsed && parsed.method ? parsed.method : null,
            status: parsed && parsed.status ? parsed.status : 'DONE',
            approvedAt: (parsed && parsed.approvedAt) ? parsed.approvedAt : new Date().toISOString(),
            totalAmount: (parsed && parsed.totalAmount) ? parsed.totalAmount : order.amountKrw,
            receiptUrl: (parsed && parsed.receipt && parsed.receipt.url) ? parsed.receipt.url : null,
            cardCompany: (parsed && parsed.card && parsed.card.company) ? parsed.card.company : null,
            cardNumber: (parsed && parsed.card && parsed.card.number) ? parsed.card.number : null,
            installmentPlanMonths: (parsed && parsed.card && parsed.card.installmentPlanMonths) || 0
        };

        return { ok: true, receipt: order.tossReceipt };
    } catch (err) {
        const isAbort = err && err.name === 'AbortError';
        return {
            ok: false,
            error: isAbort ? '토스페이먼츠 승인 요청 타임아웃(15초)' : `토스페이먼츠 네트워크 오류: ${err.message}`,
            code: 'NETWORK_ERROR'
        };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * [STEP 3] 결제 취소(환불) — 토스페이먼츠 cancel API
 * @param {{ paymentKey: string, cancelReason: string }} input
 */
async function cancelPayment(input = {}) {
    const config = getDynamicConfig();
    const payments = config.payments;

    if (payments.mode !== 'TOSS_LIVE') {
        // 샌드박스: 원장 상태만 CANCELED로 변경
        const target = [...paymentOrdersStore.values()].find((o) => o.paymentKey === input.paymentKey);
        if (target) {
            target.status = ORDER_STATUS.CANCELED;
            target.updatedAt = new Date().toISOString();
        }
        return { ok: true, mode: 'SANDBOX_SIMULATION', canceled: Boolean(target) };
    }

    if (!input.paymentKey) {
        return { ok: false, error: 'paymentKey가 필요합니다.' };
    }

    const authHeader = 'Basic ' + Buffer.from(`${payments.secretKey}:`).toString('base64');

    try {
        const response = await fetch(`${payments.apiBaseUrl}/payments/${encodeURIComponent(input.paymentKey)}/cancel`, {
            method: 'POST',
            headers: {
                Authorization: authHeader,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ cancelReason: input.cancelReason || '고객 요청에 의한 환불' })
        });

        const rawBody = await response.text();
        let parsed = null;
        try {
            parsed = rawBody ? JSON.parse(rawBody) : null;
        } catch (err) {
            parsed = null;
        }

        if (!response.ok) {
            return {
                ok: false,
                error: `토스페이먼츠 취소 실패: ${(parsed && parsed.message) || rawBody.slice(0, 300)}`,
                code: (parsed && parsed.code) || `HTTP_${response.status}`
            };
        }

        const target = [...paymentOrdersStore.values()].find((o) => o.paymentKey === input.paymentKey);
        if (target) {
            target.status = ORDER_STATUS.CANCELED;
            target.updatedAt = new Date().toISOString();
        }

        return { ok: true, mode: 'TOSS_LIVE', receipt: parsed };
    } catch (err) {
        return { ok: false, error: `토스페이먼츠 취소 네트워크 오류: ${err.message}` };
    }
}

/**
 * 주문 조회 (클라이언트 노출용으로 민감키는 마스킹)
 */
function getOrder(orderId, { includeSession = false } = {}) {
    const order = paymentOrdersStore.get(orderId);
    if (!order) {
        return null;
    }

    return {
        orderId: order.orderId,
        ...(includeSession ? { sessionToken: order.sessionToken } : {}),
        planTier: order.planTier,
        amountKrw: order.amountKrw,
        orderName: order.orderName,
        status: order.status,
        mode: order.mode,
        paymentKeyMasked: order.paymentKey ? maskSensitiveString(order.paymentKey) : null,
        appOwnerIdMasked: order.appOwnerIdMasked,
        settlementHolderMasked: order.settlementHolderMasked,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt
    };
}

/**
 * 내부용: 원본 주문 객체 접근 (서버 로직 전용 — 외부 응답으로 절대 직렬화 금지)
 */
function getRawOrder(orderId) {
    return paymentOrdersStore.get(orderId) || null;
}

function markOrderPaid(orderId, patch = {}) {
    const order = paymentOrdersStore.get(orderId);
    if (!order) {
        return null;
    }
    Object.assign(order, patch, { status: ORDER_STATUS.PAID, updatedAt: new Date().toISOString() });
    return order;
}

/**
 * 클라이언트에 노출 가능한 결제 모드 정보
 */
function getPaymentStatus() {
    const config = getDynamicConfig();
    const payments = config.payments;

    return {
        mode: payments.mode,
        liveEnabled: payments.enabled,
        clientKey: payments.mode === 'TOSS_LIVE' ? payments.clientKey : null,
        clientKeyMasked: payments.clientKeyMasked,
        secretKeyMasked: payments.secretKeyMasked,
        publicBaseUrlConfigured: Boolean(payments.publicBaseUrl),
        vipAnnualPrice: config.vipAnnualPrice,
        starterPrice: config.monetizationPrice,
        supportsRefund: payments.enabled
    };
}

module.exports = {
    createOrder,
    confirmPayment,
    cancelPayment,
    getOrder,
    getRawOrder,
    markOrderPaid,
    getPaymentStatus,
    resolvePlan,
    ORDER_STATUS
};
