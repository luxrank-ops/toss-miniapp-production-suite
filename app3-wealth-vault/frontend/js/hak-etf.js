/**
 * ============================================================================
 * 파일명: app3-wealth-vault/frontend/js/hak-etf.js
 * 역할: [HAK ETF 관리 미니앱 프론트엔드 컨트롤러]
 *       1) 월배당 포트폴리오 계산기 & 12개월 배당 캘린더 렌더링
 *       2) KODEX / 주요 ETF 테마별 탐색·랭킹 및 키워드 검색
 *       3) ETF 다중 비교표 & 구성종목(PDF) 비중 차트 렌더링
 *       4) 개인재정 앱(웰스볼트 AI) 및 카카오페이·은행·증권사 마이데이터 실시간 동기화
 * ============================================================================
 */

const hakState = {
    activeTab: 'TAB_DIVIDEND',
    calcMode: 'TARGET_DIVIDEND',
    selectedCodes: ['486290', '489250', '476800'], // 기본 추천 월배당 3종 조합
    filterCategory: 'ALL',
    sortBy: 'dividend_desc',
    keyword: '',
    lastSimulation: null,
    theme: 'light'
};

let hakToastTimer = null;

/**
 * 교육용 주석:
 * 화면 상단에 부드럽게 내려오는 캡슐 형태의 알림 메시지(토스트)를 띄워주는 함수입니다.
 */
function showHakToast(message) {
    const toastEl = document.getElementById('tdsToast');
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add('show');

    if (hakToastTimer) {
        clearTimeout(hakToastTimer);
    }
    hakToastTimer = setTimeout(() => {
        toastEl.classList.remove('show');
    }, 2700);
}

/**
 * 교육용 주석:
 * 라이트 모드와 다크 모드를 전환하는 함수입니다.
 */
function toggleHakTheme() {
    hakState.theme = hakState.theme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', hakState.theme);
    const btn = document.getElementById('themeToggleBtn');
    if (btn) {
        btn.textContent = hakState.theme === 'dark' ? '☀️' : '🌙';
    }
    showHakToast(
        hakState.theme === 'dark'
            ? '🌌 스페이셜 다크 글래스 모드가 켜졌어요'
            : '☀️ 크리스탈 라이트 글래스 모드가 켜졌어요'
    );
}

/**
 * 교육용 주석:
 * 개인재정 앱(웰스볼트 AI)에서 넘어온 사용자의 이름, 건강보험 자격,
 * 기존 증권자산, 기존 금융소득 및 보유 ETF 종목을 자동으로 읽어와 입력칸에 채워줍니다.
 */
function loadSyncedDataFromWealthVault() {
    try {
        const raw = localStorage.getItem('WEALTH_VAULT_TO_HAK_ETF');
        if (!raw) return;
        const parsed = JSON.parse(raw);

        if (parsed.userName) {
            document.getElementById('hakUserNameInput').value = parsed.userName;
        }
        if (parsed.healthInsType) {
            document.getElementById('hakHealthTypeSelect').value = parsed.healthInsType;
        }
        if (typeof parsed.stockAssetMan === 'number') {
            document.getElementById('existingStockInput').value = parsed.stockAssetMan;
            document.getElementById('heroExistingStockText').textContent =
                `${parsed.stockAssetMan.toLocaleString('ko-KR')}만 원`;
        }
        if (typeof parsed.financialIncomeYearlyMan === 'number') {
            document.getElementById('existingFinIncomeInput').value = parsed.financialIncomeYearlyMan;
            document.getElementById('heroExistingFinIncomeText').textContent =
                `연 ${parsed.financialIncomeYearlyMan.toLocaleString('ko-KR')}만 원`;
        }
        if (Array.isArray(parsed.heldEtfCodes) && parsed.heldEtfCodes.length > 0) {
            hakState.selectedCodes = parsed.heldEtfCodes;
        }
        showHakToast('🏦 개인재정 앱(웰스볼트 AI)의 내 자산·금융소득 데이터를 불러왔어요!');
    } catch (err) {
        console.error('개인재정 앱 데이터 연동 로드 오류:', err);
    }
}

/**
 * 교육용 주석:
 * HAK ETF 관리 화면 안에서 '💛 카카오페이 · 은행 · 증권사 내 자산 & 보유 ETF 불러오기' 버튼을 눌렀을 때
 * 금융권 계좌들의 증권자산, 금융소득, 보유 KODEX ETF 종목들을 즉시 불러와 반영하는 함수입니다.
 */
async function fetchMyDataDirectlyInHakEtf() {
    const btn = document.getElementById('hakQuickMyDataFetchBtn');
    const origText = btn.textContent;
    btn.textContent = '🔐 금융권 계좌 & 보유 ETF 암호화 연동 중...';
    btn.disabled = true;

    try {
        const res = await fetch('/api/mydata/fetch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userName: document.getElementById('hakUserNameInput').value.trim() || '이춘학'
            })
        });
        const json = await res.json();
        if (!json.success) {
            throw new Error(json.message || '금융권 자산 불러오기 실패');
        }

        const d = json.data;
        const agg = d.aggregatedAssets;

        document.getElementById('existingStockInput').value = agg.totalStockAssetMan;
        document.getElementById('existingFinIncomeInput').value = agg.totalFinancialIncomeYearlyMan;

        if (Array.isArray(agg.heldEtfCodes) && agg.heldEtfCodes.length > 0) {
            hakState.selectedCodes = agg.heldEtfCodes;
        }

        const statusEl = document.getElementById('hakMyDataStatusText');
        if (statusEl) {
            statusEl.textContent = `✔ ${d.syncedInstitutionCount}개 금융기관 연동 완료`;
        }

        const boxEl = document.getElementById('hakSyncedAccountsBox');
        if (boxEl) {
            boxEl.classList.remove('hidden');
            const stockAccounts = d.accounts.filter((a) => a.assetType === 'STOCK' || a.instCode === 'KAKAOPAY');
            boxEl.innerHTML =
                `<div style="font-weight: 800; color: var(--hak-accent-blue); margin-bottom: 4px;">📂 연동된 주요 페이·증권 계좌 (${stockAccounts.length}개)</div>` +
                stockAccounts
                    .map(
                        (a) => `
                        <div style="display: flex; justify-content: space-between; padding: 3px 0; border-bottom: 1px dashed var(--border-subtle);">
                            <span>${a.icon} ${a.accountName}</span>
                            <strong>${a.balanceMan.toLocaleString('ko-KR')}만 원 (연 ${a.annualIncomeMan}만)</strong>
                        </div>`
                    )
                    .join('');
        }

        await runHakPortfolioSimulation();
        showHakToast(
            `💛 카카오페이·삼성·미래에셋·신협 등 ${d.syncedAccountCount}개 계좌와 보유 ETF(${hakState.selectedCodes.length}종)를 불러왔어요!`
        );
    } catch (err) {
        showHakToast(err.message);
    } finally {
        btn.textContent = origText;
        btn.disabled = false;
    }
}

/**
 * 교육용 주석:
 * 상단 3개 탭(월배당·절세 계산기 / ETF 탐색·랭킹 / ETF 비교·PDF)을 전환하는 함수입니다.
 */
function switchHakTab(tabKey) {
    hakState.activeTab = tabKey;

    document.querySelectorAll('.loop-tab-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.tab === tabKey);
    });

    const divSec = document.getElementById('tabDividendSection');
    const findSec = document.getElementById('tabFinderSection');
    const compSec = document.getElementById('tabCompareSection');

    divSec.classList.toggle('hidden', tabKey !== 'TAB_DIVIDEND');
    findSec.classList.toggle('hidden', tabKey !== 'TAB_FINDER');
    compSec.classList.toggle('hidden', tabKey !== 'TAB_COMPARE');

    if (tabKey === 'TAB_DIVIDEND') {
        runHakPortfolioSimulation();
    } else if (tabKey === 'TAB_FINDER') {
        loadAndRenderEtfCatalog();
    } else if (tabKey === 'TAB_COMPARE') {
        loadAndRenderEtfComparison();
    }
}

/**
 * 교육용 주석:
 * 특정 ETF 종목을 내 포트폴리오 및 비교함에 추가하거나 제거하는 토글 함수입니다.
 */
function toggleSelectEtfCode(code, name) {
    const idx = hakState.selectedCodes.indexOf(code);
    if (idx >= 0) {
        if (hakState.selectedCodes.length <= 1) {
            showHakToast('⚠️ 최소 1개 이상의 ETF 종목이 선택되어 있어야 해요!');
            return;
        }
        hakState.selectedCodes.splice(idx, 1);
        showHakToast(`➖ [${name}] 종목을 포트폴리오에서 제외했어요`);
    } else {
        hakState.selectedCodes.push(code);
        showHakToast(`➕ [${name}] 종목을 포트폴리오에 담았어요!`);
    }

    document.getElementById('selectedCountBadge').textContent =
        `선택 ETF ${hakState.selectedCodes.length}종목`;

    if (hakState.activeTab === 'TAB_FINDER') {
        loadAndRenderEtfCatalog();
    } else if (hakState.activeTab === 'TAB_COMPARE') {
        loadAndRenderEtfComparison();
    } else {
        runHakPortfolioSimulation();
    }
}

/**
 * 1. [탭 1 기능] 월배당 계산기 + 12개월 배당 캘린더 + 개인재정 2,000만 원 절세 시뮬레이션 실행
 */
async function runHakPortfolioSimulation() {
    const payload = {
        userName: document.getElementById('hakUserNameInput').value.trim() || '이춘학',
        healthInsType: document.getElementById('hakHealthTypeSelect').value,
        calcMode: hakState.calcMode,
        targetMonthlyDivMan: Number(document.getElementById('targetMonthlyDivInput').value || 100),
        investAmountMan: Number(document.getElementById('investAmountInput').value || 10000),
        existingStockAssetMan: Number(document.getElementById('existingStockInput').value || 0),
        existingFinancialIncomeYearlyMan: Number(document.getElementById('existingFinIncomeInput').value || 0),
        selectedCodes: hakState.selectedCodes
    };

    document.getElementById('heroExistingStockText').textContent =
        `${payload.existingStockAssetMan.toLocaleString('ko-KR')}만 원`;
    document.getElementById('heroExistingFinIncomeText').textContent =
        `연 ${payload.existingFinancialIncomeYearlyMan.toLocaleString('ko-KR')}만 원`;

    try {
        const res = await fetch('/api/hak-etf/simulate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const json = await res.json();
        if (!json.success) {
            throw new Error(json.message || '시뮬레이션 중 오류가 발생했습니다.');
        }

        hakState.lastSimulation = json.data;
        renderSimulationResult(json.data);
    } catch (err) {
        showHakToast(err.message);
    }
}

/**
 * 교육용 주석:
 * 서버에서 계산된 월배당 포트폴리오 요약, 1~12월 배당 캘린더,
 * 그리고 2,000만 원 종합과세·ISA 절세 연동 결과를 화면에 그려주는 함수입니다.
 */
function renderSimulationResult(data) {
    const p = data.portfolioSummary;
    const w = data.wealthVaultSync;

    document.getElementById('selectedCountBadge').textContent = `선택 ETF ${p.selectedEtfCount}종목`;
    document.getElementById('simRequiredLabel').textContent =
        data.calcMode === 'TARGET_DIVIDEND'
            ? `월 ${p.formattedMonthlyDiv} 배당 달성에 필요한 ETF 투자원금`
            : `입력하신 ETF 투자원금 (${p.selectedEtfCount}종목 동일 비중 분산)`;

    document.getElementById('simAvgYieldBadge').textContent =
        `평균 연 분배율 ${p.avgDividendYieldPct}% · 1년 수익률 +${p.avgOneYearReturnPct}%`;
    document.getElementById('simRequiredInvestText').textContent = p.formattedRequiredInvest;
    document.getElementById('simMonthlyDivText').textContent = p.formattedMonthlyDiv;
    document.getElementById('simAnnualDivText').textContent = p.formattedAnnualDiv;

    document.getElementById('simSelectedEtfsList').innerHTML = p.selectedEtfs
        .map(
            (etf) => `
            <div style="display: flex; justify-content: space-between; align-items: center; background: var(--input-bg); padding: 9px 12px; border-radius: 12px; font-size: 12px;">
                <div>
                    <span class="etf-code-pill">${etf.code}</span>
                    <strong>${etf.name}</strong>
                </div>
                <div style="text-align: right;">
                    <span style="color: var(--hak-accent-blue); font-weight: 800;">연 ${etf.annualDividendYieldPct}%</span>
                    <span style="color: var(--text-muted); margin-left: 6px;">(${etf.allocatedInvestMan.toLocaleString('ko-KR')}만 원)</span>
                </div>
            </div>`
        )
        .join('');

    document.getElementById('dividendCalendarGrid').innerHTML = data.monthlyCalendar
        .map(
            (m) => `
            <div class="calendar-month-cell">
                <div class="calendar-month-label">${m.monthLabel}</div>
                <div class="calendar-month-amount">${m.grossDividendMan.toLocaleString('ko-KR')}만 원</div>
                <div class="calendar-month-sub">ISA 실수령 ${m.afterIsaTaxMan.toLocaleString('ko-KR')}만</div>
            </div>`
        )
        .join('');

    document.getElementById('isaTaxSaveBadge').textContent =
        `중개형 ISA 절세 연 +${w.formattedIsaAnnualTaxSave}`;
    document.getElementById('taxWarningTitleText').textContent = w.taxWarningTitle;
    document.getElementById('combinedFinIncomeText').textContent = w.formattedCombinedFinancialIncome;

    const gaugePct = Math.min(100, Math.round((w.combinedFinancialIncomeMan / 2000) * 100));
    const gaugeEl = document.getElementById('taxGaugeFill');
    gaugeEl.style.width = `${gaugePct}%`;
    if (w.taxSafetyGrade === 'DANGER') {
        gaugeEl.style.background = 'var(--toss-danger)';
    } else if (w.taxSafetyGrade === 'CAUTION') {
        gaugeEl.style.background = '#F59E0B';
    } else {
        gaugeEl.style.background = 'var(--toss-success)';
    }

    document.getElementById('taxFreeOptionNoticeText').textContent =
        w.taxFreeOptionPremiumMan > 0
            ? `💡 비과세 옵션 프리미엄 배당분(연 ${w.taxFreeOptionPremiumMan.toLocaleString('ko-KR')}만 원)은 금융소득 합산에서 자동 제외되어 절세에 유리합니다!`
            : `💡 과세 대상 신규 배당금 연 ${w.taxableNewDividendMan.toLocaleString('ko-KR')}만 원이 기존 금융소득과 합산 계산되었습니다.`;

    document.getElementById('taxAdviceDetailText').textContent = w.taxAdviceDetail;
    document.getElementById('hakCryptoAuditText').textContent =
        `Hash(${data.securityAudit.userLookupHash}) / Cipher(${data.securityAudit.encryptedPayloadPreview})`;
}

/**
 * 2. [탭 2 기능] KODEX 핵심 ETF 카탈로그 조회 및 카드 렌더링
 */
async function loadAndRenderEtfCatalog() {
    const params = new URLSearchParams({
        category: hakState.filterCategory,
        sortBy: hakState.sortBy,
        keyword: hakState.keyword
    });

    try {
        const res = await fetch(`/api/hak-etf/catalog?${params.toString()}`);
        const json = await res.json();
        if (!json.success) return;

        const container = document.getElementById('etfCatalogContainer');
        if (json.data.items.length === 0) {
            container.innerHTML = `
                <div class="tds-card" style="text-align: center; padding: 30px; color: var(--text-secondary);">
                    검색 조건에 맞는 ETF가 없습니다. 다른 키워드나 테마를 선택해 보세요!
                </div>`;
            return;
        }

        container.innerHTML = json.data.items
            .map((etf) => {
                const isSelected = hakState.selectedCodes.includes(etf.code);
                const topHoldingsHtml = etf.pdfHoldings
                    .slice(0, 3)
                    .map(
                        (h) => `
                        <div class="pdf-holding-row">
                            <span class="pdf-holding-name">${h.name}</span>
                            <div class="pdf-holding-bar-wrap">
                                <div class="pdf-holding-bar-fill" style="width: ${Math.min(100, h.weightPct * 2.5)}%;"></div>
                            </div>
                            <span class="pdf-holding-pct">${h.weightPct}%</span>
                        </div>`
                    )
                    .join('');

                return `
                <article class="etf-item-card ${isSelected ? 'selected' : ''}">
                    <div class="etf-card-header">
                        <div>
                            <span class="etf-code-pill">${etf.code}</span>
                            <span class="etf-category-pill">${etf.categoryLabel}</span>
                            <h3 class="etf-name-title">${etf.name}</h3>
                        </div>
                        <button
                            type="button"
                            class="etf-select-btn ${isSelected ? 'active' : ''}"
                            data-code="${etf.code}"
                            data-name="${etf.name}"
                        >
                            ${isSelected ? '✔ 담김' : '+ 담기'}
                        </button>
                    </div>

                    <p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 6px;">
                        ${etf.summary}
                    </p>

                    <div style="font-size: 11px; font-weight: 800; color: var(--hak-accent-blue); margin-bottom: 6px;">
                        ${etf.isaRecommendBadge} · ${etf.dividendCycle}
                    </div>

                    <div class="etf-metrics-grid">
                        <div>
                            <div class="etf-metric-label">연 분배율(배당)</div>
                            <div class="etf-metric-val" style="color: var(--hak-accent-blue);">연 ${etf.annualDividendYieldPct}%</div>
                        </div>
                        <div>
                            <div class="etf-metric-label">최근 1년 수익률</div>
                            <div class="etf-metric-val" style="color: var(--toss-success);">+${etf.oneYearReturnPct}%</div>
                        </div>
                        <div>
                            <div class="etf-metric-label">총보수(연)</div>
                            <div class="etf-metric-val">${etf.totalExpenseRatioPct}%</div>
                        </div>
                    </div>

                    <div class="pdf-holdings-box">
                        <div style="font-size: 11px; font-weight: 800; color: var(--text-secondary); margin-bottom: 6px;">
                            📂 핵심 구성종목(PDF) TOP 3 비중
                        </div>
                        ${topHoldingsHtml}
                    </div>
                </article>`;
            })
            .join('');

        container.querySelectorAll('.etf-select-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                toggleSelectEtfCode(btn.dataset.code, btn.dataset.name);
            });
        });
    } catch (err) {
        console.error('카탈로그 조회 오류:', err);
    }
}

/**
 * 3. [탭 3 기능] 선택한 ETF 다중 비교표 & 구성종목(PDF) TOP 5 상세 비중 렌더링
 */
async function loadAndRenderEtfComparison() {
    try {
        const res = await fetch('/api/hak-etf/compare', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ codes: hakState.selectedCodes })
        });
        const json = await res.json();
        if (!json.success) return;

        const d = json.data;
        document.getElementById('compareHighlightsBox').innerHTML = `
            <div>🏆 <strong>최고 1년 수익률:</strong> <span style="color: var(--toss-success);">${d.highlights.bestReturn}</span></div>
            <div>💰 <strong>최고 연 분배율:</strong> <span style="color: var(--hak-accent-blue);">${d.highlights.bestDividend}</span></div>
            <div>💎 <strong>최저 총보수(수수료):</strong> <span>${d.highlights.lowestFee}</span></div>
        `;

        const headerCols = d.etfs.map((e) => `<th>${e.name.replace('KODEX ', '')}</th>`).join('');
        const rowYield = d.etfs.map((e) => `<td style="font-weight:800; color:var(--hak-accent-blue);">연 ${e.annualDividendYieldPct}%</td>`).join('');
        const rowReturn = d.etfs.map((e) => `<td style="font-weight:800; color:var(--toss-success);">+${e.oneYearReturnPct}%</td>`).join('');
        const rowFee = d.etfs.map((e) => `<td>연 ${e.totalExpenseRatioPct}%</td>`).join('');
        const row1EokMonthly = d.etfs.map((e) => `<td><strong>월 ${e.simulationOn1Eok.monthlyDivMan}만 원</strong></td>`).join('');
        const rowCycle = d.etfs.map((e) => `<td>${e.dividendCycle}</td>`).join('');
        const rowTax = d.etfs.map((e) => `<td style="font-size:11px;">${e.taxType}</td>`).join('');

        document.getElementById('compareTable').innerHTML = `
            <thead>
                <tr>
                    <th style="min-width: 90px;">비교 항목</th>
                    ${headerCols}
                </tr>
            </thead>
            <tbody>
                <tr><th>연 분배율</th>${rowYield}</tr>
                <tr><th>1년 수익률</th>${rowReturn}</tr>
                <tr><th>1억 투자 시 월배당</th>${row1EokMonthly}</tr>
                <tr><th>연간 총보수</th>${rowFee}</tr>
                <tr><th>배당 주기</th>${rowCycle}</tr>
                <tr><th>절세·과세 특징</th>${rowTax}</tr>
            </tbody>
        `;

        document.getElementById('comparePdfListContainer').innerHTML = d.etfs
            .map((etf) => {
                const bars = etf.pdfHoldings
                    .map(
                        (h) => `
                        <div class="pdf-holding-row">
                            <span class="pdf-holding-name">${h.name} (${h.ticker})</span>
                            <div class="pdf-holding-bar-wrap">
                                <div class="pdf-holding-bar-fill" style="width: ${Math.min(100, h.weightPct * 2.2)}%;"></div>
                            </div>
                            <span class="pdf-holding-pct">${h.weightPct}%</span>
                        </div>`
                    )
                    .join('');

                return `
                <div style="background: var(--input-bg); padding: 14px; border-radius: 16px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <strong>${etf.name}</strong>
                        <span class="etf-code-pill">${etf.code}</span>
                    </div>
                    ${bars}
                </div>`;
            })
            .join('');
    } catch (err) {
        console.error('ETF 비교 조회 오류:', err);
    }
}

/**
 * 4. [양방향 연동 핵심] HAK ETF 관리에서 설계한 ETF 투자원금과 연간 배당금을
 *    내 개인재정 앱(웰스볼트 AI)에 저장하고 즉시 개인재정 앱 화면으로 이동합니다.
 */
function syncPortfolioBackToWealthVault() {
    if (!hakState.lastSimulation) {
        showHakToast('먼저 월배당 시뮬레이션을 실행해 주세요!');
        return;
    }

    const sim = hakState.lastSimulation;
    const syncData = {
        userName: document.getElementById('hakUserNameInput').value.trim() || '이춘학',
        healthInsType: document.getElementById('hakHealthTypeSelect').value,
        newTotalStockAssetMan: sim.wealthVaultSync.newTotalStockAssetMan,
        combinedFinancialIncomeMan: Math.round(sim.wealthVaultSync.combinedFinancialIncomeMan),
        addedEtfInvestMan: sim.portfolioSummary.requiredInvestMan,
        addedAnnualDividendMan: Math.round(sim.portfolioSummary.expectedAnnualDivMan),
        addedMonthlyDividendMan: Math.round(sim.portfolioSummary.expectedMonthlyDivMan),
        selectedEtfNames: sim.portfolioSummary.selectedEtfs.map((e) => e.name),
        syncedAt: new Date().toISOString()
    };

    localStorage.setItem('HAK_ETF_TO_WEALTH_VAULT', JSON.stringify(syncData));
    showHakToast('🏦 개인재정 앱(웰스볼트 AI)으로 ETF 투자금·배당금을 반영하여 이동합니다!');

    setTimeout(() => {
        window.location.href = '/index.html?from=hak-etf';
    }, 550);
}

// 화면 초기 로드 및 이벤트 연결
document.addEventListener('DOMContentLoaded', () => {
    loadSyncedDataFromWealthVault();
    runHakPortfolioSimulation();

    const themeBtn = document.getElementById('themeToggleBtn');
    if (themeBtn) {
        themeBtn.addEventListener('click', toggleHakTheme);
    }

    // [금융권 자산 & 보유 ETF 원클릭 불러오기 버튼]
    const quickFetchBtn = document.getElementById('hakQuickMyDataFetchBtn');
    if (quickFetchBtn) {
        quickFetchBtn.addEventListener('click', fetchMyDataDirectlyInHakEtf);
    }

    const pill = document.getElementById('dynamicIslandPill');
    const hint = document.getElementById('islandHintText');
    if (pill) {
        pill.addEventListener('click', () => {
            const isExp = pill.classList.toggle('expanded');
            if (hint) hint.textContent = isExp ? '닫기 ▲' : '터치 ▼';
        });
    }

    document.querySelectorAll('.loop-tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            switchHakTab(btn.dataset.tab);
        });
    });

    document.querySelectorAll('#calcModeChipGroup .tds-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('#calcModeChipGroup .tds-chip').forEach((c) => c.classList.remove('selected'));
            chip.classList.add('selected');
            hakState.calcMode = chip.dataset.calcmode;
            runHakPortfolioSimulation();
        });
    });

    document.getElementById('runSimulationBtn').addEventListener('click', () => {
        runHakPortfolioSimulation();
        showHakToast('⚡ 월배당 캘린더 & 2,000만 원 절세 시뮬레이션이 업데이트되었어요!');
    });

    document.getElementById('goToFinderBtn').addEventListener('click', () => {
        switchHakTab('TAB_FINDER');
    });

    document.querySelectorAll('#etfCategoryChipGroup .tds-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('#etfCategoryChipGroup .tds-chip').forEach((c) => c.classList.remove('selected'));
            chip.classList.add('selected');
            hakState.filterCategory = chip.dataset.category;
            loadAndRenderEtfCatalog();
        });
    });

    document.getElementById('etfSortSelect').addEventListener('change', (e) => {
        hakState.sortBy = e.target.value;
        loadAndRenderEtfCatalog();
    });

    document.getElementById('etfSearchKeywordInput').addEventListener('input', (e) => {
        hakState.keyword = e.target.value;
        loadAndRenderEtfCatalog();
    });

    document.getElementById('applyToWealthVaultBtn').addEventListener('click', syncPortfolioBackToWealthVault);
    document.getElementById('bottomSyncToWealthBtn').addEventListener('click', syncPortfolioBackToWealthVault);
});
