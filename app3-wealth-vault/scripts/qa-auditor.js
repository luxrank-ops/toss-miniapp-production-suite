/**
 * ============================================================================
 * 파일명: app3-wealth-vault/scripts/qa-auditor.js
 * 역할: [제3호 앱 AGENT 6: QA & Code Auditor v3.0] 웰스볼트 AI 품질·보안·차별화 디자인 검수기
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const { getDynamicConfig } = require('../backend/config/envLoader');
const {
    encryptPersonalData,
    decryptPersonalData
} = require('../backend/security/cryptoManager');
const {
    analyzeWealthPortfolio,
    verifyWealthPaymentAndUnlock
} = require('../backend/services/wealthEngine');

function runQaAudit() {
    const projectRoot = path.join(__dirname, '..');
    const checks = [];

    // [QA-01] .env.example 플레이스홀더 검증
    const envExamplePath = path.join(projectRoot, '.env.example');
    const envExampleText = fs.existsSync(envExamplePath)
        ? fs.readFileSync(envExamplePath, 'utf-8')
        : '';
    const hasPlaceholders =
        envExampleText.includes('APP_OWNER_ID=') &&
        envExampleText.includes('USER_IDENTITY=') &&
        envExampleText.includes('MONETIZATION_PRICE=') &&
        envExampleText.includes('REVENUE_PRICE=');

    checks.push({
        id: 'QA-01',
        title: '[웰스볼트 AI] 동적 환경변수 템플릿(.env.example) 설계 검증',
        passed: hasPlaceholders,
        detail: 'APP_OWNER_ID, USER_IDENTITY, MONETIZATION_PRICE, REVENUE_PRICE 공란 템플릿 확인'
    });

    // [QA-02] Supabase SQL 000_ 번호 규칙 검증
    const migrationDir = path.join(projectRoot, 'supabase', 'migrations');
    const sqlFiles = fs.existsSync(migrationDir)
        ? fs.readdirSync(migrationDir).filter((f) => f.endsWith('.sql'))
        : [];
    const allNumbered = sqlFiles.length >= 2 && sqlFiles.every((f) => /^\d{3}_/.test(f));

    checks.push({
        id: 'QA-02',
        title: '[웰스볼트 AI] Supabase 마이그레이션 폴더 및 000_ 번호 명명 규칙 검증',
        passed: allNumbered,
        detail: `SQL 파일 확인: ${sqlFiles.join(', ')}`
    });

    // [QA-03] 5대 자산 & 2대 소득 데이터 AES-256-GCM 양방향 암호화 검증
    const sampleWealth = { userName: '이춘학', bankAssetMan: 6500, rentalIncomeMonthlyMan: 120 };
    const enc = encryptPersonalData(sampleWealth);
    const dec = decryptPersonalData(enc);
    const cryptoOk =
        enc.algorithm === 'AES-256-GCM' &&
        !enc.encryptedText.includes('이춘학') &&
        dec.bankAssetMan === 6500;

    checks.push({
        id: 'QA-03',
        title: '[웰스볼트 AI] 개인 재산·소득 데이터 AES-256-GCM 양방향 암호화 무결성 검증',
        passed: cryptoOk,
        detail: `암호문 샘플: ${enc.encryptedText.substring(0, 28)}... (평문 노출 0건)`
    });

    // [QA-04] 5대 자산 + 2대 소득 무료 진단 & 위변조 결제 차단 & 정가 결제 복호화 검증
    const config = getDynamicConfig();
    const preview = analyzeWealthPortfolio({
        userName: '김자산',
        bankAssetMan: 6500,
        stockAssetMan: 8500,
        realEstateAssetMan: 45000,
        movableAssetMan: 3500,
        insuranceMonthlyMan: 48,
        financialIncomeYearlyMan: 1650,
        rentalIncomeMonthlyMan: 120
    });

    let tamperBlocked = false;
    try {
        verifyWealthPaymentAndUnlock({
            portfolioId: preview.portfolioId,
            paidAmount: 100
        });
    } catch {
        tamperBlocked = true;
    }

    const unlockResult = verifyWealthPaymentAndUnlock({
        portfolioId: preview.portfolioId,
        paidAmount: config.monetizationPrice
    });

    const paymentOk =
        preview.freeSummary.totalNetWorthMan > 0 &&
        tamperBlocked &&
        unlockResult.status === 'PASS' &&
        unlockResult.unlockedPremiumReport.sections.length === 4;

    checks.push({
        id: 'QA-04',
        title: '[웰스볼트 AI] 5대 재산·2대 소득 분석, 위변조 차단 및 정가 결제 복호화 검증',
        passed: paymentOk,
        detail: `순자산(${preview.freeSummary.formattedNetWorth}) 산출 및 정가(${config.formattedPrice}원) 결제 시 4대 처방전 복호화 완료`
    });

    // [QA-05] AGENT 2-DIFF 구글 스토어·아이폰 차별화 디자인 6대 요소 적용 검증
    const htmlPath = path.join(projectRoot, 'frontend', 'index.html');
    const cssPath = path.join(projectRoot, 'frontend', 'styles', 'tds-wealth.css');
    const jsPath = path.join(projectRoot, 'frontend', 'js', 'app.js');
    const htmlText = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf-8') : '';
    const cssText = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf-8') : '';
    const jsText = fs.existsSync(jsPath) ? fs.readFileSync(jsPath, 'utf-8') : '';

    const hasDifferentiatedDesign =
        htmlText.includes('dynamic-island-pill') &&
        htmlText.includes('bento-dashboard-grid') &&
        htmlText.includes('allocation-stack-bar') &&
        htmlText.includes('themeToggleBtn') &&
        cssText.includes('holographicSweep') &&
        cssText.includes('[data-theme="dark"]') &&
        jsText.includes('toggleGlassTheme') &&
        jsText.includes('initDynamicIsland');

    checks.push({
        id: 'QA-05',
        title: '[AGENT 2-DIFF] 구글 플레이(Material Expressive) × 아이폰(Dynamic Island/Bento/Liquid Glass) 차별화 디자인 검증',
        passed: hasDifferentiatedDesign,
        detail: 'Dynamic Island 캡슐, Apple Bento Grid, 5대 자산 스택바, Spatial Liquid Glass, Holographic Shimmer, Dark Mode 확인'
    });

    const allPassed = checks.every((c) => c.passed);
    const status = allPassed ? 'PASS' : 'REJECT';

    console.log('====================================================================');
    console.log(`🔍 [제3호 앱 AGENT 6: QA & Code Auditor v3.0] 검수 결과: [STATUS: ${status}]`);
    console.log('====================================================================');
    for (const c of checks) {
        console.log(`${c.passed ? '✅' : '❌'} [${c.id}] ${c.title}`);
        console.log(`   └─ ${c.detail}`);
    }
    console.log('====================================================================');

    return {
        status,
        score: allPassed ? 100 : 40,
        checks,
        auditedAt: new Date().toISOString()
    };
}

if (require.main === module) {
    const res = runQaAudit();
    if (res.status !== 'PASS') {
        process.exit(1);
    }
}

module.exports = {
    runQaAudit
};
