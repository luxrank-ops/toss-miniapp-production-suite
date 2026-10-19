/**
 * ============================================================================
 * 파일명: backend/config/envLoader.js
 * 역할: [App Business Evaluator 최우선 결정(Override) 반영]
 *       외부 환경변수(.env) 파일에서 고LTV 연간 VIP 패스 금액(VIP_ANNUAL_PRICE),
 *       장기 무료 체험 기간(TRIAL_DAYS), 보조 스타터 크레딧 팩 금액(MONETIZATION_PRICE),
 *       AI 추론 크레딧 한도(VIP_CREDIT_CAP / STARTER_CREDIT_CAP), 그리고
 *       정산 소유자 식별 정보(APP_OWNER_ID / USER_IDENTITY)를 동적으로 읽어오는 로더입니다.
 * 교육용 설명:
 *   - 코드 내부에 판매 가격이나 개인정보를 직접 하드코딩하지 않습니다.
 *   - 배포 직전 사용자가 .env 파일만 수정하면 서버가 자동으로 새로운 가격과 크레딧 한도,
 *     정산자 정보를 읽어들여 하드 페이월과 결제 검증 로직에 즉시 반영합니다.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');

/**
 * .env 파일을 읽어서 process.env 객체에 주입하는 함수입니다.
 */
function loadDotEnv() {
    const envPath = path.resolve(__dirname, '../../.env');
    if (!fs.existsSync(envPath)) {
        return;
    }

    const rawContent = fs.readFileSync(envPath, 'utf8');
    const lines = rawContent.split(/\r?\n/);

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }
        const equalIndex = trimmed.indexOf('=');
        if (equalIndex === -1) {
            continue;
        }
        const key = trimmed.slice(0, equalIndex).trim();
        const value = trimmed.slice(equalIndex + 1).trim();

        if (key) {
            process.env[key] = value;
        }
    }
}

/**
 * 민감한 식별자 문자열의 가운데 글자를 별표(*)로 가려주는(마스킹) 보안 함수입니다.
 * @param {string} rawText 원본 문자열
 * @returns {string} 마스킹 처리된 안전한 문자열
 */
function maskSensitiveString(rawText) {
    if (!rawText || typeof rawText !== 'string') {
        return 'UNCONFIGURED_OWNER';
    }
    const clean = rawText.trim();
    if (clean.length <= 4) {
        return clean[0] + '***';
    }
    const prefix = clean.slice(0, 3);
    const suffix = clean.slice(-3);
    const maskedMiddle = '*'.repeat(Math.min(clean.length - 6, 8));
    return `${prefix}${maskedMiddle}${suffix}`;
}

/**
 * 현재 설정된 동적 환경변수 구성을 읽어서 반환합니다.
 */
function getDynamicConfig() {
    loadDotEnv();

    // 1순위 주력 상품: 21일 장기 무료 체험 + 연간 VIP 패스 ($62.19 벤치마크 매칭, RLTV 6배 극대화)
    const parsedVipPrice = parseInt(process.env.VIP_ANNUAL_PRICE || '79000', 10);
    const vipAnnualPrice = (!Number.isNaN(parsedVipPrice) && parsedVipPrice > 0) ? parsedVipPrice : 79000;

    // 17~32일 장기 무료 체험 일수 (벤치마크 전환율 42.5%)
    const parsedTrialDays = parseInt(process.env.TRIAL_DAYS || '21', 10);
    const trialDays = (!Number.isNaN(parsedTrialDays) && parsedTrialDays >= 17) ? parsedTrialDays : 21;

    // 2순위 보조(Decoy) 상품: 스타터 크레딧 팩 (process.env.MONETIZATION_PRICE / REVENUE_PRICE 호환)
    const rawStarterPrice = process.env.MONETIZATION_PRICE || process.env.REVENUE_PRICE || '9900';
    const parsedStarterPrice = parseInt(rawStarterPrice, 10);
    const monetizationPrice = (!Number.isNaN(parsedStarterPrice) && parsedStarterPrice > 0) ? parsedStarterPrice : 9900;

    // Thin Wrapper 역마진 방어용 크레딧 한도(Credit Cap)
    const vipCreditCap = parseInt(process.env.VIP_CREDIT_CAP || '100', 10) || 100;
    const starterCreditCap = parseInt(process.env.STARTER_CREDIT_CAP || '30', 10) || 30;

    // 정산 소유자 식별 정보
    const appOwnerId = process.env.APP_OWNER_ID || process.env.USER_IDENTITY || 'DYNAMIC_OWNER_PLACEHOLDER';
    const settlementHolder = process.env.SETTLEMENT_ACCOUNT_HOLDER || '동적정산계좌_미지정';
    const miniappId = process.env.TOSS_MINIAPP_ID || 'toss-miniapp-glow-muse-2026-v4';
    const port = parseInt(process.env.PORT || '3003', 10);

    return {
        appOwnerId,
        appOwnerIdMasked: maskSensitiveString(appOwnerId),
        settlementHolderMasked: maskSensitiveString(settlementHolder),
        vipAnnualPrice,
        formattedVipAnnualPrice: `₩${vipAnnualPrice.toLocaleString('ko-KR')}`,
        monthlyEquivalentFormatted: `월 ₩${Math.round(vipAnnualPrice / 12).toLocaleString('ko-KR')}`,
        trialDays,
        monetizationPrice,
        formattedPrice: `₩${monetizationPrice.toLocaleString('ko-KR')}`,
        vipCreditCap,
        starterCreditCap,
        miniappId,
        port,
        encryptionMasterKey: process.env.ENCRYPTION_MASTER_KEY || ''
    };
}

module.exports = {
    loadDotEnv,
    maskSensitiveString,
    getDynamicConfig
};
