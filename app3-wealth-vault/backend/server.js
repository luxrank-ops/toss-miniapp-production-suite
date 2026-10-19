/**
 * ============================================================================
 * 파일명: app3-wealth-vault/backend/server.js
 * 역할: [제3호 앱 AGENT 4] 웰스볼트 AI + [HAK ETF 관리] + [금융권 마이데이터 자산 불러오기]
 *       통합 백엔드 서버 (포트: 3002)
 * ============================================================================
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { getDynamicConfig } = require('./config/envLoader');
const {
    analyzeWealthPortfolio,
    verifyWealthPaymentAndUnlock,
    getWealthLedgerStatus
} = require('./services/wealthEngine');
const {
    getHakEtfCatalog,
    compareHakEtfs,
    simulateHakEtfPortfolio
} = require('./services/hakEtfEngine');
const {
    getMyDataInstitutions,
    fetchAndSyncMyDataAssets
} = require('./services/mydataSyncEngine');

const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');

/**
 * 교육용 주석:
 * 브라우저가 POST 방식으로 보낸 JSON 본문(Body) 데이터를 읽어서
 * 자바스크립트 객체로 변환해 주는 함수입니다.
 */
function parseRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk) => {
            body += chunk.toString('utf8');
            if (body.length > 1e6) {
                req.destroy();
                reject(new Error('요청 데이터가 너무 큽니다.'));
            }
        });
        req.on('end', () => {
            if (!body) {
                resolve({});
                return;
            }
            try {
                resolve(JSON.parse(body));
            } catch {
                reject(new Error('올바른 JSON 형식이 아닙니다.'));
            }
        });
        req.on('error', reject);
    });
}

/**
 * 교육용 주석:
 * 서버에서 계산한 결과 데이터를 JSON 형태로 브라우저에게 응답해 주는 함수입니다.
 */
function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end(JSON.stringify(data, null, 2));
}

/**
 * 교육용 주석:
 * HTML, CSS, JS 같은 화면 파일들을 읽어서 브라우저에 전달해 주는 정적 파일 서빙 함수입니다.
 */
function serveStaticFile(res, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8'
    };
    const contentType = mimeTypes[ext] || 'text/plain; charset=utf-8';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            sendJson(res, 404, { error: '요청하신 파일을 찾을 수 없습니다.' });
            return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
    });
}

async function requestHandler(req, res) {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return;
    }

    // [API 1] GET /api/config (기존 웰스볼트 AI 환경 설정 조회)
    if (req.method === 'GET' && pathname === '/api/config') {
        const config = getDynamicConfig();
        sendJson(res, 200, {
            success: true,
            appName: '웰스볼트 AI : 은행·증권·부동산·동산·보험 통합 자산 & HAK ETF 관리',
            monetizationPrice: config.monetizationPrice,
            formattedPrice: config.formattedPrice,
            maskedOwnerId: config.maskedOwnerId,
            maskedUserIdentity: config.maskedUserIdentity,
            maskedSettlementAccount: config.maskedSettlementAccount,
            securityStandard: 'AES-256-GCM Encrypted Personal Wealth & HAK ETF Protection'
        });
        return;
    }

    // [API 2] POST /api/wealth/analyze (기존 웰스볼트 AI 5대 재산 분석)
    if (req.method === 'POST' && pathname === '/api/wealth/analyze') {
        try {
            const body = await parseRequestBody(req);
            const result = analyzeWealthPortfolio(body);
            sendJson(res, 200, { success: true, data: result });
        } catch (error) {
            sendJson(res, 400, { success: false, message: error.message });
        }
        return;
    }

    // [API 3] POST /api/payment/verify (기존 웰스볼트 AI 결제 검증)
    if (req.method === 'POST' && pathname === '/api/payment/verify') {
        try {
            const body = await parseRequestBody(req);
            const verification = verifyWealthPaymentAndUnlock(body);
            sendJson(res, 200, { success: true, data: verification });
        } catch (error) {
            sendJson(res, 400, { success: false, message: error.message });
        }
        return;
    }

    // [API 4] GET /api/ledger (기존 웰스볼트 AI 원장 상태 조회)
    if (req.method === 'GET' && pathname === '/api/ledger') {
        sendJson(res, 200, { success: true, ledger: getWealthLedgerStatus() });
        return;
    }

    // =========================================================================
    // [HAK ETF 관리 미니앱 전용 API 3종]
    // =========================================================================

    // [API 5] GET /api/hak-etf/catalog
    if (req.method === 'GET' && pathname === '/api/hak-etf/catalog') {
        const category = parsedUrl.searchParams.get('category') || 'ALL';
        const sortBy = parsedUrl.searchParams.get('sortBy') || 'dividend_desc';
        const keyword = parsedUrl.searchParams.get('keyword') || '';
        const catalogData = getHakEtfCatalog({ category, sortBy, keyword });
        sendJson(res, 200, { success: true, data: catalogData });
        return;
    }

    // [API 6] POST /api/hak-etf/compare
    if (req.method === 'POST' && pathname === '/api/hak-etf/compare') {
        try {
            const body = await parseRequestBody(req);
            const compared = compareHakEtfs(body.codes);
            sendJson(res, 200, { success: true, data: compared });
        } catch (error) {
            sendJson(res, 400, { success: false, message: error.message });
        }
        return;
    }

    // [API 7] POST /api/hak-etf/simulate
    if (req.method === 'POST' && pathname === '/api/hak-etf/simulate') {
        try {
            const body = await parseRequestBody(req);
            const simulation = simulateHakEtfPortfolio(body);
            sendJson(res, 200, { success: true, data: simulation });
        } catch (error) {
            sendJson(res, 400, { success: false, message: error.message });
        }
        return;
    }

    // =========================================================================
    // [금융권 마이데이터(MyData) 나의 자산내역 통합 불러오기 API 2종]
    // =========================================================================

    // [API 8] GET /api/mydata/institutions (카카오페이·은행·증권사·보험사 목록 조회)
    if (req.method === 'GET' && pathname === '/api/mydata/institutions') {
        const instData = getMyDataInstitutions();
        sendJson(res, 200, { success: true, data: instData });
        return;
    }

    // [API 9] POST /api/mydata/fetch (선택 금융기관 내 계좌 잔고·배당·보유 ETF 통합 불러오기 & 암호화)
    if (req.method === 'POST' && pathname === '/api/mydata/fetch') {
        try {
            const body = await parseRequestBody(req);
            const syncedResult = fetchAndSyncMyDataAssets(body);
            sendJson(res, 200, { success: true, data: syncedResult });
        } catch (error) {
            sendJson(res, 400, { success: false, message: error.message });
        }
        return;
    }

    // 정적 웹페이지 라우팅 처리
    if (req.method === 'GET') {
        if (pathname === '/' || pathname === '/index.html') {
            serveStaticFile(res, path.join(FRONTEND_DIR, 'index.html'));
            return;
        }
        if (pathname === '/hak-etf' || pathname === '/hak-etf.html') {
            serveStaticFile(res, path.join(FRONTEND_DIR, 'hak-etf.html'));
            return;
        }
        const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
        const targetFile = path.join(FRONTEND_DIR, safePath);
        if (fs.existsSync(targetFile) && fs.statSync(targetFile).isFile()) {
            serveStaticFile(res, targetFile);
            return;
        }
    }

    sendJson(res, 404, { error: '존재하지 않는 엔드포인트입니다.' });
}

function startServer(customPort) {
    const config = getDynamicConfig();
    const port = customPort || config.port;
    const server = http.createServer(requestHandler);

    return new Promise((resolve) => {
        server.listen(port, () => {
            console.log('====================================================================');
            console.log('🏦 [웰스볼트 AI + HAK ETF 관리 + 금융권 마이데이터] 통합 서버 가동!');
            console.log(`🔗 개인재정 앱(웰스볼트 AI) 주소: http://localhost:${port}`);
            console.log(`📈 HAK ETF 관리 미니앱 주소:      http://localhost:${port}/hak-etf.html`);
            console.log('💛 금융권 연동: 카카오페이 · 신협 · 카카오뱅크 · 삼성/미래에셋/키움 · 메리츠');
            console.log('🔒 개인 재산/계좌 보안 프로토콜: AES-256-GCM 양방향 암호화 활성화 완료');
            console.log('====================================================================');
            resolve(server);
        });
    });
}

if (require.main === module) {
    startServer();
}

module.exports = {
    startServer,
    requestHandler
};
