/**
 * ============================================================================
 * 파일명: frontend/js/app.js
 * 역할: [AGENT 2-DIFF & AGENT 5] 구글 플레이(Material Expressive) × 아이폰(Dynamic Island & Spatial Glass)
 *       인터랙션 컨트롤러 및 동적 결제 퍼널 로직
 * 설명: 1) 아이폰 Dynamic Island 캡슐 터치 확장/축소 인터랙션
 *       2) 크리스탈 라이트 / 스페이셜 다크 글래스 모드 전환
 *       3) Google Material 3 Expressive 모드별 오로라 테마 컬러 팔레트 동적 변형
 *       4) .env 동적 판매가 바인딩 및 토스페이 원클릭 결제 잠금 해제
 * ============================================================================
 */

const appState = {
    appCategory: 'MZ_SAJU',
    concernTopic: '주식·투자 타이밍',
    dynamicPrice: 1900,
    formattedPrice: '1,900',
    maskedOwnerId: '',
    maskedUserIdentity: '',
    currentRequestId: null,
    isUnlocked: false,
    lastUnlockedReport: null,
    theme: 'light'
};

const SOCIAL_PROOF_MESSAGES = [
    '방금 서울 마포구 김*현님이 이번 달 손재수 주의보 3일을 확인했어요',
    '1분 전 경기 분당 박*진님이 주식·투자 황금 재물일 리포트를 잠금 해제했어요',
    '방금 서울 강남구 이*연님이 사주 오행 금전 점수 94점을 달성했어요',
    '2분 전 부산 해운대 최*우님이 이직·연봉협상 대길 날짜를 저장했어요',
    '방금 대전 유성구 정*아님이 충동지출 방어 캘린더로 18만 원을 아꼈어요'
];

// [차별화 #4] Google Material 3 Expressive 모드별 다이내믹 컬러 팔레트 및 프리셋
const GENERATION_PRESETS = {
    MZ_SAJU: {
        headerTitle: '머니사주 AI',
        badge: '2030 MZ세대 인기 1위 금융·사주',
        titleHtml: '이번 달 내 돈 새는 날,<br />언제인지 미리 피하세요',
        subtitle: '타고난 사주 오행과 재테크 고민을 결합해 손재수 주의보 3일과 황금 재물 타이밍 3일을 집어드려요.',
        lossLabel: '🛡️ 손재수 3일 회피 시',
        lossAmount: '평균 185,000원',
        accentPrimary: '#3182F6',
        accentSecondary: '#6366F1',
        accentGlow: 'rgba(49, 130, 246, 0.30)',
        topics: [
            '📈 주식·투자 타이밍',
            '💼 이직·연봉협상',
            '🛡️ 지출·손재수 방어',
            '🏠 내집마련·문서운',
            '🚀 부업·창업 수익'
        ]
    },
    SENIOR_HEALTH: {
        headerTitle: '시니어 건강·지원금 AI',
        badge: '5060 액티브 시니어 맞춤 헬스·재물',
        titleHtml: '이번 달 병원비 새는 날과<br />문서·지원금 행운일을 확인하세요',
        subtitle: '생년월일 오행 체질 분석으로 컨디션 주의일 3일과 건강·자산 지원금 신청 길일 3일을 안내해 드려요.',
        lossLabel: '🏥 건강·문서 손재수 방어',
        lossAmount: '평균 240,000원',
        accentPrimary: '#00C471',
        accentSecondary: '#0EA5E9',
        accentGlow: 'rgba(0, 196, 113, 0.30)',
        topics: [
            '💊 영양제·건기식 궁합 및 활력',
            '🏥 병원비·건강 누수 방어',
            '📑 정부·지자체 지원금 문서운',
            '🏡 노후 연금·안전 자산 관리'
        ]
    },
    ALPHA_FEEL: {
        headerTitle: '필코노미 갓생 카드 AI',
        badge: '1020 잘파세대 취향·감정소비 진단',
        titleHtml: '기분파 소비로 텅장 되는 날,<br />AI 캘린더로 미리 잠그세요',
        subtitle: '나의 필코노미(기분 소비) 지수와 이번 달 갓생 저축 성공 타이밍 3일을 카드로 발급해 드려요.',
        lossLabel: '🛍️ 과소비 주의보 방어 시',
        lossAmount: '평균 95,000원',
        accentPrimary: '#8B5CF6',
        accentSecondary: '#EC4899',
        accentGlow: 'rgba(139, 92, 246, 0.30)',
        topics: [
            '🛍️ 한정판·제철코어 과소비 방어',
            '🎯 한 달 용돈·식비 세이브 챌린지',
            '🎨 덕질·취미 자금 모으기',
            '📱 앱테크·소액 재테크 시작'
        ]
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
 * [차별화 #6] 크리스탈 라이트 / 스페이셜 다크 글래스 테마 전환 함수
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
 * [차별화 #1] iOS Dynamic Island 플로팅 캡슐 확장/축소 토글 및 실시간 티커
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

function animateScoreCountUp(targetScore) {
    const scoreEl = document.getElementById('freeWealthScoreText');
    const barEl = document.getElementById('freeScoreBar');
    if (!scoreEl || !barEl) return;

    let current = 0;
    const duration = 750;
    const intervalTime = 20;
    const increment = Math.max(1, Math.ceil(targetScore / (duration / intervalTime)));

    barEl.style.width = '0%';
    setTimeout(() => {
        barEl.style.width = `${targetScore}%`;
    }, 50);

    const timer = setInterval(() => {
        current += increment;
        if (current >= targetScore) {
            current = targetScore;
            clearInterval(timer);
        }
        scoreEl.textContent = `${current}점`;
    }, intervalTime);
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
                `${json.formattedPrice}원으로 전체 날짜 잠금 해제하기`;
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

/**
 * [차별화 #4] Google Material 3 Expressive 모드 전환 시 CSS 변수(컬러 팔레트) 동적 변경
 */
function switchGenerationTab(categoryKey) {
    appState.appCategory = categoryKey;
    const preset = GENERATION_PRESETS[categoryKey] || GENERATION_PRESETS.MZ_SAJU;

    // Material Expressive 동적 컬러 팔레트 주입
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty('--accent-primary', preset.accentPrimary);
    rootStyle.setProperty('--accent-secondary', preset.accentSecondary);
    rootStyle.setProperty('--accent-glow', preset.accentGlow);

    document.getElementById('headerAppTitle').textContent = preset.headerTitle;
    document.getElementById('heroGenerationBadge').textContent = preset.badge;
    document.getElementById('heroMainTitle').innerHTML = preset.titleHtml;
    document.getElementById('heroSubTitle').textContent = preset.subtitle;
    document.getElementById('lossAversionLabel').textContent = preset.lossLabel;
    document.getElementById('lossAversionAmount').textContent = preset.lossAmount;

    const chipGroup = document.getElementById('concernChipGroup');
    chipGroup.innerHTML = '';
    preset.topics.forEach((topicLabel, idx) => {
        const cleanTopic = topicLabel.replace(/^[^\s]+\s/, '');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = idx === 0 ? 'tds-chip selected' : 'tds-chip';
        btn.dataset.topic = cleanTopic;
        btn.textContent = topicLabel;
        if (idx === 0) {
            appState.concernTopic = cleanTopic;
        }
        btn.addEventListener('click', () => {
            document.querySelectorAll('#concernChipGroup .tds-chip').forEach((c) => c.classList.remove('selected'));
            btn.classList.add('selected');
            appState.concernTopic = cleanTopic;
        });
        chipGroup.appendChild(btn);
    });

    resetToInputView();
    showTdsToast(`🎨 Material Expressive [${preset.headerTitle}] 테마가 적용되었어요`);
}

function resetToInputView() {
    appState.currentRequestId = null;
    appState.isUnlocked = false;
    updateFunnelStepIndicator(1);
    document.getElementById('resultContainer').classList.add('hidden');
    document.getElementById('loadingSection').classList.add('hidden');
    document.getElementById('inputSection').classList.remove('hidden');
    document.getElementById('floatingNudgeBubble').textContent =
        '⚡ 3초 만에 무료로 내 금전 에너지 점수를 확인해 보세요!';
    document.getElementById('mainCtaBtn').textContent = '내 사주로 무료 금전 점수 확인하기';
}

async function submitFreeAnalysis() {
    const userName = document.getElementById('userNameInput').value.trim() || '김토스';
    const birthDate = document.getElementById('birthDateInput').value || '1996-05-15';
    const birthHour = document.getElementById('birthHourSelect').value;
    const gender = document.getElementById('genderSelect').value;
    const calendarType = document.getElementById('calendarSelect').value;

    document.getElementById('inputSection').classList.add('hidden');
    document.getElementById('resultContainer').classList.add('hidden');
    document.getElementById('loadingSection').classList.remove('hidden');

    try {
        const response = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userName,
                birthDate,
                birthHour,
                gender,
                calendarType,
                concernTopic: appState.concernTopic,
                appCategory: appState.appCategory
            })
        });

        const json = await response.json();
        if (!json.success) {
            throw new Error(json.message || '분석 요청에 실패했습니다.');
        }

        setTimeout(() => {
            renderPreviewResult(json.data);
        }, 650);
    } catch (err) {
        showTdsToast(err.message);
        resetToInputView();
    }
}

function renderPreviewResult(data) {
    appState.currentRequestId = data.requestId;
    appState.isUnlocked = false;
    updateFunnelStepIndicator(2);

    document.getElementById('loadingSection').classList.add('hidden');
    document.getElementById('resultContainer').classList.remove('hidden');

    document.getElementById('freeElementText').textContent =
        `${data.freeSummary.userNameMasked}님의 타고난 오행: ${data.freeSummary.elementKorean}`;
    document.getElementById('freeWealthTypeText').textContent = data.freeSummary.wealthType;
    animateScoreCountUp(data.freeSummary.wealthScore);
    document.getElementById('freeAdviceText').textContent = data.freeSummary.freeAdvice;
    document.getElementById('cryptoAuditText').textContent =
        `Hash(${data.securityAudit.userLookupHash}) / Cipher(${data.securityAudit.encryptedBirthPreview})`;

    const blurredContent = document.getElementById('premiumReportContent');
    blurredContent.classList.remove('unlocked');
    document.getElementById('paywallOverlay').classList.remove('hidden');
    document.getElementById('receiptSuccessCard').classList.add('hidden');

    const badge = document.getElementById('unlockStatusBadge');
    badge.textContent = '🔒 유료 잠금';
    badge.style.background = 'var(--toss-danger-bg)';
    badge.style.color = 'var(--toss-danger)';

    document.getElementById('dangerDaysList').innerHTML = data.paywallTeaser.maskedDangerPreview
        .map(
            (text) => `
            <div class="calendar-item danger">
                <div class="calendar-day-header">
                    <span class="calendar-day-title">${text}</span>
                    <span class="calendar-tag tag-danger">잠금됨</span>
                </div>
                <p style="font-size: 13px; color: var(--text-secondary);">
                    결제 후 구체적인 손재수 발생 시간대와 지출 방어 해법이 공개돼요.
                </p>
            </div>`
        )
        .join('');

    document.getElementById('luckyDaysList').innerHTML = data.paywallTeaser.maskedLuckyPreview
        .map(
            (text) => `
            <div class="calendar-item lucky">
                <div class="calendar-day-header">
                    <span class="calendar-day-title">${text}</span>
                    <span class="calendar-tag tag-lucky">잠금됨</span>
                </div>
                <p style="font-size: 13px; color: var(--text-secondary);">
                    결제 후 매수·계약·이직에 행운이 따르는 정확한 날짜가 공개돼요.
                </p>
            </div>`
        )
        .join('');

    document.getElementById('floatingNudgeBubble').textContent =
        '🔥 커피 한 잔 값 이하로 이번 달 돈 새는 날짜 3일을 모두 피하세요!';
    document.getElementById('mainCtaBtn').textContent =
        `🔒 ${appState.formattedPrice}원으로 내 돈 새는 날 전부 확인하기`;

    showTdsToast('🎉 무료 오행 진단이 완료되었어요!');
}

function openPaymentModal() {
    document.getElementById('paymentModalBackdrop').classList.add('open');
}

function closePaymentModal() {
    document.getElementById('paymentModalBackdrop').classList.remove('open');
}

async function processTossPayment() {
    if (!appState.currentRequestId) {
        showTdsToast('먼저 무료 사주 분석을 실행해 주세요.');
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
                requestId: appState.currentRequestId,
                paidAmount: appState.dynamicPrice,
                paymentMethod: '토스페이 원클릭 결제'
            })
        });

        const json = await res.json();
        if (!json.success) {
            throw new Error(json.message || '결제 검증에 실패했습니다.');
        }

        closePaymentModal();
        renderUnlockedPremiumReport(json.data);
    } catch (err) {
        showTdsToast(err.message);
    } finally {
        confirmBtn.textContent = originalText;
        confirmBtn.disabled = false;
    }
}

function renderUnlockedPremiumReport(verificationData) {
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

    document.getElementById('dangerDaysList').innerHTML = report.dangerDays
        .map(
            (item) => `
            <div class="calendar-item danger">
                <div class="calendar-day-header">
                    <span class="calendar-day-title">🚨 ${item.day}</span>
                    <span class="calendar-tag tag-danger">${item.tag}</span>
                </div>
                <p style="font-size: 13px; color: var(--text-primary);">${item.reason}</p>
            </div>`
        )
        .join('');

    document.getElementById('luckyDaysList').innerHTML = report.luckyDays
        .map(
            (item) => `
            <div class="calendar-item lucky">
                <div class="calendar-day-header">
                    <span class="calendar-day-title">💰 ${item.day}</span>
                    <span class="calendar-tag tag-lucky">${item.tag}</span>
                </div>
                <p style="font-size: 13px; color: var(--text-primary);">${item.reason}</p>
            </div>`
        )
        .join('');

    document.getElementById('strategyColor').textContent = report.customStrategy.luckyColor;
    document.getElementById('strategyDirection').textContent = report.customStrategy.luckyDirection;
    document.getElementById('strategyAction').textContent = report.customStrategy.luckyAction;

    document.getElementById('luckyNumbersContainer').innerHTML = report.customStrategy.luckyNumbers
        .map((num) => `<div class="lucky-ball">${num}</div>`)
        .join('');

    document.getElementById('receiptSuccessCard').classList.remove('hidden');
    document.getElementById('receiptMetaText').textContent =
        `주문번호: ${orderInfo.tossPaymentKey} | 결제금액: ${orderInfo.chargedAmount.toLocaleString('ko-KR')}원 | 정산파트너: ${orderInfo.appOwnerId}`;

    document.getElementById('floatingNudgeBubble').textContent =
        '✅ 모든 날짜 잠금이 해제되었어요! 가족·친구의 사주도 확인해 보세요';
    document.getElementById('mainCtaBtn').textContent = '🔄 다른 생년월일/고민으로 다시 분석하기';

    showTdsToast('🔓 결제 검증 완료! 이번 달 머니캘린더가 열렸어요');
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
            switchGenerationTab(tabBtn.dataset.category);
        });
    });

    document.querySelectorAll('#concernChipGroup .tds-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('#concernChipGroup .tds-chip').forEach((c) => c.classList.remove('selected'));
            chip.classList.add('selected');
            appState.concernTopic = chip.dataset.topic;
        });
    });

    document.getElementById('mainCtaBtn').addEventListener('click', () => {
        if (!appState.currentRequestId) {
            submitFreeAnalysis();
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
        const summaryText = [
            `[머니사주 AI 프리미엄 리포트]`,
            `- 손재수 주의보: ${r.dangerDays.map((d) => d.day).join(', ')}`,
            `- 황금 재물일: ${r.luckyDays.map((d) => d.day).join(', ')}`,
            `- 행운 컬러: ${r.customStrategy.luckyColor}`,
            `- 행운 번호: ${r.customStrategy.luckyNumbers.join(', ')}`
        ].join('\n');

        try {
            await navigator.clipboard.writeText(summaryText);
            showTdsToast('📋 리포트 핵심 날짜가 클립보드에 복사되었어요!');
        } catch {
            showTdsToast('복사 완료!');
        }
    });
});
