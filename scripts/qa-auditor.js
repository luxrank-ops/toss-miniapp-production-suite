/**
 * ============================================================================
 * 파일명: scripts/qa-auditor.js
 * 역할: [AGENT 6: QA & Code Auditor] 유료 미니앱 품질·보안·구글/아이폰 차별화 디자인 검수기 (v3.0)
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
    analyzeAndCreatePreview,
    verifyPaymentAndUnlock
} = require('../backend/services/miniAppEngine');

function runQaAudit() {
    const projectRoot = path.join(__dirname, '..');
    const checks = [];

    const envExamplePath = path.join(projectRoot, '.env.example');
    const hasEnvExample = fs.existsSync(envExamplePath);
    const envExampleText = hasEnvExample ? fs.readFileSync(envExamplePath, 'utf-8') : '';
    const hasOwnerPlaceholder =
        envExampleText.includes('APP_OWNER_ID=') && envExampleText.includes('USER_IDENTITY=');
    const hasPricePlaceholder =
        envExampleText.includes('MONETIZATION_PRICE=') && envExampleText.includes('REVENUE_PRICE=');

    checks.push({
        id: 'QA-01',
        title: '사용자 동적 환경변수 템플릿(.env.example) 설계 검증',
        passed: hasEnvExample && hasOwnerPlaceholder && hasPricePlaceholder,
        detail: 'APP_OWNER_ID, USER_IDENTITY, MONETIZATION_PRICE, REVENUE_PRICE 공란 템플릿 확인 완료'
    });

    const migrationDir = path.join(projectRoot, 'supabase', 'migrations');
    const sqlFiles = fs.existsSync(migrationDir)
        ? fs.readdirSync(migrationDir).filter((f) => f.endsWith('.sql'))
        : [];
    const allNumbered = sqlFiles.length >= 2 && sqlFiles.every((f) => /^\d{3}_/.test(f));

    checks.push({
        id: 'QA-02',
        title: 'Supabase 마이그레이션 폴더 및 000_ 번호 명명 규칙 준수 검증',
        passed: allNumbered,
        detail: `발견된 SQL 파일: ${sqlFiles.join(', ')}`
    });

    const sampleSensitive = { name: '이춘학', birth: '1992-10-18' };
    const encryptedPkg = encryptPersonalData(sampleSensitive);
    const decryptedObj = decryptPersonalData(encryptedPkg);
    const cryptoPassed =
        encryptedPkg.algorithm === 'AES-256-GCM' &&
        !encryptedPkg.encryptedText.includes('이춘학') &&
        !encryptedPkg.encryptedText.includes('1992-10-18') &&
        decryptedObj.name === '이춘학';

    checks.push({
        id: 'QA-03',
        title: '개인정보 AES-256-GCM 양방향 암호화 및 평문 마스킹 무결성 검증',
        passed: cryptoPassed,
        detail: `암호문 샘플: ${encryptedPkg.encryptedText.substring(0, 28)}... (평문 노출 0건)`
    });

    const config = getDynamicConfig();
    const preview = analyzeAndCreatePreview({
        userName: '홍길동',
        birthDate: '1996-05-15',
        birthHour: '오시(11:30~13:29)',
        gender: 'female',
        concernTopic: '주식·투자 타이밍',
        appCategory: 'MZ_SAJU'
    });

    let tamperBlocked = false;
    try {
        verifyPaymentAndUnlock({
            requestId: preview.requestId,
            paidAmount: 100
        });
    } catch {
        tamperBlocked = true;
    }

    const unlockResult = verifyPaymentAndUnlock({
        requestId: preview.requestId,
        paidAmount: config.monetizationPrice
    });

    const paymentFlowPassed =
        preview.paywallTeaser.isLocked === true &&
        tamperBlocked === true &&
        unlockResult.status === 'PASS' &&
        unlockResult.unlockedPremiumReport.dangerDays.length === 3 &&
        unlockResult.unlockedPremiumReport.luckyDays.length === 3;

    checks.push({
        id: 'QA-04',
        title: '동적 금액 결제 검증, 위변조 차단 및 프리미엄 리포트 잠금 해제 검증',
        passed: paymentFlowPassed,
        detail: `위변조(100원) 차단 성공 및 정가(${config.formattedPrice}원) 결제 시 프리미엄 날짜 6건 복호화 완료`
    });

    const htmlPath = path.join(projectRoot, 'frontend', 'index.html');
    const cssPath = path.join(projectRoot, 'frontend', 'styles', 'tds-theme.css');
    const jsPath = path.join(projectRoot, 'frontend', 'js', 'app.js');
    const frontendExists =
        fs.existsSync(htmlPath) && fs.existsSync(cssPath) && fs.existsSync(jsPath);

    const htmlContent = frontendExists ? fs.readFileSync(htmlPath, 'utf-8') : '';
    const cssContent = frontendExists ? fs.readFileSync(cssPath, 'utf-8') : '';
    const jsContent = frontendExists ? fs.readFileSync(jsPath, 'utf-8') : '';

    // [QA-05] AGENT 2-DIFF: 토스 Top 10 클리셰 탈피 & 구글 스토어(Material Expressive) + 아이폰(iOS Spatial/Bento/Dynamic Island) 차별화 디자인 검증
    const hasDifferentiatedDesign =
        htmlContent.includes('dynamic-island-pill') &&
        htmlContent.includes('bento-dashboard-grid') &&
        htmlContent.includes('themeToggleBtn') &&
        cssContent.includes('holographicSweep') &&
        cssContent.includes('[data-theme="dark"]') &&
        jsContent.includes('toggleGlassTheme') &&
        jsContent.includes('initDynamicIsland');

    checks.push({
        id: 'QA-05',
        title: '[AGENT 2-DIFF] 구글 플레이(Material Expressive) × 아이폰(Dynamic Island/Bento/Liquid Glass) 6대 차별화 디자인 검증',
        passed: hasDifferentiatedDesign,
        detail: 'Dynamic Island 캡슐, Apple Bento Grid, Spatial Liquid Glass, Material Expressive 모핑, Holographic Shimmer, Dark Mode 확인'
    });

    const allPassed = checks.every((c) => c.passed);
    const status = allPassed ? 'PASS' : 'REJECT';

    console.log('====================================================================');
    console.log(`🔍 [AGENT 6: QA & Code Auditor v3.0] 최종 품질 및 차별화 디자인 검수: [STATUS: ${status}]`);
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
    const result = runQaAudit();
    if (result.status !== 'PASS') {
        process.exit(1);
    }
}

module.exports = {
    runQaAudit
};
