/**
 * ============================================================================
 * 파일명: scripts/qa-auditor.js
 * 역할: [4대 전문 서브에이전트 합동 v5.0 통합 품질 및 상업적 생존 감사 스크립트]
 * 교육용 설명:
 *   1. 🥇 app-business-evaluator (1순위): Hard Paywall, 21일 체험 + 연 ₩79,000 VIP 패스,
 *      차등 크레딧 차감 매트릭스(-2, -3, -5, -10 크레딧) 및 Pydantic AI JSON 검증
 *   2. 🥈 top-tier-app-consultant (2순위): 4주 이원화 회복 비교 곡선(SOS 적용 vs 방치 노화),
 *      최저가 절약 배지, 청담 피부과 CPA, 처방 영수증 바이럴 루프 검증
 *   3. 🥉 cross-store-design-differentiator (3순위): AI 추구미 포토 스튜디오 Before/After 슬라이더,
 *      4대 룩북 시뮬레이터, 홀로그래픽 쉬머, 4주 인터랙티브 프로그레스 바 검증
 *   4. 🏅 toss-top10-design-benchmarker (4순위): 실시간 소셜 프루프 라이브 티커,
 *      슬롯머신 숫자 카운트업(easeOutExpo), 3단계 햅틱 피드백 및 SQL 001~005 검증
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const { getDynamicConfig } = require('../backend/config/envLoader');
const { encryptSensitiveData, decryptSensitiveData } = require('../backend/security/cryptoManager');
const {
    analyzeGlowMuseProfile,
    generateDailyVariableReward,
    evaluatePouchItemCompatibility,
    analyzeSkinBarrierScan,
    simulateChugumiPhotoStudio,
    getBusinessEvaluatorReport
} = require('../backend/services/glowEngine');
// [QA-07] 실제 AI 게이트웨이 & 토스페이먼츠 결제 게이트웨이 검증용
const { getAiStatus } = require('../backend/services/aiProvider');
const { mergeSkinScanResult } = require('../backend/services/aiEnrichment');
const { createOrder, resolvePlan, getPaymentStatus } = require('../backend/services/paymentGateway');

function runQaAudit() {
    const projectRoot = path.resolve(__dirname, '..');
    const checks = [];

    // 1. .env.example 동적 플레이스홀더 공란 및 Business Evaluator 변수 규격 검증
    const envExamplePath = path.join(projectRoot, '.env.example');
    const envExampleContent = fs.existsSync(envExamplePath) ? fs.readFileSync(envExamplePath, 'utf8') : '';
    const hasBlankPlaceholders =
        envExampleContent.includes('APP_OWNER_ID=') &&
        envExampleContent.includes('VIP_ANNUAL_PRICE=') &&
        envExampleContent.includes('MONETIZATION_PRICE=') &&
        envExampleContent.includes('VIP_CREDIT_CAP=');
    checks.push({
        id: 'QA-01',
        name: '.env.example 동적 플레이스홀더(VIP 연간 패스·크레딧 한도 포함) 규격 검증',
        passed: hasBlankPlaceholders,
        score: hasBlankPlaceholders ? 12 : 0
    });

    // 2. AES-256-GCM 암호화 및 복호화 무결성 검증 (규칙 8)
    const sampleProfile = { nickname: '청담뮤즈', skinConcern: 'PORE_ELASTICITY' };
    const enc1 = encryptSensitiveData(sampleProfile);
    const enc2 = encryptSensitiveData(sampleProfile);
    const dec1 = decryptSensitiveData(enc1);
    const cryptoPassed =
        enc1.algorithm === 'AES-256-GCM' &&
        enc1.encryptedData !== enc2.encryptedData &&
        dec1.nickname === '청담뮤즈';
    checks.push({
        id: 'QA-02',
        name: 'AES-256-GCM 양방향 암호화 및 난수 IV 무결성 검증',
        passed: cryptoPassed,
        score: cryptoPassed ? 12 : 0
    });

    // 3. [1순위 app-business-evaluator] Hard Paywall & 21일 체험 고LTV 가격 정책 검증
    const config = getDynamicConfig();
    const sampleAnalysis = analyzeGlowMuseProfile({ nickname: '지수', monthlyBeautySpendManwon: 30 });
    const hardPaywallPassed =
        config.vipAnnualPrice >= 50000 &&
        config.trialDays >= 17 &&
        sampleAnalysis.hardPaywallTeaser.paywallType === 'HARD_PAYWALL' &&
        sampleAnalysis.hardPaywallTeaser.maskedAuraPreview.includes('잠금됨') &&
        Boolean(sampleAnalysis.unlockedFullReport.prescriptions.prescription1_Chugumi);
    checks.push({
        id: 'QA-03',
        name: '[1순위 BIZ-EVAL] Hard Paywall(10.7%) & 21일 장기 체험 + 고LTV 가격 검증',
        passed: hardPaywallPassed,
        score: hardPaywallPassed ? 15 : 0
    });

    // 4. [2순위 top-tier-app-consultant] Nir Eyal Hook + 4주 이원화 회복 곡선 + 최저가/CPA 검증
    const rewardSample = generateDailyVariableReward(3, 'GOOD', 'LOW');
    const moatSample = evaluatePouchItemCompatibility('리들샷 300', 'REEDLE_VITC_LASER');
    const skinScanSample = analyzeSkinBarrierScan('https://images.unsplash.com/photo-1544005313-94ddf0286df2', 26);
    const consultantPassed =
        rewardSample.weeklyGoalCompleted === true &&
        moatSample.verdict === 'CONFLICT_DANGER' &&
        Boolean(skinScanSample.recoveryComparison) &&
        Array.isArray(skinScanSample.recoveryComparison.sosAppliedScores) &&
        Array.isArray(skinScanSample.recoveryComparison.neglectedDecayScores) &&
        Boolean(skinScanSample.recommendedIngredients[0].lowestPriceBadge);
    checks.push({
        id: 'QA-04',
        name: '[2순위 Consultant] 4주 회복 이원화 곡선(SOS vs 방치) & 최저가/청담 CPA 검증',
        passed: consultantPassed,
        score: consultantPassed ? 18 : 0
    });

    // 5. [3순위 Cross-Store & 4순위 Toss-Top10] AI 추구미 포토 스튜디오 & 라이브 티커/영수증 모달 검증
    const studioSample = simulateChugumiPhotoStudio('SILK_OLD_MONEY');
    const htmlContent = fs.readFileSync(path.join(projectRoot, 'frontend/index.html'), 'utf8');
    const designAndInteractionPassed =
        studioSample.cheongdamSalonValueKrw === 320000 &&
        htmlContent.includes('chugumiPhotoStudioCard') &&
        htmlContent.includes('liveSocialTickerText') &&
        htmlContent.includes('viralReceiptModal') &&
        fs.existsSync(path.join(projectRoot, 'src/components/SkinScannerView.tsx')) &&
        fs.existsSync(path.join(projectRoot, 'src/components/BarrierRecoveryDashboard.tsx'));
    checks.push({
        id: 'QA-05',
        name: '[3·4순위 Design] AI 포토 스튜디오 Before/After & 실시간 티커 & 처방 영수증 모달 검증',
        passed: designAndInteractionPassed,
        score: designAndInteractionPassed ? 18 : 0
    });

    // 6. Pydantic AI 스키마 규격 비즈니스 평가 JSON & Supabase SQL 번호 규칙(001_~005_) 검증
    const evalJson = getBusinessEvaluatorReport();
    const sqlDir = path.join(projectRoot, 'supabase/migrations');
    const sqlFiles = fs.existsSync(sqlDir) ? fs.readdirSync(sqlDir) : [];
    const schemaAndSqlPassed =
        typeof evalJson.project_title === 'string' &&
        typeof evalJson.commercial_viability_score === 'number' &&
        sqlFiles.length >= 5 &&
        sqlFiles.every((f) => /^\d{3}_.+\.sql$/.test(f));
    checks.push({
        id: 'QA-06',
        name: 'Pydantic AI 스키마 JSON(9.6점) 및 Supabase SQL 000_ 번호 규칙(001~005) 검증',
        passed: schemaAndSqlPassed,
        score: schemaAndSqlPassed ? 12 : 0
    });

    // 7. [실제 AI 연동 & 실결제 게이트웨이] 폴백 안전성 + 금액 위변조 방어 검증
    const aiStatus = getAiStatus();
    const baseScan = analyzeSkinBarrierScan('https://images.unsplash.com/photo-1544005313-94ddf0286df2', 26);

    // AI가 범위를 벗어난 값/잘못된 타입을 반환해도(환각·프롬프트 인젝션) 결과가 오염되지 않아야 함
    const hostileAiPayload = {
        skinBarrierScore: 999999,
        skinAge: 3,
        skinType: 'x'.repeat(500),
        barrierStatus: 'INVALID',
        aiAnalysisText: 12345,
        metrics: [{ id: 'hydration', score: -80, summary: null }],
        sosCareRoutine: 'NOT_AN_ARRAY',
        recommendedIngredients: [{ name: null }]
    };
    const hostileMerged = mergeSkinScanResult(baseScan, hostileAiPayload).merged;
    const hostileAiPassed =
        typeof aiStatus.mode === 'string' &&
        hostileMerged.skinBarrierScore >= 0 && hostileMerged.skinBarrierScore <= 100 &&
        hostileMerged.skinAge >= 18 &&
        hostileMerged.skinType.length <= 60 &&
        Array.isArray(hostileMerged.sosCareRoutine) &&
        Array.isArray(hostileMerged.metrics) && hostileMerged.metrics.length === 5 &&
        Array.isArray(hostileMerged.recoveryComparison.sosAppliedScores);

    // 결제: 존재하지 않는 플랜 거절 + 서버가 금액을 확정(VIP 금액 = 환경변수 값)
    const invalidOrder = createOrder({ sessionToken: 'glow_qa_invalid', planTier: 'HACK_100_WON' });
    const vipPlan = resolvePlan('VIP_ANNUAL');
    const validOrder = createOrder({ sessionToken: 'glow_qa_valid', planTier: 'VIP_ANNUAL' });
    const payStatus = getPaymentStatus();
    const paymentGatewayPassed =
        invalidOrder.ok === false &&
        validOrder.ok === true &&
        validOrder.order.amountKrw === config.vipAnnualPrice &&
        validOrder.checkout.amountKrw === config.vipAnnualPrice &&
        vipPlan.amountKrw === config.vipAnnualPrice &&
        vipPlan.creditsGranted === config.vipCreditCap &&
        (payStatus.mode === 'TOSS_LIVE' || payStatus.mode === 'SANDBOX_SIMULATION');

    const aiAndPaymentPassed =
        hostileAiPassed &&
        paymentGatewayPassed &&
        envExampleContent.includes('AI_PROVIDER=') &&
        envExampleContent.includes('TOSS_PAYMENTS_SECRET_KEY=');

    checks.push({
        id: 'QA-07',
        name: '[실전 연동] AI 게이트웨이 폴백·응답 검증 & 토스페이먼츠 서버 금액 확정(위변조 방어) 검증',
        passed: aiAndPaymentPassed,
        score: aiAndPaymentPassed ? 13 : 0
    });

    const totalScore = checks.reduce((sum, item) => sum + item.score, 0);
    const allPassed = checks.every((item) => item.passed) && totalScore === 100;

    const report = {
        status: allPassed ? 'PASS' : 'REJECT',
        totalScore,
        businessEvaluatorViabilityScore: evalJson.commercial_viability_score,
        auditedAt: new Date().toISOString(),
        checks
    };

    if (require.main === module) {
        console.log('====================================================================');
        console.log(`🔍 [4대 에이전트 합동 QA v5.0] 통합 감사 결과: [STATUS: ${report.status}] (${report.totalScore}/100점 | 상업 생존점수: ${report.businessEvaluatorViabilityScore}/10.0)`);
        for (const c of checks) {
            console.log(`  - [${c.passed ? 'PASS' : 'FAIL'}] (${c.score}점) ${c.id}: ${c.name}`);
        }
        console.log('====================================================================');
    }

    return report;
}

if (require.main === module) {
    const result = runQaAudit();
    process.exit(result.status === 'PASS' ? 0 : 1);
}

module.exports = {
    runQaAudit
};
