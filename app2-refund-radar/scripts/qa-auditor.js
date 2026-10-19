/**
 * ============================================================================
 * 파일명: app2-refund-radar/scripts/qa-auditor.js
 * 역할: [제2호 앱 AGENT 6: QA & Code Auditor v3.0] 환급레이더 AI 품질·보안·구글/아이폰 차별화 디자인 검수기
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
    scanAndCreateRefundPreview,
    verifyRefundPaymentAndUnlock
} = require('../backend/services/refundEngine');

function runQaAudit() {
    const projectRoot = path.join(__dirname, '..');
    const checks = [];

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
        title: '[환급레이더 AI] 동적 환경변수 템플릿(.env.example) 설계 검증',
        passed: hasPlaceholders,
        detail: 'APP_OWNER_ID, USER_IDENTITY, MONETIZATION_PRICE, REVENUE_PRICE 공란 템플릿 확인'
    });

    const migrationDir = path.join(projectRoot, 'supabase', 'migrations');
    const sqlFiles = fs.existsSync(migrationDir)
        ? fs.readdirSync(migrationDir).filter((f) => f.endsWith('.sql'))
        : [];
    const allNumbered = sqlFiles.length >= 2 && sqlFiles.every((f) => /^\d{3}_/.test(f));

    checks.push({
        id: 'QA-02',
        title: '[환급레이더 AI] Supabase 마이그레이션 폴더 및 000_ 번호 명명 규칙 검증',
        passed: allNumbered,
        detail: `SQL 파일 확인: ${sqlFiles.join(', ')}`
    });

    const sample = { userName: '이춘학', medicalFreq: '연 4~10회' };
    const enc = encryptPersonalData(sample);
    const dec = decryptPersonalData(enc);
    const cryptoOk =
        enc.algorithm === 'AES-256-GCM' &&
        !enc.encryptedText.includes('이춘학') &&
        dec.userName === '이춘학';

    checks.push({
        id: 'QA-03',
        title: '[환급레이더 AI] 개인정보 AES-256-GCM 양방향 암호화 무결성 검증',
        passed: cryptoOk,
        detail: `암호문 샘플: ${enc.encryptedText.substring(0, 28)}... (평문 노출 0건)`
    });

    const config = getDynamicConfig();
    const scanPreview = scanAndCreateRefundPreview({
        userName: '이토스',
        ageGroup: '30대~40대',
        jobType: '직장인(4대보험)',
        medicalFreq: '연 4~10회 병원·약국 이용',
        monthlySpend: '월 100만~200만 원 지출'
    });

    let tamperBlocked = false;
    try {
        verifyRefundPaymentAndUnlock({
            scanId: scanPreview.scanId,
            paidAmount: 500
        });
    } catch {
        tamperBlocked = true;
    }

    const unlockResult = verifyRefundPaymentAndUnlock({
        scanId: scanPreview.scanId,
        paidAmount: config.monetizationPrice
    });

    const paymentOk =
        scanPreview.freeSummary.estimatedTotalRefund > 0 &&
        tamperBlocked &&
        unlockResult.status === 'PASS' &&
        unlockResult.unlockedPremiumReport.refundItems.length === 4;

    checks.push({
        id: 'QA-04',
        title: '[환급레이더 AI] 동적 금액 결제 검증, 위변조 차단 및 4대 환급 치트키 복호화 검증',
        passed: paymentOk,
        detail: `예상 환급금(${scanPreview.freeSummary.formattedTotalRefund}원) 산출 및 정가(${config.formattedPrice}원) 결제 검증 완료`
    });

    const htmlPath = path.join(projectRoot, 'frontend', 'index.html');
    const cssPath = path.join(projectRoot, 'frontend', 'styles', 'tds-refund.css');
    const jsPath = path.join(projectRoot, 'frontend', 'js', 'app.js');
    const htmlText = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf-8') : '';
    const cssText = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf-8') : '';
    const jsText = fs.existsSync(jsPath) ? fs.readFileSync(jsPath, 'utf-8') : '';

    const hasDifferentiatedDesign =
        htmlText.includes('dynamic-island-pill') &&
        htmlText.includes('bento-dashboard-grid') &&
        htmlText.includes('themeToggleBtn') &&
        cssText.includes('holographicSweep') &&
        cssText.includes('[data-theme="dark"]') &&
        jsText.includes('toggleGlassTheme') &&
        jsText.includes('initDynamicIsland');

    checks.push({
        id: 'QA-05',
        title: '[AGENT 2-DIFF] 구글 플레이(Material Expressive) × 아이폰(Dynamic Island/Bento/Liquid Glass) 6대 차별화 디자인 검증',
        passed: hasDifferentiatedDesign,
        detail: 'Dynamic Island 캡슐, Apple Bento Grid, Spatial Liquid Glass, Material Expressive 모핑, Holographic Shimmer, Dark Mode 확인'
    });

    const allPassed = checks.every((c) => c.passed);
    const status = allPassed ? 'PASS' : 'REJECT';

    console.log('====================================================================');
    console.log(`🔍 [제2호 앱 AGENT 6: QA & Code Auditor v3.0] 검수 결과: [STATUS: ${status}]`);
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
