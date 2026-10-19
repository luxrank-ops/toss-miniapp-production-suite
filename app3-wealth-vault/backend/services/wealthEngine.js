/**
 * ============================================================================
 * 파일명: app3-wealth-vault/backend/services/wealthEngine.js
 * 역할: [제3호 앱 AGENT 4] 은행·증권·부동산·동산·보험 통합 자산 & 임대/금융소득 절세 엔진
 * 설명: 1) 사용자의 모든 재산 및 임대/금융소득 데이터를 AES-256-GCM으로 암호화하여 저장합니다.
 *       2) 무료 구간: 총 순자산(만원 단위), 5대 자산군 비중(%), 연간 합산 패시브 인컴,
 *          재정·세무 안전도 점수(0~100점)를 산출합니다.
 *       3) 유료 구간: 금융소득종합과세(2,000만 원) & 피부양자 건보료(1,000만 원) &
 *          임대소득/보수외소득 건보료 폭탄 시뮬레이션, ISA/분리과세 스위칭 절세액,
 *          부동산/동산 리밸런싱, 보험료 구조조정 처방전을 결제 검증 후 복호화해 반환합니다.
 * ============================================================================
 */

const crypto = require('crypto');
const { getDynamicConfig } = require('../config/envLoader');
const {
    encryptPersonalData,
    decryptPersonalData,
    createLookupHash
} = require('../security/cryptoManager');

const encryptedPortfoliosLedger = new Map();
const paymentOrdersLedger = new Map();

/**
 * 만원 단위의 숫자를 한국어 금액 표기(예: "5억 8,500만 원")로 변환하는 헬퍼 함수입니다.
 */
function formatManwonToKorean(manwon) {
    const num = Math.max(0, Math.round(Number(manwon) || 0));
    if (num === 0) return '0원';
    const eok = Math.floor(num / 10000);
    const remMan = num % 10000;
    if (eok > 0 && remMan > 0) {
        return `${eok.toLocaleString('ko-KR')}억 ${remMan.toLocaleString('ko-KR')}만 원`;
    }
    if (eok > 0) {
        return `${eok.toLocaleString('ko-KR')}억 원`;
    }
    return `${remMan.toLocaleString('ko-KR')}만 원`;
}

/**
 * [STEP 1] 5대 자산(은행/증권/부동산/동산/보험) + 2대 소득(금융소득/임대소득) 분석 및 AES-256 암호화 저장
 */
function analyzeWealthPortfolio(inputPayload) {
    const config = getDynamicConfig();

    const userName = (inputPayload.userName || '김자산').trim();
    const focusMode = (inputPayload.focusMode || 'TOTAL_WEALTH').trim();
    const healthInsType = (inputPayload.healthInsType || '직장가입자').trim();
    const wealthGoal = (inputPayload.wealthGoal || '금융·임대소득 절세 및 건보료 방어').trim();

    // 입력 단위: 만 원 (기본값 세팅으로 초보자도 바로 테스트 가능)
    const bankAssetMan = Math.max(0, Number(inputPayload.bankAssetMan ?? 6500));           // 은행 예적금·파킹통장 (예: 6,500만 원)
    const stockAssetMan = Math.max(0, Number(inputPayload.stockAssetMan ?? 8500));         // 증권 주식·ETF·ISA·채권 (예: 8,500만 원)
    const realEstateAssetMan = Math.max(0, Number(inputPayload.realEstateAssetMan ?? 45000)); // 부동산 아파트·상가·보증금 (예: 4억 5,000만 원)
    const movableAssetMan = Math.max(0, Number(inputPayload.movableAssetMan ?? 3500));     // 동산 자동차·금·실물자산 (예: 3,500만 원)
    const insuranceMonthlyMan = Math.max(0, Number(inputPayload.insuranceMonthlyMan ?? 48)); // 월 납입 보험료 (예: 월 48만 원)
    const financialIncomeYearlyMan = Math.max(0, Number(inputPayload.financialIncomeYearlyMan ?? 1650)); // 연간 이자+배당 금융소득 (예: 연 1,650만 원)
    const rentalIncomeMonthlyMan = Math.max(0, Number(inputPayload.rentalIncomeMonthlyMan ?? 120));      // 월간 부동산 임대소득 (예: 월 120만 원)

    // 1. [보안 최우선] 사용자 이름과 전체 재산·소득 수치를 AES-256-GCM으로 양방향 암호화
    const encryptedNamePkg = encryptPersonalData(userName);
    const encryptedWealthPkg = encryptPersonalData({
        bankAssetMan,
        stockAssetMan,
        realEstateAssetMan,
        movableAssetMan,
        insuranceMonthlyMan,
        financialIncomeYearlyMan,
        rentalIncomeMonthlyMan,
        healthInsType,
        wealthGoal
    });

    const lookupHash = createLookupHash(`${userName}|${bankAssetMan}|${stockAssetMan}|${realEstateAssetMan}`);

    // 2. 총 자산 및 자산군별 비중 계산 (보험은 연간 납입액 × 5년 환산 추정 해지환급 가치를 자산 파이에 반영)
    const estimatedInsuranceValueMan = insuranceMonthlyMan * 36;
    const totalNetWorthMan =
        bankAssetMan +
        stockAssetMan +
        realEstateAssetMan +
        movableAssetMan +
        estimatedInsuranceValueMan;

    const safeTotal = totalNetWorthMan > 0 ? totalNetWorthMan : 1;
    const allocationRatios = {
        bankPct: Math.round((bankAssetMan / safeTotal) * 100),
        stockPct: Math.round((stockAssetMan / safeTotal) * 100),
        realEstatePct: Math.round((realEstateAssetMan / safeTotal) * 100),
        movablePct: Math.round((movableAssetMan / safeTotal) * 100),
        insurancePct: Math.max(
            1,
            100 -
                Math.round((bankAssetMan / safeTotal) * 100) -
                Math.round((stockAssetMan / safeTotal) * 100) -
                Math.round((realEstateAssetMan / safeTotal) * 100) -
                Math.round((movableAssetMan / safeTotal) * 100)
        )
    };

    // 3. 연간 합산 패시브 인컴 (금융소득 + 연간 임대소득)
    const rentalIncomeYearlyMan = rentalIncomeMonthlyMan * 12;
    const totalPassiveIncomeYearlyMan = financialIncomeYearlyMan + rentalIncomeYearlyMan;

    // 4. 세무/건보료 위험도 및 재정 건전성 점수(0~100) 계산
    let wealthHealthScore = 88;
    // 금융소득 2,000만 원 초과 시 감점(경고), 1,000만 원 초과 시 주의
    if (financialIncomeYearlyMan > 2000) {
        wealthHealthScore -= 14;
    } else if (financialIncomeYearlyMan > 1000) {
        wealthHealthScore -= 6;
    }
    // 임대+금융 보수외 소득 2,000만 원 초과 시 추가 건보료 주의
    if (totalPassiveIncomeYearlyMan > 2000) {
        wealthHealthScore -= 8;
    }
    // 부동산 비중이 75% 초과 시 유동성 감점
    if (allocationRatios.realEstatePct > 75) {
        wealthHealthScore -= 7;
    }
    wealthHealthScore = Math.max(58, Math.min(96, wealthHealthScore));

    // 5. 유료 결제 시 잠금 해제될 4대 영역 프리미엄 자산·절세·건보료 처방전 생성
    // (1) 금융소득 + 임대소득 세금 & 건보료 시뮬레이션
    const finTaxGapMan = 2000 - financialIncomeYearlyMan;
    const finTaxAlertText =
        finTaxGapMan > 0
            ? `현재 연간 금융소득(이자+배당)은 ${financialIncomeYearlyMan.toLocaleString('ko-KR')}만 원으로, 금융소득종합과세 기준(2,000만 원)까지 ${finTaxGapMan.toLocaleString('ko-KR')}만 원의 안전 여유 한도가 남아 있어요. 단, 지역가입자·피부양자 건보료 기준(1,000만 원)은 ${financialIncomeYearlyMan > 1000 ? '초과 상태이므로 즉시 ISA 비과세 계좌로 이관해야 해요!' : '안전 구간이에요.'}`
            : `경고! 연간 금융소득이 ${financialIncomeYearlyMan.toLocaleString('ko-KR')}만 원으로 종합과세 기준(2,000만 원)을 ${Math.abs(finTaxGapMan).toLocaleString('ko-KR')}만 원 초과했어요. 고배당주 분리과세 특례 신청과 ISA/연금계좌 분산이 시급해요.`;

    const passiveExtraOver2000Man = Math.max(0, totalPassiveIncomeYearlyMan - 2000);
    const estimatedExtraHealthInsYearlyMan =
        passiveExtraOver2000Man > 0
            ? Math.round(passiveExtraOver2000Man * 0.0709)
            : 0;

    // (2) 은행·증권 ISA & 연금저축 스위칭 절세 예상액
    const potentialIsaTaxSaveMan = Math.max(
        42,
        Math.round((financialIncomeYearlyMan * 0.154) * 0.65)
    );

    // (3) 보험료 다이어트 세이브 예상액 (월 보험료가 25만 원 초과 시 리모델링 절감분 산출)
    const insuranceOverpayMonthlyMan = Math.max(8, Math.round(insuranceMonthlyMan * 0.28));
    const insuranceAnnualSaveMan = insuranceOverpayMonthlyMan * 12;

    const totalAnnualTaxAndCostSaveMan =
        potentialIsaTaxSaveMan +
        insuranceAnnualSaveMan +
        (estimatedExtraHealthInsYearlyMan > 0 ? estimatedExtraHealthInsYearlyMan : 35);

    const fullPremiumWealthReport = {
        focusMode,
        wealthGoal,
        totalAnnualTaxAndCostSaveMan,
        formattedTotalAnnualSave: formatManwonToKorean(totalAnnualTaxAndCostSaveMan),
        sections: [
            {
                badge: '🚨 금융소득 · 임대소득 세무 & 건보료 방어',
                title: '① 이자·배당 금융소득 & 부동산 임대소득 과세 시뮬레이션',
                highlightMetric:
                    estimatedExtraHealthInsYearlyMan > 0
                        ? `보수외소득 초과 건보료 연 약 ${estimatedExtraHealthInsYearlyMan.toLocaleString('ko-KR')}만 원 방어 필요`
                        : `금융소득 종합과세 여유한도 ${Math.max(0, finTaxGapMan).toLocaleString('ko-KR')}만 원 확보`,
                detailText: `${finTaxAlertText} 또한 월 임대소득 ${rentalIncomeMonthlyMan.toLocaleString('ko-KR')}만 원(연 ${rentalIncomeYearlyMan.toLocaleString('ko-KR')}만 원)과 합산된 연간 패시브 인컴은 총 ${formatManwonToKorean(totalPassiveIncomeYearlyMan)}입니다. ${healthInsType} 기준 보수외 소득 2,000만 원 초과분(${passiveExtraOver2000Man.toLocaleString('ko-KR')}만 원)에 대한 소득월액 건보료를 줄이려면 임대사업자 필요경비율 특례 및 배우자 증여(10년 6억 원 비과세 한도) 분산을 적용하세요.`
            },
            {
                badge: '🏦 은행 · 📈 증권 포트폴리오 스위칭',
                title: '② 예적금·배당주 ➔ ISA(만능계좌) & 분리과세 이전 처방',
                highlightMetric: `연간 이자·배당소득세 약 ${potentialIsaTaxSaveMan.toLocaleString('ko-KR')}만 원 즉시 절세`,
                detailText: `현재 은행 자산(${formatManwonToKorean(bankAssetMan)})과 증권 자산(${formatManwonToKorean(stockAssetMan)})에서 발생하는 이자·배당을 일반 과세(15.4%) 계좌에 두면 세금과 건보료 산정 소득이 동시에 늘어납니다. 만기 예금과 고배당 ETF를 중개형 ISA(서민형 400만/일반형 200만 비과세 후 9.9% 분리과세, 종소세 합산 제외) 및 연금저축(연 600만 원 세액공제)으로 즉시 재배치하세요.`
            },
            {
                badge: '🏢 부동산 · 🚗 동산 실물자산 리밸런싱',
                title: '③ 부동산 편중도 및 동산(자동차·금) 감가상각 방어 진단',
                highlightMetric: `전체 자산 중 부동산 비중 ${allocationRatios.realEstatePct}% · 동산 ${allocationRatios.movablePct}%`,
                detailText: `부동산(${formatManwonToKorean(realEstateAssetMan)}) 비중이 ${allocationRatios.realEstatePct}%로 ${allocationRatios.realEstatePct > 70 ? '유동성 경직 위험이 있습니다. 전세보증금 간주임대료 과세 대상을 점검하고 추가 투자는 환금성이 높은 월배당 리츠/ETF로 분산하세요.' : '안정적인 균형을 유지하고 있습니다.'} 동산(${formatManwonToKorean(movableAssetMan)}) 중 차량 등 감가상각 자산 비중은 총자산의 5% 이내로 제한하고 KRX 금현물 계좌(매매차익 비과세)를 활용하세요.`
            },
            {
                badge: '🛡️ 보험 리모델링 & 고정비 구조조정',
                title: '④ 보장성·저축성 보험 다이어트 및 현금흐름 개선 플랜',
                highlightMetric: `월 ${insuranceOverpayMonthlyMan}만 원 (연간 ${insuranceAnnualSaveMan.toLocaleString('ko-KR')}만 원) 보험료 절감 가능`,
                detailText: `현재 월 납입 보험료(${insuranceMonthlyMan}만 원) 중 중복 특약 및 원금 도달이 늦은 저축성 보험을 정리하여 월 ${insuranceOverpayMonthlyMan}만 원만 줄여도 연간 ${insuranceAnnualSaveMan.toLocaleString('ko-KR')}만 원의 추가 투자 시드머니가 확보됩니다. 실손의료보험과 3대 진단비 코어 보장만 남기는 '지출 코어화'를 실행하세요.`
            }
        ],
        actionChecklist: [
            '중개형 ISA 계좌로 고배당 ETF·리츠 이전하여 금융소득종합과세(2,000만 원) 합산 제외시키기',
            '임대소득 + 금융소득 합산액이 직장가입자 보수외소득(2,000만 원) 넘지 않도록 만기 수령 시기(연말/연초) 분산하기',
            '중복 보장성 보험 특약 정리로 절감한 월 현금흐름을 연금저축펀드 세액공제 계좌에 자동이체하기'
        ]
    };

    const encryptedPremiumPkg = encryptPersonalData(fullPremiumWealthReport);
    const portfolioId = crypto.randomUUID();

    encryptedPortfoliosLedger.set(portfolioId, {
        portfolioId,
        focusMode,
        userLookupHash: lookupHash,
        encryptedUserName: encryptedNamePkg.encryptedText,
        encryptedWealthPayload: encryptedWealthPkg.encryptedText,
        encryptionIv: encryptedWealthPkg.iv,
        encryptionAuthTag: encryptedWealthPkg.authTag,
        wealthHealthScore,
        encryptedPremiumReport: encryptedPremiumPkg,
        isUnlocked: false,
        createdAt: new Date().toISOString()
    });

    return {
        portfolioId,
        securityAudit: {
            encryptionAlgorithm: 'AES-256-GCM',
            userLookupHash: lookupHash.substring(0, 16) + '...',
            encryptedWealthPreview: encryptedWealthPkg.encryptedText.substring(0, 24) + '...'
        },
        dynamicPricing: {
            price: config.monetizationPrice,
            formattedPrice: config.formattedPrice,
            maskedOwnerId: config.maskedOwnerId,
            maskedUserIdentity: config.maskedUserIdentity
        },
        freeSummary: {
            userNameMasked: userName.length > 1 ? userName[0] + '*' + userName.slice(2) : userName,
            healthInsType,
            totalNetWorthMan,
            formattedNetWorth: formatManwonToKorean(totalNetWorthMan),
            totalPassiveIncomeYearlyMan,
            formattedPassiveIncome: formatManwonToKorean(totalPassiveIncomeYearlyMan),
            wealthHealthScore,
            allocationRatios,
            estimatedAnnualSavePreview: formatManwonToKorean(totalAnnualTaxAndCostSaveMan)
        },
        paywallTeaser: {
            isLocked: true,
            maskedSectionsPreview: [
                {
                    badge: '🚨 금융·임대소득 세무 & 건보료',
                    title: '① 이자·배당 금융소득 & 임대소득 과세 시뮬레이션',
                    maskedMetric: '예상 방어액 연 ███만 원 (잠금됨)'
                },
                {
                    badge: '🏦 은행 · 📈 증권 스위칭',
                    title: '② 예적금·배당주 ➔ ISA & 분리과세 이전 처방',
                    maskedMetric: '이자·배당 절세액 연 ██만 원 (잠금됨)'
                },
                {
                    badge: '🏢 부동산 · 🚗 동산 리밸런싱',
                    title: '③ 부동산 편중도 및 동산 감가상각 방어 진단',
                    maskedMetric: '간주임대료·유동성 처방 (잠금됨)'
                },
                {
                    badge: '🛡️ 보험 다이어트 플랜',
                    title: '④ 보장성·저축성 보험 구조조정 및 현금흐름 개선',
                    maskedMetric: '보험료 절감 연 ███만 원 (잠금됨)'
                }
            ]
        }
    };
}

/**
 * [STEP 2] 동적 유료 결제 검증 및 4대 영역 프리미엄 자산·절세 리포트 복호화 잠금 해제
 */
function verifyWealthPaymentAndUnlock(paymentInput) {
    const config = getDynamicConfig();
    const { portfolioId, paidAmount, paymentMethod } = paymentInput;

    if (!portfolioId || !encryptedPortfoliosLedger.has(portfolioId)) {
        throw new Error('유효하지 않은 포트폴리오 진단 ID(portfolioId)입니다. 먼저 무료 자산 스캔을 실행해 주세요.');
    }

    const numericPaid = Number(paidAmount);
    if (numericPaid !== config.monetizationPrice) {
        throw new Error(
            `결제 금액 위변조가 감지되었습니다! (서버 설정가: ${config.monetizationPrice}원, 요청 금액: ${numericPaid}원)`
        );
    }

    const record = encryptedPortfoliosLedger.get(portfolioId);
    record.isUnlocked = true;

    const tossPaymentKey = `toss_wealth_pay_${crypto.randomBytes(8).toString('hex')}`;
    const orderId = crypto.randomUUID();

    const orderRecord = {
        orderId,
        portfolioId,
        tossPaymentKey,
        appOwnerId: config.maskedOwnerId,
        chargedAmount: config.monetizationPrice,
        paymentMethod: paymentMethod || '토스페이 원클릭 결제',
        paymentStatus: 'PAID',
        isUnlocked: true,
        approvedAt: new Date().toISOString()
    };

    paymentOrdersLedger.set(orderId, orderRecord);

    const unlockedPremiumReport = decryptPersonalData(record.encryptedPremiumReport);

    return {
        status: 'PASS',
        orderInfo: orderRecord,
        unlockedPremiumReport
    };
}

function getWealthLedgerStatus() {
    const config = getDynamicConfig();
    return {
        totalPortfoliosScanned: encryptedPortfoliosLedger.size,
        totalPaidOrders: paymentOrdersLedger.size,
        totalRevenueKRW: paymentOrdersLedger.size * config.monetizationPrice,
        currentDynamicPrice: config.monetizationPrice,
        maskedOwnerId: config.maskedOwnerId
    };
}

module.exports = {
    analyzeWealthPortfolio,
    verifyWealthPaymentAndUnlock,
    getWealthLedgerStatus
};
