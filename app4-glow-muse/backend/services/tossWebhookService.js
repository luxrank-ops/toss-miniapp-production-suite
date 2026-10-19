/**
 * ============================================================================
 * 파일명: backend/services/tossWebhookService.js
 * 역할: [토스페이먼츠 웹훅 수신·검증·원장 반영]
 * ----------------------------------------------------------------------------
 * 지원 이벤트
 *   - PAYMENT_STATUS_CHANGED : 카드/계좌이체/가상계좌 등 모든 결제 상태 변경
 *   - DEPOSIT_CALLBACK       : 가상계좌 입금/입금 오류/취소 (평면 구조 본문)
 *   - BILLING_DELETED        : 자동결제 빌링키 삭제
 *   - CANCEL_STATUS_CHANGED  : 해외 간편결제 비동기 취소 (로그만 기록)
 *
 * 보안 설계 (중요)
 *   1) 결제 웹훅에는 서명 헤더가 없습니다(토스 공식 문서: signature 는 payout.changed /
 *      seller.changed 전용). 따라서 **본문의 status/amount 를 신뢰하지 않고**
 *      토스 API 로 결제를 재조회(canonical verification)한 뒤 그 결과만 반영합니다.
 *   2) DEPOSIT_CALLBACK 의 secret 은 결제 승인 응답의 secret 과 일치해야 합니다.
 *      (불일치 시에도 canonical 재조회가 성공해야만 처리)
 *   3) 전송 ID(tosspayments-webhook-transmission-id)로 멱등 처리하여 토스의 재전송
 *      (최대 7회)에도 크레딧이 중복 지급되지 않습니다.
 *   4) 경로 토큰(TOSS_WEBHOOK_PATH_TOKEN)으로 무작위 스캐너 요청을 1차 차단합니다.
 *
 * 응답 코드 정책 (토스 재전송 규칙)
 *   - 200: 정상 처리 / 중복 / 우리 주문 아님 / 무시 가능한 이벤트 → 재전송 중단
 *   - 400: JSON 파손 → 재전송해도 성공 불가
 *   - 401/403: 경로 토큰·secret 검증 실패 (공격 또는 설정 오류)
 *   - 503: 토스 API 일시 장애로 검증 불가 → 토스가 재전송하도록 유도
 * ============================================================================
 */

const crypto = require('crypto');
const { getWebhookConfig, getDynamicConfig } = require('../config/envLoader');
const persistence = require('./persistenceStore');
const {
    fetchPaymentByKey,
    fetchPaymentByOrderId,
    updateOrderStatus,
    getRawOrder,
    hydrateOrder,
    ORDER_STATUS
} = require('./paymentGateway');
const { grantEntitlementForOrder, revokeEntitlementForOrder } = require('./entitlementService');
const billingService = require('./billingService');

const stats = {
    received: 0,
    processed: 0,
    duplicates: 0,
    ignored: 0,
    rejected: 0,
    verificationFailures: 0,
    errors: 0,
    lastEventAt: null,
    lastEventType: null,
    lastResult: null
};

/** 타이밍 공격 방어 상수 시간 비교 */
function safeEqual(a, b) {
    const left = Buffer.from(String(a || ''));
    const right = Buffer.from(String(b || ''));
    if (left.length !== right.length) {
        return false;
    }
    return crypto.timingSafeEqual(left, right);
}

/** 경로 토큰 검증 (미설정 시 통과) */
function verifyPathToken(token) {
    const config = getWebhookConfig();
    if (!config.pathTokenConfigured) {
        return true;
    }
    return safeEqual(token, config.pathToken);
}

function sha256Hex(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * 본문 정규화 — PAYMENT_STATUS_CHANGED(nested) 와 DEPOSIT_CALLBACK(flat) 구조 차이 흡수
 */
function normalizeEvent(payload) {
    if (!payload || typeof payload !== 'object') {
        return { eventType: 'UNKNOWN' };
    }

    if (payload.eventType) {
        const data = payload.data || {};
        return {
            eventType: String(payload.eventType),
            createdAt: payload.createdAt || null,
            orderId: data.orderId || payload.orderId || null,
            paymentKey: data.paymentKey || null,
            status: data.status || payload.status || null,
            transactionKey: data.transactionKey || payload.transactionKey || null,
            secret: payload.secret || null,
            data
        };
    }

    // DEPOSIT_CALLBACK 은 eventType/data 없이 평면 구조로 전송됩니다.
    if (payload.orderId && (payload.transactionKey || payload.secret)) {
        return {
            eventType: 'DEPOSIT_CALLBACK',
            createdAt: payload.createdAt || null,
            orderId: payload.orderId,
            paymentKey: null,
            status: payload.status || null,
            transactionKey: payload.transactionKey || null,
            secret: payload.secret || null,
            data: payload
        };
    }

    return { eventType: 'UNKNOWN', createdAt: payload.createdAt || null };
}

/** 토스에 재조회로 canonical 상태를 확인합니다. */
async function fetchCanonicalPayment(event) {
    const config = getWebhookConfig();
    const options = { timeoutMs: config.timeoutMs };

    if (event.paymentKey) {
        return fetchPaymentByKey(event.paymentKey, options);
    }
    if (event.orderId) {
        return fetchPaymentByOrderId(event.orderId, options);
    }
    return { ok: false, data: null, error: 'paymentKey/orderId 가 없습니다.', code: 'MISSING_IDENTIFIER' };
}

/**
 * canonical Payment 객체를 주문 원장에 반영합니다. (모든 경로가 공유하는 단일 함수)
 * @returns {Promise<{ result: string, details?: Object }>}
 */
async function applyCanonicalPayment(order, payment, options = {}) {
    const status = String(payment.status || '').toUpperCase();
    const virtualAccount = payment.virtualAccount || null;
    const canonicalPaymentKey = payment.paymentKey || null;

    const baseReceipt = {
        ...(order.tossReceipt || {}),
        paymentKey: canonicalPaymentKey || (order.tossReceipt && order.tossReceipt.paymentKey) || null,
        orderId: order.orderId,
        method: payment.method || (order.tossReceipt && order.tossReceipt.method) || null,
        status,
        totalAmount: Number(payment.totalAmount) || order.amountKrw,
        receiptUrl: (payment.receipt && payment.receipt.url) ? payment.receipt.url : (order.tossReceipt && order.tossReceipt.receiptUrl) || null,
        approvedAt: payment.approvedAt || (order.tossReceipt && order.tossReceipt.approvedAt) || null,
        virtualAccount: virtualAccount || (order.tossReceipt && order.tossReceipt.virtualAccount) || null
    };

    if (status === 'DONE') {
        updateOrderStatus(order.orderId, ORDER_STATUS.PAID, {
            paymentKey: canonicalPaymentKey || order.paymentKey || null,
            virtualAccount: virtualAccount || order.virtualAccount || null,
            tossReceipt: baseReceipt
        });

        const entitlement = await grantEntitlementForOrder(order.orderId, {
            source: options.source || 'TOSS_WEBHOOK'
        });

        return {
            result: entitlement.ok
                ? (entitlement.alreadyGranted ? 'ALREADY_FULFILLED' : 'FULFILLED')
                : 'PAID_BUT_NOT_FULFILLED',
            details: {
                remainingCredits: entitlement.remainingCredits,
                alreadyGranted: Boolean(entitlement.alreadyGranted),
                error: entitlement.error || null
            }
        };
    }

    if (status === 'WAITING_FOR_DEPOSIT') {
        // 입금 오류로 DONE → WAITING_FOR_DEPOSIT 으로 되돌아온 경우 권한을 회수합니다.
        const wasGranted = Boolean(order.entitlementsGranted);
        if (wasGranted) {
            await revokeEntitlementForOrder(order.orderId, { reason: 'DEPOSIT_ERROR' });
        }

        updateOrderStatus(order.orderId, ORDER_STATUS.AWAITING_DEPOSIT, {
            paymentKey: canonicalPaymentKey || order.paymentKey || null,
            virtualAccount: virtualAccount || order.virtualAccount || null,
            tossReceipt: baseReceipt
        });

        return {
            result: wasGranted ? 'REVERTED_TO_AWAITING_DEPOSIT' : 'AWAITING_DEPOSIT'
        };
    }

    if (['CANCELED', 'PARTIAL_CANCELED', 'EXPIRED', 'ABORTED'].includes(status)) {
        const wasGranted = Boolean(order.entitlementsGranted);
        if (wasGranted) {
            await revokeEntitlementForOrder(order.orderId, { reason: `TOSS_${status}` });
        }

        updateOrderStatus(order.orderId, status, {
            paymentKey: canonicalPaymentKey || order.paymentKey || null,
            tossReceipt: baseReceipt
        });

        return { result: wasGranted ? 'REVOKED' : 'STATUS_UPDATED' };
    }

    return { result: 'IGNORED_STATUS', details: { status } };
}

/**
 * 웹훅 본문을 검증·반영하고 처리 결과를 로그에 남깁니다.
 * @param {{ rawBody: string, headers: Object, query: URLSearchParams }} input
 * @returns {Promise<{ statusCode: number, body: Object }>}
 */
async function processWebhook(input = {}) {
    const config = getWebhookConfig();
    const payments = getDynamicConfig().payments;
    const rawBody = input.rawBody || '';
    const headers = input.headers || {};

    stats.received += 1;

    if (!verifyPathToken(input.query ? input.query.get('token') : null)) {
        stats.rejected += 1;
        return {
            statusCode: 401,
            body: { ok: false, error: 'INVALID_WEBHOOK_TOKEN' }
        };
    }

    let payload;
    try {
        payload = rawBody ? JSON.parse(rawBody) : null;
    } catch (err) {
        stats.rejected += 1;
        return { statusCode: 400, body: { ok: false, error: 'INVALID_JSON' } };
    }

    if (!payload || typeof payload !== 'object') {
        stats.rejected += 1;
        return { statusCode: 400, body: { ok: false, error: 'EMPTY_PAYLOAD' } };
    }

    const event = normalizeEvent(payload);
    const transmissionId = String(
        headers['tosspayments-webhook-transmission-id']
        || `wh_${sha256Hex(rawBody).slice(0, 32)}`
    );
    const retriedCount = Number(headers['tosspayments-webhook-transmission-retried-count']) || 0;

    // ------------------------------------------------------------------
    // 멱등성: 같은 transmission-id 는 재처리하지 않습니다.
    // ------------------------------------------------------------------
    const cachedLog = persistence.webhookLogs.get(transmissionId)
        || (persistence.getStatus().configured ? await persistence.webhookLogs.hydrate(transmissionId) : null);

    if (cachedLog && cachedLog.processedAt) {
        stats.duplicates += 1;
        return {
            statusCode: 200,
            body: { ok: true, duplicate: true, transmissionId, result: cachedLog.processedResult }
        };
    }

    const logRecord = {
        transmissionId,
        eventType: event.eventType,
        orderId: event.orderId || null,
        paymentStatus: event.status || null,
        transactionKey: event.transactionKey || null,
        retriedCount,
        receivedAt: new Date().toISOString(),
        payload,
        processedResult: 'PENDING',
        processedAt: null
    };

    let statusCode = 200;
    let responseBody = { ok: true };

    try {
        if (!config.eventTypes.includes(event.eventType)) {
            logRecord.processedResult = 'IGNORED_UNKNOWN_EVENT';
            stats.ignored += 1;
            responseBody = { ok: true, ignored: true, eventType: event.eventType };
            return { statusCode: 200, body: responseBody };
        }

        if (event.eventType === 'CANCEL_STATUS_CHANGED') {
            logRecord.processedResult = 'LOGGED_ONLY';
            stats.ignored += 1;
            responseBody = { ok: true, loggedOnly: true };
            return { statusCode: 200, body: responseBody };
        }

        if (event.eventType === 'BILLING_DELETED') {
            const result = await billingService.handleBillingDeleted(event.data || {});
            logRecord.processedResult = result.matched ? 'BILLING_DELETED_APPLIED' : 'BILLING_DELETED_UNMATCHED';
            stats.processed += 1;
            responseBody = { ok: true, result: logRecord.processedResult };
            return { statusCode: 200, body: responseBody };
        }

        // --------------------------------------------------------------
        // PAYMENT_STATUS_CHANGED / DEPOSIT_CALLBACK
        // --------------------------------------------------------------
        if (!event.orderId) {
            logRecord.processedResult = 'IGNORED_MISSING_ORDER_ID';
            stats.ignored += 1;
            responseBody = { ok: true, ignored: true };
            return { statusCode: 200, body: responseBody };
        }

        const order = getRawOrder(event.orderId) || (await hydrateOrder(event.orderId));
        if (!order) {
            // 우리 앱이 만든 주문이 아님 → 재전송을 유도할 필요 없음
            logRecord.processedResult = 'IGNORED_ORDER_NOT_FOUND';
            stats.ignored += 1;
            responseBody = { ok: true, ignored: true };
            return { statusCode: 200, body: responseBody };
        }

        // [DEPOSIT_CALLBACK] secret 검증 (승인 응답의 secret 과 상수시간 비교)
        let secretValid = null;
        if (event.eventType === 'DEPOSIT_CALLBACK') {
            const storedSecret = order.tossReceipt && order.tossReceipt.secret;
            secretValid = Boolean(storedSecret) && safeEqual(storedSecret, event.secret);
            logRecord.secretValid = secretValid;
            if (!secretValid) {
                // secret 이 없거나 불일치 → 위조 가능성이 있으므로 canonical 검증 필수
                stats.rejected += 1;
            }
        }

        // 토스 API 재조회 — 실결제 모드에서는 설정과 무관하게 **항상** canonical 을 신뢰합니다.
        // (TOSS_WEBHOOK_VERIFY_CANONICAL=false 는 샌드박스 개발 모드에서만 의미가 있습니다)
        if (payments.mode === 'TOSS_LIVE') {
            const canonical = await fetchCanonicalPayment(event);

            if (!canonical.ok || !canonical.data) {
                stats.verificationFailures += 1;
                logRecord.processedResult = 'CANONICAL_VERIFICATION_FAILED';
                logRecord.verificationError = canonical.error || 'unknown';
                statusCode = canonical.code === 'NETWORK_ERROR' || canonical.code === 'TIMEOUT' ? 503 : 200;
                responseBody = {
                    ok: false,
                    error: 'CANONICAL_VERIFICATION_FAILED',
                    retryable: statusCode === 503
                };
                return { statusCode, body: responseBody };
            }

            const payment = canonical.data;

            // 주문 위조 방어: orderId·금액이 서버 확정값과 정확히 일치해야 합니다.
            if (String(payment.orderId) !== String(order.orderId)
                || Number(payment.totalAmount) !== Number(order.amountKrw)) {
                stats.rejected += 1;
                logRecord.processedResult = 'SECURITY_MISMATCH_REJECTED';
                responseBody = { ok: false, error: 'PAYMENT_MISMATCH_REJECTED' };
                return { statusCode: 200, body: responseBody };
            }

            if (event.paymentKey && payment.paymentKey && String(payment.paymentKey) !== String(event.paymentKey)) {
                stats.rejected += 1;
                logRecord.processedResult = 'SECURITY_MISMATCH_REJECTED';
                responseBody = { ok: false, error: 'PAYMENT_KEY_MISMATCH_REJECTED' };
                return { statusCode: 200, body: responseBody };
            }

            const applied = await applyCanonicalPayment(order, payment, { source: 'TOSS_WEBHOOK' });
            logRecord.processedResult = applied.result;
            logRecord.processedDetails = applied.details || null;
            stats.processed += 1;
            responseBody = { ok: true, result: applied.result, ...(applied.details || {}) };
            return { statusCode: 200, body: responseBody };
        }

        // --------------------------------------------------------------
        // [SANDBOX_SIMULATION] 키가 없어 canonical 조회가 불가능한 개발 모드.
        // 운영(TOSS_LIVE)에서는 위 canonical 경로만 사용됩니다.
        // --------------------------------------------------------------
        if (event.eventType === 'DEPOSIT_CALLBACK' && secretValid === false) {
            logRecord.processedResult = 'SECRET_MISMATCH_REJECTED';
            stats.rejected += 1;
            return { statusCode: 401, body: { ok: false, error: 'SECRET_MISMATCH' } };
        }

        const syntheticPayment = {
            paymentKey: event.paymentKey || (order.tossReceipt && order.tossReceipt.paymentKey) || null,
            orderId: order.orderId,
            status: event.status,
            method: order.paymentMethod === 'VIRTUAL_ACCOUNT' ? '가상계좌' : '카드',
            totalAmount: order.amountKrw,
            virtualAccount: order.virtualAccount || null
        };

        const applied = await applyCanonicalPayment(order, syntheticPayment, { source: 'TOSS_WEBHOOK_SANDBOX' });
        logRecord.processedResult = `${applied.result}_SANDBOX`;
        stats.processed += 1;
        responseBody = { ok: true, sandbox: true, result: applied.result };
        return { statusCode: 200, body: responseBody };
    } catch (err) {
        stats.errors += 1;
        logRecord.processedResult = 'ERROR';
        logRecord.errorMessage = String(err.message || err).slice(0, 300);
        statusCode = 500;
        responseBody = { ok: false, error: 'WEBHOOK_PROCESSING_ERROR' };
        return { statusCode, body: responseBody };
    } finally {
        // 503(토스 API 일시 장애)은 토스가 같은 transmission-id 로 재전송할 수 있습니다.
        // processedAt 을 비워 두어야 재전송 시 멱등 중복으로 오인해 유실되지 않습니다.
        if (statusCode !== 503) {
            logRecord.processedAt = new Date().toISOString();
        }
        stats.lastEventAt = logRecord.processedAt || new Date().toISOString();
        stats.lastEventType = event.eventType;
        stats.lastResult = logRecord.processedResult;

        // 로그는 실패해도 요청 응답을 막지 않습니다. (원장은 이미 반영)
        persistence.webhookLogs.set(transmissionId, logRecord).catch(() => {});
      }
}

function getWebhookStatus() {
    const config = getWebhookConfig();
    const payments = getDynamicConfig().payments;
    return {
        enabled: config.enabled,
        endpoint: payments.publicBaseUrl ? `${payments.publicBaseUrl}/api/webhooks/toss` : null,
        pathTokenConfigured: config.pathTokenConfigured,
        verifyCanonical: config.verifyCanonical,
        paymentMode: payments.mode,
        supportedEvents: config.eventTypes,
        stats,
        logCount: persistence.webhookLogs.size,
        note: '결제 웹훅에는 서명이 없으므로 토스 API 재조회(canonical)로 검증합니다.'
    };
}

module.exports = {
    processWebhook,
    verifyPathToken,
    normalizeEvent,
    applyCanonicalPayment,
    getWebhookStatus,
    stats
};
