/**
 * ============================================================================
 * 파일명: app2-refund-radar/backend/config/envLoader.js
 * 역할: [제2호 앱 AGENT 3 & 4] 환경변수(.env) 동적 로더 및 판매자 식별정보 마스킹 모듈
 * 설명: 외부 패키지 설치 없이 .env 파일을 읽어 판매 금액(MONETIZATION_PRICE / REVENUE_PRICE)과
 *       판매자 식별자(APP_OWNER_ID / USER_IDENTITY)를 동적으로 불러옵니다.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');

function loadEnvFile() {
    const envPath = path.join(__dirname, '..', '..', '.env');
    if (fs.existsSync(envPath)) {
        const rawContent = fs.readFileSync(envPath, 'utf-8');
        const lines = rawContent.split(/\r?\n/);

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) {
                continue;
            }
            const equalIndex = trimmed.indexOf('=');
            if (equalIndex > 0) {
                const key = trimmed.substring(0, equalIndex).trim();
                const value = trimmed.substring(equalIndex + 1).trim();
                if (!process.env[key]) {
                    process.env[key] = value;
                }
            }
        }
    }
}

function maskSensitiveText(rawText) {
    if (!rawText || typeof rawText !== 'string') {
        return '미설정_플레이스홀더';
    }
    const clean = rawText.trim();
    if (clean.length <= 4) {
        return clean[0] + '***';
    }
    return `${clean.slice(0, 3)}****${clean.slice(-2)}`;
}

function getDynamicConfig() {
    loadEnvFile();

    const rawPrice = process.env.MONETIZATION_PRICE || process.env.REVENUE_PRICE || '2900';
    const parsedPrice = parseInt(rawPrice.replace(/[^0-9]/g, ''), 10);
    const finalPrice = Number.isNaN(parsedPrice) || parsedPrice <= 0 ? 2900 : parsedPrice;

    const rawOwnerId = process.env.APP_OWNER_ID || process.env.USER_IDENTITY || 'TOSS_PARTNER_APP2';
    const rawUserIdentity = process.env.USER_IDENTITY || process.env.APP_OWNER_ID || '이춘학_핀테크랩';
    const rawSettlementAccount = process.env.OWNER_SETTLEMENT_ACCOUNT || '미입력_정산계좌';
    const encryptionKey = process.env.ENCRYPTION_SECRET_KEY || 'default_app2_refund_radar_aes256_key_2026';
    const port = parseInt(process.env.PORT || '3001', 10);

    return {
        monetizationPrice: finalPrice,
        formattedPrice: finalPrice.toLocaleString('ko-KR'),
        rawOwnerId,
        rawUserIdentity,
        rawSettlementAccount,
        maskedOwnerId: maskSensitiveText(rawOwnerId),
        maskedUserIdentity: maskSensitiveText(rawUserIdentity),
        maskedSettlementAccount: maskSensitiveText(rawSettlementAccount),
        encryptionKey,
        port
    };
}

module.exports = {
    loadEnvFile,
    maskSensitiveText,
    getDynamicConfig
};
