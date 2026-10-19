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
        server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
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

                const existingIndex = rows.findIndex((row) => filters.every((f) => String(row[f.column]) === f.value));
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
// [목 토스페이먼츠 서버] /v1/payments/confirm · /v1/payments/{key}/cancel
// ============================================================================
function startMockTossServer({ secretKey }) {
    const expectedAuth = 'Basic ' + Buffer.from(`${secretKey}:`).toString('base64');
    const calls = [];

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
            calls.push({ url: req.url, auth: req.headers.authorization, payload });

            // [보안 검증] Basic 인증 헤더가 정확한 시크릿 키로 생성되었는지 확인
            if (req.headers.authorization !== expectedAuth) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 'INVALID_AUTHORIZATION', message: '인증 실패' }));
                return;
            }

            if (req.url === '/v1/payments/confirm') {
                // 의도적 실패 키
                if (payload.paymentKey === 'FAIL_ME') {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 'PAY_PROCESS_CANCELED', message: '사용자가 결제를 취소했습니다.' }));
                    return;
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    paymentKey: payload.paymentKey,
                    orderId: payload.orderId,
                    status: 'DONE',
                    method: '카드',
                    totalAmount: payload.amount,
                    approvedAt: new Date().toISOString(),
                    receipt: { url: 'https://mock.tosspayments.com/receipt/1234' },
                    card: { company: '신한카드', number: '1234**********5678', installmentPlanMonths: 0 }
                }));
                return;
            }

            const cancelMatch = req.url.match(/^\/v1\/payments\/(.+)\/cancel$/);
            if (cancelMatch) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    paymentKey: decodeURIComponent(cancelMatch[1]),
                    status: 'CANCELED',
                    cancels: [{ cancelReason: payload.cancelReason, canceledAt: new Date().toISOString() }]
                }));
                return;
            }

            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ code: 'NOT_FOUND', message: 'unknown endpoint' }));
        });
    });

    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, calls }));
    });
}

const FAKE_IMAGE = Buffer.from('fake-jpeg-bytes-for-smoke-test').toString('base64').repeat(20);

/** 단일 시나리오 실행: AI 미설정(A) / AI 설정(B) */
async function runScenario(label, { withAi, aiBaseUrl }) {
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
            `status=${hookRes.body.status} remaining=${hookRes.body.remainingCredits}`);
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

async function main() {
    console.log('====================================================================');
    console.log('🧪 [MuseGlow AI v5.0] 실제 AI 연동 & 결제 게이트웨이 통합 스모크 테스트');
    console.log('====================================================================');

    const mock = await startMockAiServer();
    const aiBaseUrl = `http://127.0.0.1:${mock.port}/v1`;

    try {
        await runScenario('시나리오 A', { withAi: false });
        await runScenario('시나리오 B', { withAi: true, aiBaseUrl });
        await runTossLiveScenario();
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
