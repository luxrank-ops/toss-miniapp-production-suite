/**
 * ============================================================================
 * 파일명: app2-refund-radar/backend/server.js
 * 역할: [제2호 앱 AGENT 4] 환급레이더 AI 백엔드 API 및 정적 웹뷰 통합 서버 (기본 포트: 3001)
 * 설명: 1호 앱(3000번 포트)과 동시에 켜도 충돌하지 않도록 3001번 포트에서 동작하며,
 *       .env의 동적 유료화 금액(MONETIZATION_PRICE)과 판매자 식별자(APP_OWNER_ID)를
 *       프론트엔드에 실시간 연결합니다.
 * ============================================================================
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { getDynamicConfig } = require('./config/envLoader');
const {
    scanAndCreateRefundPreview,
    verifyRefundPaymentAndUnlock,
    getRefundLedgerStatus
} = require('./services/refundEngine');

const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');

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

function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end(JSON.stringify(data, null, 2));
}

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

    // [API 1] GET /api/config
    if (req.method === 'GET' && pathname === '/api/config') {
        const config = getDynamicConfig();
        sendJson(res, 200, {
            success: true,
            appName: '환급레이더 AI : 숨은 병원비·건보료·통신비 환급금 & 고정지출 누수 스캐너',
            monetizationPrice: config.monetizationPrice,
            formattedPrice: config.formattedPrice,
            maskedOwnerId: config.maskedOwnerId,
            maskedUserIdentity: config.maskedUserIdentity,
            maskedSettlementAccount: config.maskedSettlementAccount,
            securityStandard: 'AES-256-GCM Encrypted Personal Data Protection'
        });
        return;
    }

    // [API 2] POST /api/scan
    if (req.method === 'POST' && pathname === '/api/scan') {
        try {
            const body = await parseRequestBody(req);
            const result = scanAndCreateRefundPreview(body);
            sendJson(res, 200, { success: true, data: result });
        } catch (error) {
            sendJson(res, 400, { success: false, message: error.message });
        }
        return;
    }

    // [API 3] POST /api/payment/verify
    if (req.method === 'POST' && pathname === '/api/payment/verify') {
        try {
            const body = await parseRequestBody(req);
            const verification = verifyRefundPaymentAndUnlock(body);
            sendJson(res, 200, { success: true, data: verification });
        } catch (error) {
            sendJson(res, 400, { success: false, message: error.message });
        }
        return;
    }

    // [API 4] GET /api/ledger
    if (req.method === 'GET' && pathname === '/api/ledger') {
        sendJson(res, 200, { success: true, ledger: getRefundLedgerStatus() });
        return;
    }

    if (req.method === 'GET') {
        if (pathname === '/' || pathname === '/index.html') {
            serveStaticFile(res, path.join(FRONTEND_DIR, 'index.html'));
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
            console.log('🚀 [제2호 토스 미니앱: 환급레이더 AI] 웹뷰 & 결제 서버가 가동되었습니다!');
            console.log(`🔗 토스 인앱 브라우저 접속 주소: http://localhost:${port}`);
            console.log(`💰 현재 동적 설정 판매 금액 (MONETIZATION_PRICE): ${config.formattedPrice}원`);
            console.log(`👤 판매자 식별자 (마스킹 처리됨): ${config.maskedOwnerId} (${config.maskedUserIdentity})`);
            console.log('🔒 개인정보 보안 프로토콜: AES-256-GCM 양방향 암호화 활성화 완료');
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
