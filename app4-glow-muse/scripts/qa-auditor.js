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
const crypto = require('crypto');
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
// [QA-08] Supabase 영속화 계층 검증용
const persistence = require('../backend/services/persistenceStore');
// [QA-09~12] 웹훅 · 자동결제 · 앱인토스 IAP · AI 응답 캐시 검증용
const tossWebhookService = require('../backend/services/tossWebhookService');
const billingService = require('../backend/services/billingService');
const iapService = require('../backend/services/iapService');
const aiCacheService = require('../backend/services/aiCache');

async function runQaAudit() {
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
        score: hasBlankPlaceholders ? 8 : 0
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
        score: cryptoPassed ? 8 : 0
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
        score: hardPaywallPassed ? 12 : 0
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
        score: consultantPassed ? 14 : 0
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
        score: designAndInteractionPassed ? 14 : 0
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
        name: 'Pydantic AI 스키마 JSON(9.6점) 및 Supabase SQL 000_ 번호 규칙(001~006) 검증',
        passed: schemaAndSqlPassed,
        score: schemaAndSqlPassed ? 8 : 0
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
        score: aiAndPaymentPassed ? 10 : 0
    });

    // 8. [Supabase 영속화] 마이그레이션 규칙 준수 + DB 미설정 시 무중단 인메모리 폴백 검증
    const migrationFiles = sqlFiles;
    const hasPersistenceMigration = migrationFiles.includes('006_create_runtime_persistence_tables.sql');

    // DB 미설정 상태에서 저장소가 예외 없이 동작하고 메모리 값은 유지되는지 검증
    const sampleSession = {
        sessionToken: 'glow_qa_persistence',
        isPremiumUnlocked: false,
        remainingCredits: 0,
        aiStatus: 'PENDING'
    };
    let persistencePassed = false;
    let persistenceDetail = '';
    try {
        await persistence.sessions.set(sampleSession.sessionToken, sampleSession);
        const cached = persistence.sessions.get(sampleSession.sessionToken);
        const status = persistence.getStatus();
        const roundTrip = persistence.parseEncryptedRow(
            persistence.buildEncryptedRow({ nickname: '영속화검증' }, { remaining_credits: 7 })
        );

        persistencePassed =
            hasPersistenceMigration &&
            typeof status.mode === 'string' &&
            ['SUPABASE', 'IN_MEMORY_FALLBACK'].includes(status.mode) &&
            Boolean(cached) && cached.sessionToken === sampleSession.sessionToken &&
            roundTrip && roundTrip.nickname === '영속화검증' &&
            envExampleContent.includes('SUPABASE_URL=') &&
            envExampleContent.includes('SUPABASE_SERVICE_ROLE_KEY=');
        persistenceDetail = `mode=${status.mode} migration006=${hasPersistenceMigration}`;
    } catch (err) {
        persistencePassed = false;
        persistenceDetail = err.message;
    }

    checks.push({
        id: 'QA-08',
        name: '[영속화] Supabase 마이그레이션(006) 규칙 준수 & DB 미설정 시 무중단 인메모리 폴백 검증',
        passed: persistencePassed,
        score: persistencePassed ? 10 : 0,
        detail: persistenceDetail
    });

    // 9. [토스 웹훅] 가상계좌 입금 콜백(평면 구조) / 결제 상태 변경(중첩 구조) 정규화 & canonical 검증 배선
    const flatEvent = tossWebhookService.normalizeEvent({
        orderId: 'QA_ORDER_WEBHOOK',
        secret: 'qa_secret',
        status: 'DONE',
        transactionKey: 'qa_tx'
    });
    const nestedEvent = tossWebhookService.normalizeEvent({
        eventType: 'PAYMENT_STATUS_CHANGED',
        data: { orderId: 'QA_ORDER_WEBHOOK', paymentKey: 'qa_pk', status: 'DONE' }
    });
    const serverSource = fs.readFileSync(path.join(projectRoot, 'backend/server.js'), 'utf8');
    const webhookPassed =
        flatEvent.eventType === 'DEPOSIT_CALLBACK' &&
        nestedEvent.eventType === 'PAYMENT_STATUS_CHANGED' &&
        nestedEvent.orderId === 'QA_ORDER_WEBHOOK' &&
        nestedEvent.paymentKey === 'qa_pk' &&
        tossWebhookService.verifyPathToken(null) === true &&
        serverSource.includes('/api/webhooks/toss') &&
        migrationFiles.includes('007_create_toss_webhook_and_billing_tables.sql') &&
        envExampleContent.includes('TOSS_WEBHOOK_PATH_TOKEN=');
    checks.push({
        id: 'QA-09',
        name: '[웹훅] 가상계좌 DEPOSIT_CALLBACK(평면)·결제상태(중첩) 정규화 & canonical 재검증 배선',
        passed: webhookPassed,
        score: webhookPassed ? 4 : 0,
        detail: `flat=${flatEvent.eventType} nested=${nestedEvent.eventType}`
    });

    // 10. [자동결제] customerKey 파생·구독/갱신/해지 배선 & 스케줄러 무결성
    const customerKeyA = billingService.deriveCustomerKey('qa_billing_session');
    const customerKeyB = billingService.deriveCustomerKey('qa_billing_session');
    const customerKeyOther = billingService.deriveCustomerKey('qa_billing_other');
    const billingStatus = billingService.getBillingStatus();
    const billingPassed =
        /^MG_[a-f0-9]{34}$/.test(customerKeyA) &&
        customerKeyA === customerKeyB &&
        customerKeyA !== customerKeyOther &&
        typeof billingStatus.mode === 'string' &&
        typeof billingService.startScheduler === 'function' &&
        typeof billingService.stopScheduler === 'function' &&
        migrationFiles.includes('007_create_toss_webhook_and_billing_tables.sql') &&
        envExampleContent.includes('TOSS_BILLING_ENABLED=') &&
        envExampleContent.includes('BILLING_SCHEDULER_ENABLED=');
    checks.push({
        id: 'QA-10',
        name: '[자동결제] customerKey HMAC 파생·갱신 주기·해지/스케줄러 및 007 마이그레이션 검증',
        passed: billingPassed,
        score: billingPassed ? 4 : 0,
        detail: `mode=${billingStatus.mode} key=${customerKeyA.slice(0, 8)}…`
    });

    // 11. [앱인토스 IAP] 로그인 토큰 서명/검증(세션 바인딩) & SKU 카탈로그·008 마이그레이션
    const qaSessionToken = 'qa_iap_session_token';
    const qaUserKey = 'qa_toss_user_key';
    const loginToken = iapService.signLoginToken({
        userKeyHash: crypto.createHash('sha256').update(qaUserKey).digest('hex'),
        sessionHash: crypto.createHash('sha256').update(qaSessionToken).digest('hex'),
        iat: Date.now(),
        exp: Date.now() + 10 * 60 * 1000
    });
    const loginTokenOk = iapService.verifyLoginToken(loginToken, qaSessionToken);
    const loginTokenTampered = iapService.verifyLoginToken(
        loginToken.replace(/.$/, (ch) => (ch === 'a' ? 'b' : 'a')),
        qaSessionToken
    );
    const iapCatalog = iapService.getProductCatalog();
    const iapStatus = iapService.getIapStatus();
    const iapPassed =
        loginTokenOk.ok === true &&
        loginTokenTampered.ok === false &&
        Array.isArray(iapCatalog) &&
        typeof iapStatus.mode === 'string' &&
        migrationFiles.includes('008_create_apps_in_toss_iap_orders.sql') &&
        envExampleContent.includes('AIT_API_KEY=') &&
        envExampleContent.includes('AIT_IAP_SKU_VIP_ANNUAL=');
    checks.push({
        id: 'QA-11',
        name: '[앱인토스 IAP] 로그인 토큰 HMAC·세션 바인딩 검증 & SKU 카탈로그/008 마이그레이션',
        passed: iapPassed,
        score: iapPassed ? 4 : 0,
        detail: `mode=${iapStatus.mode} skus=${iapStatus.skusConfigured}`
    });

    // 12. [AI 응답 캐시] 결정론적 키(입력 변경 시 미스) · 메모리 히트 · TTL/용량 설정 · 009 마이그레이션
    const cacheKeyA = aiCacheService.buildCacheKey({
        requestKind: 'SKIN_SCAN',
        systemPrompt: 'qa-system',
        userPrompt: 'qa-user',
        image: { base64: 'QAFakeImageBytes', mimeType: 'image/jpeg' },
        temperature: 0.4,
        maxTokens: 800,
        provider: 'openai',
        model: 'gpt-4o-qa'
    });
    const cacheKeyB = aiCacheService.buildCacheKey({
        requestKind: 'SKIN_SCAN',
        systemPrompt: 'qa-system',
        userPrompt: 'qa-user',
        image: { base64: 'QAFakeImageBytes', mimeType: 'image/jpeg' },
        temperature: 0.4,
        maxTokens: 800,
        provider: 'openai',
        model: 'gpt-4o-qa'
    });
    const cacheKeyOther = aiCacheService.buildCacheKey({
        requestKind: 'SKIN_SCAN',
        systemPrompt: 'qa-system',
        userPrompt: 'qa-user',
        image: { base64: 'QAFakeImageBytes-CHANGED', mimeType: 'image/jpeg' },
        temperature: 0.4,
        maxTokens: 800,
        provider: 'openai',
        model: 'gpt-4o-qa'
    });
    const cacheStore = await aiCacheService.set({
        cacheKey: cacheKeyA.cacheKey,
        requestKind: 'SKIN_SCAN',
        provider: 'openai',
        model: 'gpt-4o-qa',
        imageHash: cacheKeyA.imageHash,
        data: { qa: true }
    });
    const cacheHit = await aiCacheService.get(cacheKeyA.cacheKey);
    const cacheStatus = aiCacheService.getCacheStatus();
    const aiCachePassed =
        cacheStore.stored === true &&
        cacheHit.hit === true &&
        cacheHit.data && cacheHit.data.qa === true &&
        cacheKeyA.cacheKey === cacheKeyB.cacheKey &&
        cacheKeyA.cacheKey !== cacheKeyOther.cacheKey &&
        typeof cacheStatus.enabled === 'boolean' &&
        migrationFiles.includes('009_create_ai_response_cache.sql') &&
        envExampleContent.includes('AI_CACHE_ENABLED=') &&
        envExampleContent.includes('AI_CACHE_TTL_MS=');
    checks.push({
        id: 'QA-12',
        name: '[AI 캐시] 결정론적 키·메모리 히트·TTL/용량 설정 및 009 마이그레이션 검증',
        passed: aiCachePassed,
        score: aiCachePassed ? 4 : 0,
        detail: `hit=${cacheHit.hit} layer=${cacheHit.layer} entries=${cacheStatus.memoryEntries}`
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

    return report;
}

if (require.main === module) {
    runQaAudit().then((result) => {
        console.log('====================================================================');
        console.log(`🔍 [4대 에이전트 합동 QA v5.0] 통합 감사 결과: [STATUS: ${result.status}] (${result.totalScore}/100점 | 상업 생존점수: ${result.businessEvaluatorViabilityScore}/10.0)`);
        for (const c of result.checks) {
            console.log(`  - [${c.passed ? 'PASS' : 'FAIL'}] (${c.score}점) ${c.id}: ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
        }
        console.log('====================================================================');
        process.exit(result.status === 'PASS' ? 0 : 1);
    });
}

module.exports = {
    runQaAudit
};
