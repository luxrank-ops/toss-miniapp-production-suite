/**
 * ============================================================================
 * 파일명: backend/server.js
 * 역할: [AGENT 4] 토스 미니앱 백엔드 API 및 정적 웹뷰 통합 서버
 * 설명: 외부 라이브러리 설치 오류 없이 Node.js 내장 http 모듈만으로 즉시 실행되며,
 *       .env 파일의 동적 유료화 금액(MONETIZATION_PRICE / REVENUE_PRICE)과
 *       판매자 식별 정보(APP_OWNER_ID / USER_IDENTITY)를 실시간으로 프론트엔드에
 *       연결해 주는 결제 가교(Payment-Bridge) 서버입니다.
 * ============================================================================
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { getDynamicConfig } = require('./config/envLoader');
const {
    analyzeAndCreatePreview,
    verifyPaymentAndUnlock,
    getLedgerStatus
} = require('./services/miniAppEngine');

const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');

/**
 * 클라이언트가 보낸 JSON 요청 본문(Body)을 안전하게 읽어오는 헬퍼 함수입니다.
 */
function parseRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk) => {
            body += chunk.toString('utf8');
            // 대용량 공격 방지를 위해 1MB 제한
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
            } catch (err) {
                reject(new Error('올바른 JSON 형식이 아닙니다.'));
            }
        });
        req.on('error', reject);
    });
}

/**
 * JSON 응답을 전송하는 헬퍼 함수입니다.
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
 * 프론트엔드 정적 파일(HTML, CSS, JS)을 브라우저로 전송하는 함수입니다.
 */
function serveStaticFile(res, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png'
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

/**
 * HTTP 요청 라우터 처리 함수
 */
async function requestHandler(req, res) {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    // CORS Preflight 처리
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return;
    }

    // [API 1] GET /api/config : .env에서 동적 유료화 금액 및 마스킹된 판매자 정보 조회
    if (req.method === 'GET' && pathname === '/api/config') {
        const config = getDynamicConfig();
        sendJson(res, 200, {
            success: true,
            appName: '머니사주 AI : 내 사주로 보는 이번 달 돈 새는 날 & 재물 타이밍 리포트',
            monetizationPrice: config.monetizationPrice,
            formattedPrice: config.formattedPrice,
            maskedOwnerId: config.maskedOwnerId,
            maskedUserIdentity: config.maskedUserIdentity,
            maskedSettlementAccount: config.maskedSettlementAccount,
            securityStandard: 'AES-256-GCM Encrypted Personal Data Protection'
        });
        return;
    }

    // [API 2] POST /api/analyze : 사용자 정보 AES-256 암호화 저장 및 무료 결과 + 유료 블러 프리뷰 생성
    if (req.method === 'POST' && pathname === '/api/analyze') {
        try {
            const body = await parseRequestBody(req);
            const result = analyzeAndCreatePreview(body);
            sendJson(res, 200, {
                success: true,
                data: result
            });
        } catch (error) {
            sendJson(res, 400, {
                success: false,
                message: error.message || '분석 중 오류가 발생했습니다.'
            });
        }
        return;
    }

    // [API 3] POST /api/payment/verify : 동적 금액 결제 검증 및 프리미엄 리포트 잠금 해제
    if (req.method === 'POST' && pathname === '/api/payment/verify') {
        try {
            const body = await parseRequestBody(req);
            const verification = verifyPaymentAndUnlock(body);
            sendJson(res, 200, {
                success: true,
                data: verification
            });
        } catch (error) {
            sendJson(res, 400, {
                success: false,
                message: error.message || '결제 검증에 실패했습니다.'
            });
        }
        return;
    }

    // [API 4] GET /api/ledger : 실시간 AES-256 암호화 원장 및 정산 통계 확인
    if (req.method === 'GET' && pathname === '/api/ledger') {
        sendJson(res, 200, {
            success: true,
            ledger: getLedgerStatus()
        });
        return;
    }

    // 정적 파일 서빙 (프론트엔드 웹앱)
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

/**
 * 서버 시작 함수 (직접 실행 시 또는 외부 스크립트에서 호출 가능)
 */
function startServer(customPort) {
    const config = getDynamicConfig();
    const port = customPort || config.port;
    const server = http.createServer(requestHandler);

    return new Promise((resolve) => {
        server.listen(port, () => {
            console.log('====================================================================');
            console.log('🚀 [토스 미니앱 유료화 팩토리] 웹뷰 & 결제 가교 서버가 가동되었습니다!');
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
