/**
 * ============================================================================
 * 파일명: app2-refund-radar/frontend/js/app.js
 * 역할: [제2호 앱 AGENT 2-DIFF & AGENT 5] 구글 플레이(Material Expressive) × 아이폰(Dynamic Island & Spatial Glass)
 *       인터랙션 컨트롤러 및 동적 결제 퍼널 로직
 * ============================================================================
 */

const appState = {
    scanMode: 'WORKER_REFUND',
    medicalFreq: '연 4~10회 병원·약국 이용',
    monthlySpend: '월 100만~200만 원 지출',
    dynamicPrice: 2900,
    formattedPrice: '2,900',
    maskedOwnerId: '',
    maskedUserIdentity: '',
    currentScanId: null,
    isUnlocked: false,
    lastUnlockedReport: null,
    theme: 'light'
};

const SOCIAL_PROOF_MESSAGES = [
    '방금 서울 송파구 박*훈님이 숨은 건보료·실비 환급금 412,000원을 발견했어요',
    '1분 전 인천 연수구 김*미님이 미청구 약제비·통원비 195,000원 신청 루트를 열었어요',
    '방금 경기 수원시 이*재님이 통신3사 과오납금 및 선택약정 누락분 98,000원을 찾았어요',
    '2분 전 대구 수성구 정*호님이 소멸 직전 카드포인트 143,000원을 현금 입금받았어요'
];

// [차별화 #4] Google Material 3 Expressive 모드별 다이내믹 컬러 팔레트
const MODE_PRESETS = {
    WORKER_REFUND: {
        headerTitle: '환급레이더 AI',
        badge: '3050 직장인·주부 환급 만족도 1위',
        titleHtml: '잠자고 있는 내 병원비·건보료,<br />얼마나 쌓여있는지 스캔해요',
        subtitle: '최근 3년간 미청구된 건강보험 상한액 초과금, 소액 실비, 통신비 과오납금, 소멸예정 카드포인트를 한 번에 계산해 드려요.',
        accentPrimary: '#00C471',
        accentSecondary: '#3182F6',
        accentGlow: 'rgba(0, 196, 113, 0.30)'
    },
    SENIOR_MEDICAL: {
        headerTitle: '시니어 병원비·건보료 레이더',
        badge: '5060 시니어 의료비 환급 특화 스캐너',
        titleHtml: '놓치기 쉬운 부모님·시니어 병원비,<br />본인부담상한액 환급금을 찾으세요',
        subtitle: '정기 통원·약 처방이 많은 시니어 계층의 건강보험 초과 부담금과 실비 미청구 내역을 집중 스캔해 드려요.',
        accentPrimary: '#0EA5E9',
        accentSecondary: '#6366F1',
        accentGlow: 'rgba(14, 165, 233, 0.30)'
    },
    FREELANCE_TAX: {
        headerTitle: '자영업·N잡러 환급 레이더',
        badge: '소상공인·프리랜서 숨은 환급금 스캐너',
        titleHtml: '바빠서 못 챙긴 세금·통신·건보료,<br />1분 만에 누수 금액을 찾아드려요',
        subtitle: '지역가입자 건보료 조정 환급금, 사업용 카드 휴면 포인트, 지방소득세 미수령액을 정밀 스캔해요.',
        accentPrimary: '#8B5CF6',
        accentSecondary: '#EC4899',
        accentGlow: 'rgba(139, 92, 246, 0.30)'
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

/**
 * [차별화 #6] 라이트 / 스페이셜 다크 글래스 모드 전환
 */
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
 * [차별화 #1] iOS Dynamic Island 플로팅 캡슐 확장/축소 및 실시간 티커
 */
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

function animateCurrencyCountUp(targetAmount) {
    const amountEl = document.getElementById('freeTotalRefundText');
    if (!amountEl) return;

    let current = 0;
    const steps = 32;
    const stepValue = Math.ceil(targetAmount / steps);

    const timer = setInterval(() => {
        current += stepValue;
        if (current >= targetAmount) {
            current = targetAmount;
            clearInterval(timer);
        }
        amountEl.textContent = `${current.toLocaleString('ko-KR')}원`;
    }, 22);
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
                `${json.formattedPrice}원으로 4대 환급 신청 루트 열기`;
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

function switchScanMode(modeKey) {
    appState.scanMode = modeKey;
    const preset = MODE_PRESETS[modeKey] || MODE_PRESETS.WORKER_REFUND;

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
    appState.currentScanId = null;
    appState.isUnlocked = false;
    updateFunnelStepIndicator(1);
    document.getElementById('resultContainer').classList.add('hidden');
    document.getElementById('loadingSection').classList.add('hidden');
    document.getElementById('inputSection').classList.remove('hidden');
    document.getElementById('floatingNudgeBubble').textContent =
        '⚡ 3초 만에 무료로 내 숨은 환급금 총액을 스캔해 보세요!';
    document.getElementById('mainCtaBtn').textContent = '내 숨은 환급금 무료로 스캔하기';
}

async function submitFreeRefundScan() {
    const userName = document.getElementById('userNameInput').value.trim() || '이토스';
    const ageGroup = document.getElementById('ageGroupSelect').value;
    const jobType = document.getElementById('jobTypeSelect').value;

    document.getElementById('inputSection').classList.add('hidden');
    document.getElementById('resultContainer').classList.add('hidden');
    document.getElementById('loadingSection').classList.remove('hidden');

    try {
        const res = await fetch('/api/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userName,
                ageGroup,
                jobType,
                medicalFreq: appState.medicalFreq,
                monthlySpend: appState.monthlySpend,
                scanMode: appState.scanMode
            })
        });

        const json = await res.json();
        if (!json.success) {
            throw new Error(json.message || '환급 스캔 중 오류가 발생했습니다.');
        }

        setTimeout(() => {
            renderPreviewScanResult(json.data);
        }, 700);
    } catch (err) {
        showTdsToast(err.message);
        resetToInputView();
    }
}

function renderPreviewScanResult(data) {
    appState.currentScanId = data.scanId;
    appState.isUnlocked = false;
    updateFunnelStepIndicator(2);

    document.getElementById('loadingSection').classList.add('hidden');
    document.getElementById('resultContainer').classList.remove('hidden');

    document.getElementById('freeUserHeaderText').textContent =
        `${data.freeSummary.userNameMasked}님 (${data.freeSummary.ageGroup} · ${data.freeSummary.jobType}) 맞춤 스캔 결과`;

    animateCurrencyCountUp(data.freeSummary.estimatedTotalRefund);

    document.getElementById('freeDefenseScoreText').textContent = `${data.freeSummary.defenseScore}점`;
    document.getElementById('freeDefenseBar').style.width = `${data.freeSummary.defenseScore}%`;
    document.getElementById('cryptoAuditText').textContent =
        `Hash(${data.securityAudit.userLookupHash}) / Cipher(${data.securityAudit.encryptedProfilePreview})`;

    document.getElementById('premiumReportContent').classList.remove('unlocked');
    document.getElementById('paywallOverlay').classList.remove('hidden');
    document.getElementById('receiptSuccessCard').classList.add('hidden');

    const badge = document.getElementById('unlockStatusBadge');
    badge.textContent = '🔒 유료 잠금';
    badge.style.background = 'var(--toss-danger-bg)';
    badge.style.color = 'var(--toss-danger)';

    document.getElementById('refundItemsList').innerHTML = data.paywallTeaser.maskedItemsPreview
        .map(
            (item) => `
            <div class="refund-item-card">
                <div class="refund-item-header">
                    <span class="refund-item-title">${item.title}</span>
                    <span class="refund-item-amount">${item.maskedAmount}</span>
                </div>
                <p style="font-size: 12px; color: var(--text-secondary);">
                    결제 즉시 정확한 예상 금액과 1분 직통 환급 신청 메뉴 경로가 공개돼요.
                </p>
            </div>`
        )
        .join('');

    document.getElementById('floatingNudgeBubble').textContent =
        `🔥 ${data.freeSummary.formattedTotalRefund}원을 찾는 직통 신청 루트를 커피 한 잔 값에 열어보세요!`;
    document.getElementById('mainCtaBtn').textContent =
        `🔒 ${appState.formattedPrice}원으로 4대 환급 신청 치트키 열기`;

    showTdsToast(`🎉 총 ${data.freeSummary.formattedTotalRefund}원의 예상 환급금이 스캔되었어요!`);
}

function openPaymentModal() {
    document.getElementById('paymentModalBackdrop').classList.add('open');
}

function closePaymentModal() {
    document.getElementById('paymentModalBackdrop').classList.remove('open');
}

async function processTossPayment() {
    if (!appState.currentScanId) {
        showTdsToast('먼저 무료 환급금 스캔을 실행해 주세요.');
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
                scanId: appState.currentScanId,
                paidAmount: appState.dynamicPrice,
                paymentMethod: '토스페이 원클릭 결제'
            })
        });

        const json = await res.json();
        if (!json.success) {
            throw new Error(json.message || '결제 검증에 실패했습니다.');
        }

        closePaymentModal();
        renderUnlockedRefundReport(json.data);
    } catch (err) {
        showTdsToast(err.message);
    } finally {
        confirmBtn.textContent = originalText;
        confirmBtn.disabled = false;
    }
}

function renderUnlockedRefundReport(verificationData) {
    appState.isUnlocked = true;
    updateFunnelStepIndicator(3);

    const report = verificationData.unlockedPremiumReport;
    const orderInfo = verificationData.orderInfo;
    appState.lastUnlockedReport = report;

    document.getElementById('paywallOverlay').classList.add('hidden');
    document.getElementById('premiumReportContent').classList.add('unlocked');

    const badge = document.getElementById('unlockStatusBadge');
    badge.textContent = '🔓 잠금 해제 완료';
    badge.style.background = 'var(--toss-emerald-bg)';
    badge.style.color = 'var(--toss-emerald)';

    document.getElementById('refundItemsList').innerHTML = report.refundItems
        .map(
            (item) => `
            <div class="refund-item-card">
                <div class="refund-item-header">
                    <span class="refund-item-title">${item.category}</span>
                    <span class="refund-item-amount">+${item.amountKRW.toLocaleString('ko-KR')}원</span>
                </div>
                <div style="margin-bottom: 6px;">
                    <span style="font-size: 11px; font-weight: 700; background: rgba(245,158,11,0.16); color: #F59E0B; padding: 2px 8px; border-radius: 999px;">
                        ⚡ ${item.urgencyTag}
                    </span>
                </div>
                <p style="font-size: 13px; color: var(--text-primary);">${item.actionGuide}</p>
            </div>`
        )
        .join('');

    document.getElementById('annualSaveText').textContent =
        `${report.dietPrescription.annualSavePotentialKRW.toLocaleString('ko-KR')}원`;
    document.getElementById('topLeakHabitText').textContent = report.dietPrescription.topLeakHabit;
    document.getElementById('checklistContainer').innerHTML = report.dietPrescription.oneClickChecklist
        .map((c) => `<div style="margin-bottom: 4px;">✅ ${c}</div>`)
        .join('');

    document.getElementById('receiptSuccessCard').classList.remove('hidden');
    document.getElementById('receiptMetaText').textContent =
        `주문번호: ${orderInfo.tossPaymentKey} | 결제금액: ${orderInfo.chargedAmount.toLocaleString('ko-KR')}원 | 정산파트너: ${orderInfo.appOwnerId}`;

    document.getElementById('floatingNudgeBubble').textContent =
        '✅ 모든 환급 신청 경로가 열렸어요! 가족의 숨은 환급금도 스캔해 보세요';
    document.getElementById('mainCtaBtn').textContent = '🔄 다른 조건으로 다시 스캔하기';

    showTdsToast('🔓 결제 검증 완료! 4대 기관 환급 신청 치트키가 열렸어요');
}

document.addEventListener('DOMContentLoaded', () => {
    loadDynamicEnvironmentConfig();
    initDynamicIsland();

    const themeBtn = document.getElementById('themeToggleBtn');
    if (themeBtn) {
        themeBtn.addEventListener('click', toggleGlassTheme);
    }

    document.querySelectorAll('.loop-tab-btn').forEach((tabBtn) => {
        tabBtn.addEventListener('click', () => {
            document.querySelectorAll('.loop-tab-btn').forEach((b) => b.classList.remove('active'));
            tabBtn.classList.add('active');
            switchScanMode(tabBtn.dataset.mode);
        });
    });

    document.querySelectorAll('#medicalChipGroup .tds-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('#medicalChipGroup .tds-chip').forEach((c) => c.classList.remove('selected'));
            chip.classList.add('selected');
            appState.medicalFreq = chip.dataset.medical;
        });
    });

    document.querySelectorAll('#spendChipGroup .tds-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('#spendChipGroup .tds-chip').forEach((c) => c.classList.remove('selected'));
            chip.classList.add('selected');
            appState.monthlySpend = chip.dataset.spend;
        });
    });

    document.getElementById('mainCtaBtn').addEventListener('click', () => {
        if (!appState.currentScanId) {
            submitFreeRefundScan();
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
            `[환급레이더 AI - 총 예상 환급액 ${r.estimatedTotalRefund.toLocaleString('ko-KR')}원 신청 체크리스트]`,
            ...r.refundItems.map((i) => `${i.category}: +${i.amountKRW.toLocaleString('ko-KR')}원\n└ ${i.actionGuide}`)
        ].join('\n\n');

        try {
            await navigator.clipboard.writeText(text);
            showTdsToast('📋 4대 기관 환급 신청 가이드가 복사되었어요!');
        } catch {
            showTdsToast('복사 완료!');
        }
    });
});
