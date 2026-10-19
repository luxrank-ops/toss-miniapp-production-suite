/**
 * ============================================================================
 * 파일명: scripts/integration-smoke-test.js
 * 역할: [실제 AI 연동 & 결제 연동 통합 스모크 테스트]
 * ----------------------------------------------------------------------------
 * 외부 벤더(OpenAI/Gemini/Anthropic)에 직접 접속하지 않고도 **실제 AI 호출 코드 경로
 * 전체**를 검증하기 위해, 로컬에 "OpenAI 호환 목(Mock) LLM 서버"를 띄워 테스트합니다.
 *
 *   [시나리오 A] AI 키 없음   → 로컬 결정론적 엔진 폴백 검증 (서비스 중단 없음)
 *   [시나리오 B] AI 키 있음   → 실제 HTTP 호출 → 응답 JSON 파싱 → 병합 검증
 *   [시나리오 C] 결제 게이트웨이 → 서버 금액 확정 / 금액 위변조 차단 검증
 *
 * 실행: node scripts/integration-smoke-test.js
 * ============================================================================
 */

const http = require('http');
const { spawn } = require('child_process');

const results = [];

function record(name, passed, detail = '') {
    results.push({ name, passed, detail });
    console.log(`  - [${passed ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function requestJson(url, options = {}) {
    return fetch(url, options).then(async (res) => ({
        status: res.status,
        body: await res.json().catch(() => null)
    }));
}

// ============================================================================
// [목 LLM 서버] OpenAI Chat Completions 호환 (Vision 포함)
// ============================================================================
function startMockAiServer() {
    const stats = { requests: 0, visionRequests: 0, textRequests: 0 };

    const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (chunk) => { raw += chunk.toString('utf8'); });
        req.on('end', () => {
            let payload = {};
            try {
                payload = raw ? JSON.parse(raw) : {};
            } catch (err) {
                payload = {};
            }

            // Vision 요청 판정: image_url 파트가 포함되어 있으면 피부 스캔 응답
            const messages = payload.messages || [];
            const userContent = (messages[1] && messages[1].content) || [];
            const hasImage = Array.isArray(userContent)
                && userContent.some((part) => part && part.type === 'image_url');

            stats.requests += 1;
            if (hasImage) {
                stats.visionRequests += 1;
            } else {
                stats.textRequests += 1;
            }

            const content = hasImage
                ? JSON.stringify({
                    skinType: '목 서버 진단: 복합성 수부지 장벽 저하형',
                    skinAge: 31,
                    skinBarrierScore: 71,
                    barrierStatus: '주의',
                    aiAnalysisText: '목 Vision 모델 분석: U존 미세 각질과 T존 피지 산화가 동시 관찰됩니다.',
                    metrics: [
                        { id: 'hydration', score: 66, summary: '표피 수분 유지력 다소 저하' },
                        { id: 'oil_balance', score: 62, summary: 'T존 피지 산화 진행' },
                        { id: 'ceramide_density', score: 74, summary: '세라마이드 밀도 양호' },
                        { id: 'pore_elasticity', score: 58, summary: '나비존 모공 탄력 저하' },
                        { id: 'redness_defense', score: 83, summary: '붉은기 방어력 안정' }
                    ],
                    sosCareRoutine: ['목 1단계: 약산성 클렌징', '목 2단계: PDRN 앰플', '목 3단계: 장벽 크림 밀폐'],
                    recommendedIngredients: [
                        { name: '목 추천: 세라마이드 앰플', benefit: '장벽 재건', matchingProductType: '리페어 앰플', oliveYoungKeyword: '세라마이드 앰플' }
                    ]
                })
                : JSON.stringify({
                    museAuraTitle: '목 LLM 청담 실크광 뮤즈',
                    museAuraBadge: '상위 3% 귀티 여백형',
                    summaryComment: '목 LLM이 생성한 개인화 종합 코멘트입니다.',
                    bioSkinAgeDiff: '-4.8세 동안 잠재력',
                    prescription1: {
                        coreInsight: '목 LLM 추구미 인사이트',
                        actionItems: ['목 액션 1', '목 액션 2', '목 액션 3'],
                        worstWarning: '목 워스트 경고'
                    },
                    prescription3: {
                        goldenWindow: '목 황금기 설명',
                        dangerWindow: '목 위험기 설명',
                        calendarPlan: ['목 1주차', '목 2주차', '목 3주차', '목 4주차']
                    },
                    prescription4: { secretInnerBeauty: '목 이너뷰티 시크릿' },
                    aiModelNote: 'MOCK_LLM'
                });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                id: 'chatcmpl-mock',
                object: 'chat.completion',
                choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
            }));
        });
    });

    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve({
            server,
            port: server.address().port,
            stats,
            requestCount: () => stats.requests
        }));
    });
}

// ============================================================================
// [앱 서버 실행] 자식 프로세스로 띄우고 /api/config 응답까지 대기
// ============================================================================
function startAppServer(envOverrides) {
    const child = spawn(process.execPath, ['backend/server.js'], {
        cwd: __dirname.replace(/scripts$/, ''),
        env: { ...process.env, ...envOverrides },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    let logBuffer = '';
    child.stdout.on('data', (d) => { logBuffer += d.toString(); });
    child.stderr.on('data', (d) => { logBuffer += d.toString(); });

    return new Promise((resolve, reject) => {
        const port = Number(envOverrides.PORT);
        const deadline = Date.now() + 15000;

        (async function poll() {
            while (Date.now() < deadline) {
                try {
                    const res = await requestJson(`http://127.0.0.1:${port}/api/config`);
                    if (res.status === 200) {
                        return resolve({ child, port, log: () => logBuffer });
                    }
                } catch (err) { /* 아직 부팅 중 */ }
                await sleep(250);
            }
            child.kill();
            reject(new Error(`앱 서버 시작 실패 (port ${port})\n${logBuffer}`));
        })();
    });
}

// ============================================================================
// [목 Supabase(PostgREST) 서버] 최소 REST 규격 + 의도적 장애 모드 지원
// ============================================================================
function startMockSupabaseServer({ serviceKey, failMode = false } = {}) {
    /** table → Array<row> 형태의 초경량 인메모리 저장소 */
    const tables = new Map();

    const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (chunk) => { raw += chunk.toString('utf8'); });
        req.on('end', () => {
            if (failMode) {
                res.writeHead(503, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: 'Supabase 장애 시뮬레이션' }));
                return;
            }

            // [보안 검증] apikey + Bearer 토큰이 모두 정확한 Service Role Key 인지 확인
            if (req.headers.apikey !== serviceKey || req.headers.authorization !== `Bearer ${serviceKey}`) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: 'invalid api key' }));
                return;
            }

            const url = new URL(req.url, 'http://127.0.0.1');
            const table = url.pathname.replace('/rest/v1/', '');
            if (!table) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: 'unknown route' }));
                return;
            }

            if (!tables.has(table)) {
                tables.set(table, []);
            }
            const rows = tables.get(table);

            const sendRows = (payload) => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(payload));
            };

            // eq 필터 파싱 (col=eq.value)
            const filters = [...url.searchParams.entries()]
                .filter(([k, v]) => k !== 'limit' && k !== 'order' && k !== 'on_conflict' && k !== 'select')
                .map(([k, v]) => ({ column: k, value: String(v).replace(/^eq\./, '') }));

            if (req.method === 'GET') {
                const matched = rows.filter((row) => filters.every((f) => String(row[f.column]) === f.value));
                const limit = Number(url.searchParams.get('limit')) || matched.length;
                sendRows(matched.slice(0, limit));
                return;
            }

            if (req.method === 'POST') {
                // upsert (resolution=merge-duplicates)
                let body = {};
                try {
                    body = raw ? JSON.parse(raw) : {};
                } catch (err) {
                    body = {};
                }

                // Supabase upsert 는 on_conflict 컬럼 기준으로 병합합니다.
                // (필터가 비어 있을 때 첫 행을 덮어쓰지 않도록 반드시 on_conflict 를 우선)
                const onConflict = url.searchParams.get('on_conflict');
                const conflictColumns = onConflict ? onConflict.split(',').map((c) => c.trim()).filter(Boolean) : [];
                const existingIndex = conflictColumns.length > 0
                    ? rows.findIndex((row) => conflictColumns.every((c) => String(row[c]) === String(body[c])))
                    : (filters.length > 0
                        ? rows.findIndex((row) => filters.every((f) => String(row[f.column]) === f.value))
                        : -1);
                if (existingIndex >= 0) {
                    rows[existingIndex] = { ...rows[existingIndex], ...body };
                    sendRows([rows[existingIndex]]);
                } else {
                    rows.push(body);
                    sendRows([body]);
                }
                return;
            }

            if (req.method === 'PATCH') {
                let body = {};
                try {
                    body = raw ? JSON.parse(raw) : {};
                } catch (err) {
                    body = {};
                }
                const updated = [];
                rows.forEach((row, index) => {
                    if (filters.every((f) => String(row[f.column]) === f.value)) {
                        rows[index] = { ...row, ...body };
                        updated.push(rows[index]);
                    }
                });
                sendRows(updated);
                return;
            }

            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ message: 'method not allowed' }));
        });
    });

    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve({
            server,
            port: server.address().port,
            /** 테스트 검증용: 테이블 행 조회 */
            rows: (table) => (tables.get(table) || []).slice(),
            tableNames: () => [...tables.keys()]
        }));
    });
}

// ============================================================================
// [목 토스페이먼츠 서버]
//   - 카드 승인 / 취소
//   - 가상계좌 발급(WAITING_FOR_DEPOSIT) + 입금 완료 시뮬레이션(markDeposit)
//   - 빌링키 발급 / 자동결제 승인 / 빌링키 삭제
//   - 웹훅 canonical 검증용 결제 재조회(GET /payments/{key}, /payments/orders/{orderId})
// ============================================================================
function startMockTossServer({ secretKey }) {
    const expectedAuth = 'Basic ' + Buffer.from(`${secretKey}:`).toString('base64');
    const calls = [];
    const paymentsByKey = new Map();
    const paymentsByOrder = new Map();
    const billingKeys = new Set();
    const control = { failCharges: false, failLookup: false };

    const send = (res, status, payload) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
    };

    const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (chunk) => { raw += chunk.toString('utf8'); });
        req.on('end', () => {
            let payload = {};
            try {
                payload = raw ? JSON.parse(raw) : {};
            } catch (err) {
                payload = {};
            }
            const cleanUrl = req.url.split('?')[0];
            calls.push({ url: req.url, auth: req.headers.authorization, payload });

            // [보안 검증] Basic 인증 헤더가 정확한 시크릿 키로 생성되었는지 확인
            if (req.headers.authorization !== expectedAuth) {
                send(res, 401, { code: 'INVALID_AUTHORIZATION', message: '인증 실패' });
                return;
            }

            // ------------------------- 결제 승인 -------------------------
            if (req.method === 'POST' && cleanUrl === '/v1/payments/confirm') {
                // 의도적 실패 키
                if (payload.paymentKey === 'FAIL_ME') {
                    send(res, 400, { code: 'PAY_PROCESS_CANCELED', message: '사용자가 결제를 취소했습니다.' });
                    return;
                }

                // [가상계좌] 승인 = 계좌 발급. status 는 WAITING_FOR_DEPOSIT, secret 포함.
                if (String(payload.paymentKey || '').startsWith('va_')) {
                    const vaPayment = {
                        paymentKey: payload.paymentKey,
                        orderId: payload.orderId,
                        status: 'WAITING_FOR_DEPOSIT',
                        method: '가상계좌',
                        totalAmount: payload.amount,
                        approvedAt: null,
                        virtualAccount: {
                            accountNumber: '10023345678901',
                            bankCode: '20',
                            bank: '우리은행',
                            customerName: '가상뮤즈',
                            accountHolder: '머즈글로우',
                            dueDate: '2026-10-20 23:59:59'
                        },
                        secret: 'va_secret_smoke_ok',
                        receipt: { url: 'https://mock.tosspayments.com/receipt/va' }
                    };
                    paymentsByKey.set(vaPayment.paymentKey, vaPayment);
                    paymentsByOrder.set(vaPayment.orderId, vaPayment);
                    send(res, 200, vaPayment);
                    return;
                }

                const cardPayment = {
                    paymentKey: payload.paymentKey,
                    orderId: payload.orderId,
                    status: 'DONE',
                    method: '카드',
                    totalAmount: payload.amount,
                    approvedAt: new Date().toISOString(),
                    receipt: { url: 'https://mock.tosspayments.com/receipt/1234' },
                    card: { company: '신한카드', number: '1234**********5678', installmentPlanMonths: 0 }
                };
                paymentsByKey.set(cardPayment.paymentKey, cardPayment);
                paymentsByOrder.set(cardPayment.orderId, cardPayment);
                send(res, 200, cardPayment);
                return;
            }

            // ------------------------- 결제 취소 -------------------------
            const cancelMatch = cleanUrl.match(/^\/v1\/payments\/(.+)\/cancel$/);
            if (req.method === 'POST' && cancelMatch) {
                const paymentKey = decodeURIComponent(cancelMatch[1]);
                const existing = paymentsByKey.get(paymentKey);
                if (existing) {
                    existing.status = 'CANCELED';
                }
                send(res, 200, {
                    paymentKey,
                    status: 'CANCELED',
                    cancels: [{ cancelReason: payload.cancelReason, canceledAt: new Date().toISOString() }]
                });
                return;
            }

            // ------------------- 웹훅 canonical 재조회 -------------------
            const orderLookup = cleanUrl.match(/^\/v1\/payments\/orders\/(.+)$/);
            if (req.method === 'GET' && orderLookup) {
                if (control.failLookup) {
                    // 토스 API 일시 장애(네트워크 오류) 시뮬레이션
                    req.destroy();
                    return;
                }
                const orderId = decodeURIComponent(orderLookup[1]);
                const payment = paymentsByOrder.get(orderId);
                if (!payment) {
                    send(res, 404, { code: 'NOT_FOUND_PAYMENT', message: '결제 정보를 찾을 수 없습니다.' });
                    return;
                }
                send(res, 200, payment);
                return;
            }

            const paymentLookup = cleanUrl.match(/^\/v1\/payments\/([^/]+)$/);
            if (req.method === 'GET' && paymentLookup) {
                const paymentKey = decodeURIComponent(paymentLookup[1]);
                const payment = paymentsByKey.get(paymentKey);
                if (!payment) {
                    send(res, 404, { code: 'NOT_FOUND_PAYMENT', message: '결제 정보를 찾을 수 없습니다.' });
                    return;
                }
                send(res, 200, payment);
                return;
            }

            // ------------------------- 자동결제 -------------------------
            if (req.method === 'POST' && cleanUrl === '/v1/billing/authorizations/issue') {
                if (payload.authKey === 'FAIL_AUTH') {
                    send(res, 400, { code: 'INVALID_AUTH_KEY', message: '유효하지 않은 authKey 입니다.' });
                    return;
                }
                const billingKey = 'billing_mock_key_1';
                billingKeys.add(billingKey);
                send(res, 200, {
                    billingKey,
                    customerKey: payload.customerKey,
                    authenticatedAt: new Date().toISOString(),
                    method: { type: '카드' },
                    card: { company: '신한카드', number: '1234**********5678' }
                });
                return;
            }

            const billingCharge = cleanUrl.match(/^\/v1\/billing\/([^/]+)$/);
            if (req.method === 'POST' && billingCharge) {
                const billingKey = decodeURIComponent(billingCharge[1]);
                if (!billingKeys.has(billingKey)) {
                    send(res, 404, { code: 'NOT_FOUND_BILLING_KEY', message: '빌링키를 찾을 수 없습니다.' });
                    return;
                }
                if (control.failCharges) {
                    send(res, 400, { code: 'REJECT_CARD_PAYMENT', message: '카드 한도 초과(테스트)' });
                    return;
                }
                const chargePayment = {
                    paymentKey: `billing_pk_${payload.orderId}`,
                    orderId: payload.orderId,
                    status: 'DONE',
                    method: '자동결제',
                    totalAmount: payload.amount,
                    approvedAt: new Date().toISOString(),
                    receipt: { url: 'https://mock.tosspayments.com/receipt/billing' },
                    card: { company: '신한카드' }
                };
                paymentsByKey.set(chargePayment.paymentKey, chargePayment);
                paymentsByOrder.set(chargePayment.orderId, chargePayment);
                send(res, 200, chargePayment);
                return;
            }

            if (req.method === 'DELETE' && billingCharge) {
                const billingKey = decodeURIComponent(billingCharge[1]);
                billingKeys.delete(billingKey);
                send(res, 200, {});
                return;
            }

            send(res, 404, { code: 'NOT_FOUND', message: 'unknown endpoint' });
        });
    });

    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve({
            server,
            port: server.address().port,
            calls,
            control,
            billingKeys,
            /** 가상계좌 입금 완료 시뮬레이션 (canonical 재조회가 DONE 을 반환하도록 변경) */
            markDeposit: (orderId) => {
                const payment = paymentsByOrder.get(orderId);
                if (!payment) return false;
                payment.status = 'DONE';
                payment.approvedAt = new Date().toISOString();
                return true;
            },
            paymentByOrder: (orderId) => paymentsByOrder.get(orderId) || null
        }));
    });
}

// ============================================================================
// [목 Apps-in-Toss 파트너 API 서버]
//   - 토스 로그인 코드 교환(generate-token) / 사용자 조회(login-me)
//   - 주문 상태 조회(get-order-status)
// ============================================================================
function startMockAppsInTossServer({ apiKey, userKey = 'toss_user_smoke_0001' }) {
    const calls = [];
    const orders = new Map();
    const accessToken = 'ait_access_token_smoke';

    const send = (res, status, payload) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
    };

    const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (chunk) => { raw += chunk.toString('utf8'); });
        req.on('end', () => {
            let payload = {};
            try {
                payload = raw ? JSON.parse(raw) : {};
            } catch (err) {
                payload = {};
            }
            const cleanUrl = req.url.split('?')[0];
            calls.push({ url: req.url, method: req.method, headers: req.headers, payload });

            const isLoginMe = req.method === 'GET'
                && cleanUrl === '/api-partner/v1/apps-in-toss/user/oauth2/login-me';

            // 파트너 API 키 인증 (로그인 사용자 조회는 accessToken 인증)
            if (!isLoginMe && req.headers.authorization !== `Bearer ${apiKey}`) {
                send(res, 401, { errorCode: 'INVALID_API_KEY', errorMessage: 'API Key 인증 실패' });
                return;
            }

            if (req.method === 'POST' && cleanUrl === '/api-partner/v1/apps-in-toss/user/oauth2/generate-token') {
                if (payload.authorizationCode !== 'auth_code_smoke') {
                    send(res, 400, { errorCode: 'INVALID_AUTHORIZATION_CODE', errorMessage: '인증 코드 오류' });
                    return;
                }
                send(res, 200, { accessToken, expiresIn: 3600, tokenType: 'Bearer' });
                return;
            }

            if (req.method === 'GET' && cleanUrl === '/api-partner/v1/apps-in-toss/user/oauth2/login-me') {
                if (req.headers.authorization !== `Bearer ${accessToken}`) {
                    // generate-token 과 API Key 를 동일 헤더로 쓰지 않도록 실제 구현은 Bearer accessToken
                    send(res, 401, { errorCode: 'INVALID_ACCESS_TOKEN', errorMessage: 'accessToken 오류' });
                    return;
                }
                send(res, 200, { userKey });
                return;
            }

            if (req.method === 'POST' && cleanUrl === '/api-partner/v1/apps-in-toss/order/get-order-status') {
                const record = orders.get(payload.orderId);
                if (!record) {
                    send(res, 200, { orderId: payload.orderId, status: 'NOT_FOUND' });
                    return;
                }
                send(res, 200, {
                    orderId: payload.orderId,
                    sku: record.sku,
                    status: record.status,
                    reason: record.reason || null,
                    statusDeterminedAt: new Date().toISOString()
                });
                return;
            }

            send(res, 404, { errorCode: 'NOT_FOUND', errorMessage: 'unknown endpoint' });
        });
    });

    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve({
            server,
            port: server.address().port,
            calls,
            userKey,
            setOrder: (orderId, record) => orders.set(orderId, record),
            orderCount: () => orders.size
        }));
    });
}

const FAKE_IMAGE = Buffer.from('fake-jpeg-bytes-for-smoke-test').toString('base64').repeat(20);

/** 단일 시나리오 실행: AI 미설정(A) / AI 설정(B) */
async function runScenario(label, { withAi, aiBaseUrl, mockAi }) {
    console.log(`\n▶ [${label}] ${withAi ? '실제 AI 호출 경로 (목 LLM 서버)' : 'AI 키 미설정 → 로컬 폴백 경로'}`);

    const appPort = 4000 + Math.floor(Math.random() * 500);
    const env = {
        PORT: String(appPort),
        VIP_ANNUAL_PRICE: '79000',
        MONETIZATION_PRICE: '9900',
        TRIAL_DAYS: '21',
        VIP_CREDIT_CAP: '100',
        STARTER_CREDIT_CAP: '30',
        APP_OWNER_ID: 'SMOKE_TEST_OWNER',
        ENCRYPTION_MASTER_KEY: 'a'.repeat(64)
    };

    if (withAi) {
        env.AI_PROVIDER = 'openai';
        env.OPENAI_API_KEY = 'sk-test-mock-key-0000000000';
        env.OPENAI_BASE_URL = aiBaseUrl;
        env.OPENAI_MODEL = 'gpt-4o-mock';
    }

    const { child, port } = await startAppServer(env);
    const base = `http://127.0.0.1:${port}`;

    try {
        // 1) 설정 API에 AI/결제 상태가 노출되는가
        const configRes = await requestJson(`${base}/api/config`);
        const config = configRes.body || {};
        record(`${label} /api/config AI 상태 노출`,
            Boolean(config.ai) && typeof config.ai.mode === 'string',
            `mode=${config.ai && config.ai.mode} provider=${config.ai && config.ai.provider}`);
        record(`${label} /api/config 결제 상태 노출`,
            Boolean(config.payments) && ['TOSS_LIVE', 'SANDBOX_SIMULATION'].includes(config.payments.mode),
            `mode=${config.payments && config.payments.mode}`);

        // 2) AI 상태 API
        const aiStatusRes = await requestJson(`${base}/api/ai/status`);
        record(`${label} GET /api/ai/status`, aiStatusRes.status === 200 && Boolean(aiStatusRes.body.ai));

        // 3) 피부 스캔 (Vision)
        const scanRes = await requestJson(`${base}/api/skin/scan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageBase64: FAKE_IMAGE, userAge: 28 })
        });
        const scan = scanRes.body || {};
        record(`${label} POST /api/skin/scan`, scanRes.status === 200 && typeof scan.skinBarrierScore === 'number');

        if (withAi) {
            record(`${label} 실제 AI Vision 결과 병합`,
                scan.ai && scan.ai.applied === true && scan.skinType.includes('목 서버 진단'),
                `provider=${scan.ai && scan.ai.provider} score=${scan.skinBarrierScore}`);
            record(`${label} AI 점수 기반 4주 회복 곡선 재계산`,
                Array.isArray(scan.recoveryComparison.sosAppliedScores)
                && scan.recoveryComparison.sosAppliedScores[0] === scan.skinBarrierScore,
                JSON.stringify(scan.recoveryComparison.sosAppliedScores));

            // [AI 응답 캐싱] 완전히 동일한 입력 재요청 → 벤더 재호출 없이 캐시 히트
            const callsBefore = mockAi ? mockAi.requestCount() : -1;
            const scanAgainRes = await requestJson(`${base}/api/skin/scan`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageBase64: FAKE_IMAGE, userAge: 28 })
            });
            const scanAgain = scanAgainRes.body || {};
            record(`${label} 동일 입력 재요청 시 AI 캐시 히트(벤더 재호출 0회)`,
                Boolean(scanAgain.ai && scanAgain.ai.cache && scanAgain.ai.cache.hit === true)
                && mockAi.requestCount() === callsBefore,
                `layer=${scanAgain.ai && scanAgain.ai.cache && scanAgain.ai.cache.layer} calls=${mockAi.requestCount()} before=${callsBefore}`);

            // [AI 응답 캐싱] 입력이 다르면 반드시 미스 → stale 응답 재사용 금지
            const scanDiffRes = await requestJson(`${base}/api/skin/scan`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageBase64: `${FAKE_IMAGE.slice(0, -8)}DIFF==`, userAge: 28 })
            });
            const scanDiff = scanDiffRes.body || {};
            record(`${label} 입력 변경 시 AI 캐시 미스(모델 재호출)`,
                Boolean(scanDiff.ai && scanDiff.ai.cache && scanDiff.ai.cache.hit === false)
                && mockAi.requestCount() > callsBefore,
                `hit=${scanDiff.ai && scanDiff.ai.cache && scanDiff.ai.cache.hit} calls=${mockAi.requestCount()}`);

            const cacheStatusRes = await requestJson(`${base}/api/ai/cache/status`);
            record(`${label} AI 캐시 관제 API(히트/절감액)`,
                cacheStatusRes.status === 200
                && cacheStatusRes.body.cache.metrics.hits >= 1
                && cacheStatusRes.body.cache.metrics.savedCalls >= 1
                && cacheStatusRes.body.cache.metrics.estimatedUsdSaved >= 0,
                `hits=${cacheStatusRes.body.cache && cacheStatusRes.body.cache.metrics.hits}`);
        } else {
            record(`${label} AI 미설정 시 폴백(applied=false)`,
                scan.ai && scan.ai.applied === false && scan.ai.fallbackUsed === true);
        }

        // 4) 진단 → 잠금 해제 (AI 리포트 병합)
        const diagRes = await requestJson(`${base}/api/glow/diagnose`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nickname: '스모크뮤즈',
                ageGroup: '2030_TREND',
                focusMode: 'CHUGUMI_MOOD',
                faceVibe: 'SILK_OLD_MONEY',
                skinConcern: 'PORE_ELASTICITY',
                cyclePhase: 'FOLLICULAR_GOLDEN',
                monthlyBeautySpendManwon: 30
            })
        });
        const diag = diagRes.body || {};
        record(`${label} POST /api/glow/diagnose`, diagRes.status === 200 && Boolean(diag.sessionToken));

        // 5) 결제: 금액 위변조 차단 (서버 확정 금액과 불일치)
        const tamperRes = await requestJson(`${base}/api/payment/unlock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken: diag.sessionToken, planTier: 'VIP_ANNUAL', paidAmount: 100 })
        });
        record(`${label} 결제 금액 위변조(₩100) 차단`,
            tamperRes.body && tamperRes.body.status === 'PRICE_MISMATCH',
            tamperRes.body && tamperRes.body.status);

        // 6) 주문 생성 (서버 금액 확정)
        const orderRes = await requestJson(`${base}/api/payment/order`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken: diag.sessionToken, planTier: 'VIP_ANNUAL' })
        });
        record(`${label} POST /api/payment/order 서버 금액 확정`,
            orderRes.status === 200
            && orderRes.body.checkout.amountKrw === 79000
            && Boolean(orderRes.body.orderId),
            `amount=${orderRes.body.checkout && orderRes.body.checkout.amountKrw}`);

        // 7) 잘못된 플랜 거절
        const badOrderRes = await requestJson(`${base}/api/payment/order`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken: diag.sessionToken, planTier: 'HACK_PLAN' })
        });
        record(`${label} 잘못된 플랜 거절`, badOrderRes.status === 400);

        // 8) 정상 잠금 해제 (샌드박스)
        const unlockRes = await requestJson(`${base}/api/payment/unlock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken: diag.sessionToken, planTier: 'VIP_ANNUAL', paidAmount: 79000 })
        });
        const unlock = unlockRes.body || {};
        record(`${label} 결제 후 잠금 해제`, unlock.status === 'UNLOCKED' && unlock.receipt.remainingCredits === 90,
            `remaining=${unlock.receipt && unlock.receipt.remainingCredits}`);

        if (withAi) {
            const report = unlock.unlockedFullReport || {};
            record(`${label} 실제 AI 처방전 병합`,
                unlock.ai && unlock.ai.applied === true
                && String(report.overview.summaryComment).includes('목 LLM'),
                `museAuraTitle=${report.overview && report.overview.museAuraTitle}`);
            record(`${label} AI가 금액·점수 원장을 오염시키지 않음`,
                report.overview && typeof report.overview.preventedWasteKrw === 'number'
                && typeof report.overview.glowIndexScore === 'number',
                `preventedWasteKrw=${report.overview && report.overview.preventedWasteKrw}`);
        } else {
            record(`${label} AI 미설정 시 기본 리포트 제공`,
                unlock.ai && unlock.ai.applied === false
                && Boolean(unlock.unlockedFullReport.prescriptions.prescription1_Chugumi));
        }

        // 9) 훅 액션 (크레딧 차감)
        const hookRes = await requestJson(`${base}/api/hook/action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken: diag.sessionToken, actionType: 'DAILY_CHECKIN' })
        });
        record(`${label} 크레딧 차감 훅 동작`,
            hookRes.body && hookRes.body.status === 'HOOK_CHECKIN_SUCCESS'
            && hookRes.body.remainingCredits === 88,
            `remaining=${hookRes.body && hookRes.body.remainingCredits}`);

        // 10) 결제 성공/실패 리다이렉트 페이지 서빙
        const successPage = await fetch(`${base}/payments/success`);
        record(`${label} /payments/success 페이지 서빙`, successPage.status === 200);
    } finally {
        child.kill();
    }
}

/**
 * [시나리오 C] TOSS_LIVE 실결제 경로
 * - 목 토스페이먼츠 서버를 붙여 "주문 생성 → 결제위젯 인증 → 서버 최종 승인(confirm)" 전체를 검증
 */
async function runTossLiveScenario() {
    console.log('\n▶ [시나리오 C] TOSS_LIVE 실결제 경로 (목 토스페이먼츠 API 서버)');

    const secretKey = 'test_sk_mock_secret_key_1234';
    const toss = await startMockTossServer({ secretKey });
    const appPort = 4700 + Math.floor(Math.random() * 200);

    const { child, port } = await startAppServer({
        PORT: String(appPort),
        VIP_ANNUAL_PRICE: '79000',
        MONETIZATION_PRICE: '9900',
        VIP_CREDIT_CAP: '100',
        APP_OWNER_ID: 'SMOKE_TOSS_OWNER',
        ENCRYPTION_MASTER_KEY: 'b'.repeat(64),
        TOSS_PAYMENTS_CLIENT_KEY: 'test_ck_mock_client_key',
        TOSS_PAYMENTS_SECRET_KEY: secretKey,
        TOSS_PAYMENTS_API_BASE_URL: `http://127.0.0.1:${toss.port}/v1`,
        PUBLIC_BASE_URL: `http://127.0.0.1:${appPort}`
    });

    const base = `http://127.0.0.1:${port}`;

    try {
        const configRes = await requestJson(`${base}/api/config`);
        record('시나리오 C 결제 모드 TOSS_LIVE 전환',
            configRes.body.payments.mode === 'TOSS_LIVE'
            && configRes.body.payments.clientKey === 'test_ck_mock_client_key',
            `mode=${configRes.body.payments.mode}`);

        const diagRes = await requestJson(`${base}/api/glow/diagnose`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nickname: '토스뮤즈', monthlyBeautySpendManwon: 30 })
        });
        const sessionToken = diagRes.body.sessionToken;

        // 1) 주문 생성 → successUrl / failUrl 포함
        const orderRes = await requestJson(`${base}/api/payment/order`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken, planTier: 'VIP_ANNUAL' })
        });
        const checkout = orderRes.body.checkout || {};
        record('시나리오 C 주문 생성(금액·리다이렉트 URL 확정)',
            orderRes.status === 200 && checkout.amountKrw === 79000
            && String(checkout.successUrl).includes('/payments/success')
            && String(checkout.failUrl).includes('/payments/fail'),
            `orderId=${orderRes.body.orderId}`);

        // 2) paymentKey 없이 해제 시도 → 차단 (결제 인증 없이 잠금 해제 불가)
        const noKeyRes = await requestJson(`${base}/api/payment/unlock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken, planTier: 'VIP_ANNUAL', paidAmount: 79000 })
        });
        record('시나리오 C paymentKey 없이 잠금 해제 차단',
            noKeyRes.body.status === 'TOSS_CONFIRM_REQUIRED', noKeyRes.body.status);

        // 3) 다른 세션의 주문으로 해제 시도 → 차단
        const otherDiag = await requestJson(`${base}/api/glow/diagnose`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nickname: '다른세션', monthlyBeautySpendManwon: 10 })
        });
        const crossRes = await requestJson(`${base}/api/payment/unlock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionToken: otherDiag.body.sessionToken,
                paymentKey: 'pk_mock_123',
                orderId: orderRes.body.orderId
            })
        });
        record('시나리오 C 타 세션 주문 도용 차단',
            crossRes.body.status === 'SESSION_ORDER_MISMATCH', crossRes.body.status);

        // 4) 토스 승인 실패(사용자 취소) → 402 반환 및 크레딧 미지급
        const failRes = await requestJson(`${base}/api/payment/unlock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken, paymentKey: 'FAIL_ME', orderId: orderRes.body.orderId })
        });
        record('시나리오 C 토스 승인 실패 시 잠금 유지',
            failRes.status === 402 && failRes.body.status === 'PAYMENT_CONFIRM_FAILED',
            failRes.body.code);

        // 5) 정상 승인 → 잠금 해제 + 카드 정보 영수증
        const okRes = await requestJson(`${base}/api/payment/unlock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken, paymentKey: 'pk_mock_success_9', orderId: orderRes.body.orderId })
        });
        const receipt = (okRes.body.receipt || {});
        record('시나리오 C 토스 서버 승인 후 잠금 해제',
            okRes.body.status === 'UNLOCKED' && receipt.remainingCredits === 90
            && receipt.paymentMode === 'TOSS_LIVE'
            && receipt.tossPayment && receipt.tossPayment.cardCompany === '신한카드',
            `remaining=${receipt.remainingCredits} card=${receipt.tossPayment && receipt.tossPayment.cardCompany}`);

        // 6) 동일 주문 재승인(중복 결제) → 멱등성 보장 (크레딧 이중 지급 방지)
        const dupRes = await requestJson(`${base}/api/payment/unlock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken, paymentKey: 'pk_mock_success_9', orderId: orderRes.body.orderId })
        });
        record('시나리오 C 중복 승인 시 크레딧 이중 지급 방지',
            dupRes.body.status === 'UNLOCKED' && dupRes.body.receipt.remainingCredits === 90,
            `remaining=${dupRes.body.receipt && dupRes.body.receipt.remainingCredits}`);

        // 7) 주문 상태 조회 API
        const statusRes = await requestJson(`${base}/api/payment/status?orderId=${encodeURIComponent(orderRes.body.orderId)}`);
        record('시나리오 C 주문 상태 조회',
            statusRes.status === 200 && statusRes.body.order.status === 'PAID',
            statusRes.body.order && statusRes.body.order.status);

        // 8) 환불 → 크레딧 회수 및 재잠금
        const cancelRes = await requestJson(`${base}/api/payment/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId: orderRes.body.orderId, cancelReason: '단순 변심' })
        });
        record('시나리오 C 결제 취소/환불 처리',
            cancelRes.status === 200 && cancelRes.body.status === 'CANCELED',
            cancelRes.body.status);

        const afterCancel = await requestJson(`${base}/api/hook/action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken, actionType: 'DAILY_CHECKIN' })
        });
        record('시나리오 C 환불 후 기능 재잠금(크레딧 회수)',
            afterCancel.body.status === 'HARD_PAYWALL_BLOCKED',
            afterCancel.body.status);

        // 9) 토스 시크릿 키가 Basic 인증으로 정상 전송되었는지 (목 서버 수신 기록 확인)
        record('시나리오 C 토스 시크릿 키 Basic 인증 전송',
            toss.calls.length > 0 && toss.calls.every((c) => c.auth && c.auth.startsWith('Basic ')),
            `confirm 호출 ${toss.calls.filter((c) => c.url.includes('confirm')).length}회`);
    } finally {
        child.kill();
        toss.server.close();
    }
}

/**
 * [시나리오 D] Supabase 영속화 — 저장·암호화·서버 재시작 후 세션 복원 검증
 */
async function runSupabasePersistenceScenario() {
    console.log('\n▶ [시나리오 D] Supabase 영속화 (목 PostgREST 서버)');

    const serviceKey = 'test-service-role-key-abcdef';
    const supa = await startMockSupabaseServer({ serviceKey });
    const baseEnv = {
        VIP_ANNUAL_PRICE: '79000',
        MONETIZATION_PRICE: '9900',
        VIP_CREDIT_CAP: '100',
        ENCRYPTION_MASTER_KEY: 'c'.repeat(64),
        SUPABASE_URL: `http://127.0.0.1:${supa.port}`,
        SUPABASE_SERVICE_ROLE_KEY: serviceKey
    };

    const appPort = 5000 + Math.floor(Math.random() * 200);
    const first = await startAppServer({ ...baseEnv, PORT: String(appPort) });
    const base = `http://127.0.0.1:${first.port}`;
    let sessionToken = null;

    try {
        const statusRes = await requestJson(`${base}/api/persistence/status`);
        record('시나리오 D 영속화 모드 SUPABASE 전환',
            statusRes.body.persistence.mode === 'SUPABASE',
            `mode=${statusRes.body.persistence.mode}`);

        const diagRes = await requestJson(`${base}/api/glow/diagnose`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nickname: '영속화뮤즈', monthlyBeautySpendManwon: 30 })
        });
        sessionToken = diagRes.body.sessionToken;

        const orderRes = await requestJson(`${base}/api/payment/order`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken, planTier: 'VIP_ANNUAL' })
        });

        const unlockRes = await requestJson(`${base}/api/payment/unlock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken, planTier: 'VIP_ANNUAL', paidAmount: 79000 })
        });
        record('시나리오 D 영속화 상태에서 결제 정상 동작',
            unlockRes.body.status === 'UNLOCKED');

        // DB에 실제로 행이 기록되었는지
        await sleep(200);
        const sessionRows = supa.rows('glow_muse_runtime_sessions');
        const orderRows = supa.rows('glow_muse_runtime_orders');
        const paymentRows = supa.rows('glow_muse_runtime_payments');

        record('시나리오 D 세션 원장 DB 기록',
            sessionRows.length === 1 && sessionRows[0].session_token === sessionToken,
            `sessions=${sessionRows.length}`);
        record('시나리오 D 주문 원장 DB 기록 + 금액 서버 확정',
            orderRows.length >= 1 && orderRows[0].amount_krw === 79000,
            `orders=${orderRows.length} amount=${orderRows[0] && orderRows[0].amount_krw}`);
        record('시나리오 D 결제 원장 DB 기록',
            paymentRows.length === 1 && paymentRows[0].paid_amount_krw === 79000,
            `payments=${paymentRows.length}`);

        // [보안] 평문 개인정보(닉네임)가 DB에 저장되지 않았는지
        const allRowsJson = JSON.stringify([
            ...sessionRows, ...orderRows, ...paymentRows
        ]);
        record('시나리오 D 민감정보 평문 저장 금지(AES-256-GCM 암호화)',
            !allRowsJson.includes('영속화뮤즈')
            && Boolean(sessionRows[0] && sessionRows[0].encrypted_payload && sessionRows[0].iv_hex && sessionRows[0].auth_tag_hex),
            '닉네임 평문 미검출 + iv/auth_tag 존재');

        record('시나리오 D 주문 상태가 PAID 로 갱신',
            orderRows.some((r) => r.status === 'PAID'),
            orderRows.map((r) => r.status).join(','));

        // [자동결제] 구독 원장도 DB 에 기록되는지 (재시작 후 스케줄러 복원 대상)
        const billingDiag = await requestJson(`${base}/api/glow/diagnose`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nickname: '구독영속화뮤즈', monthlyBeautySpendManwon: 20 })
        });
        const billingIssue = await requestJson(`${base}/api/billing/issue`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken: billingDiag.body.sessionToken, startTrial: true })
        });
        await sleep(200);
        const billingRows = supa.rows('glow_muse_billing_subscriptions');
        record('시나리오 D 자동결제 구독 원장 DB 기록(빌링키 암호화)',
            billingIssue.status === 200
            && billingRows.length === 1
            && Boolean(billingRows[0].encrypted_payload)
            && !JSON.stringify(billingRows[0]).includes('"billingKey":"'),
            `subscriptions=${billingRows.length}`);
    } finally {
        first.child.kill();
        await sleep(300);
    }

    // ---- 서버 재시작 후 세션이 DB에서 복원되는지 (Read-Through 검증) ----
    const second = await startAppServer({ ...baseEnv, PORT: String(appPort) });
    try {
        const statusRes = await requestJson(`${second.port && `http://127.0.0.1:${second.port}`}/api/persistence/status`);
        record('시나리오 D 재시작 후 인메모리 원장 0개(복원 전)',
            statusRes.body.persistence.counts.sessions === 0,
            `sessions=${statusRes.body.persistence.counts.sessions}`);

        // 재시작된 서버에서 이전 세션으로 훅 액션 호출 → DB에서 세션을 복원해 처리해야 함
        const hookRes = await requestJson(`http://127.0.0.1:${second.port}/api/hook/action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken, actionType: 'DAILY_CHECKIN' })
        });
        record('시나리오 D 서버 재시작 후 세션 DB 복원(Read-Through)',
            hookRes.body.status === 'HOOK_CHECKIN_SUCCESS' && hookRes.body.remainingCredits === 88,
            `status=${hookRes.body.status} remaining=${hookRes.body.remainingCredits} message=${hookRes.body.message || ''}`);

        const billingStatusRes = await requestJson(`http://127.0.0.1:${second.port}/api/billing/status`);
        record('시나리오 D 서버 재시작 후 자동결제 구독 DB 복원(스케줄러 인식)',
            billingStatusRes.status === 200
            && billingStatusRes.body.billing.counts.total >= 1
            && billingStatusRes.body.billing.counts.active >= 1,
            `total=${billingStatusRes.body.billing && billingStatusRes.body.billing.counts.total}`);
    } finally {
        second.child.kill();
    }

    supa.server.close();
}

/**
 * [시나리오 E] Supabase 장애 → 자동 인메모리 폴백 (무중단 검증)
 */
async function runSupabaseFailureScenario() {
    console.log('\n▶ [시나리오 E] DB 장애 시 자동 인메모리 폴백');

    const serviceKey = 'test-service-role-key-failure';
    const supa = await startMockSupabaseServer({ serviceKey, failMode: true });
    const appPort = 5300 + Math.floor(Math.random() * 100);

    const { child, port } = await startAppServer({
        PORT: String(appPort),
        VIP_ANNUAL_PRICE: '79000',
        MONETIZATION_PRICE: '9900',
        VIP_CREDIT_CAP: '100',
        ENCRYPTION_MASTER_KEY: 'd'.repeat(64),
        SUPABASE_URL: `http://127.0.0.1:${supa.port}`,
        SUPABASE_SERVICE_ROLE_KEY: serviceKey,
        SUPABASE_TIMEOUT_MS: '2000'
    });

    const base = `http://127.0.0.1:${port}`;

    try {
        const statusRes = await requestJson(`${base}/api/persistence/status`);
        record('시나리오 E DB 장애 감지 → IN_MEMORY_FALLBACK',
            statusRes.body.persistence.mode === 'IN_MEMORY_FALLBACK',
            `mode=${statusRes.body.persistence.mode}`);

        const diagRes = await requestJson(`${base}/api/glow/diagnose`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nickname: '장애뮤즈', monthlyBeautySpendManwon: 30 })
        });
        record('시나리오 E DB 장애 중에도 진단 정상 동작',
            diagRes.body.status === 'SUCCESS');

        const unlockRes = await requestJson(`${base}/api/payment/unlock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionToken: diagRes.body.sessionToken,
                planTier: 'VIP_ANNUAL',
                paidAmount: 79000
            })
        });
        record('시나리오 E DB 장애 중에도 결제·잠금 해제 정상 동작',
            unlockRes.body.status === 'UNLOCKED' && unlockRes.body.receipt.remainingCredits === 90,
            `remaining=${unlockRes.body.receipt && unlockRes.body.receipt.remainingCredits}`);

        const statusAfter = await requestJson(`${base}/api/persistence/status`);
        record('시나리오 E 서킷 브레이커 동작(연속 실패 기록)',
            statusAfter.body.persistence.client.consecutiveFailures > 0,
            `failures=${statusAfter.body.persistence.client.consecutiveFailures} circuit=${statusAfter.body.persistence.client.circuitOpen}`);
    } finally {
        child.kill();
        supa.server.close();
    }
}

/**
 * [시나리오 F] 토스 웹훅 — 가상계좌 입금 확인 + 자동결제(빌링) 갱신
 * - 가상계좌는 승인 직후 잠금 유지(WAITING_FOR_DEPOSIT) → 입금 웹훅 수신 후 해제
 * - 웹훅 본문은 신뢰하지 않고 토스 API 재조회(canonical) 결과만 반영
 * - 동일 transmission-id 재전송은 멱등 처리(크레딧 이중 지급 없음)
 */
async function runWebhookBillingScenario() {
    console.log('\n▶ [시나리오 F] 토스 웹훅(가상계좌 입금) + 자동결제(빌링)');

    const secretKey = 'test_sk_webhook_mock_secret_9999';
    const webhookToken = 'wh_path_token_smoke';
    const adminToken = 'billing_admin_smoke';
    const toss = await startMockTossServer({ secretKey });
    const appPort = 5500 + Math.floor(Math.random() * 150);

    const { child, port } = await startAppServer({
        PORT: String(appPort),
        VIP_ANNUAL_PRICE: '79000',
        MONETIZATION_PRICE: '9900',
        TRIAL_DAYS: '21',
        VIP_CREDIT_CAP: '100',
        STARTER_CREDIT_CAP: '30',
        APP_OWNER_ID: 'SMOKE_WEBHOOK_OWNER',
        ENCRYPTION_MASTER_KEY: 'f'.repeat(64),
        TOSS_PAYMENTS_CLIENT_KEY: 'test_ck_webhook_client',
        TOSS_PAYMENTS_SECRET_KEY: secretKey,
        TOSS_PAYMENTS_API_BASE_URL: `http://127.0.0.1:${toss.port}/v1`,
        PUBLIC_BASE_URL: `http://127.0.0.1:${appPort}`,
        TOSS_WEBHOOK_PATH_TOKEN: webhookToken,
        TOSS_BILLING_ADMIN_TOKEN: adminToken,
        BILLING_SCHEDULER_ENABLED: 'false',
        AIT_IAP_ADMIN_TOKEN: 'iap_admin_smoke'
    });

    const base = `http://127.0.0.1:${port}`;
    const webhookUrl = (token) => `${base}/api/webhooks/toss${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    const postWebhook = (payload, transmissionId, token = webhookToken) => requestJson(webhookUrl(token), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'tosspayments-webhook-transmission-id': transmissionId,
            'tosspayments-webhook-transmission-time': new Date().toISOString()
        },
        body: JSON.stringify(payload)
    });

    try {
        // 1) 설정 노출
        const configRes = await requestJson(`${base}/api/config`);
        record('시나리오 F 웹훅·자동결제 설정 노출',
            configRes.body.webhook && configRes.body.webhook.endpoint === `${base}/api/webhooks/toss`
            && configRes.body.webhook.pathTokenConfigured === true
            && configRes.body.billing.mode === 'TOSS_LIVE'
            && configRes.body.billing.schedulerEnabled === false,
            `webhook=${configRes.body.webhook && configRes.body.webhook.endpoint} billing=${configRes.body.billing && configRes.body.billing.mode}`);

        const diagRes = await requestJson(`${base}/api/glow/diagnose`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nickname: '웹훅뮤즈', monthlyBeautySpendManwon: 30 })
        });
        const sessionToken = diagRes.body.sessionToken;

        // 2) 가상계좌 주문 생성 — 서버가 계좌 발급 옵션을 확정
        const orderRes = await requestJson(`${base}/api/payment/order`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionToken,
                planTier: 'VIP_ANNUAL',
                paymentMethod: 'VIRTUAL_ACCOUNT',
                customerName: '가상뮤즈'
            })
        });
        const checkout = orderRes.body.checkout || {};
        const orderId = orderRes.body.orderId;
        record('시나리오 F 가상계좌 주문 생성(수단·계좌옵션 확정)',
            orderRes.status === 200
            && checkout.method === 'VIRTUAL_ACCOUNT'
            && checkout.virtualAccount
            && checkout.virtualAccount.customerName === '가상뮤즈',
            `orderId=${orderId}`);

        // 3) 가상계좌 승인 → 계좌 발급 + 잠금 유지
        const vaRes = await requestJson(`${base}/api/payment/unlock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken, paymentKey: 'va_pk_smoke_1', orderId })
        });
        record('시나리오 F 가상계좌 발급 후 입금 대기(잠금 유지)',
            vaRes.body.status === 'AWAITING_DEPOSIT'
            && vaRes.body.virtualAccount
            && vaRes.body.virtualAccount.accountNumber === '10023345678901'
            && vaRes.body.remainingCredits === 0,
            `status=${vaRes.body.status} account=${vaRes.body.virtualAccount && vaRes.body.virtualAccount.accountNumber}`);

        const beforeDeposit = await requestJson(`${base}/api/session/report?sessionToken=${encodeURIComponent(sessionToken)}`);
        record('시나리오 F 입금 전 리포트 접근 차단',
            beforeDeposit.status === 403 && beforeDeposit.body.status === 'HARD_PAYWALL_BLOCKED',
            beforeDeposit.body.status);

        // 4) 위조 웹훅 (잘못된 경로 토큰) → 401
        const badTokenRes = await postWebhook(
            { eventType: 'PAYMENT_STATUS_CHANGED', data: { orderId, status: 'DONE' } },
            'wh_bad_token_1',
            'wrong_token'
        );
        record('시나리오 F 잘못된 경로 토큰 웹훅 거절', badTokenRes.status === 401, `status=${badTokenRes.status}`);

        // 5) 입금 전 웹훅 + 잘못된 secret → canonical(WAITING_FOR_DEPOSIT)만 신뢰 → 지급 없음
        const fakeDepositRes = await postWebhook(
            { createdAt: new Date().toISOString(), orderId, secret: 'FORGED_SECRET', status: 'DONE', transactionKey: 'tx_fake' },
            'wh_fake_deposit_1'
        );
        const afterFake = await requestJson(`${base}/api/session/report?sessionToken=${encodeURIComponent(sessionToken)}`);
        record('시나리오 F 위조 입금 웹훅으로 크레딧 미지급(멱등·검증)',
            fakeDepositRes.status === 200
            && fakeDepositRes.body.result === 'AWAITING_DEPOSIT'
            && afterFake.status === 403,
            `result=${fakeDepositRes.body.result} report=${afterFake.body.status}`);

        // 6) 실제 입금 완료 → canonical DONE → 정당한 secret 과 함께 웹훅 수신 → 지급
        toss.markDeposit(orderId);
        const depositPayload = {
            createdAt: new Date().toISOString(),
            orderId,
            secret: 'va_secret_smoke_ok',
            status: 'DONE',
            transactionKey: 'tx_deposit_ok_1'
        };
        const depositRes = await postWebhook(depositPayload, 'wh_deposit_ok_1');
        record('시나리오 F 입금 웹훅 수신 → 잠금 해제·크레딧 지급',
            depositRes.status === 200
            && depositRes.body.result === 'FULFILLED'
            && depositRes.body.remainingCredits === 90,
            `result=${depositRes.body.result} remaining=${depositRes.body.remainingCredits}`);

        const duplicateRes = await postWebhook(depositPayload, 'wh_deposit_ok_1');
        record('시나리오 F 동일 transmission-id 재전송 멱등 처리',
            duplicateRes.status === 200 && duplicateRes.body.duplicate === true,
            `duplicate=${duplicateRes.body.duplicate}`);

        // 6-1) 토스 API 일시 장애 → 503 으로 재전송 유도, 같은 transmission-id 재전송은 재처리되어야 함
        toss.control.failLookup = true;
        const outageRes = await postWebhook(
            { ...depositPayload, transactionKey: 'tx_deposit_retry' },
            'wh_outage_retry_1'
        );
        toss.control.failLookup = false;
        const retryRes = await postWebhook(
            { ...depositPayload, transactionKey: 'tx_deposit_retry' },
            'wh_outage_retry_1'
        );
        record('시나리오 F 토스 API 장애 시 503 → 동일 ID 재전송 재처리',
            outageRes.status === 503
            && outageRes.body.retryable === true
            && retryRes.status === 200
            && retryRes.body.duplicate !== true
            && ['ALREADY_FULFILLED', 'FULFILLED'].includes(retryRes.body.result),
            `outage=${outageRes.status} retry=${retryRes.status}/${retryRes.body.result}`);

        const reportRes = await requestJson(`${base}/api/session/report?sessionToken=${encodeURIComponent(sessionToken)}`);
        record('시나리오 F 입금 후 리포트 조회(폴링 경로) 정상',
            reportRes.status === 200
            && reportRes.body.status === 'UNLOCKED'
            && reportRes.body.remainingCredits === 90,
            `remaining=${reportRes.body.remainingCredits}`);

        const statusRes = await requestJson(`${base}/api/payment/status?orderId=${encodeURIComponent(orderId)}`);
        record('시나리오 F 가상계좌 주문 상태 PAID 전이',
            statusRes.status === 200
            && statusRes.body.order.status === 'PAID'
            && statusRes.body.order.paymentMethod === 'VIRTUAL_ACCOUNT'
            && Boolean(statusRes.body.order.virtualAccount),
            `status=${statusRes.body.order && statusRes.body.order.status}`);

        const unknownRes = await postWebhook(
            { eventType: 'PAYMENT_STATUS_CHANGED', data: { orderId: 'MG_UNKNOWN_ORDER', status: 'DONE' } },
            'wh_unknown_order_1'
        );
        record('시나리오 F 우리 주문 아닌 웹훅은 200 무시(재전송 중단)',
            unknownRes.status === 200 && unknownRes.body.ignored === true,
            `ignored=${unknownRes.body.ignored}`);

        // ------------------------------------------------------------------
        // [자동결제] customerKey → 빌링키 발급 → 21일 체험 즉시 부여
        // ------------------------------------------------------------------
        const ckRes = await requestJson(`${base}/api/billing/customer-key`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken })
        });
        record('시나리오 F 자동결제 고객 식별키 파생(세션 원문 비노출)',
            ckRes.status === 200
            && /^MG_[a-f0-9]{34}$/.test(ckRes.body.customerKey || ''),
            `customerKey=${ckRes.body.customerKey && ckRes.body.customerKey.slice(0, 8)}…`);

        const issueRes = await requestJson(`${base}/api/billing/issue`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken, authKey: 'auth_key_smoke_ok', startTrial: true })
        });
        const subscriptionId = issueRes.body.subscription && issueRes.body.subscription.subscriptionId;
        record('시나리오 F 빌링키 발급 + 21일 체험 즉시 부여',
            issueRes.status === 200
            && issueRes.body.status === 'BILLING_SUBSCRIPTION_ACTIVE'
            && issueRes.body.subscription.status === 'ACTIVE'
            && issueRes.body.subscription.billingKeyMasked
            && issueRes.body.trialAccessGranted === true,
            `subscription=${subscriptionId} nextCharge=${issueRes.body.subscription && issueRes.body.subscription.nextChargeAt}`);

        const afterTrial = await requestJson(`${base}/api/session/report?sessionToken=${encodeURIComponent(sessionToken)}`);
        record('시나리오 F 체험 권한 지급(누적 크레딧 +100)',
            afterTrial.status === 200 && afterTrial.body.remainingCredits === 190,
            `remaining=${afterTrial.body.remainingCredits}`);

        // 재등록(카드 교체) 시 체험 크레딧 중복 지급 금지
        const reissueTrialRes = await requestJson(`${base}/api/billing/issue`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken, authKey: 'auth_key_smoke_ok', startTrial: true })
        });
        const afterReissue = await requestJson(`${base}/api/session/report?sessionToken=${encodeURIComponent(sessionToken)}`);
        record('시나리오 F 카드 재등록 시 체험 크레딧 중복 지급 방지',
            reissueTrialRes.status === 200
            && reissueTrialRes.body.subscription.subscriptionId === subscriptionId
            && afterReissue.body.remainingCredits === 190,
            `remaining=${afterReissue.body.remainingCredits}`);

        const issueFailRes = await requestJson(`${base}/api/billing/issue`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken, authKey: 'FAIL_AUTH', startTrial: true })
        });
        record('시나리오 F 빌링키 발급 실패 시 402 + 명확한 코드',
            issueFailRes.status === 402
            && issueFailRes.body.status === 'BILLING_ISSUE_FAILED'
            && issueFailRes.body.code === 'INVALID_AUTH_KEY',
            `code=${issueFailRes.body.code}`);

        // ------------------------------------------------------------------
        // [자동결제] 갱신 청구 성공 → 실패/재시도 → 복구
        // ------------------------------------------------------------------
        const chargeRes = await requestJson(`${base}/api/billing/charge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
            body: JSON.stringify({ subscriptionId, force: true })
        });
        record('시나리오 F 자동결제 갱신 청구 성공(빌링키)',
            chargeRes.status === 200
            && chargeRes.body.status === 'BILLING_CHARGED'
            && chargeRes.body.entitlement
            && chargeRes.body.entitlement.remainingCredits === 290,
            `remaining=${chargeRes.body.entitlement && chargeRes.body.entitlement.remainingCredits}`);

        const unauthorizedCharge = await requestJson(`${base}/api/billing/charge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subscriptionId, force: true })
        });
        record('시나리오 F 관리자 토큰 없는 청구 차단', unauthorizedCharge.status === 403);

        toss.control.failCharges = true;
        const failedCharge = await requestJson(`${base}/api/billing/charge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
            body: JSON.stringify({ subscriptionId, force: true })
        });
        record('시나리오 F 갱신 실패 → 실패 횟수·재시도 일시 기록',
            failedCharge.status === 402
            && failedCharge.body.status === 'BILLING_CHARGE_FAILED'
            && failedCharge.body.failedAttempts === 1
            && Boolean(failedCharge.body.nextChargeAt),
            `attempts=${failedCharge.body.failedAttempts} next=${failedCharge.body.nextChargeAt}`);

        toss.control.failCharges = false;
        const recoveredCharge = await requestJson(`${base}/api/billing/charge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
            body: JSON.stringify({ subscriptionId, force: true })
        });
        record('시나리오 F 재시도 성공 시 실패 카운터 초기화',
            recoveredCharge.status === 200
            && recoveredCharge.body.subscription.failedAttempts === 0,
            `attempts=${recoveredCharge.body.subscription && recoveredCharge.body.subscription.failedAttempts}`);

        const cancelRes = await requestJson(`${base}/api/billing/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken, deleteKey: true })
        });
        record('시나리오 F 자동결제 해지 + 토스 빌링키 삭제',
            cancelRes.status === 200
            && cancelRes.body.status === 'SUBSCRIPTION_CANCELED'
            && cancelRes.body.subscription.status === 'CANCELED'
            && toss.calls.some((c) => c.url.includes('/v1/billing/') && !c.url.includes('authorizations')),
            `status=${cancelRes.body.subscription && cancelRes.body.subscription.status}`);

        // 7) BILLING_DELETED 웹훅 (토스 측 빌링키 삭제) → 청구 차단
        const reissueRes = await requestJson(`${base}/api/billing/issue`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken, authKey: 'auth_key_smoke_ok', startTrial: false })
        });
        const reissuedId = reissueRes.body.subscription && reissueRes.body.subscription.subscriptionId;
        const billingDeletedRes = await postWebhook(
            { eventType: 'BILLING_DELETED', createdAt: new Date().toISOString(), data: { billingKey: 'billing_mock_key_1' } },
            'wh_billing_deleted_1'
        );
        record('시나리오 F BILLING_DELETED 웹훅 → 구독 차단 반영',
            billingDeletedRes.status === 200
            && billingDeletedRes.body.result === 'BILLING_DELETED_APPLIED',
            `result=${billingDeletedRes.body.result}`);

        const deletedCharge = await requestJson(`${base}/api/billing/charge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
            body: JSON.stringify({ subscriptionId: reissuedId, force: true })
        });
        record('시나리오 F 삭제된 빌링키로 재청구 차단',
            deletedCharge.status === 402
            && deletedCharge.body.code === 'BILLING_KEY_DELETED',
            `code=${deletedCharge.body.code}`);
    } finally {
        child.kill();
        toss.server.close();
    }
}

/**
 * [시나리오 G] App-in-Toss 인앱결제(SDK 지급 콜백)
 * - 토스 로그인(authorizationCode) → userKey + 단기 loginToken
 * - 주문 상태 서버 검증(PAYMENT_COMPLETED + SKU 일치) 후 멱등 지급
 * - 중복 orderId / SKU 불일치 / 미완료 상태 / 환불 동기화 검증
 */
async function runAppsInTossScenario() {
    console.log('\n▶ [시나리오 G] App-in-Toss 인앱결제 (목 파트너 API)');

    const apiKey = 'ait_api_key_smoke';
    const aitAdminToken = 'iap_admin_smoke';
    const ait = await startMockAppsInTossServer({ apiKey, userKey: 'toss_user_smoke_0001' });
    const appPort = 5800 + Math.floor(Math.random() * 150);

    const { child, port } = await startAppServer({
        PORT: String(appPort),
        VIP_ANNUAL_PRICE: '79000',
        STARTER_CREDIT_CAP: '30',
        VIP_CREDIT_CAP: '100',
        ENCRYPTION_MASTER_KEY: 'g'.repeat(64),
        AIT_API_KEY: apiKey,
        AIT_API_BASE_URL: `http://127.0.0.1:${ait.port}`,
        AIT_APP_ID: 'app-glow-muse-smoke',
        AIT_SESSION_SECRET: 'ait_session_secret_smoke_1234567890',
        AIT_IAP_SKU_VIP_ANNUAL: 'sku.vip.annual',
        AIT_IAP_SKU_STARTER_PACK: 'sku.starter.30',
        AIT_IAP_ADMIN_TOKEN: aitAdminToken,
        AIT_IAP_TIMEOUT_MS: '5000'
    });

    const base = `http://127.0.0.1:${port}`;

    try {
        const configRes = await requestJson(`${base}/api/config`);
        record('시나리오 G IAP LIVE 모드·SKU 카탈로그 노출',
            configRes.body.iap.mode === 'LIVE'
            && configRes.body.iap.skusConfigured === 2
            && Array.isArray(configRes.body.iap.products)
            && configRes.body.iap.products.length === 2,
            `mode=${configRes.body.iap.mode} skus=${configRes.body.iap.skusConfigured}`);

        const productsRes = await requestJson(`${base}/api/iap/products`);
        record('시나리오 G 인앱 상품 목록(콘솔 SKU 매핑)',
            productsRes.status === 200
            && productsRes.body.products.some((p) => p.planTier === 'VIP_ANNUAL' && p.sku === 'sku.vip.annual'),
            `count=${productsRes.body.products && productsRes.body.products.length}`);

        const diagRes = await requestJson(`${base}/api/glow/diagnose`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nickname: '앱인토스뮤즈', monthlyBeautySpendManwon: 30 })
        });
        const sessionToken = diagRes.body.sessionToken;

        // 1) 토스 로그인 → userKey + loginToken
        const loginRes = await requestJson(`${base}/api/iap/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken, authorizationCode: 'auth_code_smoke', referrer: 'DEFAULT' })
        });
        const loginToken = loginRes.body.loginToken;
        const userKey = loginRes.body.userKey;
        record('시나리오 G 토스 로그인 코드 교환 + userKey 바인딩',
            loginRes.status === 200
            && loginRes.body.status === 'IAP_LOGIN_OK'
            && userKey === ait.userKey
            && typeof loginToken === 'string'
            && loginToken.includes('.'),
            `userKey=${loginRes.body.userKeyMasked}`);

        const badLoginRes = await requestJson(`${base}/api/iap/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken, authorizationCode: 'expired_code' })
        });
        record('시나리오 G 만료/위조 인증코드 거절',
            badLoginRes.status === 401 && badLoginRes.body.status === 'IAP_LOGIN_FAILED',
            `status=${badLoginRes.status}`);

        // 2) 결제 완료 주문 지급
        ait.setOrder('AIT_ORD_VIP_1', { sku: 'sku.vip.annual', status: 'PAYMENT_COMPLETED' });
        const grantRes = await requestJson(`${base}/api/iap/grant`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken, orderId: 'AIT_ORD_VIP_1', sku: 'sku.vip.annual', userKey, loginToken })
        });
        record('시나리오 G 인앱결제 지급(서버 주문 검증 후)',
            grantRes.status === 200
            && grantRes.body.status === 'IAP_GRANTED'
            && grantRes.body.grant === true
            && grantRes.body.remainingCredits === 90
            && grantRes.body.mode === 'LIVE',
            `remaining=${grantRes.body.remainingCredits} mode=${grantRes.body.mode}`);

        const dupGrant = await requestJson(`${base}/api/iap/grant`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken, orderId: 'AIT_ORD_VIP_1', sku: 'sku.vip.annual', userKey, loginToken })
        });
        record('시나리오 G 동일 orderId 재지급 멱등(크레딧 이중 지급 없음)',
            dupGrant.status === 200
            && dupGrant.body.alreadyGranted === true
            && dupGrant.body.remainingCredits === 90,
            `remaining=${dupGrant.body.remainingCredits}`);

        // 3) 로그인 토큰 없이 지급 시도 → 거절
        ait.setOrder('AIT_ORD_NO_TOKEN', { sku: 'sku.vip.annual', status: 'PAYMENT_COMPLETED' });
        const noTokenRes = await requestJson(`${base}/api/iap/grant`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken, orderId: 'AIT_ORD_NO_TOKEN', sku: 'sku.vip.annual', userKey })
        });
        record('시나리오 G loginToken 없는 지급 요청 차단',
            noTokenRes.status === 402 && noTokenRes.body.code === 'LOGIN_TOKEN_REQUIRED',
            `code=${noTokenRes.body.code}`);

        // 4) SKU 불일치 / 미완료 / 환불 상태 거절
        ait.setOrder('AIT_ORD_MISMATCH', { sku: 'sku.starter.30', status: 'PAYMENT_COMPLETED' });
        const mismatchRes = await requestJson(`${base}/api/iap/grant`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken, orderId: 'AIT_ORD_MISMATCH', sku: 'sku.vip.annual', userKey, loginToken })
        });
        record('시나리오 G 주문 SKU 불일치 지급 거절',
            mismatchRes.status === 402 && mismatchRes.body.code === 'SKU_MISMATCH',
            `code=${mismatchRes.body.code}`);

        ait.setOrder('AIT_ORD_PENDING', { sku: 'sku.vip.annual', status: 'ORDER_IN_PROGRESS' });
        const pendingRes = await requestJson(`${base}/api/iap/grant`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken, orderId: 'AIT_ORD_PENDING', sku: 'sku.vip.annual', userKey, loginToken })
        });
        record('시나리오 G 미완료 주문 지급 거절',
            pendingRes.status === 402 && pendingRes.body.code === 'ORDER_STATUS_ORDER_IN_PROGRESS',
            `code=${pendingRes.body.code}`);

        // 5) 환불 동기화 → 권한 회수
        ait.setOrder('AIT_ORD_VIP_1', { sku: 'sku.vip.annual', status: 'REFUNDED' });
        const syncRes = await requestJson(`${base}/api/iap/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-admin-token': aitAdminToken },
            body: JSON.stringify({ orderId: 'AIT_ORD_VIP_1', userKey })
        });
        record('시나리오 G 환불 동기화 → IAP 주문 REFUNDED 처리',
            syncRes.status === 200
            && syncRes.body.status === 'IAP_SYNC_OK'
            && syncRes.body.syncStatus === 'REFUNDED'
            && syncRes.body.changed === true
            && syncRes.body.record && syncRes.body.record.status === 'REFUNDED',
            `changed=${syncRes.body.changed} syncStatus=${syncRes.body.syncStatus}`);

        const lockedReport = await requestJson(`${base}/api/session/report?sessionToken=${encodeURIComponent(sessionToken)}`);
        record('시나리오 G 환불 후 기능 재잠금(권한 회수)',
            lockedReport.status === 403 && lockedReport.body.status === 'REFUNDED_LOCKED',
            lockedReport.body.status);

        const refundedGrant = await requestJson(`${base}/api/iap/grant`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken, orderId: 'AIT_ORD_VIP_1', sku: 'sku.vip.annual', userKey, loginToken })
        });
        record('시나리오 G 환불된 주문 재지급 차단',
            refundedGrant.status === 402 && refundedGrant.body.code === 'ORDER_REFUNDED',
            `code=${refundedGrant.body.code}`);

        // 6) 파트너 API 호출이 실제로 발생했는지(토큰 교환·userKey 조회·주문 상태)
        record('시나리오 G 파트너 API(mTLS/Bearer) 호출 경로 검증',
            ait.calls.some((c) => c.url.includes('/user/oauth2/generate-token'))
            && ait.calls.some((c) => c.url.includes('/user/oauth2/login-me'))
            && ait.calls.some((c) => c.url.includes('/order/get-order-status')),
            `calls=${ait.calls.length}`);
    } finally {
        child.kill();
        ait.server.close();
    }
}

async function main() {
    console.log('====================================================================');
    console.log('🧪 [MuseGlow AI v5.0] 실제 AI 연동 & 결제 게이트웨이 통합 스모크 테스트');
    console.log('====================================================================');

    const mock = await startMockAiServer();
    const aiBaseUrl = `http://127.0.0.1:${mock.port}/v1`;

    try {
        await runScenario('시나리오 A', { withAi: false });
        await runScenario('시나리오 B', { withAi: true, aiBaseUrl, mockAi: mock });
        await runTossLiveScenario();
        await runWebhookBillingScenario();
        await runAppsInTossScenario();
        await runSupabasePersistenceScenario();
        await runSupabaseFailureScenario();
    } finally {
        mock.server.close();
    }

    const passed = results.filter((r) => r.passed).length;
    const total = results.length;
    console.log('\n====================================================================');
    console.log(`📊 스모크 테스트 결과: ${passed}/${total} PASS`);
    console.log('====================================================================');

    process.exit(passed === total ? 0 : 1);
}

if (require.main === module) {
    main().catch((err) => {
        console.error('스모크 테스트 실행 중 오류:', err);
        process.exit(1);
    });
}

module.exports = { main };
