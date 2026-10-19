/**
 * ============================================================================
 * 파일명: backend/config/envLoader.js
 * 역할: [AGENT 3 & AGENT 4] 환경변수(.env) 동적 로더 및 개인정보 마스킹 모듈
 * 설명: 코딩 초보자분들이 외부 패키지(dotenv 등)를 별도로 설치하지 않아도,
 *       Node.js 기본 기능만으로 .env 파일을 읽어와 판매 금액과 판매자 정보를
 *       앱 전체에 동적으로 주입해 주는 역할을 합니다.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');

/**
 * 프로젝트 루트에 위치한 .env 파일을 한 줄씩 읽어서 process.env에 등록하는 함수입니다.
 */
function loadEnvFile() {
    const envPath = path.join(__dirname, '..', '..', '.env');

    // .env 파일이 존재하는 경우에만 읽기를 시도합니다.
    if (fs.existsSync(envPath)) {
        const rawContent = fs.readFileSync(envPath, 'utf-8');
        const lines = rawContent.split(/\r?\n/);

        for (const line of lines) {
            const trimmed = line.trim();
            // 빈 줄이나 '#'으로 시작하는 주석 줄은 건너뜁니다.
            if (!trimmed || trimmed.startsWith('#')) {
                continue;
            }

            const equalIndex = trimmed.indexOf('=');
            if (equalIndex > 0) {
                const key = trimmed.substring(0, equalIndex).trim();
                const value = trimmed.substring(equalIndex + 1).trim();

                // 시스템 환경변수에 아직 값이 없을 때만 .env 값을 넣어줍니다.
                if (!process.env[key]) {
                    process.env[key] = value;
                }
            }
        }
    }
}

/**
 * 민감한 판매자 식별자나 계좌 정보를 화면에 안전하게 표시하기 위해 가운데 글자를 '*'로 가려주는(마스킹) 함수입니다.
 * 예: "TOSS_PARTNER_CHUNHAK" -> "TOSS_****_CHUNHAK"
 * @param {string} rawText 원본 문자열
 * @returns {string} 마스킹 처리된 안전한 문자열
 */
function maskSensitiveText(rawText) {
    if (!rawText || typeof rawText !== 'string') {
        return '미설정_플레이스홀더';
    }
    const clean = rawText.trim();
    if (clean.length <= 4) {
        return clean[0] + '***';
    }
    const front = clean.slice(0, 3);
    const back = clean.slice(-2);
    return `${front}****${back}`;
}

/**
 * 현재 설정된 동적 유료화 환경변수를 읽어와 표준 객체로 반환하는 함수입니다.
 * AGENT 4 규격(REVENUE_PRICE, USER_IDENTITY)과 ARTIFACT 규격(MONETIZATION_PRICE, APP_OWNER_ID)을 모두 호환합니다.
 */
function getDynamicConfig() {
    loadEnvFile();

    // 1. 유료화 판매 금액 읽기 (MONETIZATION_PRICE 또는 REVENUE_PRICE 중 입력된 값 사용)
    const rawPrice = process.env.MONETIZATION_PRICE || process.env.REVENUE_PRICE || '1900';
    const parsedPrice = parseInt(rawPrice.replace(/[^0-9]/g, ''), 10);
    const finalPrice = Number.isNaN(parsedPrice) || parsedPrice <= 0 ? 1900 : parsedPrice;

    // 2. 판매자(소유자) 식별 정보 읽기 (APP_OWNER_ID 또는 USER_IDENTITY 중 입력된 값 사용)
    const rawOwnerId = process.env.APP_OWNER_ID || process.env.USER_IDENTITY || 'TOSS_PARTNER_PLACEHOLDER';
    const rawUserIdentity = process.env.USER_IDENTITY || process.env.APP_OWNER_ID || '홍길동_파트너스튜디오';
    const rawSettlementAccount = process.env.OWNER_SETTLEMENT_ACCOUNT || '미입력_정산계좌_플레이스홀더';

    // 3. 암호화 마스터 키 읽기
    const encryptionKey = process.env.ENCRYPTION_SECRET_KEY || 'default_antigravity_aes256_secret_key_2026';

    // 4. 서버 포트 번호 읽기
    const port = parseInt(process.env.PORT || '3000', 10);

    return {
        // 실제 결제 검증에 사용되는 숫자형 금액
        monetizationPrice: finalPrice,
        // 한국 원화 콤마 포맷 (예: "1,900")
        formattedPrice: finalPrice.toLocaleString('ko-KR'),
        // 내부 보관용 원본 식별자 (외부 API 응답에는 절대 평문 노출하지 않음)
        rawOwnerId,
        rawUserIdentity,
        rawSettlementAccount,
        // 프론트엔드 결제창 표시용 마스킹 식별자
        maskedOwnerId: maskSensitiveText(rawOwnerId),
        maskedUserIdentity: maskSensitiveText(rawUserIdentity),
        maskedSettlementAccount: maskSensitiveText(rawSettlementAccount),
        // AES-256 암호화 키
        encryptionKey,
        port
    };
}

module.exports = {
    loadEnvFile,
    maskSensitiveText,
    getDynamicConfig
};
