/**
 * ============================================================================
 * 파일명: app3-wealth-vault/backend/services/hakEtfEngine.js
 * 역할: [HAK ETF 관리 미니앱 핵심 엔진]
 *       1) 삼성자산운용 KODEX 핵심 ETF 카탈로그 및 구성종목(PDF) 데이터 관리
 *       2) 테마별 탐색·랭킹 필터링 및 다중 ETF 1:1 비교 분석
 *       3) 목표 월배당금(분배금) 포트폴리오 계산기 및 1~12월 배당 캘린더 생성
 *       4) 개인재정 앱(웰스볼트 AI)의 증권·ISA·금융소득(2,000만 원 건보료·절세) 연동 시뮬레이션
 *       5) 모든 사용자 민감 정보 AES-256-GCM 양방향 암호화 저장 (보안 최우선)
 * ============================================================================
 */

const crypto = require('crypto');
const {
    encryptPersonalData,
    decryptPersonalData,
    createLookupHash
} = require('../security/cryptoManager');

// 암호화된 HAK ETF 시뮬레이션 결과를 메모리에 보관하는 보안 저장소 (DB 테이블과 1:1 매핑 구조)
const inMemoryHakEtfSimulations = new Map();

/**
 * 교육용 주석:
 * 삼성자산운용 KODEX의 대표 ETF 8종 데이터입니다.
 * 각 ETF마다 종목코드(code), 테마(category), 수익률, 연 분배율(배당률), 총보수,
 * 배당 지급월(paymentMonths), 그리고 ETF 안에 어떤 주식이 들어있는지 보여주는
 * 구성종목(PDF: Portfolio Deposit File) 상위 비중 데이터를 담고 있습니다.
 */
const HAK_ETF_CATALOG = [
    {
        code: '483280',
        name: 'KODEX 미국AI메모리TOP2플러스',
        category: 'AI_SEMI',
        categoryLabel: '🤖 AI·반도체 핵심',
        oneYearReturnPct: 42.8,
        annualDividendYieldPct: 1.2,
        totalExpenseRatioPct: 0.39,
        aumBillionWon: 5420,
        currentPriceWon: 14850,
        dividendCycle: '분기배당 (1·4·7·10월)',
        paymentMonths: [1, 4, 7, 10],
        taxType: '해외주식형 (매매차익·배당 15.4% 과세 ➔ ISA·연금 절세 필수)',
        isaRecommendBadge: '🔥 연금·ISA 초고수익 성장형 1위',
        summary: 'AI 서버의 심장인 HBM 메모리 1·2위(SK하이닉스·마이크론)와 엔비디아 등 AI 밸류체인에 집중 투자합니다.',
        pdfHoldings: [
            { ticker: 'MU', name: '마이크론 테크놀로지 (Micron)', weightPct: 26.5 },
            { ticker: '000660', name: 'SK하이닉스', weightPct: 24.8 },
            { ticker: 'NVDA', name: '엔비디아 (NVIDIA)', weightPct: 16.2 },
            { ticker: 'AVGO', name: '브로드컴 (Broadcom)', weightPct: 11.4 },
            { ticker: 'TSM', name: 'TSMC', weightPct: 9.1 }
        ]
    },
    {
        code: '486290',
        name: 'KODEX 미국배당다우존스타겟커버드콜',
        category: 'MONTHLY_DIV',
        categoryLabel: '💰 월배당·커버드콜',
        oneYearReturnPct: 14.6,
        annualDividendYieldPct: 9.8,
        totalExpenseRatioPct: 0.39,
        aumBillionWon: 8950,
        currentPriceWon: 11240,
        dividendCycle: '월배당 (매월 15일경 지급)',
        paymentMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        payoutTiming: 'MID_MONTH',
        taxType: '해외주식·옵션형 (중개형 ISA 편입 시 배당 비과세·분리과세 극대화)',
        isaRecommendBadge: '💎 매월 15일 월급날 세팅 1순위',
        summary: '미국 대표 배당성장주(SCHD)에 투자하면서 탄력적 커버드콜 전략으로 연 9~10%대 높은 월배당을 추구합니다.',
        pdfHoldings: [
            { ticker: 'SCHD', name: 'Schwab US Dividend Equity ETF', weightPct: 21.0 },
            { ticker: 'ABBV', name: '애브비 (AbbVie)', weightPct: 4.5 },
            { ticker: 'HD', name: '홈디포 (Home Depot)', weightPct: 4.3 },
            { ticker: 'AVGO', name: '브로드컴 (Broadcom)', weightPct: 4.2 },
            { ticker: 'CVX', name: '셰브론 (Chevron)', weightPct: 3.9 }
        ]
    },
    {
        code: '489250',
        name: 'KODEX 200타겟위클리커버드콜',
        category: 'MONTHLY_DIV',
        categoryLabel: '💰 월배당·커버드콜',
        oneYearReturnPct: 16.2,
        annualDividendYieldPct: 14.5,
        totalExpenseRatioPct: 0.39,
        aumBillionWon: 7820,
        currentPriceWon: 10580,
        dividendCycle: '월배당 (매월 말일경 지급)',
        paymentMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        payoutTiming: 'END_MONTH',
        taxType: '국내옵션 프리미엄 비과세 특화 (금융소득 2,000만 원 한도 방어 최강)',
        isaRecommendBadge: '🛡️ 금융소득종합과세·건보료 방어 특화',
        summary: '국내 코스피200 우량주 배당에 위클리 콜옵션 프리미엄(비과세 재원)을 더해 세금 부담 없이 높은 월분배금을 지급합니다.',
        pdfHoldings: [
            { ticker: '005930', name: '삼성전자', weightPct: 28.4 },
            { ticker: '000660', name: 'SK하이닉스', weightPct: 12.6 },
            { ticker: '373220', name: 'LG에너지솔루션', weightPct: 3.8 },
            { ticker: '207940', name: '삼성바이오로직스', weightPct: 3.5 },
            { ticker: '005380', name: '현대차', weightPct: 3.2 }
        ]
    },
    {
        code: '476800',
        name: 'KODEX 한국부동산리츠인프라',
        category: 'MONTHLY_DIV',
        categoryLabel: '💰 월배당·커버드콜',
        oneYearReturnPct: 9.4,
        annualDividendYieldPct: 8.6,
        totalExpenseRatioPct: 0.09,
        aumBillionWon: 6150,
        currentPriceWon: 5320,
        dividendCycle: '월배당 (매월 말일경 지급)',
        paymentMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        payoutTiming: 'END_MONTH',
        taxType: '조특법상 분리과세 신청 가능 (5,000만 원 한도 9.9% 분리과세 혜택)',
        isaRecommendBadge: '🏢 초저보수(0.09%) + 부동산 월세 대체',
        summary: '맥쿼리인프라와 국내 대표 프라임 오피스·물류 리츠에 분산 투자해 상가 공실 걱정 없이 매월 따박따박 월세형 배당을 받습니다.',
        pdfHoldings: [
            { ticker: '088980', name: '맥쿼리인프라', weightPct: 24.8 },
            { ticker: '395400', name: 'SK리츠', weightPct: 14.2 },
            { ticker: '330590', name: '롯데리츠', weightPct: 11.8 },
            { ticker: '365550', name: 'ESR켄달스퀘어리츠', weightPct: 10.6 },
            { ticker: '293940', name: '신한알파리츠', weightPct: 9.9 }
        ]
    },
    {
        code: '379800',
        name: 'KODEX 미국S&P500',
        category: 'US_INDEX',
        categoryLabel: '🇺🇸 미국대표지수',
        oneYearReturnPct: 24.5,
        annualDividendYieldPct: 1.4,
        totalExpenseRatioPct: 0.0099,
        aumBillionWon: 34200,
        currentPriceWon: 18920,
        dividendCycle: '분기배당 (1·4·7·10월)',
        paymentMonths: [1, 4, 7, 10],
        taxType: '해외주식형 (중개형 ISA 및 연금저축 계좌 코어 자산 추천)',
        isaRecommendBadge: '👑 대한민국 대표 연금·ISA 코어 자산',
        summary: '미국을 대표하는 우량 기업 500개에 초저보수로 분산 투자하는 장기 자산 증식의 가장 든든한 기본기 ETF입니다.',
        pdfHoldings: [
            { ticker: 'AAPL', name: '애플 (Apple)', weightPct: 7.1 },
            { ticker: 'NVDA', name: '엔비디아 (NVIDIA)', weightPct: 6.8 },
            { ticker: 'MSFT', name: '마이크로소프트 (Microsoft)', weightPct: 6.5 },
            { ticker: 'AMZN', name: '아마존 (Amazon)', weightPct: 3.8 },
            { ticker: 'META', name: '메타 (Meta Platforms)', weightPct: 2.6 }
        ]
    },
    {
        code: '379810',
        name: 'KODEX 미국나스닥100',
        category: 'US_INDEX',
        categoryLabel: '🇺🇸 미국대표지수',
        oneYearReturnPct: 29.8,
        annualDividendYieldPct: 0.8,
        totalExpenseRatioPct: 0.0099,
        aumBillionWon: 21500,
        currentPriceWon: 21450,
        dividendCycle: '분기배당 (1·4·7·10월)',
        paymentMonths: [1, 4, 7, 10],
        taxType: '해외주식형 (ISA 만기 후 연금계좌 이전 시 과세이연 극대화)',
        isaRecommendBadge: '🚀 빅테크 성장주 적립식 투자 1순위',
        summary: '글로벌 혁신을 이끄는 미국 나스닥 상위 100대 기술주에 집중 투자하여 장기 복리 성장을 극대화합니다.',
        pdfHoldings: [
            { ticker: 'AAPL', name: '애플 (Apple)', weightPct: 8.8 },
            { ticker: 'NVDA', name: '엔비디아 (NVIDIA)', weightPct: 8.4 },
            { ticker: 'MSFT', name: '마이크로소프트 (Microsoft)', weightPct: 8.1 },
            { ticker: 'AVGO', name: '브로드컴 (Broadcom)', weightPct: 5.2 },
            { ticker: 'AMZN', name: '아마존 (Amazon)', weightPct: 5.0 }
        ]
    },
    {
        code: '091160',
        name: 'KODEX 반도체',
        category: 'AI_SEMI',
        categoryLabel: '🤖 AI·반도체 핵심',
        oneYearReturnPct: 31.2,
        annualDividendYieldPct: 1.5,
        totalExpenseRatioPct: 0.45,
        aumBillionWon: 9200,
        currentPriceWon: 41800,
        dividendCycle: '연 1회 (4월 지급)',
        paymentMonths: [4],
        taxType: '국내주식형 (일반 계좌에서도 매매차익 100% 비과세 혜택!)',
        isaRecommendBadge: '✨ 일반계좌 매매차익 비과세 특권',
        summary: '대한민국 반도체 산업을 대표하는 SK하이닉스, 삼성전자, 한미반도체 등 핵심 소부장 기업에 한 번에 투자합니다.',
        pdfHoldings: [
            { ticker: '000660', name: 'SK하이닉스', weightPct: 23.5 },
            { ticker: '005930', name: '삼성전자', weightPct: 21.8 },
            { ticker: '042700', name: '한미반도체', weightPct: 11.2 },
            { ticker: '058470', name: '리노공업', weightPct: 6.9 },
            { ticker: '000990', name: 'DB하이텍', weightPct: 4.4 }
        ]
    },
    {
        code: '437080',
        name: 'KODEX TDF2050액티브',
        category: 'PENSION_ISA',
        categoryLabel: '🛡️ 연금·ISA 필수',
        oneYearReturnPct: 18.9,
        annualDividendYieldPct: 2.1,
        totalExpenseRatioPct: 0.30,
        aumBillionWon: 4680,
        currentPriceWon: 14120,
        dividendCycle: '연 1회 분배 / 재투자',
        paymentMonths: [12],
        taxType: '퇴직연금(DC/IRP) 안전자산 30% 한도 내 100% 편입 가능 상품',
        isaRecommendBadge: '🏦 퇴직연금 안전자산 30% 채우기 최적',
        summary: '은퇴 시점(2050년)에 맞춰 글로벌 주식과 한국 채권 비중을 알아서 리밸런싱해 주는 연금 특화 올라운더 ETF입니다.',
        pdfHoldings: [
            { ticker: 'SPY', name: 'SPDR S&P 500 ETF Trust', weightPct: 38.0 },
            { ticker: 'QQQ', name: 'Invesco QQQ Trust', weightPct: 18.5 },
            { ticker: 'KR_BOND', name: '대한민국 국고채 10년물', weightPct: 16.0 },
            { ticker: 'EFA', name: '선진국 주식 인덱스', weightPct: 11.2 },
            { ticker: 'GLD', name: '글로벌 금 현물 ETF', weightPct: 5.3 }
        ]
    }
];

/**
 * 교육용 주석:
 * 사용자의 이름을 화면에 표시할 때 개인정보 보호를 위해 가운데 글자를 '*'로 가려주는 함수입니다.
 * 예: '이춘학' -> '이*학'
 */
function maskKoreanName(name) {
    const clean = String(name || '이춘학').trim();
    if (clean.length <= 1) return clean + '*';
    if (clean.length === 2) return clean[0] + '*';
    return clean[0] + '*'.repeat(clean.length - 2) + clean[clean.length - 1];
}

/**
 * 교육용 주석:
 * '만 원' 단위 숫자를 읽기 쉬운 '억 / 만 원' 한글 통화 표기로 바꾸어 주는 함수입니다.
 */
function formatManWon(manWonValue) {
    const num = Math.round(Number(manWonValue) || 0);
    if (num >= 10000) {
        const eok = Math.floor(num / 10000);
        const remMan = num % 10000;
        return remMan > 0
            ? `${eok.toLocaleString('ko-KR')}억 ${remMan.toLocaleString('ko-KR')}만 원`
            : `${eok.toLocaleString('ko-KR')}억 원`;
    }
    return `${num.toLocaleString('ko-KR')}만 원`;
}

/**
 * 1. [기능 ①] HAK ETF 관리 카탈로그 조회 및 테마/정렬/검색 필터링
 */
function getHakEtfCatalog(options = {}) {
    const category = options.category || 'ALL';
    const sortBy = options.sortBy || 'dividend_desc';
    const keyword = String(options.keyword || '').trim().toLowerCase();

    // 1단계: 테마 및 검색어 필터링
    let list = HAK_ETF_CATALOG.filter((etf) => {
        const matchCategory = category === 'ALL' || etf.category === category;
        const matchKeyword =
            !keyword ||
            etf.name.toLowerCase().includes(keyword) ||
            etf.code.toLowerCase().includes(keyword) ||
            etf.summary.toLowerCase().includes(keyword) ||
            etf.pdfHoldings.some((h) => h.name.toLowerCase().includes(keyword));
        return matchCategory && matchKeyword;
    });

    // 2단계: 정렬 기준 적용
    list = [...list].sort((a, b) => {
        if (sortBy === 'dividend_desc') {
            return b.annualDividendYieldPct - a.annualDividendYieldPct;
        }
        if (sortBy === 'return_desc') {
            return b.oneYearReturnPct - a.oneYearReturnPct;
        }
        if (sortBy === 'fee_asc') {
            return a.totalExpenseRatioPct - b.totalExpenseRatioPct;
        }
        if (sortBy === 'aum_desc') {
            return b.aumBillionWon - a.aumBillionWon;
        }
        return 0;
    });

    return {
        totalCount: list.length,
        items: list
    };
}

/**
 * 2. [기능 ②] 선택한 ETF 종목들의 1:1 / 다중 비교 및 구성종목(PDF) 비중 분석
 */
function compareHakEtfs(codes = []) {
    const validCodes = Array.isArray(codes) && codes.length > 0
        ? codes
        : ['486290', '489250', '483280'];

    const selectedEtfs = validCodes
        .map((c) => HAK_ETF_CATALOG.find((item) => item.code === String(c)))
        .filter(Boolean);

    if (selectedEtfs.length === 0) {
        throw new Error('비교할 ETF 종목을 최소 1개 이상 선택해 주세요.');
    }

    // 1억 원(10,000만 원) 투자 기준 비교 지표 계산
    const comparisonRows = selectedEtfs.map((etf) => {
        const annualDivOn1EokMan = Number(((10000 * etf.annualDividendYieldPct) / 100).toFixed(1));
        const monthlyDivOn1EokMan = Number((annualDivOn1EokMan / 12).toFixed(1));
        const annualFeeOn1EokWon = Math.round(100000000 * (etf.totalExpenseRatioPct / 100));

        return {
            ...etf,
            simulationOn1Eok: {
                annualDivMan: annualDivOn1EokMan,
                monthlyDivMan: monthlyDivOn1EokMan,
                annualFeeWon: annualFeeOn1EokWon
            }
        };
    });

    // 가장 수익률이 높은 ETF, 가장 배당률이 높은 ETF, 가장 보수가 저렴한 ETF 하이라이트 추출
    const bestReturnEtf = [...comparisonRows].sort((a, b) => b.oneYearReturnPct - a.oneYearReturnPct)[0];
    const bestDividendEtf = [...comparisonRows].sort((a, b) => b.annualDividendYieldPct - a.annualDividendYieldPct)[0];
    const lowestFeeEtf = [...comparisonRows].sort((a, b) => a.totalExpenseRatioPct - b.totalExpenseRatioPct)[0];

    return {
        comparedCount: comparisonRows.length,
        highlights: {
            bestReturn: `${bestReturnEtf.name} (+${bestReturnEtf.oneYearReturnPct}%)`,
            bestDividend: `${bestDividendEtf.name} (연 ${bestDividendEtf.annualDividendYieldPct}%)`,
            lowestFee: `${lowestFeeEtf.name} (연 ${lowestFeeEtf.totalExpenseRatioPct}%)`
        },
        etfs: comparisonRows
    };
}

/**
 * 3. [기능 ③ & ④] 월배당 포트폴리오 계산기 + 12개월 배당 캘린더 + 개인재정(2,000만 원 절세·건보료) 자동 연동 시뮬레이션
 *    모든 개인 데이터는 AES-256-GCM으로 암호화되어 저장됩니다.
 */
function simulateHakEtfPortfolio(input) {
    const userName = String(input.userName || '이춘학').trim();
    const healthInsType = String(input.healthInsType || '직장가입자').trim();

    // 시뮬레이션 모드: 'TARGET_DIVIDEND' (목표 월배당금 기준) 또는 'INVEST_AMOUNT' (투자금액 기준)
    const calcMode = input.calcMode === 'INVEST_AMOUNT' ? 'INVEST_AMOUNT' : 'TARGET_DIVIDEND';
    const targetMonthlyDivMan = Math.max(1, Number(input.targetMonthlyDivMan || 100)); // 기본 월 100만 원 배당 목표
    const investAmountInputMan = Math.max(100, Number(input.investAmountMan || 10000)); // 기본 1억 원(10,000만 원)

    // 개인재정 앱(웰스볼트 AI)에서 연동된 기존 자산 및 기존 금융소득
    const existingStockAssetMan = Math.max(0, Number(input.existingStockAssetMan || 8500));
    const existingFinancialIncomeYearlyMan = Math.max(0, Number(input.existingFinancialIncomeYearlyMan || 1650));

    // 사용자가 선택한 ETF 종목들 (선택 안 했을 경우 월배당 대표 3종 기본 조합)
    const requestedCodes = Array.isArray(input.selectedCodes) && input.selectedCodes.length > 0
        ? input.selectedCodes
        : ['486290', '489250', '476800'];

    const selectedEtfs = requestedCodes
        .map((code) => HAK_ETF_CATALOG.find((item) => item.code === String(code)))
        .filter(Boolean);

    const activeEtfs = selectedEtfs.length > 0
        ? selectedEtfs
        : [HAK_ETF_CATALOG[1], HAK_ETF_CATALOG[2], HAK_ETF_CATALOG[3]];

    // 동일 비중 포트폴리오 평균 연 분배율, 평균 1년 수익률, 평균 총보수 계산
    const avgDividendYieldPct = Number(
        (activeEtfs.reduce((acc, item) => acc + item.annualDividendYieldPct, 0) / activeEtfs.length).toFixed(2)
    );
    const avgOneYearReturnPct = Number(
        (activeEtfs.reduce((acc, item) => acc + item.oneYearReturnPct, 0) / activeEtfs.length).toFixed(2)
    );
    const avgExpenseRatioPct = Number(
        (activeEtfs.reduce((acc, item) => acc + item.totalExpenseRatioPct, 0) / activeEtfs.length).toFixed(3)
    );

    // 필요 투자원금 및 연간/월간 예상 배당금(세전) 계산
    let requiredInvestMan = 0;
    let expectedAnnualDivMan = 0;
    let expectedMonthlyDivMan = 0;

    const safeYield = Math.max(0.5, avgDividendYieldPct);
    if (calcMode === 'TARGET_DIVIDEND') {
        expectedMonthlyDivMan = targetMonthlyDivMan;
        expectedAnnualDivMan = Number((targetMonthlyDivMan * 12).toFixed(1));
        requiredInvestMan = Math.round((expectedAnnualDivMan / safeYield) * 100);
    } else {
        requiredInvestMan = investAmountInputMan;
        expectedAnnualDivMan = Number(((requiredInvestMan * safeYield) / 100).toFixed(1));
        expectedMonthlyDivMan = Number((expectedAnnualDivMan / 12).toFixed(1));
    }

    // 종목별 투자 배분액 및 1월~12월 월별 배당 캘린더 생성
    const perEtfInvestMan = Number((requiredInvestMan / activeEtfs.length).toFixed(1));
    const monthlyCalendar = Array.from({ length: 12 }, (_, idx) => {
        const month = idx + 1;
        let monthTotalMan = 0;
        const payers = [];

        activeEtfs.forEach((etf) => {
            if (etf.paymentMonths.includes(month)) {
                const payoutCountPerYear = etf.paymentMonths.length;
                const etfAnnualDivMan = (perEtfInvestMan * etf.annualDividendYieldPct) / 100;
                const monthDivFromEtf = etfAnnualDivMan / payoutCountPerYear;
                monthTotalMan += monthDivFromEtf;
                payers.push(etf.name.replace('KODEX ', ''));
            }
        });

        const roundedGrossMan = Number(monthTotalMan.toFixed(1));
        // 일반 계좌 배당소득세(15.4%) 공제 후 실수령액 vs 중개형 ISA 계좌 활용 시 실수령액
        const afterRegularTaxMan = Number((roundedGrossMan * (1 - 0.154)).toFixed(1));
        const afterIsaTaxMan = Number((roundedGrossMan * 0.99).toFixed(1)); // 비과세 구간 반영 시 거의 세전 수령

        return {
            month,
            monthLabel: `${month}월`,
            grossDividendMan: roundedGrossMan,
            afterRegularTaxMan,
            afterIsaTaxMan,
            payingEtfs: payers
        };
    });

    // =========================================================================
    // [기능 ④ 핵심] 개인재정 앱(웰스볼트 AI) 금융소득 2,000만 원·건보료·ISA 절세 자동 연동 분석
    // =========================================================================
    // 참고: KODEX 200타겟위클리커버드콜(489250)은 국내 옵션 프리미엄 비과세 비중(약 70%)이 있어
    // 실제 과세 대상 금융소득 합산액을 줄여주는 절세 효과가 있습니다!
    let taxableNewDividendMan = 0;
    let taxFreeOptionPremiumMan = 0;

    activeEtfs.forEach((etf) => {
        const etfAnnualDivMan = (perEtfInvestMan * etf.annualDividendYieldPct) / 100;
        if (etf.code === '489250') {
            // 국내 위클리 콜옵션 프리미엄(비과세 재원 약 75%) 분리 계산
            const freePortion = etfAnnualDivMan * 0.75;
            taxFreeOptionPremiumMan += freePortion;
            taxableNewDividendMan += etfAnnualDivMan * 0.25;
        } else {
            taxableNewDividendMan += etfAnnualDivMan;
        }
    });

    taxableNewDividendMan = Number(taxableNewDividendMan.toFixed(1));
    taxFreeOptionPremiumMan = Number(taxFreeOptionPremiumMan.toFixed(1));

    // 기존 금융소득 + 신규 과세 배당소득 합산
    const combinedFinancialIncomeMan = Number(
        (existingFinancialIncomeYearlyMan + taxableNewDividendMan).toFixed(1)
    );
    const comprehensiveTaxLimitMan = 2000; // 금융소득종합과세 기준선 2,000만 원
    const excessOver2000Man = Math.max(0, Number((combinedFinancialIncomeMan - comprehensiveTaxLimitMan).toFixed(1)));

    // 중개형 ISA(연 2,000만 원 납입, 최대 1억 한도, 손익통산 200~400만 원 비과세 + 9.9% 분리과세) 활용 시 절세액
    const regularDividendTaxMan = Number((taxableNewDividendMan * 0.154).toFixed(1));
    const isaTaxableAfterFreeMan = Math.max(0, taxableNewDividendMan - 400); // 서민형/확대 비과세 400만 원 기준
    const isaDividendTaxMan = Number((isaTaxableAfterFreeMan * 0.099).toFixed(1));
    const isaAnnualTaxSaveMan = Math.max(
        12,
        Number((regularDividendTaxMan - isaDividendTaxMan + (excessOver2000Man > 0 ? excessOver2000Man * 0.18 : 0)).toFixed(1))
    );

    let taxSafetyGrade = 'SAFE';
    let taxWarningTitle = '🟢 금융소득종합과세(2,000만 원) 안전 구간입니다';
    let taxAdviceDetail = `기존 금융소득(${existingFinancialIncomeYearlyMan.toLocaleString('ko-KR')}만 원)에 HAK ETF 신규 과세 배당금(${taxableNewDividendMan.toLocaleString('ko-KR')}만 원)을 합산해도 연 ${combinedFinancialIncomeMan.toLocaleString('ko-KR')}만 원으로 2,000만 원 이하입니다. 중개형 ISA 계좌에서 매수하시면 배당소득세(15.4%)까지 아껴 연 약 ${isaAnnualTaxSaveMan.toLocaleString('ko-KR')}만 원을 추가 절세할 수 있습니다.`;

    if (combinedFinancialIncomeMan > 2000) {
        taxSafetyGrade = 'DANGER';
        taxWarningTitle = `🚨 주의! 합산 금융소득이 2,000만 원을 ${excessOver2000Man.toLocaleString('ko-KR')}만 원 초과합니다`;
        taxAdviceDetail = `기존 금융소득(${existingFinancialIncomeYearlyMan.toLocaleString('ko-KR')}만 원) + 신규 과세 배당금(${taxableNewDividendMan.toLocaleString('ko-KR')}만 원) = 연 ${combinedFinancialIncomeMan.toLocaleString('ko-KR')}만 원으로 금융소득종합과세 및 건보료(${healthInsType}) 추가 부과 위험이 있습니다! 초과분은 반드시 ① 중개형 ISA(분리과세), ② 연금저축·IRP 계좌, 또는 ③ 비과세 옵션 프리미엄 비중이 높은 [KODEX 200타겟위클리커버드콜]이나 분리과세 [KODEX 한국부동산리츠인프라]로 배치하여 연 약 ${isaAnnualTaxSaveMan.toLocaleString('ko-KR')}만 원의 세금·건보료를 방어하세요.`;
    } else if (combinedFinancialIncomeMan >= 1500 || (healthInsType.includes('피부양자') && combinedFinancialIncomeMan >= 1000)) {
        taxSafetyGrade = 'CAUTION';
        taxWarningTitle = '🟡 금융소득 2,000만 원(피부양자 1,000만 원) 임계점 근접 구간입니다';
        taxAdviceDetail = `합산 과세 금융소득이 연 ${combinedFinancialIncomeMan.toLocaleString('ko-KR')}만 원으로 종합과세 및 피부양자 자격 기준선에 가까워지고 있습니다. 일반 계좌 대신 중개형 ISA 및 조특법 분리과세 리츠 ETF를 우선 활용하여 과세표준 합산을 막으시면 연 약 ${isaAnnualTaxSaveMan.toLocaleString('ko-KR')}만 원의 절세 효과를 얻습니다.`;
    }

    // =========================================================================
    // [보안 규칙 8 준수] 개인 자산 및 ETF 시뮬레이션 데이터 AES-256-GCM 암호화 저장
    // =========================================================================
    const simulationId = crypto.randomUUID();
    const userLookupHash = createLookupHash(`${userName}_${healthInsType}_HAK_ETF`);
    const encryptedNameObj = encryptPersonalData(userName);
    const encryptedPayloadObj = encryptPersonalData({
        userName,
        healthInsType,
        calcMode,
        requiredInvestMan,
        expectedAnnualDivMan,
        expectedMonthlyDivMan,
        existingStockAssetMan,
        existingFinancialIncomeYearlyMan,
        selectedCodes: activeEtfs.map((e) => e.code),
        simulatedAt: new Date().toISOString()
    });

    inMemoryHakEtfSimulations.set(simulationId, {
        simulationId,
        userLookupHash,
        encryptedUserName: encryptedNameObj.encryptedText,
        encryptedEtfPayload: encryptedPayloadObj.encryptedText,
        encryptionIv: encryptedPayloadObj.iv,
        encryptionAuthTag: encryptedPayloadObj.authTag,
        selectedEtfCount: activeEtfs.length,
        expectedAnnualYieldPct: avgDividendYieldPct,
        taxSafetyGrade
    });

    return {
        simulationId,
        userNameMasked: maskKoreanName(userName),
        healthInsType,
        calcMode,
        portfolioSummary: {
            selectedEtfCount: activeEtfs.length,
            selectedEtfs: activeEtfs.map((e) => ({
                code: e.code,
                name: e.name,
                categoryLabel: e.categoryLabel,
                annualDividendYieldPct: e.annualDividendYieldPct,
                oneYearReturnPct: e.oneYearReturnPct,
                totalExpenseRatioPct: e.totalExpenseRatioPct,
                allocatedInvestMan: perEtfInvestMan
            })),
            requiredInvestMan,
            formattedRequiredInvest: formatManWon(requiredInvestMan),
            expectedAnnualDivMan,
            formattedAnnualDiv: formatManWon(expectedAnnualDivMan),
            expectedMonthlyDivMan,
            formattedMonthlyDiv: formatManWon(expectedMonthlyDivMan),
            avgDividendYieldPct,
            avgOneYearReturnPct,
            avgExpenseRatioPct
        },
        monthlyCalendar,
        wealthVaultSync: {
            existingStockAssetMan,
            existingFinancialIncomeYearlyMan,
            newTotalStockAssetMan: existingStockAssetMan + requiredInvestMan,
            formattedNewTotalStockAsset: formatManWon(existingStockAssetMan + requiredInvestMan),
            taxableNewDividendMan,
            taxFreeOptionPremiumMan,
            combinedFinancialIncomeMan,
            formattedCombinedFinancialIncome: formatManWon(combinedFinancialIncomeMan),
            comprehensiveTaxLimitMan,
            excessOver2000Man,
            isaAnnualTaxSaveMan,
            formattedIsaAnnualTaxSave: `${isaAnnualTaxSaveMan.toLocaleString('ko-KR')}만 원`,
            taxSafetyGrade,
            taxWarningTitle,
            taxAdviceDetail
        },
        securityAudit: {
            algorithm: 'AES-256-GCM',
            userLookupHash: userLookupHash.slice(0, 16) + '...',
            encryptedPayloadPreview: encryptedPayloadObj.encryptedText.slice(0, 28) + '...',
            ivPreview: encryptedPayloadObj.iv
        }
    };
}

module.exports = {
    HAK_ETF_CATALOG,
    getHakEtfCatalog,
    compareHakEtfs,
    simulateHakEtfPortfolio
};
