/**
 * ============================================================================
 * 파일명: backend/services/billingService.js
 * 역할: [토스페이먼츠 자동결제(빌링) 정기결제] 빌링키 발급 → 구독 원장 → 갱신 승인
 * ----------------------------------------------------------------------------
 * 공식 API (Version 2)
 *   - 빌링키 발급 : POST /v1/billing/authorizations/issue  { authKey, customerKey }
 *   - 자동결제 승인: POST /v1/billing/{billingKey}          { customerKey, amount, orderId, orderName }
 *   - 빌링키 삭제 : DELETE /v1/billing/{billingKey}
 *
 * 중요(토스 공식 문서):
 *   1) 자동결제는 **별도 계약**이 필요하며, 미계약 테스트 키로 호출하면
 *      NOT_SUPPORTED_METHOD 가 반환됩니다. (샌드박스 시뮬레이션으로 폴백)
 *   2) 자동결제 승인은 최대 60초가 걸릴 수 있어 타임아웃을 65초로 설정합니다.
 *   3) 자동결제 승인은 결제 요청과 동시에 승인되므로 **완료 웹훅이 전송되지 않습니다.**
 *      → 갱신 결과는 이 모듈이 동기 응답으로 처리하고, 원장에 기록합니다.
 *
 * 보안:
 *   - 빌링키는 AES-256-GCM 암호화 페이로드에만 저장하고, 평문 컬럼에는
 *     SHA-256 해시(웹훅 매칭용)와 마스킹 값만 남깁니다.
 *   - 관리자 수동 결제 API 는 TOSS_BILLING_ADMIN_TOKEN 으로 보호합니다(서버 라우트).
 * ============================================================================
 */

const crypto = require('crypto');
const { getDynamicConfig, getBillingConfig } = require('../config/envLoader');
const persistence = require('./persistenceStore');
const {
    createOrder,
    markOrderPaid,
    resolvePlan,
    issueBillingKey,
    chargeBillingKey,
    deleteBillingKey,
    ORDER_STATUS
} = require('./paymentGateway');
const { grantEntitlementForOrder } = require('./entitlementService');

/** 동시에 여러 갱신 사이클이 도는 것을 방지 */
let renewalCycleRunning = false;
let schedulerTimer = null;
let schedulerInitialTimer = null;
let schedulerRuns = 0;
let schedulerLastRunAt = null;
let schedulerLastResult = null;

function sha256Hex(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/** 세션 토큰 → 토스 customerKey (원문 세션을 DB 평문 컬럼에 노출하지 않음) */
function deriveCustomerKey(sessionToken) {
    const config = getDynamicConfig();
    const secret = config.iap.sessionSecret
        || getBillingConfig().adminToken
        || config.encryptionMasterKey
        || 'MUSEGLOW_BILLING_CUSTOMER_KEY_SALT';
    const digest = crypto.createHmac('sha256', secret).update(String(sessionToken || '')).digest('hex');
    return `MG_${digest.slice(0, 34)}`; // 37자 (토스 customerKey 최대 50자)
}

/**
 * 세션 객체에서 customerKey 를 파생합니다(세션 원문을 클라이언트로 되돌려주지 않음).
 * @returns {{ok:boolean, customerKey?:string, code?:string, error?:string}}
 */
function deriveCustomerKeyForSession(session) {
    const token = session && (session.sessionToken || session.token);
    if (!token) {
        return { ok: false, code: 'SESSION_REQUIRED', error: '세션 토큰이 필요합니다.' };
    }
    return { ok: true, customerKey: deriveCustomerKey(token) };
}

function maskBillingKey(billingKey) {
    const raw = String(billingKey || '');
    if (raw.length <= 10) {
        return `${raw.slice(0, 3)}***`;
    }
    return `${raw.slice(0, 6)}***${raw.slice(-4)}`;
}

async function resolveSession(sessionToken) {
    if (!sessionToken) {
        return null;
    }
    return persistence.sessions.get(sessionToken) || persistence.sessions.hydrate(sessionToken);
}

/** 기존 활성 구독 찾기 (세션당 1개) */
function findActiveSubscriptionBySession(sessionToken) {
    return persistence.billingSubscriptions.list()
        .find((item) => item.sessionToken === sessionToken && ['ACTIVE', 'PAST_DUE'].includes(item.status)) || null;
}

function findSubscriptionById(subscriptionId) {
    return persistence.billingSubscriptions.get(subscriptionId);
}

/**
 * 구독 시작(빌링키 발급). 카드 등록 인증(authKey)을 서버에서 빌링키로 교환합니다.
 * @param {{ sessionToken: string, authKey?: string, customerName?: string, customerEmail?: string, startTrial?: boolean }} input
 */
async function issueSubscription(input = {}) {
    const config = getDynamicConfig();
    const billing = getBillingConfig();
    const { sessionToken, authKey } = input;

    if (!sessionToken) {
        return { ok: false, code: 'SESSION_REQUIRED', error: '세션 토큰이 필요합니다.' };
    }

    const session = await resolveSession(sessionToken);
    if (!session) {
        return { ok: false, code: 'SESSION_NOT_FOUND', error: '유효하지 않은 진단 세션입니다.' };
    }

    const plan = resolvePlan('VIP_ANNUAL');
    if (!plan) {
        return { ok: false, code: 'PLAN_NOT_FOUND', error: 'VIP 연간 플랜을 찾을 수 없습니다.' };
    }

    const customerKey = deriveCustomerKey(sessionToken);
    let billingKey = null;
    let externalMode = billing.mode;

    if (billing.enabled) {
        if (!authKey) {
            return {
                ok: false,
                code: 'AUTH_KEY_REQUIRED',
                error: '토스 자동결제 카드 등록 인증키(authKey)가 필요합니다.'
            };
        }

        const issued = await issueBillingKey({ authKey, customerKey }, { timeoutMs: 15000 });
        if (!issued.ok) {
            return {
                ok: false,
                code: issued.code || 'BILLING_KEY_ISSUE_FAILED',
                error: `빌링키 발급 실패: ${issued.error}`
            };
        }
        billingKey = issued.data && issued.data.billingKey;
        if (!billingKey) {
            return { ok: false, code: 'BILLING_KEY_EMPTY', error: '빌링키 응답이 비어 있습니다.' };
        }
    } else {
        // 샌드박스(키 미설정·미계약) — 개발/데모 전용
        billingKey = `SANDBOX_BILLING_${sha256Hex(`${sessionToken}:${Date.now()}`).slice(0, 24)}`;
        externalMode = 'SANDBOX_SIMULATION';
    }

    const now = new Date();
    const trialDays = input.startTrial === false ? 0 : config.trialDays;
    const nextChargeAt = new Date(now.getTime() + trialDays * 86400000).toISOString();

    const existing = findActiveSubscriptionBySession(sessionToken);
    const subscriptionId = existing ? existing.subscriptionId : `SUB_${crypto.randomBytes(8).toString('hex').toUpperCase()}`;

    const record = {
        subscriptionId,
        customerKey,
        sessionToken,
        planTier: 'VIP_ANNUAL',
        amountKrw: plan.amountKrw,
        creditsGranted: plan.creditsGranted,
        status: 'ACTIVE',
        mode: externalMode,
        billingKey,
        billingKeyMasked: maskBillingKey(billingKey),
        billingKeyHash: sha256Hex(billingKey),
        trialDays,
        trialEndsAt: trialDays > 0 ? nextChargeAt : null,
        nextChargeAt,
        lastChargedAt: existing ? existing.lastChargedAt || null : null,
        lastRenewalKey: existing ? existing.lastRenewalKey || null : null,
        lastRenewalOrderId: existing ? existing.lastRenewalOrderId || null : null,
        failedAttempts: 0,
        createdAt: existing ? existing.createdAt : now.toISOString(),
        updatedAt: now.toISOString()
    };

    // [21일 무료 체험] 카드 등록만으로 체험 권한을 즉시 부여합니다(청구 없음).
    // 재등록(카드 교체·재시도) 시 체험 크레딧이 중복 지급되지 않도록 활성 구독을 확인합니다.
    const trialAlreadyGranted = Boolean(existing && existing.status === 'ACTIVE' && existing.trialAccessGranted);
    if (trialDays > 0 && !trialAlreadyGranted) {
        const wasUnlocked = Boolean(session.isPremiumUnlocked);
        const diagnosisCost = wasUnlocked ? 0 : 10;
        session.isPremiumUnlocked = true;
        session.remainingCredits = Math.max(0, (Number(session.remainingCredits) || 0) + plan.creditsGranted - diagnosisCost);
        session.selectedPlanTier = `VIP_ANNUAL_${trialDays}D_TRIAL`;
        session.billingSubscriptionId = subscriptionId;
        session.trialStartedAt = now.toISOString();
        session.trialEndsAt = nextChargeAt;
        await persistence.sessions.set(sessionToken, session);
        record.trialAccessGranted = true;
    } else if (trialAlreadyGranted) {
        // 기존 체험 기간·권한을 유지하고 결제수단만 갱신합니다.
        record.trialAccessGranted = true;
        record.trialEndsAt = existing.trialEndsAt;
        record.nextChargeAt = existing.nextChargeAt;
        record.trialStartedAt = existing.trialStartedAt || record.trialStartedAt;
        session.billingSubscriptionId = subscriptionId;
        await persistence.sessions.set(sessionToken, session);
    }

    await persistence.billingSubscriptions.set(subscriptionId, record);

    return {
        ok: true,
        mode: externalMode,
        subscription: sanitizeSubscription(record),
        trialAccessGranted: Boolean(record.trialAccessGranted)
    };
}

/** 클라이언트 노출용 구독 정보 (빌링키 원문 제거) */
function sanitizeSubscription(record) {
    if (!record) {
        return null;
    }
    return {
        subscriptionId: record.subscriptionId,
        customerKeyMasked: `MG_***${String(record.customerKey || '').slice(-4)}`,
        planTier: record.planTier,
        amountKrw: record.amountKrw,
        status: record.status,
        mode: record.mode,
        billingKeyMasked: record.billingKeyMasked,
        trialDays: record.trialDays,
        trialEndsAt: record.trialEndsAt || null,
        nextChargeAt: record.nextChargeAt,
        lastChargedAt: record.lastChargedAt || null,
        failedAttempts: record.failedAttempts || 0,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt
    };
}

function addDays(baseIso, days) {
    const base = baseIso ? new Date(baseIso) : new Date();
    return new Date(base.getTime() + days * 86400000).toISOString();
}

/**
 * 구독 1건을 자동결제로 갱신합니다.
 * - Idempotency-Key 로 같은 갱신 주기의 중복 청구를 방지합니다.
 * @param {string} subscriptionId
 * @param {{ force?: boolean, reason?: string }} options
 */
async function chargeSubscription(subscriptionId, options = {}) {
    const billing = getBillingConfig();
    const record = findSubscriptionById(subscriptionId);
    if (!record) {
        return { ok: false, code: 'SUBSCRIPTION_NOT_FOUND', error: '구독을 찾을 수 없습니다.' };
    }

    if (record.status === 'CANCELED') {
        return { ok: false, code: 'SUBSCRIPTION_CANCELED', error: '해지된 구독입니다.' };
    }
    if (record.status === 'DELETED_BY_TOSS') {
        return { ok: false, code: 'BILLING_KEY_DELETED', error: '빌링키가 토스에서 삭제되었습니다.' };
    }
    if (record.status === 'PAST_DUE' && (record.failedAttempts || 0) >= billing.retryMax) {
        return { ok: false, code: 'RETRY_EXHAUSTED', error: '재시도 한도를 초과한 구독입니다.' };
    }

    const now = Date.now();
    const dueAt = Date.parse(record.nextChargeAt || 0);
    if (!options.force && Number.isFinite(dueAt) && dueAt > now) {
        return { ok: false, code: 'NOT_DUE', error: '아직 갱신일이 되지 않았습니다.', nextChargeAt: record.nextChargeAt };
    }

    // 갱신 주기 키 (같은 주기 중복 청구 방지)
    const periodKey = String(record.nextChargeAt || new Date().toISOString()).slice(0, 10).replace(/-/g, '');
    const renewalKey = `${record.subscriptionId}_${periodKey}`;
    if (!options.force && record.lastRenewalKey === renewalKey && record.lastRenewalOrderId) {
        return { ok: true, alreadyCharged: true, orderId: record.lastRenewalOrderId, subscription: sanitizeSubscription(record) };
    }

    const session = await resolveSession(record.sessionToken);
    if (!session) {
        return { ok: false, code: 'SESSION_NOT_FOUND', error: '구독 세션을 찾을 수 없습니다.' };
    }

    const orderResult = createOrder({
        sessionToken: record.sessionToken,
        planTier: record.planTier,
        paymentMethod: 'CARD',
        paymentSource: 'TOSS_BILLING',
        subscriptionId: record.subscriptionId,
        customerName: session.encryptedProfile ? 'MuseGlow Member' : null
    });

    if (!orderResult.ok) {
        return { ok: false, code: 'ORDER_CREATE_FAILED', error: orderResult.error };
    }

    const order = orderResult.order;
    let charge;

    if (billing.enabled) {
        charge = await chargeBillingKey({
            billingKey: record.billingKey,
            customerKey: record.customerKey,
            amount: order.amountKrw,
            orderId: order.orderId,
            orderName: order.orderName,
            timeoutMs: billing.chargeTimeoutMs
        }, {
            idempotencyKey: `BILL_${renewalKey}`
        });
    } else {
        charge = {
            ok: true,
            data: {
                paymentKey: `SANDBOX_BILLING_PK_${order.orderId}`,
                orderId: order.orderId,
                status: 'DONE',
                method: '자동결제(샌드박스)',
                totalAmount: order.amountKrw,
                approvedAt: new Date().toISOString()
            }
        };
    }

    if (!charge.ok) {
        record.failedAttempts = (Number(record.failedAttempts) || 0) + 1;
        record.lastFailureCode = charge.code || 'BILLING_CHARGE_FAILED';
        record.lastFailureMessage = String(charge.error || '').slice(0, 300);
        record.lastFailureAt = new Date().toISOString();
        record.status = record.failedAttempts >= billing.retryMax ? 'PAST_DUE' : 'ACTIVE';
        record.nextChargeAt = new Date(Date.now() + billing.retryDelayHours * 3600000).toISOString();
        record.updatedAt = new Date().toISOString();
        await persistence.billingSubscriptions.set(record.subscriptionId, record);

        return {
            ok: false,
            code: record.lastFailureCode,
            error: charge.error,
            failedAttempts: record.failedAttempts,
            status: record.status,
            nextChargeAt: record.nextChargeAt
        };
    }

    const payment = charge.data || {};
    const paidAt = payment.approvedAt || new Date().toISOString();

    markOrderPaid(order.orderId, {
        paymentKey: payment.paymentKey || null,
        tossReceipt: {
            paymentKey: payment.paymentKey || null,
            orderId: order.orderId,
            method: payment.method || '자동결제',
            status: payment.status || 'DONE',
            approvedAt: paidAt,
            totalAmount: payment.totalAmount || order.amountKrw,
            receiptUrl: (payment.receipt && payment.receipt.url) ? payment.receipt.url : null,
            billingKeyMasked: record.billingKeyMasked
        }
    });

    const entitlement = await grantEntitlementForOrder(order.orderId, {
        source: 'TOSS_BILLING_RENEWAL',
        initialDiagnosisCost: 0
    });

    record.status = 'ACTIVE';
    record.failedAttempts = 0;
    record.lastChargedAt = paidAt;
    record.lastRenewalKey = renewalKey;
    record.lastRenewalOrderId = order.orderId;
    record.nextChargeAt = addDays(record.nextChargeAt || paidAt, billing.renewalPeriodDays);
    record.updatedAt = new Date().toISOString();
    await persistence.billingSubscriptions.set(record.subscriptionId, record);

    // 매출 원장 기록
    if (entitlement.ok && entitlement.session) {
        await persistence.payments.set(order.orderId, {
            tossOrderId: order.orderId,
            sessionToken: record.sessionToken,
            planTier: entitlement.planLabel,
            paidAmountKrw: order.amountKrw,
            creditsGranted: order.creditsGranted,
            remainingCredits: entitlement.remainingCredits,
            paymentMode: billing.enabled ? 'TOSS_LIVE' : 'SANDBOX_SIMULATION',
            paymentSource: 'TOSS_BILLING',
            tossReceipt: { status: 'DONE', approvedAt: paidAt, method: '자동결제' },
            paidAt
        });
    }

    return {
        ok: true,
        alreadyCharged: false,
        orderId: order.orderId,
        paidAt,
        entitlement,
        subscription: sanitizeSubscription(record)
    };
}

/**
 * 갱신 주기가 도래한 구독을 일괄 청구합니다. (스케줄러가 호출)
 */
async function runRenewalCycle() {
    if (renewalCycleRunning) {
        return { ok: false, code: 'ALREADY_RUNNING', processed: 0 };
    }

    renewalCycleRunning = true;
    schedulerRuns += 1;
    const now = Date.now();
    const due = persistence.billingSubscriptions.list().filter((item) => {
        if (!['ACTIVE', 'PAST_DUE'].includes(item.status)) {
            return false;
        }
        const dueAt = Date.parse(item.nextChargeAt || 0);
        return Number.isFinite(dueAt) && dueAt <= now;
    });

    const results = [];
    try {
        for (const subscription of due) {
            try {
                const result = await chargeSubscription(subscription.subscriptionId, { reason: 'SCHEDULED_RENEWAL' });
                results.push({
                    subscriptionId: subscription.subscriptionId,
                    ok: result.ok,
                    code: result.code || null,
                    orderId: result.orderId || null
                });
            } catch (err) {
                results.push({ subscriptionId: subscription.subscriptionId, ok: false, code: 'EXCEPTION', error: err.message });
            }
        }
    } finally {
        renewalCycleRunning = false;
        schedulerLastRunAt = new Date().toISOString();
        schedulerLastResult = {
            due: due.length,
            charged: results.filter((r) => r.ok).length,
            failed: results.filter((r) => !r.ok).length
        };
    }

    return { ok: true, processed: due.length, results };
}

/** 스케줄러 시작 (setInterval.unref → 테스트/프로세스 종료를 방해하지 않음) */
function startScheduler() {
    const billing = getBillingConfig();
    if (!billing.schedulerEnabled || schedulerTimer) {
        return { started: false, enabled: billing.schedulerEnabled };
    }

    schedulerTimer = setInterval(() => {
        runRenewalCycle().catch((err) => {
            console.error('[Billing] 갱신 사이클 오류:', err.message);
        });
    }, billing.schedulerIntervalMs);
    if (typeof schedulerTimer.unref === 'function') {
        schedulerTimer.unref();
    }

    // 부팅 직후 밀린 갱신을 한 번 처리합니다(최대 5초 지연).
    const initialDelay = Math.min(5000, billing.schedulerIntervalMs);
    schedulerInitialTimer = setTimeout(() => {
        runRenewalCycle().catch((err) => {
            console.error('[Billing] 초기 갱신 사이클 오류:', err.message);
        });
    }, initialDelay);
    if (typeof schedulerInitialTimer.unref === 'function') {
        schedulerInitialTimer.unref();
    }

    return { started: true, intervalMs: billing.schedulerIntervalMs, initialDelayMs: initialDelay };
}

function stopScheduler() {
    let stopped = false;
    if (schedulerTimer) {
        clearInterval(schedulerTimer);
        schedulerTimer = null;
        stopped = true;
    }
    if (schedulerInitialTimer) {
        clearTimeout(schedulerInitialTimer);
        schedulerInitialTimer = null;
        stopped = true;
    }
    return stopped;
}

/**
 * 구독 해지 — 자동 갱신을 중단하고 (옵션) 빌링키를 삭제합니다.
 * 남은 이용 기간의 권한은 회수하지 않습니다(기간 만료 후 자연 종료).
 */
async function cancelSubscription({ subscriptionId, sessionToken, deleteKey = true } = {}) {
    const record = subscriptionId
        ? findSubscriptionById(subscriptionId)
        : (sessionToken ? findActiveSubscriptionBySession(sessionToken) : null);

    if (!record) {
        return { ok: false, code: 'SUBSCRIPTION_NOT_FOUND', error: '구독을 찾을 수 없습니다.' };
    }

    let deleted = false;
    let deleteError = null;
    if (deleteKey && record.billingKey && getBillingConfig().enabled) {
        const result = await deleteBillingKey(record.billingKey, { timeoutMs: 15000 });
        deleted = Boolean(result.ok);
        deleteError = result.ok ? null : result.error;
    }

    record.status = 'CANCELED';
    record.canceledAt = new Date().toISOString();
    record.nextChargeAt = null;
    record.updatedAt = new Date().toISOString();
    await persistence.billingSubscriptions.set(record.subscriptionId, record);

    return {
        ok: true,
        subscription: sanitizeSubscription(record),
        billingKeyDeleted: deleted,
        deleteError
    };
}

/** BILLING_DELETED 웹훅 처리 — 토스에서 빌링키가 삭제된 경우 */
async function handleBillingDeleted(data = {}) {
    const billingKey = data.billingKey || data.billing_key;
    if (!billingKey) {
        return { ok: false, code: 'BILLING_KEY_MISSING' };
    }

    const hash = sha256Hex(billingKey);
    const candidates = persistence.billingSubscriptions.list()
        .filter((item) => item.billingKeyHash === hash);
    // 동일 빌링키로 재발급된 이력이 있으면 활성 구독을 우선 차단합니다.
    const record = candidates.find((item) => item.status === 'ACTIVE' || item.status === 'PAST_DUE')
        || candidates[0];

    if (!record) {
        return { ok: true, matched: false };
    }

    record.status = 'DELETED_BY_TOSS';
    record.nextChargeAt = null;
    record.deletedByTossAt = new Date().toISOString();
    record.updatedAt = new Date().toISOString();
    await persistence.billingSubscriptions.set(record.subscriptionId, record);

    return { ok: true, matched: true, subscriptionId: record.subscriptionId };
}

function getBillingStatus() {
    const config = getDynamicConfig();
    const billing = getBillingConfig();
    const subscriptions = persistence.billingSubscriptions.list();
    return {
        enabled: billing.enabled,
        mode: billing.mode,
        scheduler: {
            enabled: billing.schedulerEnabled,
            running: Boolean(schedulerTimer),
            intervalMs: billing.schedulerIntervalMs,
            runs: schedulerRuns,
            lastRunAt: schedulerLastRunAt,
            lastResult: schedulerLastResult
        },
        renewalPeriodDays: billing.renewalPeriodDays,
        retryMax: billing.retryMax,
        adminTokenConfigured: billing.adminTokenConfigured,
        counts: {
            total: subscriptions.length,
            active: subscriptions.filter((s) => s.status === 'ACTIVE').length,
            pastDue: subscriptions.filter((s) => s.status === 'PAST_DUE').length,
            canceled: subscriptions.filter((s) => s.status === 'CANCELED').length
        },
        trialDays: config.trialDays,
        vipAnnualPrice: config.vipAnnualPrice
    };
}

module.exports = {
    deriveCustomerKey,
    deriveCustomerKeyForSession,
    issueSubscription,
    chargeSubscription,
    runRenewalCycle,
    startScheduler,
    stopScheduler,
    cancelSubscription,
    handleBillingDeleted,
    sanitizeSubscription,
    findSubscriptionById,
    findActiveSubscriptionBySession,
    getBillingStatus
};
