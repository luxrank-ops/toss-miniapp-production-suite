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

            const scanResult = analyzeSkinBarrierScan(rawImageInput, userAge);

            // 개인정보 보호(규칙 8): 원본 사진 데이터는 즉시 참조 해제하여 메모리 파기 보장
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
                privacyGuarantee: 'RAW_PHOTO_DISCARDED_AES256_ENCRYPTED'
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

            encryptedDiagnosisStore.set(sessionToken, {
                sessionToken,
                encryptedProfile: encryptedBundle,
                hardPaywallTeaser: analysis.hardPaywallTeaser,
                encryptedFullReport: encryptSensitiveData(analysis.unlockedFullReport),
                isPremiumUnlocked: false,
                selectedPlanTier: 'LOCKED',
                remainingCredits: 0,
                weeklyCheckinCount: 0,
                encryptedPouchVault: [],
                createdAt: new Date().toISOString()
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
                hardPaywallTeaser: analysis.hardPaywallTeaser
            });
        } catch (err) {
            sendJson(res, 400, { status: 'ERROR', message: err.message });
        }
        return;
    }

    // ------------------------------------------------------------------------
    // [API 5] POST /api/payment/unlock
    // ------------------------------------------------------------------------
    if (req.method === 'POST' && pathname === '/api/payment/unlock') {
        try {
            const body = await parseJsonBody(req);
            const { sessionToken, paidAmount, planTier } = body;
            const config = getDynamicConfig();

            if (!sessionToken || !encryptedDiagnosisStore.has(sessionToken)) {
                sendJson(res, 404, { status: 'ERROR', message: '유효하지 않은 진단 세션입니다. 먼저 온보딩 스캔을 실행해 주세요.' });
                return;
            }

            const numericPaid = Number(paidAmount);
            const isVipPlan = planTier === 'VIP_ANNUAL' || numericPaid === config.vipAnnualPrice;
            const isStarterPlan = planTier === 'STARTER_PACK' || numericPaid === config.monetizationPrice;

            if (!isVipPlan && !isStarterPlan) {
                sendJson(res, 400, {
                    status: 'PRICE_MISMATCH',
                    message: `결제 요청 금액(${numericPaid}원)이 서버 환경변수 설정 금액(VIP 연간: ${config.vipAnnualPrice}원 / 스타터 팩: ${config.monetizationPrice}원)과 일치하지 않습니다.`
                });
                return;
            }

            const record = encryptedDiagnosisStore.get(sessionToken);
            const grantedCredits = isVipPlan ? config.vipCreditCap : config.starterCreditCap;
            const initialDiagnosisCost = 10;

            record.isPremiumUnlocked = true;
            record.selectedPlanTier = isVipPlan ? 'VIP_ANNUAL_21D_TRIAL' : 'STARTER_CREDIT_PACK';
            record.remainingCredits = Math.max(0, grantedCredits - initialDiagnosisCost);

            const unlockedFullReport = decryptSensitiveData(record.encryptedFullReport);
            const tossOrderId = 'TOSS_GLOW_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex').toUpperCase();
            const appliedPrice = isVipPlan ? config.vipAnnualPrice : config.monetizationPrice;

            paymentLedgerStore.set(tossOrderId, {
                tossOrderId,
                sessionToken,
                planTier: record.selectedPlanTier,
                paidAmountKrw: appliedPrice,
                creditsGranted: grantedCredits,
                remainingCredits: record.remainingCredits,
                appOwnerIdMasked: config.appOwnerIdMasked,
                settlementHolderMasked: config.settlementHolderMasked,
                paidAt: new Date().toISOString()
            });

            sendJson(res, 200, {
                status: 'UNLOCKED',
                receipt: {
                    tossOrderId,
                    planTier: record.selectedPlanTier,
                    trialDaysApplied: isVipPlan ? config.trialDays : 0,
                    paidAmountKrw: appliedPrice,
                    formattedPrice: `₩${appliedPrice.toLocaleString('ko-KR')}`,
                    creditsGranted: grantedCredits,
                    creditsDeductedForDiagnosis: initialDiagnosisCost,
                    remainingCredits: record.remainingCredits,
                    appOwnerIdMasked: config.appOwnerIdMasked,
                    settlementHolderMasked: config.settlementHolderMasked,
                    paidAt: new Date().toISOString()
                },
                unlockedFullReport
            });
        } catch (err) {
            sendJson(res, 500, { status: 'ERROR', message: err.message });
        }
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
