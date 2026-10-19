/**
 * ============================================================================
 * 파일명: backend/server.js
 * 역할: [MuseGlow AI v5.0 - 4대 전문 서브에이전트 합동 협업 백엔드 서버]
 * 교육용 설명:
 *   1. 🥇 1순위 app-business-evaluator (Supreme Override):
 *      - 전면 Hard Paywall (전환율 10.7%): /api/glow/diagnose 호출 시 미결제 유저에게는
 *        핵심 결과를 차단하고 '연간 예상 호구 손실액 경고 티저'만 반환합니다.
 *      - 21일 장기 무료 체험(전환율 42.5%) + 연간 VIP 패스(79,000원, 100 크레딧) & 스타터 팩(9,900원, 30 크레딧)
 *      - 차등 크레딧 차감 매트릭스(Credit Deduction Matrix):
 *        정밀 진단(-10), 데일리 가변 보상 체크인(-2, 3회 달성 시 +15 보너스),
 *        정밀 피부 장벽 시계열 재스캔(-3), 파우치 상극 DB 스캔(-5), AI 추구미 포토 스튜디오 생성(-10)
 *   2. 🥈 2순위 top-tier-app-consultant:
 *      - 4주 회복 이원화 곡선(SOS 적용 vs 방치 시 노화 가속), 올리브영/청담 피부과 CPA 수익 로깅,
 *        인스타/카톡 '청담 추구미 처방 영수증' 공유 시 +3 크레딧 리워드
 *   3. 🥉 3순위 cross-store-design-differentiator & 🏅 4순위 toss-top10-design-benchmarker:
 *      - AI 피부 장벽 스캐너(/api/skin/scan) 및 AI 포토 스튜디오 4대 룩북 연동
 * ============================================================================
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { getDynamicConfig } = require('./config/envLoader');
const { encryptSensitiveData, decryptSensitiveData } = require('./security/cryptoManager');
const {
    analyzeGlowMuseProfile,
    generateDailyVariableReward,
    evaluatePouchItemCompatibility,
    analyzeSkinBarrierScan,
    simulateChugumiPhotoStudio,
    getBusinessEvaluatorReport
} = require('./services/glowEngine');
// [실제 AI 연동] LLM/Vision 게이트웨이 & 프롬프트·병합 계층
const { getAiStatus } = require('./services/aiProvider');
const { runAiSkinScan, runAiReport } = require('./services/aiEnrichment');
// [실제 결제 연동] 토스페이먼츠 주문 생성·승인·취소 게이트웨이
const {
    createOrder,
    confirmPayment,
    cancelPayment,
    getOrder,
    getRawOrder,
    markOrderPaid,
    getPaymentStatus,
    resolvePlan,
    ORDER_STATUS
} = require('./services/paymentGateway');

// 인메모리 보안 원장 (Supabase 001~005 테이블과 1:1 매핑)
const encryptedDiagnosisStore = new Map();
const paymentLedgerStore = new Map();
const encryptedSkinScanStore = new Map();
const encryptedPhotoStudioStore = new Map();

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon'
};

function sendJson(res, statusCode, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end(body);
}

function parseJsonBody(req) {
    return new Promise((resolve, reject) => {
        let raw = '';
        req.on('data', (chunk) => {
            raw += chunk.toString('utf8');
            if (raw.length > 8 * 1e6) {
                reject(new Error('요청 데이터 크기가 너무 큽니다.'));
            }
        });
        req.on('end', () => {
            if (!raw) {
                resolve({});
                return;
            }
            try {
                resolve(JSON.parse(raw));
            } catch (err) {
                reject(new Error('올바르지 않은 JSON 형식입니다.'));
            }
        });
        req.on('error', reject);
    });
}

/**
 * [AI 리포트 대기 헬퍼]
 * 온보딩 진단 시 백그라운드에서 미리 생성 중인 AI 리포트를 최대 timeoutMs 동안 대기합니다.
 * - 이미 생성 완료 → 즉시 반환
 * - 시간 초과/실패 → 결정론적 기본 리포트 반환 (사용자를 절대 대기시키지 않음)
 * @param {Object} record 진단 세션 레코드
 * @param {number} timeoutMs 최대 대기 시간
 */
async function waitForAiEnrichment(record, timeoutMs = 12000) {
    if (record.aiEnrichment) {
        return record.aiEnrichment;
    }

    const fallbackEnrichment = {
        report: decryptSensitiveData(record.encryptedFullReport),
        aiMeta: { applied: false, fallbackUsed: true }
    };

    if (!record.aiEnrichmentPromise) {
        return fallbackEnrichment;
    }

    const timeoutPromise = new Promise((resolve) => {
        setTimeout(() => resolve({
            ...fallbackEnrichment,
            aiMeta: {
                ...fallbackEnrichment.aiMeta,
                error: `AI 응답 대기 시간 초과(${timeoutMs}ms) — 기본 리포트를 제공합니다.`
            }
        }), timeoutMs);
    });

    return Promise.race([record.aiEnrichmentPromise, timeoutPromise]);
}

async function handleRequest(req, res) {
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

    // ------------------------------------------------------------------------
    // [API 1] GET /api/config
    // ------------------------------------------------------------------------
    if (req.method === 'GET' && pathname === '/api/config') {
        const config = getDynamicConfig();
        sendJson(res, 200, {
            status: 'OK',
            miniappId: config.miniappId,
            appTitle: 'MuseGlow AI - 한국 여성 트렌드 진단 & AI 포토 스튜디오',
            marketingHeadline: '청담동 30만원짜리 얼굴·체질 진단? 내 숨은 추구미 찾고 피부과·올영 호구 탈출하는 시크릿 처방전',
            brandName: '뮤즈글로우 AI (MuseGlow AI v5.0)',
            businessEvaluatorOverride: true,
            paywallType: 'HARD_PAYWALL',
            trialDays: config.trialDays,
            vipAnnualPrice: config.vipAnnualPrice,
            formattedVipAnnualPrice: config.formattedVipAnnualPrice,
            monthlyEquivalentFormatted: config.monthlyEquivalentFormatted,
            vipCreditCap: config.vipCreditCap,
            monetizationPrice: config.monetizationPrice,
            formattedPrice: config.formattedPrice,
            starterCreditCap: config.starterCreditCap,
            appOwnerIdMasked: config.appOwnerIdMasked,
            settlementHolderMasked: config.settlementHolderMasked,
            securityProtocol: 'AES-256-GCM',
            // [실제 AI 연동 상태] 클라이언트가 "진짜 AI 분석인지 / 목업인지" 표시할 수 있도록 노출
            ai: getAiStatus(),
            // [실제 결제 연동 상태] TOSS_LIVE면 결제위젯, 아니면 샌드박스 시뮬레이션
            payments: getPaymentStatus(),
            creditCostMatrix: {
                initialDiagnosis: 10,
                dailyCheckin: 2,
                skinBarrierRescan: 3,
                pouchIngredientScan: 5,
                photoStudioRender: 10,
                viralShareBonus: 3,
                weekly3xStreakBonus: 15
            }
        });
        return;
    }

    // ------------------------------------------------------------------------
    // [API 2] GET /api/business-evaluation
    // ------------------------------------------------------------------------
    if (req.method === 'GET' && pathname === '/api/business-evaluation') {
        sendJson(res, 200, getBusinessEvaluatorReport());
        return;
    }

    // ------------------------------------------------------------------------
    // [API 3] POST /api/skin/scan
    // 역할: AI 피부 건강 & 장벽 정밀 스캐너 + 4주 이원화 회복 비교 곡선 반환
    //       원본 사진(imageBase64)은 즉시 메모리에서 파기하고 메타데이터만 AES-256-GCM 암호화
    // ------------------------------------------------------------------------
    if (req.method === 'POST' && pathname === '/api/skin/scan') {
        try {
            const body = await parseJsonBody(req);
            const rawImageInput = body.imageBase64 || '';
            const userAge = Number(body.userAge) || 26;
            const sessionToken = body.sessionToken || null;

            // 세션이 존재하고 이미 하드 페이월이 해제된 유저가 정밀 재스캔을 요청할 경우 -3 크레딧 차감
            let creditsDeducted = 0;
            let remainingCredits = null;
            if (sessionToken && encryptedDiagnosisStore.has(sessionToken)) {
                const record = encryptedDiagnosisStore.get(sessionToken);
                if (record.isPremiumUnlocked && record.remainingCredits >= 3) {
                    record.remainingCredits -= 3;
                    creditsDeducted = 3;
                    remainingCredits = record.remainingCredits;
                }
            }

            // 1단계: 기존 결정론적 엔진으로 즉시 결과 생성 (AI 실패 시 그대로 사용)
            const baseScanResult = analyzeSkinBarrierScan(rawImageInput, userAge);

            // 2단계: [실제 AI Vision 분석] AI 키가 설정된 경우에만 호출 (실패/미설정 시 자동 폴백)
            const aiScan = await runAiSkinScan({
                imageBase64: rawImageInput,
                userAge,
                skinConcern: body.skinConcern,
                baseResult: baseScanResult
            });
            const scanResult = aiScan.result;

            // 개인정보 보호(규칙 8): 원본 사진 데이터는 즉시 참조 해제하여 메모리 파기 보장
            // (AI 추론에 사용된 경우에도 원본은 디스크·DB에 저장되지 않고 요청 종료 시 폐기됩니다)
            delete body.imageBase64;

            const scanId = 'skin_' + crypto.randomBytes(12).toString('hex');
            const encryptedScanRecord = encryptSensitiveData({
                scanId,
                skinType: scanResult.skinType,
                skinAge: scanResult.skinAge,
                skinBarrierScore: scanResult.skinBarrierScore,
                barrierStatus: scanResult.barrierStatus,
                scannedAt: new Date().toISOString()
            });

            encryptedSkinScanStore.set(scanId, {
                scanId,
                encryptedMetadata: encryptedScanRecord,
                rawPhotoRetained: false,
                createdAt: new Date().toISOString()
            });

            sendJson(res, 200, {
                ...scanResult,
                scanId,
                creditsDeducted,
                remainingCredits,
                ai: aiScan.aiMeta,
                privacyGuarantee: aiScan.aiMeta.applied
                    ? 'RAW_PHOTO_AI_INFERENCE_ONLY_THEN_DISCARDED_AES256_ENCRYPTED'
                    : 'RAW_PHOTO_DISCARDED_AES256_ENCRYPTED'
            });
        } catch (err) {
            sendJson(res, 400, { status: 'ERROR', message: err.message });
        }
        return;
    }

    // ------------------------------------------------------------------------
    // [API 4] POST /api/glow/diagnose
    // 역할: [Hard Paywall 적용] 사용자 정보를 AES-256-GCM으로 암호화 저장하고,
    //       결제 전에는 핵심 결과를 차단한 채 '연간 예상 호구 손실액 경고 티저'만 반환
    // ------------------------------------------------------------------------
    if (req.method === 'POST' && pathname === '/api/glow/diagnose') {
        try {
            const body = await parseJsonBody(req);
            const config = getDynamicConfig();

            const sensitiveProfile = {
                nickname: body.nickname || '청담뮤즈',
                ageGroup: body.ageGroup || '2030_TREND',
                focusMode: body.focusMode || 'CHUGUMI_MOOD',
                faceVibe: body.faceVibe || 'SILK_OLD_MONEY',
                skinConcern: body.skinConcern || 'PORE_ELASTICITY',
                cyclePhase: body.cyclePhase || 'FOLLICULAR_GOLDEN',
                monthlyBeautySpendManwon: Number(body.monthlyBeautySpendManwon) || 30,
                requestedAt: new Date().toISOString()
            };

            const encryptedBundle = encryptSensitiveData(sensitiveProfile);
            const analysis = analyzeGlowMuseProfile(sensitiveProfile);
            const sessionToken = 'glow_' + crypto.randomBytes(16).toString('hex');

            const record = {
                sessionToken,
                encryptedProfile: encryptedBundle,
                hardPaywallTeaser: analysis.hardPaywallTeaser,
                encryptedFullReport: encryptSensitiveData(analysis.unlockedFullReport),
                isPremiumUnlocked: false,
                selectedPlanTier: 'LOCKED',
                remainingCredits: 0,
                weeklyCheckinCount: 0,
                encryptedPouchVault: [],
                aiStatus: 'PENDING',
                aiEnrichment: null,
                createdAt: new Date().toISOString()
            };

            encryptedDiagnosisStore.set(sessionToken, record);

            // [실제 AI 리포트 생성] 사용자가 결제를 고민하는 동안 백그라운드에서 미리 생성합니다.
            // - 결제 직후 즉시 제공되어 TTV(Time To Value) 3분 규칙을 지킵니다.
            // - AI 실패·미설정 시 결정론적 리포트가 그대로 사용됩니다(무중단 폴백).
            record.aiEnrichmentPromise = runAiReport({
                profile: sensitiveProfile,
                baseReport: analysis.unlockedFullReport
            }).then(({ report, aiMeta }) => {
                record.aiEnrichment = { report, aiMeta };
                record.aiStatus = aiMeta.applied ? 'AI_READY' : 'FALLBACK_READY';
                return record.aiEnrichment;
            }).catch((err) => {
                record.aiEnrichment = {
                    report: analysis.unlockedFullReport,
                    aiMeta: { applied: false, fallbackUsed: true, error: err.message }
                };
                record.aiStatus = 'FALLBACK_READY';
                return record.aiEnrichment;
            });

            sendJson(res, 200, {
                status: 'SUCCESS',
                paywallMode: 'HARD_PAYWALL',
                sessionToken,
                securityProof: {
                    algorithm: encryptedBundle.algorithm,
                    ivPreview: encryptedBundle.iv.slice(0, 12) + '...',
                    authTagPreview: encryptedBundle.authTag.slice(0, 12) + '...',
                    cipherPreview: encryptedBundle.encryptedData.slice(0, 24) + '...'
                },
                pricingPlans: {
                    vipAnnual: {
                        planTier: 'VIP_ANNUAL',
                        title: `👑 ${config.trialDays}일 무료 체험 + 연간 VIP 슬로우에이징 패스 (RLTV 6x 추천)`,
                        priceKrw: config.vipAnnualPrice,
                        formattedPrice: config.formattedVipAnnualPrice,
                        monthlyEquivalent: config.monthlyEquivalentFormatted,
                        creditsGranted: config.vipCreditCap,
                        trialDays: config.trialDays
                    },
                    starterPack: {
                        planTier: 'STARTER_PACK',
                        title: '⚡ 단기 검증용 스타터 30 크레딧 팩',
                        priceKrw: config.monetizationPrice,
                        formattedPrice: config.formattedPrice,
                        creditsGranted: config.starterCreditCap,
                        trialDays: 0
                    },
                    appOwnerIdMasked: config.appOwnerIdMasked
                },
                hardPaywallTeaser: analysis.hardPaywallTeaser,
                ai: {
                    ...getAiStatus(),
                    reportStatus: record.aiStatus
                }
            });
        } catch (err) {
            sendJson(res, 400, { status: 'ERROR', message: err.message });
        }
        return;
    }

    // ------------------------------------------------------------------------
    // [API 5] POST /api/payment/unlock
    // 역할: [토스페이먼츠 실결제 승인 기반 하드 페이월 해제]
    //   - TOSS_LIVE 모드 : 클라이언트가 결제위젯 인증 후 받은 paymentKey/orderId를
    //                      서버가 토스페이먼츠 /v1/payments/confirm 으로 최종 승인합니다.
    //                      금액은 .env 서버 설정값과 1원 단위로 재검증합니다.
    //   - SANDBOX_SIMULATION 모드 : 키 미설정 시 기존 데모 흐름(금액 일치 검증)으로 동작합니다.
    //   - 결제 완료 직전 백그라운드에서 미리 생성해 둔 AI 리포트를 즉시 제공합니다.
    // ------------------------------------------------------------------------
    if (req.method === 'POST' && pathname === '/api/payment/unlock') {
        try {
            const body = await parseJsonBody(req);
            const { sessionToken, paidAmount, planTier, paymentKey, orderId } = body;
            const config = getDynamicConfig();
            const paymentMode = config.payments.mode;

            if (!sessionToken || !encryptedDiagnosisStore.has(sessionToken)) {
                sendJson(res, 404, { status: 'ERROR', message: '유효하지 않은 진단 세션입니다. 먼저 온보딩 스캔을 실행해 주세요.' });
                return;
            }

            const record = encryptedDiagnosisStore.get(sessionToken);

            let resolvedPlanTier = null;
            let appliedPrice = 0;
            let grantedCredits = 0;
            let tossReceipt = null;
            let usedOrderId = orderId || null;
            let alreadyPaid = false;

            if (paymentMode === 'TOSS_LIVE') {
                // ----------------------------------------------------------------
                // [실결제 경로] 서버가 금액을 확정한 주문으로만 승인합니다.
                // ----------------------------------------------------------------
                if (!paymentKey || !orderId) {
                    sendJson(res, 400, {
                        status: 'TOSS_CONFIRM_REQUIRED',
                        message: '토스페이먼츠 결제 인증 정보(paymentKey, orderId)가 필요합니다.'
                    });
                    return;
                }

                const order = getRawOrder(orderId);
                if (!order) {
                    sendJson(res, 404, { status: 'ORDER_NOT_FOUND', message: '존재하지 않는 주문입니다. 결제를 다시 시작해 주세요.' });
                    return;
                }

                if (order.sessionToken !== sessionToken) {
                    sendJson(res, 403, { status: 'SESSION_ORDER_MISMATCH', message: '주문과 진단 세션이 일치하지 않습니다.' });
                    return;
                }

                if (order.status === ORDER_STATUS.PAID) {
                    // 이미 승인 완료된 주문: 크레딧 이중 지급 방지(멱등성 보장)
                    alreadyPaid = true;
                    tossReceipt = order.tossReceipt;
                } else {
                    const confirmResult = await confirmPayment({
                        paymentKey,
                        orderId,
                        amount: order.amountKrw
                    });

                    if (!confirmResult.ok) {
                        sendJson(res, 402, {
                            status: 'PAYMENT_CONFIRM_FAILED',
                            code: confirmResult.code || 'CONFIRM_ERROR',
                            message: confirmResult.error
                        });
                        return;
                    }

                    tossReceipt = confirmResult.receipt;
                }

                resolvedPlanTier = order.planTier;
                appliedPrice = order.amountKrw;
                grantedCredits = order.creditsGranted;
            } else {
                // ----------------------------------------------------------------
                // [샌드박스 경로] 키 미설정: 기존 데모 검증 흐름 유지
                // ----------------------------------------------------------------
                // [보안] 플랜이 지정된 경우 "플랜 금액 == 결제 금액"이 1원 단위로 일치해야만 승인합니다.
                // (기존 코드는 planTier만 맞으면 금액을 검증하지 않아 ₩100 결제로 VIP 해제가 가능했습니다)
                const numericPaid = Number(paidAmount);
                let plan = null;

                if (planTier) {
                    plan = resolvePlan(planTier);
                    if (!plan || numericPaid !== plan.amountKrw) {
                        sendJson(res, 400, {
                            status: 'PRICE_MISMATCH',
                            message: `선택한 플랜(${planTier})의 금액(${plan ? plan.amountKrw : '알 수 없음'}원)과 결제 요청 금액(${numericPaid}원)이 일치하지 않습니다.`
                        });
                        return;
                    }
                } else {
                    plan = numericPaid === config.vipAnnualPrice
                        ? resolvePlan('VIP_ANNUAL')
                        : (numericPaid === config.monetizationPrice ? resolvePlan('STARTER_PACK') : null);

                    if (!plan) {
                        sendJson(res, 400, {
                            status: 'PRICE_MISMATCH',
                            message: `결제 요청 금액(${numericPaid}원)이 서버 환경변수 설정 금액(VIP 연간: ${config.vipAnnualPrice}원 / 스타터 팩: ${config.monetizationPrice}원)과 일치하지 않습니다.`
                        });
                        return;
                    }
                }
                resolvedPlanTier = plan.planTier;
                appliedPrice = plan.amountKrw;
                grantedCredits = plan.creditsGranted;

                // 감사 추적을 위해 샌드박스 결제도 주문 원장에 기록합니다.
                const sandboxOrder = createOrder({ sessionToken, planTier: plan.planTier });
                usedOrderId = sandboxOrder.order.orderId;
                markOrderPaid(usedOrderId, {
                    paymentKey: 'SANDBOX_SIMULATED',
                    tossReceipt: {
                        paymentKey: 'SANDBOX_SIMULATED',
                        orderId: usedOrderId,
                        method: 'SANDBOX_SIMULATION',
                        status: 'DONE',
                        approvedAt: new Date().toISOString(),
                        totalAmount: appliedPrice
                    }
                });
            }

            // [멱등성] 동일 주문(orderId)로 재승인 요청이 들어오면 크레딧을 추가 지급하지 않습니다.
            // (결제위젯 재시도·새로고침·중복 콜백으로 인한 크레딧 무한 복제 원천 차단)
            const isReplayOfSameOrder = Boolean(
                record.isPremiumUnlocked && record.lastOrderId && usedOrderId && record.lastOrderId === usedOrderId
            );
            const initialDiagnosisCost = record.isPremiumUnlocked ? 0 : 10;

            if (!isReplayOfSameOrder) {
                record.remainingCredits = Math.max(
                    0,
                    (record.remainingCredits || 0) + grantedCredits - initialDiagnosisCost
                );
            }

            record.isPremiumUnlocked = true;
            record.selectedPlanTier = resolvedPlanTier === 'VIP_ANNUAL'
                ? `VIP_ANNUAL_${config.trialDays}D_TRIAL`
                : 'STARTER_CREDIT_PACK';
            record.lastOrderId = usedOrderId;

            // [실제 AI 리포트] 백그라운드 생성 결과를 최대 12초까지 대기 (초과 시 기본 리포트 제공)
            const aiEnrichment = await waitForAiEnrichment(record, 12000);
            const unlockedFullReport = aiEnrichment.report;

            const tossOrderId = usedOrderId || ('TOSS_GLOW_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex').toUpperCase());

            paymentLedgerStore.set(tossOrderId, {
                tossOrderId,
                sessionToken,
                planTier: record.selectedPlanTier,
                paidAmountKrw: appliedPrice,
                creditsGranted: grantedCredits,
                remainingCredits: record.remainingCredits,
                paymentMode,
                tossReceipt,
                appOwnerIdMasked: config.appOwnerIdMasked,
                settlementHolderMasked: config.settlementHolderMasked,
                aiProvider: aiEnrichment.aiMeta.provider || null,
                aiApplied: Boolean(aiEnrichment.aiMeta.applied),
                paidAt: new Date().toISOString()
            });

            sendJson(res, 200, {
                status: 'UNLOCKED',
                receipt: {
                    tossOrderId,
                    orderId: usedOrderId,
                    planTier: record.selectedPlanTier,
                    trialDaysApplied: resolvedPlanTier === 'VIP_ANNUAL' ? config.trialDays : 0,
                    paidAmountKrw: appliedPrice,
                    formattedPrice: `₩${appliedPrice.toLocaleString('ko-KR')}`,
                    creditsGranted: grantedCredits,
                    creditsDeductedForDiagnosis: initialDiagnosisCost,
                    remainingCredits: record.remainingCredits,
                    paymentMode,
                    tossPayment: tossReceipt ? {
                        method: tossReceipt.method || null,
                        cardCompany: tossReceipt.cardCompany || null,
                        cardNumber: tossReceipt.cardNumber || null,
                        approvedAt: tossReceipt.approvedAt || null,
                        receiptUrl: tossReceipt.receiptUrl || null
                    } : null,
                    appOwnerIdMasked: config.appOwnerIdMasked,
                    settlementHolderMasked: config.settlementHolderMasked,
                    paidAt: new Date().toISOString()
                },
                ai: aiEnrichment.aiMeta,
                unlockedFullReport
            });
        } catch (err) {
            sendJson(res, 500, { status: 'ERROR', message: err.message });
        }
        return;
    }

    // ------------------------------------------------------------------------
    // [API 5-1] POST /api/payment/order  (토스페이먼츠 결제위젯용 주문 생성)
    // 역할: 서버가 금액을 확정하여 클라이언트의 금액 조작을 원천 차단합니다.
    // ------------------------------------------------------------------------
    if (req.method === 'POST' && pathname === '/api/payment/order') {
        try {
            const body = await parseJsonBody(req);
            const { sessionToken, planTier } = body;

            if (!sessionToken || !encryptedDiagnosisStore.has(sessionToken)) {
                sendJson(res, 404, { status: 'ERROR', message: '유효하지 않은 진단 세션입니다.' });
                return;
            }

            const result = createOrder({ sessionToken, planTier });
            if (!result.ok) {
                sendJson(res, 400, { status: 'ORDER_CREATE_FAILED', message: result.error });
                return;
            }

            sendJson(res, 200, {
                status: 'ORDER_CREATED',
                orderId: result.order.orderId,
                checkout: result.checkout,
                ai: getAiStatus()
            });
        } catch (err) {
            sendJson(res, 500, { status: 'ERROR', message: err.message });
        }
        return;
    }

    // ------------------------------------------------------------------------
    // [API 5-2] GET /api/payment/status?orderId=...  (주문 상태 조회)
    // ------------------------------------------------------------------------
    if (req.method === 'GET' && pathname === '/api/payment/status') {
        const orderId = parsedUrl.searchParams.get('orderId');
        const order = orderId ? getOrder(orderId) : null;

        if (!order) {
            sendJson(res, 404, { status: 'ORDER_NOT_FOUND', message: '주문을 찾을 수 없습니다.' });
            return;
        }

        sendJson(res, 200, { status: 'OK', order });
        return;
    }

    // ------------------------------------------------------------------------
    // [API 5-3] POST /api/payment/cancel  (결제 취소/환불)
    // ------------------------------------------------------------------------
    if (req.method === 'POST' && pathname === '/api/payment/cancel') {
        try {
            const body = await parseJsonBody(req);
            const { orderId, paymentKey, cancelReason } = body;
            const config = getDynamicConfig();

            const order = orderId ? getRawOrder(orderId) : null;
            const resolvedPaymentKey = paymentKey || (order ? order.paymentKey : null);

            if (!resolvedPaymentKey) {
                sendJson(res, 400, { status: 'CANCEL_FAILED', message: '취소할 결제 정보(paymentKey 또는 orderId)가 필요합니다.' });
                return;
            }

            const cancelResult = await cancelPayment({
                paymentKey: resolvedPaymentKey,
                cancelReason: cancelReason || '고객 요청에 의한 환불'
            });

            if (!cancelResult.ok) {
                sendJson(res, 402, { status: 'CANCEL_FAILED', message: cancelResult.error });
                return;
            }

            // 환불 시 지급했던 크레딧 회수 (부정 사용 방지)
            if (order && encryptedDiagnosisStore.has(order.sessionToken)) {
                const record = encryptedDiagnosisStore.get(order.sessionToken);
                record.isPremiumUnlocked = false;
                record.remainingCredits = 0;
                record.selectedPlanTier = 'REFUNDED';
                record.aiStatus = 'PENDING';
                record.aiEnrichment = null;
            }

            sendJson(res, 200, {
                status: 'CANCELED',
                paymentMode: config.payments.mode,
                orderId: orderId || null,
                receipt: cancelResult.receipt || null
            });
        } catch (err) {
            sendJson(res, 500, { status: 'ERROR', message: err.message });
        }
        return;
    }

    // ------------------------------------------------------------------------
    // [API 5-4] GET /api/ai/status  (AI 연동 상태 진단 — 운영 관제용)
    // ------------------------------------------------------------------------
    if (req.method === 'GET' && pathname === '/api/ai/status') {
        const aiStatus = getAiStatus();
        sendJson(res, 200, {
            status: 'OK',
            ai: aiStatus,
            activeEnrichments: [...encryptedDiagnosisStore.values()]
                .filter((r) => r.aiStatus && r.aiStatus !== 'PENDING').length,
            totalSessions: encryptedDiagnosisStore.size
        });
        return;
    }

    // ------------------------------------------------------------------------
    // [API 6] POST /api/hook/action
    // 역할: [Nir Eyal Hook 4단계 & AI 차등 크레딧 한도 제어]
    //   - DAILY_CHECKIN (-2 크레딧, 3회 달성 시 +15 보너스)
    //   - POUCH_INVEST (-5 크레딧, 파우치 금고 암호화 & 상극 DB 판독)
    //   - STUDIO_RENDER (-10 크레딧, AI 추구미 포토 스튜디오 고해상도 룩북 레시피 생성)
    //   - VIRAL_SHARE (+3 크레딧, 청담 처방 영수증 공유 리워드)
    //   - CPA_PARTNER_CLICK (올리브영/청담 피부과/이너뷰티 제휴 CPA 수익 로깅)
    // ------------------------------------------------------------------------
    if (req.method === 'POST' && pathname === '/api/hook/action') {
        try {
            const body = await parseJsonBody(req);
            const { sessionToken, actionType } = body;

            if (!sessionToken || !encryptedDiagnosisStore.has(sessionToken)) {
                sendJson(res, 404, { status: 'ERROR', message: '유효하지 않은 세션입니다. 먼저 하단 1번 온보딩 스캔을 진행해 주세요.' });
                return;
            }

            const record = encryptedDiagnosisStore.get(sessionToken);
            if (!record.isPremiumUnlocked) {
                sendJson(res, 403, {
                    status: 'HARD_PAYWALL_BLOCKED',
                    message: '하드 페이월이 잠겨 있습니다. 먼저 21일 무료 체험 또는 크레딧 팩을 시작해 주세요.'
                });
                return;
            }

            if (actionType === 'DAILY_CHECKIN') {
                const cost = 2;
                if (record.remainingCredits < cost) {
                    sendJson(res, 402, {
                        status: 'INSUFFICIENT_CREDITS',
                        message: '보유한 글로우 크레딧이 부족합니다. (Thin Wrapper 역마진 방어 한도 도달)'
                    });
                    return;
                }

                record.remainingCredits -= cost;
                record.weeklyCheckinCount += 1;

                let bonusCreditsAwarded = 0;
                if (record.weeklyCheckinCount === 3) {
                    bonusCreditsAwarded = 15;
                    record.remainingCredits += bonusCreditsAwarded;
                }

                const reward = generateDailyVariableReward(
                    record.weeklyCheckinCount,
                    body.sleepCondition || 'GOOD',
                    body.swellingLevel || 'HIGH'
                );

                sendJson(res, 200, {
                    status: 'HOOK_CHECKIN_SUCCESS',
                    creditsDeducted: cost,
                    bonusCreditsAwarded,
                    remainingCredits: record.remainingCredits,
                    weeklyCheckinCount: record.weeklyCheckinCount,
                    variableReward: reward
                });
                return;
            }

            if (actionType === 'POUCH_INVEST') {
                const cost = 5;
                if (record.remainingCredits < cost) {
                    sendJson(res, 402, {
                        status: 'INSUFFICIENT_CREDITS',
                        message: '보유한 글로우 크레딧이 부족합니다. (파우치 상극 스캔에는 5 크레딧이 필요합니다)'
                    });
                    return;
                }

                record.remainingCredits -= cost;
                const compatibility = evaluatePouchItemCompatibility(body.itemName, body.comboType);

                const encryptedVaultItem = encryptSensitiveData({
                    itemName: compatibility.itemName,
                    comboType: compatibility.comboType,
                    verdict: compatibility.verdict,
                    savedAt: new Date().toISOString()
                });
                record.encryptedPouchVault.push(encryptedVaultItem);

                sendJson(res, 200, {
                    status: 'POUCH_INVEST_SUCCESS',
                    creditsDeducted: cost,
                    remainingCredits: record.remainingCredits,
                    vaultTotalCount: record.encryptedPouchVault.length,
                    encryptionProof: encryptedVaultItem.encryptedData.slice(0, 16) + '...',
                    compatibilityResult: compatibility
                });
                return;
            }

            if (actionType === 'STUDIO_RENDER') {
                const cost = 10;
                if (record.remainingCredits < cost) {
                    sendJson(res, 402, {
                        status: 'INSUFFICIENT_CREDITS',
                        message: '보유한 글로우 크레딧이 부족합니다. (AI 포토 스튜디오 정밀 렌더링에는 10 크레딧이 필요합니다. 친구에게 영수증을 공유해 +3 크레딧을 충전해 보세요!)'
                    });
                    return;
                }

                record.remainingCredits -= cost;
                const studioSpec = simulateChugumiPhotoStudio(body.vibeKey || 'SILK_OLD_MONEY');
                const encryptedStudioRecord = encryptSensitiveData({
                    sessionToken,
                    studioSpec,
                    renderedAt: new Date().toISOString()
                });
                const studioLogId = 'studio_' + crypto.randomBytes(8).toString('hex');
                encryptedPhotoStudioStore.set(studioLogId, encryptedStudioRecord);

                sendJson(res, 200, {
                    status: 'STUDIO_RENDER_SUCCESS',
                    creditsDeducted: cost,
                    remainingCredits: record.remainingCredits,
                    encryptionProof: encryptedStudioRecord.encryptedData.slice(0, 16) + '...',
                    studioResult: studioSpec
                });
                return;
            }

            if (actionType === 'VIRAL_SHARE') {
                const viralBonus = 3;
                record.remainingCredits += viralBonus;
                const receiptSerial = '#MG-2026-' + Math.floor(1000 + Math.random() * 9000);
                sendJson(res, 200, {
                    status: 'VIRAL_SHARE_REWARDED',
                    receiptSerial,
                    bonusCreditsAwarded: viralBonus,
                    remainingCredits: record.remainingCredits,
                    shareMessage: `📲 [청담 시크릿 처방전 영수증 ${receiptSerial}] 공유가 완료되어 보너스 +3 🪙 글로우 크레딧이 즉시 충전되었습니다!`
                });
                return;
            }

            if (actionType === 'CPA_PARTNER_CLICK') {
                const partnerType = body.partnerType || 'OLIVEYOUNG_ALT';
                const cpaCatalog = {
                    OLIVEYOUNG_ALT: {
                        partnerName: '올리브영 상극 탈출 대체템 최저가 큐레이션 (CPS/CPA 제휴)',
                        estimatedPartnerRevenueKrw: 4500,
                        userBenefitMessage: '🎁 내 피부장벽과 100% 호환되는 PDRN·판테놀 대체템 특가 쿠폰팩(최대 28% 할인)이 발급되었습니다!'
                    },
                    CHEONGDAM_CLINIC: {
                        partnerName: '청담 프라이빗 피부과 내 얼굴형 맞춤 시술 비공개 견적 매칭 (Lead CPA)',
                        estimatedPartnerRevenueKrw: 55000,
                        userBenefitMessage: '💎 청담동 VIP 피부과 원장님 1:1 비공개 시술 견적서(49% 제휴가) & 5만 원 시술 우대권이 예약되었습니다!'
                    },
                    INNER_BEAUTY_DEAL: {
                        partnerName: '호르몬 황금기 맞춤 림프·혈당 이너뷰티 시크릿 타임딜 (CPA 제휴)',
                        estimatedPartnerRevenueKrw: 8900,
                        userBenefitMessage: '🥂 생리 전 부종·가짜 식욕 차단 이너뷰티 스타터 키트 VIP 제휴 특가가 열렸습니다!'
                    }
                };
                const selectedCpa = cpaCatalog[partnerType] || cpaCatalog.OLIVEYOUNG_ALT;
                sendJson(res, 200, {
                    status: 'CPA_ACTION_LOGGED',
                    partnerType,
                    partnerName: selectedCpa.partnerName,
                    estimatedPartnerRevenueKrw: selectedCpa.estimatedPartnerRevenueKrw,
                    userBenefitMessage: selectedCpa.userBenefitMessage,
                    remainingCredits: record.remainingCredits
                });
                return;
            }

            sendJson(res, 400, { status: 'ERROR', message: '지원하지 않는 훅 액션 타입입니다.' });
        } catch (err) {
            sendJson(res, 500, { status: 'ERROR', message: err.message });
        }
        return;
    }

    // 정적 파일 서빙
    const frontendRoot = path.resolve(__dirname, '../frontend');

    // [토스페이먼츠 결제 후 리다이렉트 페이지] 결제창(새 창)에서 승인 후 이 페이지로 돌아와
    // 부모 창(opener)에 paymentKey/orderId/amount 를 postMessage 로 전달하고 자동으로 닫힙니다.
    if (pathname === '/payments/success' || pathname === '/payments/fail') {
        const pageFile = pathname === '/payments/success' ? '/payments-success.html' : '/payments-fail.html';
        const pagePath = path.join(frontendRoot, pageFile);
        if (fs.existsSync(pagePath)) {
            res.writeHead(200, { 'Content-Type': MIME_TYPES['.html'] });
            res.end(fs.readFileSync(pagePath));
            return;
        }
    }

    let relativePath = pathname === '/' ? '/index.html' : pathname;
    const safePath = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, '');
    const filePath = path.join(frontendRoot, safePath);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        const content = fs.readFileSync(filePath);
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
        return;
    }

    sendJson(res, 404, { status: 'NOT_FOUND', message: '요청하신 리소스를 찾을 수 없습니다.' });
}

function startServer(customPort) {
    const config = getDynamicConfig();
    const targetPort = customPort !== undefined ? customPort : (config.port || 3003);
    const server = http.createServer(handleRequest);

    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(targetPort, () => {
            const actualPort = server.address().port;
            console.log('====================================================================');
            console.log('💄 [MuseGlow AI v5.0 - 4대 전문 에이전트 합동 프로덕션 서버 가동]');
            console.log(`🌐 접속 주소     : http://localhost:${actualPort}`);
            console.log(`👑 주력 하드페이월: ${config.trialDays}일 무료 체험 후 연 ${config.formattedVipAnnualPrice} (${config.vipCreditCap} 크레딧)`);
            console.log(`⚡ 보조 스타터팩 : ${config.formattedPrice} (${config.starterCreditCap} 크레딧)`);
            console.log(`🔬 피부 스캐너   : POST /api/skin/scan (5대 지표 + 4주 이원화 회복 곡선)`);
            console.log(`📸 포토 스튜디오 : POST /api/hook/action [STUDIO_RENDER] (-10 크레딧)`);
            console.log(`🔐 정산 소유자   : ${config.appOwnerIdMasked} (${config.settlementHolderMasked})`);

            const aiStatus = getAiStatus();
            const payStatus = getPaymentStatus();
            console.log('--------------------------------------------------------------------');
            console.log(aiStatus.enabled
                ? `🧠 AI 엔진      : [LIVE] ${String(aiStatus.provider).toUpperCase()} · ${aiStatus.model} (키 ${aiStatus.apiKeyMasked})`
                : `🧠 AI 엔진      : [FALLBACK] 로컬 결정론적 엔진 (AI 키 미설정 → 자동 폴백)`);
            console.log(payStatus.mode === 'TOSS_LIVE'
                ? `💳 결제 게이트웨이: [TOSS_LIVE] 토스페이먼츠 실결제 (clientKey ${payStatus.clientKeyMasked})`
                : `💳 결제 게이트웨이: [SANDBOX] 시뮬레이션 (TOSS_PAYMENTS_CLIENT_KEY / SECRET_KEY 미설정)`);
            console.log(`   ↳ AI 상태 API : GET /api/ai/status   | 주문 생성: POST /api/payment/order`);
            console.log('====================================================================');
            resolve({ server, port: actualPort, config });
        });
    });
}

if (require.main === module) {
    startServer().catch((err) => {
        console.error('서버 시작 실패:', err);
        process.exit(1);
    });
}

module.exports = {
    startServer
};
