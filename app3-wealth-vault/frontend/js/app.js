/**
 * ============================================================================
 * 파일명: app3-wealth-vault/frontend/js/app.js
 * 역할: [제3호 앱 AGENT 2-DIFF & AGENT 5] 웰스볼트 AI 인터랙션 컨트롤러
 *       + [HAK ETF 관리] 미니앱 양방향 자산·배당 실시간 동기화 모듈
 *       + [금융권 마이데이터] 카카오페이·은행·증권사·보험사 자산내역 통합 불러오기 컨트롤러
 * ============================================================================
 */

const appState = {
    focusMode: 'TOTAL_WEALTH',
    wealthGoal: '금융·임대소득 절세 및 건보료 방어',
    dynamicPrice: 3900,
    formattedPrice: '3,900',
    maskedOwnerId: '',
    maskedUserIdentity: '',
    currentPortfolioId: null,
    isUnlocked: false,
    lastUnlockedReport: null,
    theme: 'light',
    // 금융권 마이데이터 연동 상태
    institutionsCatalog: [],
    selectedInstCodes: ['KAKAOPAY', 'CU_BANK', 'KAKAOBANK', 'SAMSUNG_SEC', 'MIRAE_SEC', 'MERITZ_INS', 'CU_PENSION_INS'],
    customAccountBalances: {},
    syncedAccounts: [],
    syncedHeldEtfCodes: ['486290', '489250', '483280']
};

const SOCIAL_PROOF_MESSAGES = [
    '방금 서울 서초구 최*석님이 카카오페이·삼성증권·신협 자산을 불러와 연 310만 원을 절세했어요',
    '1분 전 경기 판교 이*훈님이 HAK ETF 관리에서 월 100만 원 배당 포트폴리오를 설계했어요',
    '방금 서울 송파구 김*정님이 메리츠화재·보장성 보험 리모델링으로 월 22만 원 현금흐름을 찾았어요',
    '2분 전 부산 해운대 박*현님이 임대·배당소득 2,000만 원 초과 건보료를 사전 방어했어요'
];

const MODE_PRESETS = {
    TOTAL_WEALTH: {
        headerTitle: '웰스볼트 AI',
        badge: 'VIP 프라이빗 뱅킹(PB) AI 에디션',
        titleHtml: '은행·증권·부동산·보험 내 재산,<br />세금과 건보료 누수부터 막으세요',
        subtitle: '예적금·주식·부동산·동산·보험 5대 자산 비중과 이자·배당 금융소득 및 월세 임대소득에 따른 종소세·건보료 폭탄 위험을 정밀 스캔해요.',
        accentPrimary: '#2563EB',
        accentSecondary: '#4F46E5',
        accentGlow: 'rgba(37, 99, 235, 0.30)'
    },
    REALESTATE_RENT: {
        headerTitle: '부동산·임대소득 절세 볼트',
        badge: '다주택·상가·전월세 임대소득 특화',
        titleHtml: '월세·보증금 임대소득 과세와<br />건보료 피부양자 탈락을 방어하세요',
        subtitle: '전세보증금 간주임대료와 월세 수입이 직장인 보수외소득(2,000만 원) 및 건보료에 미치는 영향을 집중 진단해요.',
        accentPrimary: '#059669',
        accentSecondary: '#0EA5E9',
        accentGlow: 'rgba(5, 150, 105, 0.30)'
    },
    FINANCE_DIVIDEND: {
        headerTitle: '은행·증권·배당 절세 볼트',
        badge: '금융소득종합과세 2,000만 원 방어 특화',
        titleHtml: '이자·배당 금융소득 2,000만 원,<br />ISA와 분리과세로 똑똑하게 피하세요',
        subtitle: '은행 예적금 이자와 국내외 배당금 합산 과세를 피하는 중개형 ISA·연금저축 최적 이전 금액을 계산해 드려요.',
        accentPrimary: '#7C3AED',
        accentSecondary: '#EC4899',
        accentGlow: 'rgba(124, 58, 237, 0.30)'
    }
};

let toastTimeoutId = null;
function showTdsToast(message) {
    const toastEl = document.getElementById('tdsToast');
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add('show');

    if (toastTimeoutId) {
        clearTimeout(toastTimeoutId);
    }
    toastTimeoutId = setTimeout(() => {
        toastEl.classList.remove('show');
    }, 2600);
}

function toggleGlassTheme() {
    appState.theme = appState.theme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', appState.theme);
    const btn = document.getElementById('themeToggleBtn');
    if (btn) {
        btn.textContent = appState.theme === 'dark' ? '☀️' : '🌙';
    }
    showTdsToast(
        appState.theme === 'dark'
            ? '🌌 iOS 스페이셜 다크 글래스 모드가 켜졌어요'
            : '☀️ 크리스탈 라이트 글래스 모드가 켜졌어요'
    );
}

/**
 * ============================================================================
 * [신규 추가] 💛 카카오페이 · 은행 · 증권사 마이데이터 자산내역 불러오기 함수군
 * ============================================================================
 */
async function loadMyDataInstitutionsCatalog() {
    try {
        const res = await fetch('/api/mydata/institutions');
        const json = await res.json();
        if (json.success) {
            appState.institutionsCatalog = json.data.institutions;
            renderMyDataInstitutionGrid();
        }
    } catch (err) {
        console.error('금융기관 카탈로그 로드 실패:', err);
    }
}

function renderMyDataInstitutionGrid() {
    const gridEl = document.getElementById('myDataInstGrid');
    if (!gridEl) return;

    gridEl.innerHTML = appState.institutionsCatalog
        .map((inst) => {
            const isChecked = appState.selectedInstCodes.includes(inst.instCode);
            return `
            <div class="mydata-inst-card ${isChecked ? 'checked' : ''}" data-instcode="${inst.instCode}">
                <span class="mydata-inst-icon">${inst.icon}</span>
                <div class="mydata-inst-info">
                    <div class="mydata-inst-name">${isChecked ? '☑ ' : '☐ '}${inst.instName}</div>
                    <div class="mydata-inst-sector">${inst.sectorLabel} (${inst.accounts.length}계좌)</div>
                </div>
            </div>`;
        })
        .join('');

    gridEl.querySelectorAll('.mydata-inst-card').forEach((card) => {
        card.addEventListener('click', () => {
            const code = card.dataset.instcode;
            const idx = appState.selectedInstCodes.indexOf(code);
            if (idx >= 0) {
                if (appState.selectedInstCodes.length <= 1) {
                    showTdsToast('⚠️ 최소 1개 이상의 금융기관을 선택해 주세요.');
                    return;
                }
                appState.selectedInstCodes.splice(idx, 1);
            } else {
                appState.selectedInstCodes.push(code);
            }
            renderMyDataInstitutionGrid();
        });
    });
}

function openMyDataModal() {
    const modal = document.getElementById('myDataModalBackdrop');
    if (modal) {
        renderMyDataInstitutionGrid();
        modal.classList.add('open');
    }
}

function closeMyDataModal() {
    const modal = document.getElementById('myDataModalBackdrop');
    if (modal) {
        modal.classList.remove('open');
    }
}

async function executeMyDataAssetSync() {
    const btn = document.getElementById('confirmMyDataSyncBtn');
    const origText = btn.textContent;
    btn.textContent = '🔐 AES-256 암호화 자산 불러오는 중...';
    btn.disabled = true;

    const pastedText = document.getElementById('myDataPasteTextarea')
        ? document.getElementById('myDataPasteTextarea').value
        : '';

    try {
        const res = await fetch('/api/mydata/fetch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userName: document.getElementById('userNameInput').value.trim() || '이춘학',
                selectedInstCodes: appState.selectedInstCodes,
                customBalances: appState.customAccountBalances,
                pastedText
            })
        });

        const json = await res.json();
        if (!json.success) {
            throw new Error(json.message || '자산 내역을 불러오지 못했습니다.');
        }

        closeMyDataModal();
        applyFetchedMyDataToScreen(json.data);
    } catch (err) {
        showTdsToast(err.message);
    } finally {
        btn.textContent = origText;
        btn.disabled = false;
    }
}

/**
 * 교육용 주석:
 * 서버에서 불러온 금융권 계좌들의 합계(은행·증권·금융소득·월 보험료)를 입력칸에 자동으로 채워주고,
 * 각 계좌별 상세 잔고 리스트를 화면에 펼쳐서 사용자가 금액을 직접 수정할 수도 있게 해줍니다.
 */
function applyFetchedMyDataToScreen(syncData) {
    const agg = syncData.aggregatedAssets;
    appState.syncedAccounts = syncData.accounts;
    appState.syncedHeldEtfCodes = agg.heldEtfCodes;

    // 1. 입력칸 자동 채우기
    document.getElementById('bankAssetInput').value = agg.totalBankAssetMan;
    document.getElementById('stockAssetInput').value = agg.totalStockAssetMan;
    document.getElementById('financialIncomeInput').value = agg.totalFinancialIncomeYearlyMan;
    if (agg.totalInsuranceMonthlyMan > 0) {
        document.getElementById('insuranceMonthlyInput').value = agg.totalInsuranceMonthlyMan;
    }

    // 2. 상단 배지 및 HAK ETF 연동 저장소 업데이트
    document.getElementById('myDataSyncBadge').textContent =
        `✔ ${syncData.syncedInstitutionCount}개 금융기관(${syncData.syncedAccountCount}계좌) 연동됨`;

    localStorage.setItem(
        'MYDATA_SYNCED_STATE',
        JSON.stringify({
            syncedAt: new Date().toISOString(),
            aggregatedAssets: agg,
            accounts: syncData.accounts
        })
    );

    // 3. 계좌별 상세 잔고 리스트 렌더링 (실시간 잔액 수정 지원)
    const panel = document.getElementById('syncedMyDataPanel');
    const listContainer = document.getElementById('syncedAccountsListContainer');
    const headerText = document.getElementById('syncedAccountsHeaderText');

    if (panel && listContainer) {
        panel.classList.remove('hidden');
        headerText.textContent =
            `📂 불러온 계좌 내역 (${syncData.syncedAccountCount}개 · 총 금융자산 ${(agg.totalBankAssetMan + agg.totalStockAssetMan).toLocaleString('ko-KR')}만 원)`;

        listContainer.innerHTML = syncData.accounts
            .map((acc) => {
                const isIns = acc.assetType === 'INSURANCE';
                const currentVal = isIns ? acc.monthlyPremiumMan : acc.balanceMan;
                const unitLabel = isIns ? '만 원/월' : '만 원';
                const subNote = isIns
                    ? `월 보험·공제료 (${acc.taxNote})`
                    : `연 수익·이자 약 ${acc.annualIncomeMan}만 원 (${acc.annualYieldPct}%)`;

                return `
                <div class="mydata-account-row">
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-weight: 800; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${acc.icon} ${acc.accountName}
                        </div>
                        <div style="font-size: 10px; color: var(--text-secondary);">
                            ${acc.maskedAccountNo} · ${subNote}
                        </div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 4px;">
                        <input
                            type="number"
                            class="mydata-balance-input"
                            data-accountid="${acc.accountId}"
                            data-assettype="${acc.assetType}"
                            data-yieldpct="${acc.annualYieldPct || 3.5}"
                            value="${currentVal}"
                            min="0"
                        />
                        <span style="font-size: 11px; font-weight: 700; color: var(--text-secondary); white-space: nowrap;">
                            ${unitLabel}
                        </span>
                    </div>
                </div>`;
            })
            .join('');

        // 개별 계좌 금액을 수정하면 즉시 은행·증권·금융소득·보험료 합계를 다시 계산
        listContainer.querySelectorAll('.mydata-balance-input').forEach((inputEl) => {
            inputEl.addEventListener('input', () => {
                const accId = inputEl.dataset.accountid;
                const numVal = Math.max(0, Number(inputEl.value || 0));
                appState.customAccountBalances[accId] = numVal;
                recalculateFromEditedAccountInputs();
            });
        });
    }

    showTdsToast(
        `💛 카카오페이·은행·증권사 등 ${syncData.syncedAccountCount}개 계좌(총 ${(agg.totalBankAssetMan + agg.totalStockAssetMan).toLocaleString('ko-KR')}만 원)를 불러왔어요!`
    );
}

/**
 * 교육용 주석:
 * 사용자가 불러온 계좌 목록에서 특정 통장이나 증권 계좌의 잔액 숫자를 바꾸면,
 * 즉시 전체 은행자산·증권자산·연간 이자/배당 금융소득·월 보험료 합계를 다시 계산해 줍니다.
 */
function recalculateFromEditedAccountInputs() {
    let bankSum = 0;
    let stockSum = 0;
    let incomeSum = 0;
    let insSum = 0;

    document.querySelectorAll('#syncedAccountsListContainer .mydata-balance-input').forEach((el) => {
        const val = Math.max(0, Number(el.value || 0));
        const aType = el.dataset.assettype;
        const yieldPct = Number(el.dataset.yieldpct || 0);

        if (aType === 'BANK') {
            bankSum += val;
            incomeSum += Math.round((val * yieldPct) / 100);
        } else if (aType === 'STOCK') {
            stockSum += val;
            incomeSum += Math.round((val * yieldPct) / 100);
        } else if (aType === 'INSURANCE') {
            insSum += val;
        }
    });

    document.getElementById('bankAssetInput').value = bankSum;
    document.getElementById('stockAssetInput').value = stockSum;
    document.getElementById('financialIncomeInput').value = incomeSum;
    document.getElementById('insuranceMonthlyInput').value = insSum;

    const headerText = document.getElementById('syncedAccountsHeaderText');
    if (headerText) {
        headerText.textContent =
            `📂 불러온 계좌 내역 (실시간 수정 반영됨 · 총 금융자산 ${(bankSum + stockSum).toLocaleString('ko-KR')}만 원)`;
    }
}

/**
 * 교육용 주석:
 * 개인재정 앱(웰스볼트 AI)에서 현재 입력된 이름, 건강보험 자격, 증권자산, 연간 금융소득,
 * 그리고 마이데이터로 불러온 보유 ETF 코드 목록을 담아 'HAK ETF 관리' 미니앱(/hak-etf.html)으로 이동합니다.
 */
function openHakEtfMiniApp() {
    const syncPayload = {
        userName: document.getElementById('userNameInput').value.trim() || '이춘학',
        healthInsType: document.getElementById('healthInsTypeSelect').value,
        stockAssetMan: Number(document.getElementById('stockAssetInput').value || 0),
        financialIncomeYearlyMan: Number(document.getElementById('financialIncomeInput').value || 0),
        heldEtfCodes: appState.syncedHeldEtfCodes,
        savedAt: new Date().toISOString()
    };

    localStorage.setItem('WEALTH_VAULT_TO_HAK_ETF', JSON.stringify(syncPayload));
    showTdsToast('📈 HAK ETF 관리 미니앱으로 내 자산 데이터를 연동하여 이동합니다!');

    setTimeout(() => {
        window.location.href = '/hak-etf.html';
    }, 350);
}

/**
 * 교육용 주석:
 * 'HAK ETF 관리' 미니앱에서 월배당 포트폴리오를 설계한 뒤 돌아왔을 때,
 * 계산된 총 증권자산과 합산 금융소득을 자동으로 입력칸에 반영해 주는 함수입니다.
 */
function applySyncedDataFromHakEtf() {
    try {
        const raw = localStorage.getItem('HAK_ETF_TO_WEALTH_VAULT');
        if (!raw) return;
        const synced = JSON.parse(raw);

        if (synced.userName) {
            document.getElementById('userNameInput').value = synced.userName;
        }
        if (synced.healthInsType) {
            document.getElementById('healthInsTypeSelect').value = synced.healthInsType;
        }
        if (typeof synced.newTotalStockAssetMan === 'number') {
            document.getElementById('stockAssetInput').value = synced.newTotalStockAssetMan;
        }
        if (typeof synced.combinedFinancialIncomeMan === 'number') {
            document.getElementById('financialIncomeInput').value = synced.combinedFinancialIncomeMan;
        }

        const badgeEl = document.getElementById('hakSyncBadgeText');
        const noticeEl = document.getElementById('hakSyncStatusNotice');
        if (badgeEl) {
            badgeEl.textContent = `✔ 월 +${synced.addedMonthlyDividendMan.toLocaleString('ko-KR')}만 원 배당 연동됨`;
        }
        if (noticeEl) {
            noticeEl.innerHTML = `<strong>[HAK ETF 관리 반영 완료]</strong> 선택하신 ETF(${synced.selectedEtfNames.length}종) 투자금 <strong>+${synced.addedEtfInvestMan.toLocaleString('ko-KR')}만 원</strong>(월 배당 약 ${synced.addedMonthlyDividendMan.toLocaleString('ko-KR')}만 원)이 아래 증권 자산과 금융소득에 자동 합산되었습니다!`;
        }

        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('from') === 'hak-etf') {
            showTdsToast(`🎉 HAK ETF 관리 포트폴리오(월 배당 +${synced.addedMonthlyDividendMan}만 원)가 내 재산에 자동 반영되었어요!`);
        }
    } catch (err) {
        console.error('HAK ETF 데이터 반영 오류:', err);
    }
}

function initDynamicIsland() {
    const pill = document.getElementById('dynamicIslandPill');
    const hint = document.getElementById('islandHintText');
    const tickerEl = document.getElementById('socialTickerText');

    if (pill) {
        pill.addEventListener('click', () => {
            const isExp = pill.classList.toggle('expanded');
            if (hint) {
                hint.textContent = isExp ? '닫기 ▲' : '터치 ▼';
            }
        });
    }

    if (tickerEl) {
        let index = 0;
        setInterval(() => {
            index = (index + 1) % SOCIAL_PROOF_MESSAGES.length;
            tickerEl.style.opacity = '0';
            setTimeout(() => {
                tickerEl.textContent = SOCIAL_PROOF_MESSAGES[index];
                tickerEl.style.opacity = '1';
            }, 220);
        }, 3200);
    }
}

function updateFunnelStepIndicator(stepNumber) {
    const s1 = document.getElementById('funnelStep1');
    const s2 = document.getElementById('funnelStep2');
    const s3 = document.getElementById('funnelStep3');
    [s1, s2, s3].forEach((el) => el.classList.remove('active', 'done'));

    if (stepNumber === 1) {
        s1.classList.add('active');
    } else if (stepNumber === 2) {
        s1.classList.add('done');
        s2.classList.add('active');
    } else if (stepNumber === 3) {
        s1.classList.add('done');
        s2.classList.add('done');
        s3.classList.add('active');
    }
}

async function loadDynamicEnvironmentConfig() {
    try {
        const res = await fetch('/api/config');
        const json = await res.json();
        if (json.success) {
            appState.dynamicPrice = json.monetizationPrice;
            appState.formattedPrice = json.formattedPrice;
            appState.maskedOwnerId = json.maskedOwnerId;
            appState.maskedUserIdentity = json.maskedUserIdentity;

            document.getElementById('envOwnerDisplay').textContent =
                `${json.maskedUserIdentity} (${json.maskedOwnerId})`;
            document.getElementById('envPriceDisplay').textContent =
                `${json.formattedPrice}원`;

            document.getElementById('inlineUnlockBtn').textContent =
                `${json.formattedPrice}원으로 4대 재산·절세 처방전 열기`;
            document.getElementById('modalOwnerIdText').textContent = json.maskedOwnerId;
            document.getElementById('modalUserIdentityText').textContent = json.maskedUserIdentity;
            document.getElementById('modalFinalPriceText').textContent = `${json.formattedPrice}원`;
            document.getElementById('confirmTossPayBtn').textContent =
                `${json.formattedPrice}원 바로 결제하기`;
        }
    } catch (error) {
        console.error('환경변수 설정 로드 실패:', error);
    }
}

function switchFocusMode(modeKey) {
    appState.focusMode = modeKey;
    const preset = MODE_PRESETS[modeKey] || MODE_PRESETS.TOTAL_WEALTH;

    const rootStyle = document.documentElement.style;
    rootStyle.setProperty('--accent-primary', preset.accentPrimary);
    rootStyle.setProperty('--accent-secondary', preset.accentSecondary);
    rootStyle.setProperty('--accent-glow', preset.accentGlow);

    document.getElementById('headerAppTitle').textContent = preset.headerTitle;
    document.getElementById('heroModeBadge').textContent = preset.badge;
    document.getElementById('heroMainTitle').innerHTML = preset.titleHtml;
    document.getElementById('heroSubTitle').textContent = preset.subtitle;

    resetToInputView();
    showTdsToast(`🎨 Material Expressive [${preset.headerTitle}] 테마가 적용되었어요`);
}

function resetToInputView() {
    appState.currentPortfolioId = null;
    appState.isUnlocked = false;
    updateFunnelStepIndicator(1);
    document.getElementById('resultContainer').classList.add('hidden');
    document.getElementById('loadingSection').classList.add('hidden');
    document.getElementById('inputSection').classList.remove('hidden');
    document.getElementById('floatingNudgeBubble').textContent =
        '⚡ 3초 만에 무료로 내 5대 자산 비중과 과세 안전도를 진단해 보세요!';
    document.getElementById('mainCtaBtn').textContent = '내 통합 재산 & 임대·금융소득 무료 진단하기';
}

async function submitFreeWealthAnalysis() {
    const payload = {
        userName: document.getElementById('userNameInput').value.trim() || '이춘학',
        healthInsType: document.getElementById('healthInsTypeSelect').value,
        bankAssetMan: Number(document.getElementById('bankAssetInput').value || 0),
        stockAssetMan: Number(document.getElementById('stockAssetInput').value || 0),
        realEstateAssetMan: Number(document.getElementById('realEstateAssetInput').value || 0),
        movableAssetMan: Number(document.getElementById('movableAssetInput').value || 0),
        financialIncomeYearlyMan: Number(document.getElementById('financialIncomeInput').value || 0),
        rentalIncomeMonthlyMan: Number(document.getElementById('rentalIncomeInput').value || 0),
        insuranceMonthlyMan: Number(document.getElementById('insuranceMonthlyInput').value || 0),
        wealthGoal: appState.wealthGoal,
        focusMode: appState.focusMode
    };

    document.getElementById('inputSection').classList.add('hidden');
    document.getElementById('resultContainer').classList.add('hidden');
    document.getElementById('loadingSection').classList.remove('hidden');

    try {
        const res = await fetch('/api/wealth/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const json = await res.json();
        if (!json.success) {
            throw new Error(json.message || '자산 분석 중 오류가 발생했습니다.');
        }

        setTimeout(() => {
            renderPreviewWealthResult(json.data);
        }, 700);
    } catch (err) {
        showTdsToast(err.message);
        resetToInputView();
    }
}

function renderPreviewWealthResult(data) {
    appState.currentPortfolioId = data.portfolioId;
    appState.isUnlocked = false;
    updateFunnelStepIndicator(2);

    document.getElementById('loadingSection').classList.add('hidden');
    document.getElementById('resultContainer').classList.remove('hidden');

    const s = data.freeSummary;
    document.getElementById('freeUserHeaderText').textContent =
        `${s.userNameMasked}님 (${s.healthInsType}) 5대 자산 & 패시브 인컴 포트폴리오`;
    document.getElementById('freeNetWorthText').textContent = s.formattedNetWorth;
    document.getElementById('freePassiveIncomeBadge').textContent =
        `연 패시브소득(이자·배당·임대) ${s.formattedPassiveIncome}`;
    document.getElementById('freeHealthScoreText').textContent = `${s.wealthHealthScore}점`;

    // 5대 자산 비중 바 업데이트
    document.getElementById('barBank').style.width = `${s.allocationRatios.bankPct}%`;
    document.getElementById('barStock').style.width = `${s.allocationRatios.stockPct}%`;
    document.getElementById('barRealEstate').style.width = `${s.allocationRatios.realEstatePct}%`;
    document.getElementById('barMovable').style.width = `${s.allocationRatios.movablePct}%`;
    document.getElementById('barInsurance').style.width = `${s.allocationRatios.insurancePct}%`;

    document.getElementById('pctBank').textContent = `${s.allocationRatios.bankPct}%`;
    document.getElementById('pctStock').textContent = `${s.allocationRatios.stockPct}%`;
    document.getElementById('pctRealEstate').textContent = `${s.allocationRatios.realEstatePct}%`;
    document.getElementById('pctMovable').textContent = `${s.allocationRatios.movablePct}%`;
    document.getElementById('pctInsurance').textContent = `${s.allocationRatios.insurancePct}%`;

    document.getElementById('cryptoAuditText').textContent =
        `Hash(${data.securityAudit.userLookupHash}) / Cipher(${data.securityAudit.encryptedWealthPreview})`;
    document.getElementById('teaserAnnualSaveText').textContent = s.estimatedAnnualSavePreview;

    // 블러(Paywall) 상태 세팅
    document.getElementById('premiumReportContent').classList.remove('unlocked');
    document.getElementById('paywallOverlay').classList.remove('hidden');
    document.getElementById('receiptSuccessCard').classList.add('hidden');

    const badge = document.getElementById('unlockStatusBadge');
    badge.textContent = '🔒 유료 잠금';
    badge.style.background = 'var(--toss-danger-bg)';
    badge.style.color = 'var(--toss-danger)';

    document.getElementById('wealthSectionsList').innerHTML = data.paywallTeaser.maskedSectionsPreview
        .map(
            (sec) => `
            <div class="wealth-section-card">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <span style="font-size: 11px; font-weight: 800; color: var(--accent-primary);">${sec.badge}</span>
                    <span style="font-size: 12px; font-weight: 800; color: var(--toss-success);">${sec.maskedMetric}</span>
                </div>
                <div style="font-size: 14px; font-weight: 800; margin-bottom: 4px;">${sec.title}</div>
                <p style="font-size: 12px; color: var(--text-secondary);">
                    결제 즉시 정확한 과세 한도, ISA 이전 금액, 보험료 절감 액수가 공개돼요.
                </p>
            </div>`
        )
        .join('');

    document.getElementById('floatingNudgeBubble').textContent =
        `🔥 연 ${s.estimatedAnnualSavePreview} 절세·건보료 방어 전략을 지금 바로 잠금 해제하세요!`;
    document.getElementById('mainCtaBtn').textContent =
        `🔒 ${appState.formattedPrice}원으로 4대 재산·절세 처방전 열기`;

    showTdsToast(`🎉 총 순자산 ${s.formattedNetWorth} 포트폴리오 진단 완료!`);
}

function openPaymentModal() {
    document.getElementById('paymentModalBackdrop').classList.add('open');
}

function closePaymentModal() {
    document.getElementById('paymentModalBackdrop').classList.remove('open');
}

async function processTossPayment() {
    if (!appState.currentPortfolioId) {
        showTdsToast('먼저 무료 재산·소득 진단을 실행해 주세요.');
        return;
    }

    const confirmBtn = document.getElementById('confirmTossPayBtn');
    const originalText = confirmBtn.textContent;
    confirmBtn.textContent = '토스페이 결제 승인 검증 중...';
    confirmBtn.disabled = true;

    try {
        const res = await fetch('/api/payment/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                portfolioId: appState.currentPortfolioId,
                paidAmount: appState.dynamicPrice,
                paymentMethod: '토스페이 원클릭 결제'
            })
        });

        const json = await res.json();
        if (!json.success) {
            throw new Error(json.message || '결제 검증에 실패했습니다.');
        }

        closePaymentModal();
        renderUnlockedWealthReport(json.data);
    } catch (err) {
        showTdsToast(err.message);
    } finally {
        confirmBtn.textContent = originalText;
        confirmBtn.disabled = false;
    }
}

function renderUnlockedWealthReport(verificationData) {
    appState.isUnlocked = true;
    updateFunnelStepIndicator(3);

    const report = verificationData.unlockedPremiumReport;
    const orderInfo = verificationData.orderInfo;
    appState.lastUnlockedReport = report;

    document.getElementById('paywallOverlay').classList.add('hidden');
    document.getElementById('premiumReportContent').classList.add('unlocked');

    const badge = document.getElementById('unlockStatusBadge');
    badge.textContent = '🔓 잠금 해제 완료';
    badge.style.background = 'var(--toss-success-bg)';
    badge.style.color = 'var(--toss-success)';

    document.getElementById('wealthSectionsList').innerHTML = report.sections
        .map(
            (sec) => `
            <div class="wealth-section-card">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                    <span style="font-size: 11px; font-weight: 800; color: var(--accent-primary);">${sec.badge}</span>
                    <span style="font-size: 12px; font-weight: 800; color: var(--toss-success);">${sec.highlightMetric}</span>
                </div>
                <div style="font-size: 15px; font-weight: 800; margin-bottom: 6px;">${sec.title}</div>
                <p style="font-size: 13px; color: var(--text-primary); line-height: 1.55;">${sec.detailText}</p>
            </div>`
        )
        .join('');

    document.getElementById('annualSaveTotalText').textContent = report.formattedTotalAnnualSave;
    document.getElementById('checklistContainer').innerHTML = report.actionChecklist
        .map((c) => `<div style="margin-bottom: 6px;">✅ ${c}</div>`)
        .join('');

    document.getElementById('receiptSuccessCard').classList.remove('hidden');
    document.getElementById('receiptMetaText').textContent =
        `주문번호: ${orderInfo.tossPaymentKey} | 결제금액: ${orderInfo.chargedAmount.toLocaleString('ko-KR')}원 | 정산파트너: ${orderInfo.appOwnerId}`;

    document.getElementById('floatingNudgeBubble').textContent =
        '✅ 5대 재산 및 임대·금융소득 절세 처방전이 모두 잠금 해제되었어요!';
    document.getElementById('mainCtaBtn').textContent = '🔄 자산 수치 변경하여 다시 시뮬레이션하기';

    showTdsToast('🔓 결제 검증 완료! 프라이빗 웰스·절세 리포트가 열렸어요');
}

document.addEventListener('DOMContentLoaded', () => {
    loadDynamicEnvironmentConfig();
    initDynamicIsland();
    loadMyDataInstitutionsCatalog();
    applySyncedDataFromHakEtf();

    const themeBtn = document.getElementById('themeToggleBtn');
    if (themeBtn) {
        themeBtn.addEventListener('click', toggleGlassTheme);
    }

    // [금융권 마이데이터 자산 불러오기] 모달 이벤트 연결
    const openMyDataBtn = document.getElementById('openMyDataModalBtn');
    if (openMyDataBtn) {
        openMyDataBtn.addEventListener('click', openMyDataModal);
    }
    const closeMyDataBtn = document.getElementById('closeMyDataModalBtn');
    if (closeMyDataBtn) {
        closeMyDataBtn.addEventListener('click', closeMyDataModal);
    }
    const confirmMyDataBtn = document.getElementById('confirmMyDataSyncBtn');
    if (confirmMyDataBtn) {
        confirmMyDataBtn.addEventListener('click', executeMyDataAssetSync);
    }
    const selectAllBtn = document.getElementById('selectAllMyDataBtn');
    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => {
            appState.selectedInstCodes = appState.institutionsCatalog.map((i) => i.instCode);
            renderMyDataInstitutionGrid();
        });
    }
    const resetDefaultBtn = document.getElementById('resetDefaultMyDataBtn');
    if (resetDefaultBtn) {
        resetDefaultBtn.addEventListener('click', () => {
            appState.selectedInstCodes = appState.institutionsCatalog
                .filter((i) => i.defaultSelected)
                .map((i) => i.instCode);
            renderMyDataInstitutionGrid();
        });
    }

    // [HAK ETF 관리] 바로가기 버튼 3종 이벤트 연결
    ['openHakEtfHeaderBtn', 'openHakEtfBannerBtn', 'openHakEtfInlineBtn'].forEach((btnId) => {
        const btnEl = document.getElementById(btnId);
        if (btnEl) {
            btnEl.addEventListener('click', openHakEtfMiniApp);
        }
    });

    document.querySelectorAll('.loop-tab-btn').forEach((tabBtn) => {
        tabBtn.addEventListener('click', () => {
            document.querySelectorAll('.loop-tab-btn').forEach((b) => b.classList.remove('active'));
            tabBtn.classList.add('active');
            switchFocusMode(tabBtn.dataset.mode);
        });
    });

    document.querySelectorAll('#goalChipGroup .tds-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('#goalChipGroup .tds-chip').forEach((c) => c.classList.remove('selected'));
            chip.classList.add('selected');
            appState.wealthGoal = chip.dataset.goal;
        });
    });

    document.getElementById('mainCtaBtn').addEventListener('click', () => {
        if (!appState.currentPortfolioId) {
            submitFreeWealthAnalysis();
        } else if (!appState.isUnlocked) {
            openPaymentModal();
        } else {
            resetToInputView();
        }
    });

    document.getElementById('inlineUnlockBtn').addEventListener('click', openPaymentModal);
    document.getElementById('cancelPayModalBtn').addEventListener('click', closePaymentModal);
    document.getElementById('confirmTossPayBtn').addEventListener('click', processTossPayment);

    document.getElementById('copyReportBtn').addEventListener('click', async () => {
        if (!appState.lastUnlockedReport) return;
        const r = appState.lastUnlockedReport;
        const text = [
            `[웰스볼트 AI - 연간 기대 절세·절감액 ${r.formattedTotalAnnualSave} 처방전]`,
            ...r.sections.map((s) => `${s.title} (${s.highlightMetric})\n└ ${s.detailText}`)
        ].join('\n\n');

        try {
            await navigator.clipboard.writeText(text);
            showTdsToast('📋 4대 재산·절세 처방전이 클립보드에 복사되었어요!');
        } catch {
            showTdsToast('복사 완료!');
        }
    });
});
