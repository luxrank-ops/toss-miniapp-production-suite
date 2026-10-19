/**
 * ============================================================================
 * 파일명: backend/services/entitlementService.js
 * 역할: [결제 권한 지급/회수 단일 통로] 카드·가상계좌·자동결제·앱인토스 IAP 가
 *       모두 같은 규칙으로 크레딧/하드페이월을 해제하도록 통합합니다.
 * ----------------------------------------------------------------------------
 * 왜 필요한가?
 *   - 기존에는 /api/payment/unlock 안에만 크레딧 지급 로직이 있었습니다.
 *   - 웹훅(가상계좌 입금)·자동결제 갱신·IAP 지급이 추가되면 같은 로직이 4곳에
 *     복제되어 "주문 1건에 크레딧 2회 지급" 같은 치명적 버그가 발생합니다.
 *   - 따라서 **멱등(Idempotent) 지급 함수 하나**로 통일합니다.
 *
 * 멱등성 보장:
 *   - 주문 레코드의 entitlementsGranted=true
 *   - 세션 레코드의 grantedOrderIds 배열에 orderId 존재
 *   - 둘 중 하나라도 참이면 재지급하지 않습니다.
 *   (세션은 AES-256-GCM 암호화 페이로드에 저장되므로 DB 재시작 후에도 유지)
 * ============================================================================
 */

const { getDynamicConfig } = require('../config/envLoader');
const persistence = require('./persistenceStore');
const { getRawOrder, hydrateOrder, ORDER_STATUS } = require('./paymentGateway');

/** 세션 조회 (메모리 → Supabase Read-Through) */
async function resolveSession(sessionToken) {
    if (!sessionToken) {
        return null;
    }
    const cached = persistence.sessions.get(sessionToken);
    if (cached) {
        return cached;
    }
    return persistence.sessions.hydrate(sessionToken);
}

/** 플랜 티어 → 세션 표시 라벨 */
function resolvePlanLabel(order) {
    if (order.planTier === 'VIP_ANNUAL') {
        const config = getDynamicConfig();
        return `VIP_ANNUAL_${config.trialDays}D_TRIAL`;
    }
    if (order.planTier === 'STARTER_PACK') {
        return 'STARTER_CREDIT_PACK';
    }
    return order.planTier || 'PAID_PLAN';
}

/**
 * 주문에 대한 권한(하드페이월 해제 + 크레딧)을 멱등하게 지급합니다.
 *
 * @param {string} orderId 서버가 생성/확정한 주문 ID
 * @param {{ source?: string, initialDiagnosisCost?: number }} options
 * @returns {Promise<{
 *   ok: boolean, error?: string, code?: string,
 *   order?: Object, session?: Object, alreadyGranted?: boolean,
 *   creditsDeducted?: number, remainingCredits?: number, planLabel?: string
 * }>}
 */
async function grantEntitlementForOrder(orderId, options = {}) {
    const order = getRawOrder(orderId) || (await hydrateOrder(orderId));
    if (!order) {
        return { ok: false, code: 'ORDER_NOT_FOUND', error: '존재하지 않는 주문입니다.' };
    }

    if (order.status !== ORDER_STATUS.PAID) {
        return {
            ok: false,
            code: 'ORDER_NOT_PAID',
            error: `결제가 완료되지 않은 주문입니다(현재 상태: ${order.status}).`,
            order
        };
    }

    const session = await resolveSession(order.sessionToken);
    if (!session) {
        return {
            ok: false,
            code: 'SESSION_NOT_FOUND',
            error: '주문에 연결된 진단 세션을 찾을 수 없습니다.',
            order
        };
    }

    const grantedOrderIds = Array.isArray(session.grantedOrderIds) ? session.grantedOrderIds : [];
    const alreadyGranted = Boolean(order.entitlementsGranted) || grantedOrderIds.includes(order.orderId);

    if (alreadyGranted) {
        // 이미 지급된 주문 — 크레딧/세션 상태를 절대 변경하지 않습니다.
        if (!order.entitlementsGranted) {
            order.entitlementsGranted = true;
            order.fulfilledAt = order.fulfilledAt || new Date().toISOString();
            persistence.orders.set(order.orderId, order).catch(() => {});
        }
        return {
            ok: true,
            alreadyGranted: true,
            order,
            session,
            creditsDeducted: 0,
            remainingCredits: Number(session.remainingCredits) || 0,
            planLabel: session.selectedPlanTier
        };
    }

    const wasUnlocked = Boolean(session.isPremiumUnlocked);
    const configuredDiagnosisCost = 10;
    const initialDiagnosisCost = options.initialDiagnosisCost !== undefined
        ? Math.max(0, Number(options.initialDiagnosisCost) || 0)
        : (wasUnlocked ? 0 : configuredDiagnosisCost);

    const creditsGranted = Math.max(0, Number(order.creditsGranted) || 0);
    const nextRemaining = Math.max(
        0,
        (Number(session.remainingCredits) || 0) + creditsGranted - initialDiagnosisCost
    );

    session.remainingCredits = nextRemaining;
    session.isPremiumUnlocked = true;
    session.selectedPlanTier = resolvePlanLabel(order);
    session.lastOrderId = order.orderId;
    session.lastEntitlementAt = new Date().toISOString();
    session.lastEntitlementSource = options.source || 'UNKNOWN';
    session.grantedOrderIds = [...grantedOrderIds, order.orderId].slice(-50);

    order.entitlementsGranted = true;
    order.fulfilledAt = new Date().toISOString();
    order.fulfillmentSource = options.source || 'UNKNOWN';

    // 세션·주문을 DB 에 기록 (실패해도 메모리 값 유지)
    await persistence.sessions.set(order.sessionToken, session);
    await persistence.orders.set(order.orderId, order);

    return {
        ok: true,
        alreadyGranted: false,
        order,
        session,
        creditsDeducted: initialDiagnosisCost,
        remainingCredits: nextRemaining,
        planLabel: session.selectedPlanTier
    };
}

/**
 * 환불·결제 취소·입금 오류 시 권한을 회수합니다.
 * - 마지막으로 권한을 준 주문이면 즉시 재잠금(REFUNDED)
 * - 과거 주문이면 해당 주문이 지급한 크레딧만 차감
 */
async function revokeEntitlementForOrder(orderId, options = {}) {
    const order = getRawOrder(orderId) || (await hydrateOrder(orderId));
    if (!order) {
        return { ok: false, code: 'ORDER_NOT_FOUND', error: '존재하지 않는 주문입니다.' };
    }

    const session = await resolveSession(order.sessionToken);
    if (!session) {
        return { ok: false, code: 'SESSION_NOT_FOUND', error: '세션을 찾을 수 없습니다.', order };
    }

    const grantedOrderIds = Array.isArray(session.grantedOrderIds) ? session.grantedOrderIds : [];
    const wasGranted = Boolean(order.entitlementsGranted) || grantedOrderIds.includes(order.orderId);

    if (!wasGranted) {
        return { ok: true, alreadyRevoked: true, order, session };
    }

    const isLatest = session.lastOrderId === order.orderId;

    if (isLatest) {
        // 이 주문이 지급한 크레딧만 회수합니다(다른 주문의 잔여 크레딧은 보존).
        session.isPremiumUnlocked = false;
        session.remainingCredits = Math.max(
            0,
            (Number(session.remainingCredits) || 0) - (Number(order.creditsGranted) || 0)
        );
        session.selectedPlanTier = 'REFUNDED';
        session.aiStatus = 'PENDING';
        session.aiEnrichment = null;
        session.lastOrderId = null;
    } else {
        session.remainingCredits = Math.max(
            0,
            (Number(session.remainingCredits) || 0) - (Number(order.creditsGranted) || 0)
        );
    }

    session.grantedOrderIds = grantedOrderIds.filter((id) => id !== order.orderId);
    session.lastRevokedOrderId = order.orderId;
    session.lastRevokedAt = new Date().toISOString();

    order.entitlementsGranted = false;
    order.revokedAt = new Date().toISOString();
    order.revokeReason = options.reason || 'REFUND';

    await persistence.sessions.set(order.sessionToken, session);
    await persistence.orders.set(order.orderId, order);

    return {
        ok: true,
        alreadyRevoked: false,
        order,
        session,
        refunded: isLatest,
        remainingCredits: session.remainingCredits
    };
}

module.exports = {
    grantEntitlementForOrder,
    revokeEntitlementForOrder,
    resolveSession,
    resolvePlanLabel
};
