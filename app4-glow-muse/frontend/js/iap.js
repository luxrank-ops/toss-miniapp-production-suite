/**
 * ============================================================================
 * 파일명: frontend/js/iap.js
 * 역할: [App-in-Toss 인앱 결제 SDK 클라이언트 브리지]
 * ----------------------------------------------------------------------------
 * - 토스 앱(앱인토스) 환경에서 @apps-in-toss/web-framework 의 IAP 도메인을 사용합니다.
 * - 일반 브라우저(개발/웹 배포)에서는 SDK 브리지가 없으므로 자동으로 비활성화되고,
 *   기존 토스페이먼츠 결제창(app.js) 흐름으로 폴백합니다.
 *
 * 구매 흐름 (공식 문서)
 *   1) IAP.getProductItemList() 로 콘솔 등록 상품 조회
 *   2) IAP.createOneTimePurchaseOrder({ options: { sku, processProductGrant } })
 *      - processProductGrant({ orderId }) 안에서 파트너 서버 /api/iap/grant 호출
 *      - 서버가 실제 결제 검증 후 true 를 반환해야 지급 완료 (30초 내 미응답 시 자동 환불)
 *   3) 구독 상품은 IAP.createSubscriptionPurchaseOrder 사용
 *   4) 미결 주문은 IAP.getPendingOrders() → 서버 지급 재시도로 복원
 *
 * ※ SDK 번들 로딩
 *   - 앱인토스 빌드 환경에서는 호스트가 SDK 를 번들링하고 전역으로 노출할 수 있습니다.
 *     window.AppsInTossWebFramework = { IAP, TossAuth } 형태를 지원합니다.
 *   - 그렇지 않으면 window.__APPS_IN_TOSS_SDK_URL__ (호스트가 제공한 ESM URL) 로 동적 import 합니다.
 *   - 둘 다 없으면 외부 요청 없이 즉시 비활성화됩니다.
 *   - 어떤 경로도 실패하면 조용히 비활성화되어 기존 결제 흐름을 방해하지 않습니다.
 * ============================================================================
 */

(function () {
    'use strict';

    // 보안/무의존성 원칙: 외부 CDN 을 기본 로드하지 않습니다.
    // 앱인토스 빌드 호스트가 전역으로 주입하거나, 운영자가 명시적으로 URL 을 지정한 경우만 import 합니다.
    const SDK_URL = window.__APPS_IN_TOSS_SDK_URL__ || null;
    const GRANT_TIMEOUT_MS = 30000;

    const state = {
        sdk: null,
        sdkPromise: null,
        available: false,
        products: [],
        catalog: [],
        loginCache: null,
        lastError: null
    };

    function notify(message) {
        try {
            if (typeof window.museGlowNotify === 'function') {
                window.museGlowNotify(message);
            }
        } catch (err) { /* 무시 */ }
    }

    /** SDK 로드 (전역 노출 우선 → ESM CDN 동적 import) */
    function loadSdk() {
        if (state.sdkPromise) {
            return state.sdkPromise;
        }

        state.sdkPromise = (async () => {
            if (window.AppsInTossWebFramework && window.AppsInTossWebFramework.IAP) {
                state.sdk = window.AppsInTossWebFramework;
                return state.sdk;
            }

            if (!SDK_URL) {
                state.lastError = 'SDK_NOT_INJECTED';
                return null;
            }

            try {
                const imported = await import(/* webpackIgnore: true */ SDK_URL);
                state.sdk = imported;
                return imported;
            } catch (err) {
                state.lastError = `SDK_LOAD_FAILED: ${err && err.message ? err.message : err}`;
                return null;
            }
        })();

        return state.sdkPromise;
    }

    /** 토스 앱(앱인토스) 환경 여부 판별 — 브리지가 없으면 일반 웹으로 간주 */
    async function detect() {
        const sdk = await loadSdk();
        if (!sdk || !sdk.IAP) {
            state.available = false;
            return false;
        }

        // 1) 앱인토스 전역 값이 유효하면 확실히 토스 환경
        try {
            const globals = sdk.getAppsInTossGlobals ? sdk.getAppsInTossGlobals() : null;
            if (globals && (globals.deploymentId || globals.appName || globals.brandName)) {
                state.available = true;
                return true;
            }
        } catch (err) { /* 브라우저에서는 throw → 아래에서 상품 조회로 재판별 */ }

        // 2) 상품 목록 조회가 성공하면 브리지가 살아있는 것
        try {
            const result = await sdk.IAP.getProductItemList();
            if (result && Array.isArray(result.products)) {
                state.available = true;
                state.products = result.products;
                return true;
            }
        } catch (err) {
            state.lastError = `BRIDGE_UNAVAILABLE: ${err && err.message ? err.message : err}`;
        }

        state.available = false;
        return false;
    }

    async function ensureCatalog() {
        if (state.catalog.length > 0) {
            return state.catalog;
        }
        try {
            const res = await fetch('/api/iap/products');
            const data = await res.json();
            state.catalog = Array.isArray(data.products) ? data.products : [];
        } catch (err) {
            state.catalog = [];
        }
        return state.catalog;
    }

    function findProductForPlan(planTier) {
        const wanted = planTier === 'STARTER_PACK' ? 'STARTER_PACK' : 'VIP_ANNUAL';
        return state.catalog.find((item) => item.planTier === wanted) || null;
    }

    /** 토스 로그인 → 서버 세션 바인딩 토큰 */
    async function ensureLogin(sessionToken) {
        if (state.loginCache && state.loginCache.sessionToken === sessionToken
            && Date.parse(state.loginCache.expiresAt || 0) > Date.now() + 30000) {
            return state.loginCache;
        }

        const sdk = state.sdk || await loadSdk();
        if (!sdk || !sdk.TossAuth || typeof sdk.TossAuth.login !== 'function') {
            return null;
        }

        try {
            const login = await sdk.TossAuth.login();
            if (!login || !login.authorizationCode) {
                return null;
            }

            const res = await fetch('/api/iap/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionToken,
                    authorizationCode: login.authorizationCode,
                    referrer: login.referrer || 'DEFAULT'
                })
            });
            const data = await res.json();
            if (!res.ok || data.status !== 'IAP_LOGIN_OK') {
                state.lastError = data.message || data.code || 'IAP_LOGIN_FAILED';
                return null;
            }

            state.loginCache = {
                sessionToken,
                userKey: data.userKey,
                loginToken: data.loginToken,
                expiresAt: data.expiresAt
            };
            return state.loginCache;
        } catch (err) {
            state.lastError = `TOSS_LOGIN_FAILED: ${err && err.message ? err.message : err}`;
            return null;
        }
    }

    /** 서버에 상품 지급 요청 (processProductGrant 내부) */
    async function requestGrant({ sessionToken, orderId, sku, subscriptionId }) {
        if (!orderId) {
            return false;
        }

        const login = await ensureLogin(sessionToken);

        try {
            const res = await fetch('/api/iap/grant', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionToken,
                    orderId,
                    sku,
                    subscriptionId: subscriptionId || null,
                    userKey: login ? login.userKey : undefined,
                    loginToken: login ? login.loginToken : undefined
                })
            });
            const data = await res.json();
            if (!res.ok || data.grant !== true) {
                state.lastError = data.code || data.message || 'IAP_GRANT_FAILED';
                return false;
            }
            return true;
        } catch (err) {
            state.lastError = `IAP_GRANT_NETWORK: ${err && err.message ? err.message : err}`;
            return false;
        }
    }

    /**
     * 플랜 구매 시도.
     * @returns {Promise<{ handled: boolean, ok?: boolean, reason?: string }>}
     *   handled=false → 앱인토스 환경이 아니므로 기존 토스페이먼츠 흐름을 계속 사용
     */
    async function tryPurchase({ planTier, sessionToken }) {
        const isToss = await detect();
        if (!isToss) {
            return { handled: false, reason: 'NOT_APPS_IN_TOSS' };
        }

        const catalog = await ensureCatalog();
        const product = findProductForPlan(planTier);
        if (!product) {
            return { handled: false, reason: 'SKU_NOT_CONFIGURED' };
        }

        return new Promise((resolve) => {
            let settled = false;
            let cleanup = null;

            const finish = (result) => {
                if (settled) {
                    return;
                }
                settled = true;
                try {
                    if (typeof cleanup === 'function') {
                        cleanup();
                    }
                } catch (err) { /* 무시 */ }
                resolve(result);
            };

            const options = {
                sku: product.sku,
                processProductGrant: async ({ orderId }) => {
                    if (!orderId) {
                        state.lastError = 'MISSING_ORDER_ID';
                        return false;
                    }
                    return requestGrant({
                        sessionToken,
                        orderId,
                        sku: product.sku,
                        subscriptionId: undefined
                    });
                }
            };

            const handlers = {
                onEvent: (event) => {
                    if (event && event.type === 'success') {
                        finish({ handled: true, ok: true, data: event.data || null, product });
                    }
                },
                onError: (error) => {
                    state.lastError = error && error.message ? error.message : String(error);
                    finish({ handled: true, ok: false, reason: 'IAP_ERROR', error: state.lastError });
                }
            };

            try {
                if (product.productType === 'SUBSCRIPTION' && state.sdk.IAP.createSubscriptionPurchaseOrder) {
                    cleanup = state.sdk.IAP.createSubscriptionPurchaseOrder({ options, ...handlers });
                } else {
                    cleanup = state.sdk.IAP.createOneTimePurchaseOrder({ options, ...handlers });
                }
            } catch (err) {
                finish({ handled: true, ok: false, reason: 'IAP_INVOKE_FAILED', error: err.message });
                return;
            }

            // 결제창 응답이 없을 때 무한 대기 방지 (지급 콜백은 30초 규격)
            setTimeout(() => {
                finish({ handled: true, ok: false, reason: 'IAP_TIMEOUT' });
            }, 180000);
        });
    }

    /** 미결 주문 복원 (앱 재실행·기기 변경 대응) */
    async function restore(sessionToken) {
        const isToss = await detect();
        if (!isToss) {
            return { ok: false, reason: 'NOT_APPS_IN_TOSS' };
        }

        const results = [];
        try {
            const pending = await state.sdk.IAP.getPendingOrders();
            const orders = (pending && pending.orders) || [];
            for (const order of orders.slice(0, 20)) {
                const granted = await requestGrant({
                    sessionToken,
                    orderId: order.orderId,
                    sku: order.sku
                });
                results.push({ orderId: order.orderId, granted });
            }
            return { ok: true, processed: results.length, results };
        } catch (err) {
            return { ok: false, reason: 'RESTORE_FAILED', error: err.message };
        }
    }

    async function getProducts() {
        const isToss = await detect();
        if (!isToss) {
            return [];
        }
        try {
            const result = await state.sdk.IAP.getProductItemList();
            return (result && result.products) || [];
        } catch (err) {
            return [];
        }
    }

    window.MuseGlowIAP = {
        detect,
        isAvailable: () => state.available,
        getProducts,
        tryPurchase,
        restore,
        getState: () => ({
            available: state.available,
            productCount: state.products.length,
            catalogCount: state.catalog.length,
            lastError: state.lastError
        })
    };
})();
