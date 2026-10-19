/**
 * ============================================================================
 * 파일명: app3-wealth-vault/backend/services/mydataSyncEngine.js
 * 역할: [금융권 마이데이터(MyData) 통합 자산 불러오기 엔진]
 *       1) 카카오페이·토스·네이버페이, 은행(신협·카카오뱅크·IBK·시중은행),
 *          증권사(삼성·미래에셋·키움), 보험사(메리츠화재·신협공제) 계좌 연동
 *       2) 사용자 맞춤 잔액 직접 수정(Override) 및 앱/엑셀 복사 텍스트 자동 파싱 지원
 *       3) 은행자산·증권자산·연간 금융소득(이자+배당)·월 보험료·보유 ETF 종목 자동 집계
 *       4) 모든 개인 금융계좌 내역 AES-256-GCM 양방향 암호화 저장 (보안 규칙 8 준수)
 * ============================================================================
 */

const crypto = require('crypto');
const {
    encryptPersonalData,
    createLookupHash
} = require('../security/cryptoManager');

// 암호화된 금융권 자산 연동 내역을 보관하는 인메모리 보안 원장
const inMemoryMyDataSyncs = new Map();

/**
 * 교육용 주석:
 * 국내 주요 금융권(페이·은행·증권사·보험사) 10대 기관 카탈로그 및 기본 계좌 내역입니다.
 * 사용자가 원하는 기관만 체크해서 불러올 수도 있고, 불러온 뒤 각 계좌의 금액을
 * 본인의 실제 통장 잔고에 맞게 1만 원 단위로 자유롭게 수정할 수도 있습니다.
 */
const FINANCIAL_INSTITUTIONS_CATALOG = [
    {
        instCode: 'KAKAOPAY',
        instName: '카카오페이 · 카카오페이증권',
        sector: 'PAY_FINTECH',
        sectorLabel: '💛 페이·핀테크',
        icon: '💛',
        badgeColor: '#FEE500',
        textColor: '#191919',
        defaultSelected: true,
        description: '카카오페이머니 파킹통장 및 페이증권 미국배당·AI 소수점/ETF 모으기 내역',
        accounts: [
            {
                accountId: 'KAKAO_PAY_MONEY',
                accountName: '카카오페이머니 (플러스 파킹)',
                maskedAccountNo: '3333-**-8910',
                assetType: 'BANK', // 예치금 성격 -> 은행/현금성 자산 합산
                balanceMan: 420,
                annualYieldPct: 3.0,
                annualIncomeMan: 13,
                taxNote: '예금자보호 및 선불충전금 이자소득'
            },
            {
                accountId: 'KAKAO_PAY_SEC_ETF',
                accountName: '카카오페이증권 ETF 모으기 계좌',
                maskedAccountNo: '060-**-4412',
                assetType: 'STOCK', // 증권/ETF 자산 합산
                balanceMan: 1280,
                annualYieldPct: 8.5,
                annualIncomeMan: 109,
                heldEtfCodes: ['486290', '379810'],
                taxNote: '미국배당다우존스커버드콜 · 나스닥100 적립식 보유'
            }
        ]
    },
    {
        instCode: 'CU_BANK',
        instName: '신협중앙회 (정기예탁금·출자금)',
        sector: 'BANK',
        sectorLabel: '🏦 은행·협동조합',
        icon: '🏦',
        badgeColor: '#0284C7',
        textColor: '#FFFFFF',
        defaultSelected: true,
        description: '신협 파워정기예탁금, 불어나예탁금(퇴직충당금), 비과세 출자금 통장 내역',
        accounts: [
            {
                accountId: 'CU_POWER_DEPOSIT',
                accountName: '신협 파워정기예탁금 (세금우대)',
                maskedAccountNo: '131-**-0927',
                assetType: 'BANK',
                balanceMan: 3000,
                annualYieldPct: 4.1,
                annualIncomeMan: 123,
                taxNote: '조합원 저율과세(1.4% 농특세) 3,000만 원 한도 적용'
            },
            {
                accountId: 'CU_BULEONA_DEPOSIT',
                accountName: '신협 불어나예탁금 (퇴직충당·자유입출금)',
                maskedAccountNo: '131-**-2318',
                assetType: 'BANK',
                balanceMan: 1450,
                annualYieldPct: 3.5,
                annualIncomeMan: 51,
                taxNote: '수시입출금 및 목돈 예치 계좌'
            },
            {
                accountId: 'CU_SHARE_CAPITAL',
                accountName: '신협 조합원 출자금 통장',
                maskedAccountNo: '131-**-0004',
                assetType: 'BANK',
                balanceMan: 550,
                annualYieldPct: 4.8,
                annualIncomeMan: 26,
                taxNote: '2,000만 원 한도 배당금 전액 비과세 혜택'
            }
        ]
    },
    {
        instCode: 'KAKAOBANK',
        instName: '카카오뱅크 (세이프박스·입출금)',
        sector: 'BANK',
        sectorLabel: '🏦 은행·협동조합',
        icon: '🦁',
        badgeColor: '#FACC15',
        textColor: '#1E293B',
        defaultSelected: true,
        description: '카카오뱅크 세이프박스 파킹통장 및 생활비 주거래 입출금 계좌',
        accounts: [
            {
                accountId: 'KABANG_SAFEBOX',
                accountName: '카카오뱅크 세이프박스 + 입출금통장',
                maskedAccountNo: '3333-**-5120',
                assetType: 'BANK',
                balanceMan: 1100,
                annualYieldPct: 2.8,
                annualIncomeMan: 31,
                taxNote: '수시 입출금 비상금 파킹 계좌'
            }
        ]
    },
    {
        instCode: 'IBK_BANK',
        instName: 'IBK기업은행',
        sector: 'BANK',
        sectorLabel: '🏦 은행·협동조합',
        icon: '🏢',
        badgeColor: '#1D4ED8',
        textColor: '#FFFFFF',
        defaultSelected: false,
        description: 'IBK기업은행 급여·사업자 주거래 예금 및 적금 계좌',
        accounts: [
            {
                accountId: 'IBK_MAIN_DEPOSIT',
                accountName: 'IBK 주거래 우대예금 통장',
                maskedAccountNo: '012-**-7721',
                assetType: 'BANK',
                balanceMan: 980,
                annualYieldPct: 3.2,
                annualIncomeMan: 31,
                taxNote: '일반과세(15.4%) 예금 계좌'
            }
        ]
    },
    {
        instCode: 'SAMSUNG_SEC',
        instName: '삼성증권 (mPOP · 중개형 ISA)',
        sector: 'SECURITIES',
        sectorLabel: '📈 증권사(주식·ETF)',
        icon: '📈',
        badgeColor: '#1428A0',
        textColor: '#FFFFFF',
        defaultSelected: true,
        description: '삼성증권 중개형 ISA 절세계좌 및 KODEX 월배당·AI메모리 ETF 보유 내역',
        accounts: [
            {
                accountId: 'SAMSUNG_ISA_ACCOUNT',
                accountName: '삼성증권 중개형 ISA (절세 만능계좌)',
                maskedAccountNo: '110-**-9981',
                assetType: 'STOCK',
                balanceMan: 5200,
                annualYieldPct: 11.2,
                annualIncomeMan: 582,
                heldEtfCodes: ['489250', '486290', '483280'],
                taxNote: 'KODEX 200타겟위클리커버드콜 · 미국배당다우존스 · 미국AI메모리 보유'
            },
            {
                accountId: 'SAMSUNG_PENSION_ETF',
                accountName: '삼성증권 연금저축 ETF 계좌',
                maskedAccountNo: '110-**-3340',
                assetType: 'STOCK',
                balanceMan: 2400,
                annualYieldPct: 8.8,
                annualIncomeMan: 211,
                heldEtfCodes: ['379800', '437080'],
                taxNote: 'KODEX 미국S&P500 · TDF2050액티브 연금 과세이연 보유'
            }
        ]
    },
    {
        instCode: 'MIRAE_SEC',
        instName: '미래에셋증권 (M-STOCK · 연금)',
        sector: 'SECURITIES',
        sectorLabel: '📈 증권사(주식·ETF)',
        icon: '🧡',
        badgeColor: '#EA580C',
        textColor: '#FFFFFF',
        defaultSelected: true,
        description: '미래에셋증권 일반 주식·ETF 종합계좌 및 퇴직연금 IRP 내역',
        accounts: [
            {
                accountId: 'MIRAE_ETF_GENERAL',
                accountName: '미래에셋 종합매매 (미국나스닥·리츠 ETF)',
                maskedAccountNo: '301-**-6615',
                assetType: 'STOCK',
                balanceMan: 2100,
                annualYieldPct: 7.9,
                annualIncomeMan: 166,
                heldEtfCodes: ['379810', '476800'],
                taxNote: '미국나스닥100 및 한국부동산리츠인프라 월배당 보유'
            }
        ]
    },
    {
        instCode: 'KIWOOM_SEC',
        instName: '키움증권 (영웅문S#)',
        sector: 'SECURITIES',
        sectorLabel: '📈 증권사(주식·ETF)',
        icon: '🟣',
        badgeColor: '#9333EA',
        textColor: '#FFFFFF',
        defaultSelected: false,
        description: '키움증권 국내 반도체·배당주 및 해외주식 직접투자 계좌',
        accounts: [
            {
                accountId: 'KIWOOM_STOCK_MAIN',
                accountName: '키움증권 종합 위탁계좌',
                maskedAccountNo: '552-**-1092',
                assetType: 'STOCK',
                balanceMan: 1500,
                annualYieldPct: 6.4,
                annualIncomeMan: 96,
                heldEtfCodes: ['091160'],
                taxNote: 'KODEX 반도체 및 국내 우량 배당주 보유'
            }
        ]
    },
    {
        instCode: 'TOSS_NAVER_PAY',
        instName: '토스페이 · 네이버페이 머니',
        sector: 'PAY_FINTECH',
        sectorLabel: '💛 페이·핀테크',
        icon: '💙',
        badgeColor: '#2563EB',
        textColor: '#FFFFFF',
        defaultSelected: false,
        description: '토스페이 머니·토스뱅크 파킹통장 및 네이버페이 포인트·머니 내역',
        accounts: [
            {
                accountId: 'TOSS_NAVER_PARKING',
                accountName: '토스·네이버페이 파킹 예치금 합산',
                maskedAccountNo: '1000-**-7788',
                assetType: 'BANK',
                balanceMan: 380,
                annualYieldPct: 3.0,
                annualIncomeMan: 11,
                taxNote: '페이 간편결제 연결 파킹통장'
            }
        ]
    },
    {
        instCode: 'MERITZ_INS',
        instName: '메리츠화재 · 손해보험',
        sector: 'INSURANCE',
        sectorLabel: '🛡️ 보험·연금공제',
        icon: '🛡️',
        badgeColor: '#DC2626',
        textColor: '#FFFFFF',
        defaultSelected: true,
        description: '메리츠화재 종합보장보험·실손의료비보험 월 납입 보험료 내역',
        accounts: [
            {
                accountId: 'MERITZ_HEALTH_PROTECTION',
                accountName: '메리츠화재 무배당 종합보장·실손보험',
                maskedAccountNo: '2026-**-1190',
                assetType: 'INSURANCE',
                balanceMan: 0,
                monthlyPremiumMan: 23,
                annualYieldPct: 0,
                annualIncomeMan: 0,
                taxNote: '월 납입 보장성 보험료 23만 원'
            }
        ]
    },
    {
        instCode: 'CU_PENSION_INS',
        instName: '신협 무배당 희망찬 연금공제',
        sector: 'INSURANCE',
        sectorLabel: '🛡️ 보험·연금공제',
        icon: '🌱',
        badgeColor: '#059669',
        textColor: '#FFFFFF',
        defaultSelected: true,
        description: '신협 희망찬 연금공제 월 납입 공제료 및 노후 연금 적립 내역',
        accounts: [
            {
                accountId: 'CU_HOPE_PENSION',
                accountName: '신협 무배당 희망찬 연금공제',
                maskedAccountNo: '2026-**-2327',
                assetType: 'INSURANCE',
                balanceMan: 0,
                monthlyPremiumMan: 25,
                annualYieldPct: 3.8,
                annualIncomeMan: 0,
                taxNote: '월 납입 연금공제료 25만 원 (10년 이상 유지 시 이자소득 비과세)'
            }
        ]
    }
];

/**
 * 1. 연동 가능한 전체 금융기관 카탈로그 목록 조회
 */
function getMyDataInstitutions() {
    return {
        totalInstitutions: FINANCIAL_INSTITUTIONS_CATALOG.length,
        institutions: FINANCIAL_INSTITUTIONS_CATALOG
    };
}

/**
 * 교육용 주석:
 * 사용자가 은행·증권사·카카오페이 앱이나 엑셀에서 복사해 붙여넣은 텍스트를 분석하여
 * 계좌 내역으로 자동 변환해 주는 스마트 파서 함수입니다.
 * 예: "카카오페이 500만원" 또는 "삼성증권, 4500, 380"
 */
function parsePastedFinancialText(rawText) {
    const cleanText = String(rawText || '').trim();
    if (!cleanText) return [];

    const lines = cleanText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

    const parsedAccounts = [];
    lines.forEach((line, idx) => {
        // 줄 안에서 숫자(금액) 추출
        const numMatches = line.match(/[\d,]+/g);
        if (!numMatches || numMatches.length === 0) return;

        const cleanNumbers = numMatches
            .map((n) => Number(n.replace(/,/g, '')))
            .filter((n) => !Number.isNaN(n) && n > 0);

        if (cleanNumbers.length === 0) return;

        let balanceMan = cleanNumbers[0];
        // 만약 사용자가 '50,000,000'처럼 원 단위로 복사해 넣었다면 자동으로 '만 원' 단위로 변환
        if (balanceMan >= 1000000) {
            balanceMan = Math.round(balanceMan / 10000);
        }

        const lower = line.toLowerCase();
        let assetType = 'BANK';
        let instLabel = '직접 붙여넣기 계좌';
        let estimatedYieldPct = 3.5;

        if (
            lower.includes('증권') ||
            lower.includes('etf') ||
            lower.includes('isa') ||
            lower.includes('주식') ||
            lower.includes('미래에셋') ||
            lower.includes('키움') ||
            lower.includes('배당')
        ) {
            assetType = 'STOCK';
            instLabel = '직접 입력 증권·ETF';
            estimatedYieldPct = 9.0;
        } else if (lower.includes('보험') || lower.includes('화재') || lower.includes('공제')) {
            assetType = 'INSURANCE';
            instLabel = '직접 입력 보험·공제';
            estimatedYieldPct = 0;
        } else if (lower.includes('카카오페이') || lower.includes('토스') || lower.includes('네이버페이')) {
            assetType = lower.includes('주식') || lower.includes('etf') ? 'STOCK' : 'BANK';
            instLabel = '직접 입력 페이자산';
            estimatedYieldPct = assetType === 'STOCK' ? 8.5 : 3.0;
        }

        const titlePart = line.replace(/[\d,]+(만\s*원|원)?/g, '').replace(/[,:\-\t]+/g, ' ').trim();
        const accountName = titlePart || `${instLabel} #${idx + 1}`;
        const annualIncomeMan =
            assetType === 'INSURANCE'
                ? 0
                : cleanNumbers[1] && cleanNumbers[1] < balanceMan
                ? cleanNumbers[1]
                : Math.round((balanceMan * estimatedYieldPct) / 100);

        parsedAccounts.push({
            accountId: `CUSTOM_PASTE_${idx + 1}`,
            instCode: 'CUSTOM_PASTE',
            instName: instLabel,
            icon: assetType === 'STOCK' ? '📈' : assetType === 'INSURANCE' ? '🛡️' : '💛',
            accountName,
            maskedAccountNo: '직접입력-연동완료',
            assetType,
            balanceMan: assetType === 'INSURANCE' ? 0 : balanceMan,
            monthlyPremiumMan: assetType === 'INSURANCE' ? balanceMan : 0,
            annualYieldPct: estimatedYieldPct,
            annualIncomeMan,
            heldEtfCodes: assetType === 'STOCK' ? ['486290', '489250'] : [],
            taxNote: '클립보드 텍스트 자동 인식 계좌'
        });
    });

    return parsedAccounts;
}

/**
 * 2. 선택한 금융기관들의 자산·계좌 내역 통합 불러오기 및 AES-256-GCM 암호화 저장
 */
function fetchAndSyncMyDataAssets(input = {}) {
    const userName = String(input.userName || '이춘학').trim();
    const selectedInstCodes =
        Array.isArray(input.selectedInstCodes) && input.selectedInstCodes.length > 0
            ? input.selectedInstCodes
            : FINANCIAL_INSTITUTIONS_CATALOG.filter((i) => i.defaultSelected).map((i) => i.instCode);

    // 사용자가 화면에서 개별 계좌 잔액을 직접 수정한 값 (key: accountId, value: 수정된 만원 금액)
    const customBalances = input.customBalances && typeof input.customBalances === 'object'
        ? input.customBalances
        : {};

    const syncedAccounts = [];
    const heldEtfCodeSet = new Set();

    // 1단계: 체크된 금융기관들의 계좌 수집 및 맞춤 금액 반영
    FINANCIAL_INSTITUTIONS_CATALOG.forEach((inst) => {
        if (!selectedInstCodes.includes(inst.instCode)) return;

        inst.accounts.forEach((acc) => {
            const overrideVal = customBalances[acc.accountId];
            const hasOverride = overrideVal !== undefined && overrideVal !== '' && !Number.isNaN(Number(overrideVal));

            let finalBalanceMan = acc.balanceMan || 0;
            let finalMonthlyPremiumMan = acc.monthlyPremiumMan || 0;
            let finalAnnualIncomeMan = acc.annualIncomeMan || 0;

            if (hasOverride) {
                const numVal = Math.max(0, Number(overrideVal));
                if (acc.assetType === 'INSURANCE') {
                    finalMonthlyPremiumMan = numVal;
                } else {
                    finalBalanceMan = numVal;
                    finalAnnualIncomeMan = Math.round((finalBalanceMan * (acc.annualYieldPct || 3.5)) / 100);
                }
            }

            if (Array.isArray(acc.heldEtfCodes)) {
                acc.heldEtfCodes.forEach((code) => heldEtfCodeSet.add(code));
            }

            syncedAccounts.push({
                accountId: acc.accountId,
                instCode: inst.instCode,
                instName: inst.instName,
                sector: inst.sector,
                sectorLabel: inst.sectorLabel,
                icon: inst.icon,
                accountName: acc.accountName,
                maskedAccountNo: acc.maskedAccountNo,
                assetType: acc.assetType,
                balanceMan: finalBalanceMan,
                monthlyPremiumMan: finalMonthlyPremiumMan,
                annualYieldPct: acc.annualYieldPct,
                annualIncomeMan: finalAnnualIncomeMan,
                heldEtfCodes: acc.heldEtfCodes || [],
                taxNote: acc.taxNote
            });
        });
    });

    // 2단계: 클립보드 복사-붙여넣기 텍스트가 있으면 추가로 파싱하여 합산
    const pastedAccounts = parsePastedFinancialText(input.pastedText || '');
    pastedAccounts.forEach((pAcc) => {
        if (Array.isArray(pAcc.heldEtfCodes)) {
            pAcc.heldEtfCodes.forEach((code) => heldEtfCodeSet.add(code));
        }
        syncedAccounts.push(pAcc);
    });

    // 3단계: 웰스볼트 AI 및 HAK ETF 관리에 자동 입력할 자산군별 합계 산출
    let totalBankAssetMan = 0;
    let totalStockAssetMan = 0;
    let totalPayMoneyMan = 0;
    let totalFinancialIncomeYearlyMan = 0;
    let totalInsuranceMonthlyMan = 0;

    syncedAccounts.forEach((acc) => {
        if (acc.instCode === 'KAKAOPAY' || acc.instCode === 'TOSS_NAVER_PAY') {
            totalPayMoneyMan += acc.balanceMan;
        }
        if (acc.assetType === 'BANK') {
            totalBankAssetMan += acc.balanceMan;
            totalFinancialIncomeYearlyMan += acc.annualIncomeMan;
        } else if (acc.assetType === 'STOCK') {
            totalStockAssetMan += acc.balanceMan;
            totalFinancialIncomeYearlyMan += acc.annualIncomeMan;
        } else if (acc.assetType === 'INSURANCE') {
            totalInsuranceMonthlyMan += acc.monthlyPremiumMan || 0;
        }
    });

    const totalFinancialAssetMan = totalBankAssetMan + totalStockAssetMan;
    const heldEtfCodes = Array.from(heldEtfCodeSet);

    // 4단계: [보안 규칙 8 준수] 불러온 전체 계좌 내역 AES-256-GCM 양방향 암호화 저장
    const syncId = crypto.randomUUID();
    const userLookupHash = createLookupHash(`${userName}_MYDATA_SYNC`);
    const encryptedNameObj = encryptPersonalData(userName);
    const encryptedAccountsObj = encryptPersonalData({
        userName,
        selectedInstCodes,
        syncedAccounts,
        totals: {
            totalBankAssetMan,
            totalStockAssetMan,
            totalFinancialIncomeYearlyMan,
            totalInsuranceMonthlyMan
        },
        syncedAt: new Date().toISOString()
    });

    inMemoryMyDataSyncs.set(syncId, {
        syncId,
        userLookupHash,
        encryptedUserName: encryptedNameObj.encryptedText,
        encryptedAccountsPayload: encryptedAccountsObj.encryptedText,
        encryptionIv: encryptedAccountsObj.iv,
        encryptionAuthTag: encryptedAccountsObj.authTag,
        syncedInstitutionCount: selectedInstCodes.length,
        syncedAccountCount: syncedAccounts.length
    });

    return {
        syncId,
        syncedInstitutionCount: selectedInstCodes.length,
        syncedAccountCount: syncedAccounts.length,
        aggregatedAssets: {
            totalBankAssetMan,
            totalStockAssetMan,
            totalPayMoneyMan,
            totalFinancialAssetMan,
            totalFinancialIncomeYearlyMan,
            totalInsuranceMonthlyMan,
            heldEtfCodes: heldEtfCodes.length > 0 ? heldEtfCodes : ['486290', '489250', '483280']
        },
        accounts: syncedAccounts,
        securityAudit: {
            algorithm: 'AES-256-GCM',
            userLookupHash: userLookupHash.slice(0, 16) + '...',
            encryptedAccountsPreview: encryptedAccountsObj.encryptedText.slice(0, 28) + '...',
            ivPreview: encryptedAccountsObj.iv
        }
    };
}

module.exports = {
    FINANCIAL_INSTITUTIONS_CATALOG,
    getMyDataInstitutions,
    fetchAndSyncMyDataAssets
};
