/**
 * ============================================================================
 * 파일명: frontend/js/app.js
 * 역할: [MuseGlow AI v5.0 - 4대 전문 서브에이전트 합동 프로덕션 프론트엔드 컨트롤러]
 * 교육용 설명:
 *   1. 🥇 1순위 app-business-evaluator (Supreme Override):
 *      - 전환율 10.7% 전면 Hard Paywall, 21일 무료 체험 + 연 ₩79,000 VIP 패스 앵커링
 *      - 차등 크레딧 차감 매트릭스: 정밀 진단(-10), 데일리 체크인(-2, 주 3회 달성 시 +15 보너스),
 *        정밀 장벽 재스캔(-3), 파우치 상극 스캔(-5), AI 추구미 포토 스튜디오 렌더링(-10)
 *   2. 🥈 2순위 top-tier-app-consultant:
 *      - 4주 회복 이원화 비교 곡선(SOS 적용 vs 방치 시 노화 가속) + 24시간 골든타임 타이머
 *      - 스마트 쇼핑함 '최저가 절약 배지' + 청담 피부과 시크릿 CPA + 인스타/카톡 처방 영수증(+3 크레딧)
 *   3. 🥉 3순위 cross-store-design-differentiator:
 *      - AI 추구미 포토 스튜디오 Before/After 비교 슬라이더 & 4대 룩북 필터 실시간 연동
 *      - 4주 회복 인터랙티브 프로그레스 바 & Holographic Shimmer VIP 카드
 *   4. 🏅 4순위 toss-top10-design-benchmarker:
 *      - 상단 실시간 소셜 프루프 라이브 티커 (3.5초 자동 롤링)
 *      - 슬롯머신 숫자 카운트업(easeOutExpo) + 3단계 햅틱 피드백(navigator.vibrate)
 * ============================================================================
 */

(function () {
    const SHOPPING_STORAGE_KEY = 'museglow_smart_shopping_list';

    const state = {
        focusMode: 'SKIN_SCANNER_STUDIO',
        sessionToken: null,
        selectedPlan: 'VIP_ANNUAL',
        selectedVibeKey: 'SILK_OLD_MONEY',
        vipAnnualPrice: 79000,
        formattedVipAnnualPrice: '₩79,000',
        monthlyEquivalentFormatted: '월 ₩6,583',
        trialDays: 21,
        vipCreditCap: 100,
        starterPrice: 9900,
        formattedStarterPrice: '₩9,900',
        starterCreditCap: 30,
        remainingCredits: 0,
        weeklyCheckinCount: 0,
        appOwnerIdMasked: 'TOSS_PARTNER',
        currentSkinScanResult: null,
        cameraStream: null,
        goldenSecondsRemaining: 23 * 3600 + 59 * 60 + 42
    };

    const dynamicIsland = document.getElementById('dynamicIsland');
    const islandText = document.getElementById('islandText');
    const liveSocialTickerText = document.getElementById('liveSocialTickerText');
    const ownerBadgeText = document.getElementById('ownerBadgeText');
    const creditBalanceText = document.getElementById('creditBalanceText');
    const shoppingCartCountText = document.getElementById('shoppingCartCountText');
    const themeToggleBtn = document.getElementById('themeToggleBtn');
    const openBizEvalModalBtn = document.getElementById('openBizEvalModalBtn');
    const bizEvalModal = document.getElementById('bizEvalModal');
    const closeBizEvalModalBtn = document.getElementById('closeBizEvalModalBtn');
    const bizEvalJsonPre = document.getElementById('bizEvalJsonPre');

    // 스마트 쇼핑 리스트 및 처방 영수증 모달 요소
    const openShoppingListBtn = document.getElementById('openShoppingListBtn');
    const shoppingListModal = document.getElementById('shoppingListModal');
    const closeShoppingListModalBtn = document.getElementById('closeShoppingListModalBtn');
    const shoppingListItemsContainer = document.getElementById('shoppingListItemsContainer');

    const openReceiptModalBtn = document.getElementById('openReceiptModalBtn');
    const viralReceiptModal = document.getElementById('viralReceiptModal');
    const closeReceiptModalBtn = document.getElementById('closeReceiptModalBtn');
    const shareReceiptNowBtn = document.getElementById('shareReceiptNowBtn');

    // AI 피부 장벽 스캐너 & 포토 스튜디오 요소
    const scannerVideoEl = document.getElementById('scannerVideoEl');
    const scannerPreviewImg = document.getElementById('scannerPreviewImg');
    const scannerPlaceholderEl = document.getElementById('scannerPlaceholderEl');
    const cameraOverlayControls = document.getElementById('cameraOverlayControls');
    const capturePhotoBtn = document.getElementById('capturePhotoBtn');
    const scanningHudOverlay = document.getElementById('scanningHudOverlay');
    const scanStepTextEl = document.getElementById('scanStepTextEl');
    const startCameraBtn = document.getElementById('startCameraBtn');
    const uploadPhotoTriggerBtn = document.getElementById('uploadPhotoTriggerBtn');
    const skinFileInput = document.getElementById('skinFileInput');
    const cameraErrorBox = document.getElementById('cameraErrorBox');
    const skinPresetBtns = document.querySelectorAll('.skin-preset-btn');
    const skinScanResultContainer = document.getElementById('skinScanResultContainer');
    const addAllIngredientsBtn = document.getElementById('addAllIngredientsBtn');

    const studioCompareSlider = document.getElementById('studioCompareSlider');
    const studioAfterWrapper = document.getElementById('studioAfterWrapper');
    const studioAfterImg = document.getElementById('studioAfterImg');
    const studioBeforeImg = document.getElementById('studioBeforeImg');
    const studioActiveLookBadge = document.getElementById('studioActiveLookBadge');
    const studioLookbookTipEl = document.getElementById('studioLookbookTipEl');
    const runStudioRenderBtn = document.getElementById('runStudioRenderBtn');
    const studioRenderOutput = document.getElementById('studioRenderOutput');

    const modeChips = document.querySelectorAll('.mode-chip');
    const diagnoseForm = document.getElementById('glowDiagnoseForm');
    const hardPaywallSection = document.getElementById('hardPaywallSection');
    const unlockedSection = document.getElementById('unlockedSection');

    // 하드 페이월 요소
    const cipherProofEl = document.getElementById('cipherProofEl');
    const teaserWasteAmountEl = document.getElementById('teaserWasteAmountEl');
    const teaserWarningTextEl = document.getElementById('teaserWarningTextEl');
    const maskedAuraEl = document.getElementById('maskedAuraEl');
    const maskedScoreEl = document.getElementById('maskedScoreEl');
    const planCardVip = document.getElementById('planCardVip');
    const planCardStarter = document.getElementById('planCardStarter');
    const openPayModalBtn = document.getElementById('openPayModalBtn');

    // 결제 모달 요소
    const paymentModal = document.getElementById('paymentModal');
    const closePayModalBtn = document.getElementById('closePayModalBtn');
    const sheetPlanTitle = document.getElementById('sheetPlanTitle');
    const sheetSelectedTierText = document.getElementById('sheetSelectedTierText');
    const sheetCreditsText = document.getElementById('sheetCreditsText');
    const sheetOwnerText = document.getElementById('sheetOwnerText');
    const sheetPriceText = document.getElementById('sheetPriceText');
    const confirmTossPayBtn = document.getElementById('confirmTossPayBtn');

    // Nir Eyal Hook 요소
    const runDailyCheckinBtn = document.getElementById('runDailyCheckinBtn');
    const variableRewardOutput = document.getElementById('variableRewardOutput');
    const runPouchScanBtn = document.getElementById('runPouchScanBtn');
    const pouchVaultOutput = document.getElementById('pouchVaultOutput');

    function triggerHaptic(pattern) {
        try {
            if (navigator && typeof navigator.vibrate === 'function') {
                navigator.vibrate(pattern);
            }
        } catch (err) {
            // 미지원 브라우저 무시
        }
    }

    function notifyIsland(message) {
        islandText.textContent = message;
        dynamicIsland.classList.remove('pulse');
        void dynamicIsland.offsetWidth;
        dynamicIsland.classList.add('pulse');
        setTimeout(() => dynamicIsland.classList.remove('pulse'), 450);
    }

    // =========================================================================
    // [4순위 toss-top10-design-benchmarker] 슬롯머신 숫자 카운트업 (easeOutExpo)
    // =========================================================================
    function animateSlotCountUp(el, targetValue, durationMs, formatter) {
        if (!el) return;
        const startTime = performance.now();
        function step(now) {
            const elapsed = now - startTime;
            const progress = Math.min(1, elapsed / durationMs);
            const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
            const currentVal = Math.round(targetValue * eased);
            el.textContent = formatter ? formatter(currentVal) : String(currentVal);
            if (progress < 1) {
                requestAnimationFrame(step);
            } else {
                triggerHaptic(15);
            }
        }
        requestAnimationFrame(step);
    }

    // =========================================================================
    // [4순위 toss-top10-design-benchmarker] 실시간 소셜 프루프 라이브 티커 (3.5초 롤링)
    // =========================================================================
    const SOCIAL_PROOF_MESSAGES = [
        "✨ 방금 성수동 27세 지*님이 '청담 올드머니 실크광' 추구미 진단받고 화보를 생성했어요!",
        "💧 1분 전 강남 29세 수*님이 피부 장벽 74점 진단 후 PDRN 앰플을 올영 쇼핑함에 담았어요!",
        "💸 방금 판교 31세 현*님이 안 맞는 백화점 세럼 걸러내고 연 ₩1,308,000 호구 방어했어요!",
        "🔥 지금 또래 여성 1,428명이 내 얼굴형에 맞는 2026 추구미와 장벽 점수를 스캔하고 있어요!",
        "🛍️ 2분 전 홍대 24세 민*님이 '워터글로우 첫사랑' 맞춤 올리브영 3종 루틴을 저장했어요!",
        "📸 방금 여의도 28세 유*님이 청담 추구미 처방 영수증을 인스타 스토리에 공유하고 +3🪙 받았어요!"
    ];
    let tickerIndex = 0;
    setInterval(() => {
        if (!liveSocialTickerText) return;
        liveSocialTickerText.classList.add('slide-out');
        setTimeout(() => {
            tickerIndex = (tickerIndex + 1) % SOCIAL_PROOF_MESSAGES.length;
            liveSocialTickerText.textContent = SOCIAL_PROOF_MESSAGES[tickerIndex];
            liveSocialTickerText.classList.remove('slide-out');
        }, 280);
    }, 3500);

    // =========================================================================
    // [2순위 top-tier-app-consultant] 24시간 장벽 복구 골든타임 타이머
    // =========================================================================
    setInterval(() => {
        if (state.goldenSecondsRemaining > 0) {
            state.goldenSecondsRemaining -= 1;
        }
        const timerEl = document.getElementById('goldenTimeTimerEl');
        if (timerEl) {
            const hrs = String(Math.floor(state.goldenSecondsRemaining / 3600)).padStart(2, '0');
            const mins = String(Math.floor((state.goldenSecondsRemaining % 3600) / 60)).padStart(2, '0');
            const secs = String(state.goldenSecondsRemaining % 60).padStart(2, '0');
            timerEl.textContent = `${hrs}:${mins}:${secs} 남음 (최저가 18% 절약 & 보너스 혜택 유지)`;
        }
    }, 1000);

    function updateCreditDisplay(credits) {
        state.remainingCredits = credits;
        creditBalanceText.textContent = credits.toLocaleString('ko-KR');
    }

    function updateStampDisplay(count) {
        state.weeklyCheckinCount = count;
        const s1 = document.getElementById('stamp1');
        const s2 = document.getElementById('stamp2');
        const s3 = document.getElementById('stamp3');
        if (count >= 1) {
            s1.classList.add('done');
            s1.textContent = '✅ 스탬프 1 완료';
        }
        if (count >= 2) {
            s2.classList.add('done');
            s2.textContent = '✅ 스탬프 2 완료';
        }
        if (count >= 3) {
            s3.classList.add('done');
            s3.textContent = '🎉 3회 달성 (+15 🪙)';
        }
    }

    // =========================================================================
    // [스마트 쇼핑 리스트 (localStorage: museglow_smart_shopping_list) 관리 함수]
    // =========================================================================
    function getShoppingList() {
        try {
            const raw = localStorage.getItem(SHOPPING_STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (err) {
            return [];
        }
    }

    function saveShoppingList(list) {
        localStorage.setItem(SHOPPING_STORAGE_KEY, JSON.stringify(list));
        if (shoppingCartCountText) {
            shoppingCartCountText.textContent = String(list.length);
        }
    }

    function addIngredientToShoppingList(ing) {
        const list = getShoppingList();
        const exists = list.some((item) => item.name === ing.name);
        if (!exists) {
            list.unshift({
                id: 'scan_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                name: ing.name,
                category: ing.lowestPriceBadge || 'AI 피부 장벽 스캔 처방',
                reason: `${ing.benefit || ing.reason} (${ing.matchingProductType || '맞춤 더마 케어'})`,
                priority: 'essential',
                checked: false,
                searchQuery: ing.oliveYoungKeyword || ing.name,
                addedAt: new Date().toLocaleDateString('ko-KR')
            });
            saveShoppingList(list);
            triggerHaptic(15);
            notifyIsland(`🛒 '${ing.name}' 성분이 스마트 쇼핑함에 추가되었습니다!`);
        } else {
            notifyIsland(`ℹ️ '${ing.name}' 성분은 이미 쇼핑함에 담겨 있습니다.`);
        }
        renderShoppingListModalContent();
        if (state.currentSkinScanResult) {
            renderSkinScanResult(state.currentSkinScanResult, false);
        }
    }

    function renderShoppingListModalContent() {
        const list = getShoppingList();
        if (shoppingCartCountText) {
            shoppingCartCountText.textContent = String(list.length);
        }
        if (!shoppingListItemsContainer) return;

        if (list.length === 0) {
            shoppingListItemsContainer.innerHTML = `
                <div style="text-align:center; padding:24px; color:var(--text-muted); font-size:12.5px;">
                    아직 담긴 성분이 없습니다. AI 피부 장벽 스캐너에서 추천 성분을 담아보세요!
                </div>
            `;
            return;
        }

        shoppingListItemsContainer.innerHTML = list.map((item) => {
            const q = encodeURIComponent(item.searchQuery || item.name);
            const oliveUrl = `https://www.oliveyoung.co.kr/store/search/getSearchMain.do?query=${q}`;
            const naverUrl = `https://search.shopping.naver.com/search/all?query=${q}`;
            const coupangUrl = `https://www.coupang.com/np/search?q=${q}`;
            return `
                <div style="background:var(--glass-surface); border:1px solid var(--glass-border); border-radius:14px; padding:12px;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                        <div>
                            <span style="font-size:10px; font-weight:800; padding:2px 7px; border-radius:999px; background:rgba(245,158,11,0.2); color:#fbbf24;">🔥 ${item.category}</span>
                            <div style="font-size:13.5px; font-weight:800; margin-top:4px;">${item.name}</div>
                            <p style="font-size:11.5px; color:var(--text-secondary); margin-top:2px;">${item.reason}</p>
                        </div>
                        <button type="button" class="remove-shopping-item-btn" data-id="${item.id}" style="background:none; border:none; color:var(--text-muted); font-size:13px; cursor:pointer;">삭제</button>
                    </div>
                    <div style="display:flex; gap:6px; margin-top:8px; flex-wrap:wrap;">
                        <a href="${oliveUrl}" target="_blank" rel="noopener noreferrer" style="padding:5px 10px; border-radius:8px; background:rgba(16,185,129,0.2); color:#6ee7b7; font-size:11px; font-weight:800; text-decoration:none;">🟢 올리브영 최저가</a>
                        <a href="${naverUrl}" target="_blank" rel="noopener noreferrer" style="padding:5px 10px; border-radius:8px; background:rgba(59,130,246,0.2); color:#93c5fd; font-size:11px; font-weight:800; text-decoration:none;">🟢 네이버쇼핑 비교</a>
                        <a href="${coupangUrl}" target="_blank" rel="noopener noreferrer" style="padding:5px 10px; border-radius:8px; background:rgba(244,63,94,0.2); color:#fda4af; font-size:11px; font-weight:800; text-decoration:none;">🚀 쿠팡 로켓특가</a>
                    </div>
                </div>
            `;
        }).join('');

        shoppingListItemsContainer.querySelectorAll('.remove-shopping-item-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const targetId = btn.getAttribute('data-id');
                const updated = getShoppingList().filter((i) => i.id !== targetId);
                saveShoppingList(updated);
                renderShoppingListModalContent();
                if (state.currentSkinScanResult) {
                    renderSkinScanResult(state.currentSkinScanResult, false);
                }
            });
        });
    }

    if (openShoppingListBtn) {
        openShoppingListBtn.addEventListener('click', () => {
            triggerHaptic(12);
            renderShoppingListModalContent();
            shoppingListModal.classList.add('open');
        });
    }
    if (closeShoppingListModalBtn) {
        closeShoppingListModalBtn.addEventListener('click', () => {
            shoppingListModal.classList.remove('open');
        });
    }

    // =========================================================================
    // [3순위 cross-store-design-differentiator] AI 추구미 포토 스튜디오 & 4주 회복 인터랙티브 바
    // =========================================================================
    function syncStudioPreviewImage(imgSrc) {
        if (!imgSrc) return;
        if (studioBeforeImg) studioBeforeImg.src = imgSrc;
        if (studioAfterImg) studioAfterImg.src = imgSrc;
    }

    if (studioCompareSlider && studioAfterWrapper) {
        studioCompareSlider.addEventListener('input', (e) => {
            studioAfterWrapper.style.width = `${e.target.value}%`;
        });
    }

    document.querySelectorAll('#studioLookbookGrid .lookbook-card').forEach((btn) => {
        btn.addEventListener('click', () => {
            triggerHaptic(12);
            document.querySelectorAll('#studioLookbookGrid .lookbook-card').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');

            const vibeKey = btn.dataset.vibe;
            const label = btn.dataset.label;
            const tip = btn.dataset.tip;
            state.selectedVibeKey = vibeKey;

            if (studioAfterImg) {
                studioAfterImg.className = `studio-img-layer vibe-filter-${vibeKey}`;
            }
            if (studioActiveLookBadge) {
                studioActiveLookBadge.textContent = `AFTER · ${label}`;
            }
            if (studioLookbookTipEl) {
                studioLookbookTipEl.textContent = `💡 스타일링 처방: ${tip} (하단 1번 추구미 진단 옵션에 자동 반영됨)`;
            }
            const faceVibeSelect = document.getElementById('faceVibeSelect');
            if (faceVibeSelect) faceVibeSelect.value = vibeKey;
            notifyIsland(`📸 AI 추구미 포토 스튜디오: [${label}] 필터 & 골격 매칭 적용됨`);
        });
    });

    // AI 포토 스튜디오 정밀 레시피 생성 (-10 크레딧)
    if (runStudioRenderBtn) {
        runStudioRenderBtn.addEventListener('click', async () => {
            triggerHaptic([15, 40, 25]);
            if (!state.sessionToken) {
                notifyIsland('🔒 먼저 하단 1번 온보딩 스캔 후 21일 무료 체험(100 크레딧)을 시작해 주세요!');
                diagnoseForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
                return;
            }
            const res = await fetch('/api/hook/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionToken: state.sessionToken,
                    actionType: 'STUDIO_RENDER',
                    vibeKey: state.selectedVibeKey
                })
            });
            const data = await res.json();
            if (data.status === 'STUDIO_RENDER_SUCCESS') {
                updateCreditDisplay(data.remainingCredits);
                const s = data.studioResult;
                studioRenderOutput.innerHTML = `
                    <strong>${s.studioTitle} (-10 🪙 차감 · 암호화 ${data.encryptionProof})</strong><br/>
                    • <strong>청담 샵 견적 환산:</strong> <s>₩${s.cheongdamSalonValueKrw.toLocaleString('ko-KR')}</s> → <strong>VIP 무료</strong><br/>
                    • <strong>조명/톤 보정:</strong> ${s.lightingPreset}<br/>
                    • <strong>메이크업 공식:</strong> ${s.makeupRecipe}<br/>
                    • <strong>헤어·주얼리:</strong> ${s.hairStyling}
                `;
                studioRenderOutput.classList.remove('hidden');
                notifyIsland(`✨ AI 포토 스튜디오 레시피 생성 완료! (잔여 ${data.remainingCredits} 🪙)`);
            } else {
                notifyIsland(`⚠️ ${data.message}`);
                if (data.status === 'HARD_PAYWALL_BLOCKED') {
                    hardPaywallSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }
        });
    }

    // 4주 회복 인터랙티브 프로그레스 바 제어
    document.querySelectorAll('#recoveryWeekPillGroup .recovery-week-pill').forEach((pill) => {
        pill.addEventListener('click', () => {
            triggerHaptic(10);
            document.querySelectorAll('#recoveryWeekPillGroup .recovery-week-pill').forEach((p) => p.classList.remove('active'));
            pill.classList.add('active');

            const week = Number(pill.dataset.week || 4);
            const pct = Number(pill.dataset.pct || 100);
            const fillEl = document.getElementById('recoveryInteractiveFillEl');
            const labelEl = document.getElementById('recoveryActiveWeekLabel');
            const pctEl = document.getElementById('recoveryActivePercentLabel');

            if (fillEl) fillEl.style.width = `${pct}%`;
            const stageTitles = {
                1: 'Week 1 · 급성 붉은기 진정 & 표피 수분막 복구',
                2: 'Week 2 · 세라마이드 지질층 재건 & 속건조 해소',
                3: 'Week 3 · 모공 탄력 지지대 강화 & 유수분 밸런스',
                4: 'Week 4 · 완성형 실크 장벽 (목표 장벽 지수 달성)'
            };
            if (labelEl) labelEl.textContent = stageTitles[week] || stageTitles[4];
            if (pctEl) pctEl.textContent = `턴오버 회복률 ${pct}%`;
        });
    });

    // =========================================================================
    // [AI 피부 건강 & 장벽 정밀 스캐너 (SkinScannerView + BarrierRecoveryDashboard) 로직]
    // =========================================================================
    function stopCameraStream() {
        if (state.cameraStream) {
            state.cameraStream.getTracks().forEach((track) => track.stop());
            state.cameraStream = null;
        }
        if (scannerVideoEl) {
            scannerVideoEl.style.display = 'none';
        }
        if (cameraOverlayControls) {
            cameraOverlayControls.style.display = 'none';
        }
    }

    async function runSkinAnalysis(imageSource) {
        if (!scanningHudOverlay) return;
        syncStudioPreviewImage(imageSource);
        scanningHudOverlay.style.display = 'flex';
        scanStepTextEl.textContent = '1/4 얼굴 표피층 수분·유분 밸런스 스캔 중...';
        notifyIsland('🔬 AI 피부 장벽 스캐너가 5대 진피·표피 지표를 정밀 분석 중입니다...');

        const stepTimers = [
            setTimeout(() => {
                scanStepTextEl.textContent = '2/4 T존·U존 모공 밀도 및 붉은기 파장 추출 중...';
            }, 350),
            setTimeout(() => {
                scanStepTextEl.textContent = '3/4 피부 장벽(Skin Barrier) 손상도 & 4주 이원화 곡선 계산 중...';
            }, 750),
            setTimeout(() => {
                scanStepTextEl.textContent = '4/4 맞춤형 SOS 진정 성분 & 최저가 쇼핑함 매칭 중...';
            }, 1150)
        ];

        try {
            const res = await fetch('/api/skin/scan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    imageBase64: imageSource,
                    userAge: 26,
                    sessionToken: state.sessionToken
                })
            });
            const data = await res.json();

            setTimeout(() => {
                stepTimers.forEach(clearTimeout);
                scanningHudOverlay.style.display = 'none';
                state.currentSkinScanResult = data;
                if (typeof data.remainingCredits === 'number') {
                    updateCreditDisplay(data.remainingCredits);
                }
                renderSkinScanResult(data, true);
                notifyIsland(`✨ AI 피부 스캔 완료! 장벽 점수 ${data.skinBarrierScore}점 (${data.skinType})`);
            }, 1400);
        } catch (err) {
            stepTimers.forEach(clearTimeout);
            scanningHudOverlay.style.display = 'none';
            notifyIsland('⚠️ 스캔 처리 중 오류가 발생했습니다.');
        }
    }

    function renderSkinScanResult(result, shouldAnimateCountUp = true) {
        if (!skinScanResultContainer || !result) return;
        skinScanResultContainer.classList.remove('hidden');

        const scoreEl = document.getElementById('scanBarrierScoreEl');
        if (shouldAnimateCountUp) {
            animateSlotCountUp(scoreEl, result.skinBarrierScore, 1100, (v) => String(v));
        } else {
            scoreEl.textContent = String(result.skinBarrierScore);
        }

        document.getElementById('scanBarrierStatusBadge').textContent = `피부 장벽 ${result.barrierStatus} 단계`;
        document.getElementById('scanSkinAgeBadge').textContent = `추정 피부 나이 ${result.skinAge}세`;
        document.getElementById('scanSkinTypeTitle').textContent = result.skinType;
        document.getElementById('scanAiAnalysisText').textContent = result.aiAnalysisText;

        // 처방 영수증 데이터 동기화
        const receiptBarrierText = document.getElementById('receiptBarrierText');
        if (receiptBarrierText) {
            receiptBarrierText.textContent = `${result.skinBarrierScore} / 100 PTS (${result.skinType.slice(0, 12)})`;
        }
        if (result.recommendedIngredients && result.recommendedIngredients[0]) {
            const receiptIng = document.getElementById('receiptIngredientText');
            if (receiptIng) receiptIng.textContent = result.recommendedIngredients[0].name;
        }

        // 5대 세부 지표 렌더링
        const metricsEl = document.getElementById('scanMetricsListEl');
        metricsEl.innerHTML = (result.metrics || []).map((m) => {
            const badgeColor = m.status === '양호' ? '#34d399' : m.status === '주의' ? '#fbbf24' : '#f43f5e';
            return `
                <div style="background:var(--glass-surface); border:1px solid var(--glass-border); border-radius:14px; padding:11px 13px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                        <strong style="font-size:13px;">${m.label}</strong>
                        <span style="font-size:11.5px; font-weight:800; color:${badgeColor};">${m.status} · ${m.score}점</span>
                    </div>
                    <div class="metric-track" style="margin-bottom:6px;">
                        <div class="metric-fill" style="width:${m.score}%; background:${badgeColor};"></div>
                    </div>
                    <p style="font-size:11.5px; color:var(--text-secondary);">${m.summary || ''}</p>
                </div>
            `;
        }).join('');

        // 오늘 밤 SOS 루틴 렌더링
        const sosEl = document.getElementById('scanSosListEl');
        sosEl.innerHTML = (result.sosCareRoutine || []).map((step, idx) => `
            <li style="display:flex; gap:8px; align-items:flex-start;">
                <span style="display:inline-flex; width:18px; height:18px; border-radius:999px; background:rgba(245,158,11,0.25); color:#fbbf24; font-size:10.5px; font-weight:800; align-items:center; justify-content:center; flex-shrink:0;">${idx + 1}</span>
                <span>${step}</span>
            </li>
        `).join('');

        // 추천 유효 성분 3종 + 최저가 배지 + 쇼핑 리스트 담기 버튼 렌더링
        const shoppingList = getShoppingList();
        const ingEl = document.getElementById('scanIngredientsListEl');
        ingEl.innerHTML = (result.recommendedIngredients || []).map((ing, idx) => {
            const isAdded = shoppingList.some((item) => item.name === ing.name);
            const oliveUrl = `https://www.oliveyoung.co.kr/store/search/getSearchMain.do?query=${encodeURIComponent(ing.oliveYoungKeyword || ing.name)}`;
            return `
                <div style="background:var(--glass-surface); border:1px solid var(--glass-border); border-radius:14px; padding:12px;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; flex-wrap:wrap;">
                        <div style="flex:1;">
                            <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
                                <span style="font-size:10.5px; font-weight:800; color:#fda4af;">${ing.matchingProductType || '맞춤 더마 케어'}</span>
                                <span style="font-size:10px; font-weight:900; padding:2px 7px; border-radius:999px; background:rgba(245,158,11,0.2); color:#fbbf24;">🔥 ${ing.lowestPriceBadge || '최저가 18% 절약'}</span>
                            </div>
                            <div style="font-size:14px; font-weight:900; margin-top:3px;">${ing.name}</div>
                            <p style="font-size:12px; color:var(--text-secondary); margin-top:3px;">${ing.benefit || ing.reason}</p>
                        </div>
                        <div style="display:flex; gap:6px; align-items:center;">
                            <button type="button" class="add-single-ing-btn" data-idx="${idx}" style="padding:7px 11px; border-radius:10px; border:none; font-size:11.5px; font-weight:800; cursor:pointer; background:${isAdded ? 'rgba(16,185,129,0.22)' : '#10b981'}; color:${isAdded ? '#6ee7b7' : '#fff'};">
                                ${isAdded ? '✅ 쇼핑함 담김' : '🛒 쇼핑함 담기'}
                            </button>
                            <a href="${oliveUrl}" target="_blank" rel="noopener noreferrer" style="padding:7px 10px; border-radius:10px; background:rgba(255,255,255,0.08); color:var(--text-primary); font-size:11px; font-weight:800; text-decoration:none;">
                                올영 검색 ↗
                            </a>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        ingEl.querySelectorAll('.add-single-ing-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const idx = Number(btn.getAttribute('data-idx'));
                const targetIng = result.recommendedIngredients[idx];
                if (targetIng) {
                    addIngredientToShoppingList(targetIng);
                }
            });
        });

        // [2순위 top-tier-app-consultant] 4주간 피부 장벽 회복 vs 방치 시 노화 가속 이원화 비교 대시보드
        const baseScore = result.skinBarrierScore || 74;
        const cmp = result.recoveryComparison || {
            sosAppliedScores: [baseScore, baseScore + 7, baseScore + 13, baseScore + 17, Math.min(98, baseScore + 21)],
            neglectedDecayScores: [baseScore, baseScore - 6, baseScore - 13, baseScore - 20, Math.max(38, baseScore - 26)],
            clinicCpaOffer: '💎 [청담 피부과 VIP 비공개 CPA] 홈케어 한계를 넘어 1회 집중 케어로 장벽을 복구하는 앱 전용 49% 제휴 우대권을 확인하세요.'
        };

        const finalGood = cmp.sosAppliedScores[4];
        const finalBad = cmp.neglectedDecayScores[4];
        document.getElementById('recoveryTargetScoreEl').innerHTML = `<span style="color:#34d399;">SOS 적용 ${finalGood}점</span> vs <span style="color:#f43f5e;">방치 시 ${finalBad}점</span>`;

        const timelineGrid = document.getElementById('recoveryTimelineGridEl');
        const weeks = [
            { w: 'Week 1', title: '급성 붉은기·열감 진정', good: cmp.sosAppliedScores[1], bad: cmp.neglectedDecayScores[1], desc: '약산성 세안 + SOS 보습막 형성' },
            { w: 'Week 2', title: '속건조 해소 & 유수분 균형', good: cmp.sosAppliedScores[2], bad: cmp.neglectedDecayScores[2], desc: '세라마이드·판테놀 지질층 복원' },
            { w: 'Week 3', title: '모공 결 정돈 & 장벽 치밀화', good: cmp.sosAppliedScores[3], bad: cmp.neglectedDecayScores[3], desc: '각질 턴오버 주기 정상화 진입' },
            { w: 'Week 4', title: '슬로우에이징 실크광 완성', good: cmp.sosAppliedScores[4], bad: cmp.neglectedDecayScores[4], desc: '외부 자극에 흔들리지 않는 건강 장벽' }
        ];
        timelineGrid.innerHTML = weeks.map((item) => `
            <div style="background:rgba(255,255,255,0.05); border:1px solid rgba(16,185,129,0.28); border-radius:12px; padding:10px;">
                <div style="display:flex; justify-content:space-between; font-size:10.5px; font-weight:800;">
                    <span style="color:#34d399;">${item.w} · 회복 ${item.good}점</span>
                    <span style="color:#f43f5e;">방치 ${item.bad}점↓</span>
                </div>
                <div style="font-size:12.5px; font-weight:800; margin-top:3px;">${item.title}</div>
                <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;">${item.desc}</div>
            </div>
        `).join('');

        const clinicBox = document.getElementById('clinicCpaOfferBox');
        if (clinicBox) {
            clinicBox.textContent = cmp.clinicCpaOffer;
        }
    }

    // 실시간 카메라 시작
    if (startCameraBtn) {
        startCameraBtn.addEventListener('click', async () => {
            cameraErrorBox.classList.add('hidden');
            try {
                if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                    const stream = await navigator.mediaDevices.getUserMedia({
                        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 640 } }
                    });
                    state.cameraStream = stream;
                    scannerVideoEl.srcObject = stream;
                    scannerVideoEl.style.display = 'block';
                    scannerPreviewImg.style.display = 'none';
                    scannerPlaceholderEl.style.display = 'none';
                    cameraOverlayControls.style.display = 'flex';
                    await scannerVideoEl.play();
                    notifyIsland('📷 실시간 셀카 카메라가 활성화되었습니다. 가이드라인에 얼굴을 맞춰주세요.');
                } else {
                    cameraErrorBox.textContent = '이 브라우저에서는 카메라 접근이 지원되지 않습니다. 사진 업로드 또는 샘플 프리셋을 이용해 주세요.';
                    cameraErrorBox.classList.remove('hidden');
                }
            } catch (err) {
                cameraErrorBox.textContent = '카메라 접근 권한이 필요합니다. 사진 파일 업로드 또는 하단 1초 샘플 프리셋을 이용해 주세요.';
                cameraErrorBox.classList.remove('hidden');
            }
        });
    }

    // 카메라 캡처 버튼
    if (capturePhotoBtn) {
        capturePhotoBtn.addEventListener('click', () => {
            if (!scannerVideoEl) return;
            const canvas = document.createElement('canvas');
            canvas.width = scannerVideoEl.videoWidth || 640;
            canvas.height = scannerVideoEl.videoHeight || 640;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(scannerVideoEl, 0, 0, canvas.width, canvas.height);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                stopCameraStream();
                scannerPreviewImg.src = dataUrl;
                scannerPreviewImg.style.display = 'block';
                scannerPlaceholderEl.style.display = 'none';
                runSkinAnalysis(dataUrl);
            }
        });
    }

    // 파일 업로드 버튼
    if (uploadPhotoTriggerBtn && skinFileInput) {
        uploadPhotoTriggerBtn.addEventListener('click', () => {
            skinFileInput.click();
        });
        skinFileInput.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                const dataUrl = ev.target.result;
                stopCameraStream();
                scannerPreviewImg.src = dataUrl;
                scannerPreviewImg.style.display = 'block';
                scannerPlaceholderEl.style.display = 'none';
                runSkinAnalysis(dataUrl);
            };
            reader.readAsDataURL(file);
        });
    }

    // 3종 샘플 프리셋 버튼
    skinPresetBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
            triggerHaptic(12);
            const imgUrl = btn.getAttribute('data-img');
            stopCameraStream();
            scannerPreviewImg.src = imgUrl;
            scannerPreviewImg.style.display = 'block';
            scannerPlaceholderEl.style.display = 'none';
            runSkinAnalysis(imgUrl);
        });
    });

    // 추천 성분 전체 담기 버튼
    if (addAllIngredientsBtn) {
        addAllIngredientsBtn.addEventListener('click', () => {
            if (!state.currentSkinScanResult || !state.currentSkinScanResult.recommendedIngredients) return;
            state.currentSkinScanResult.recommendedIngredients.forEach((ing) => {
                addIngredientToShoppingList(ing);
            });
            renderShoppingListModalContent();
            shoppingListModal.classList.add('open');
        });
    }

    // =========================================================================
    // [처방 영수증 모달 (Viral Receipt Card) 열기 & 공유 시 +3 크레딧 보상]
    // =========================================================================
    if (openReceiptModalBtn) {
        openReceiptModalBtn.addEventListener('click', () => {
            triggerHaptic(12);
            viralReceiptModal.classList.add('open');
        });
    }
    if (closeReceiptModalBtn) {
        closeReceiptModalBtn.addEventListener('click', () => {
            viralReceiptModal.classList.remove('open');
        });
    }
    if (shareReceiptNowBtn) {
        shareReceiptNowBtn.addEventListener('click', async () => {
            triggerHaptic([20, 50, 40]);
            if (state.sessionToken) {
                const res = await fetch('/api/hook/action', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sessionToken: state.sessionToken,
                        actionType: 'VIRAL_SHARE'
                    })
                });
                const data = await res.json();
                if (data.status === 'VIRAL_SHARE_REWARDED') {
                    updateCreditDisplay(data.remainingCredits);
                    if (data.receiptSerial) {
                        document.getElementById('receiptSerialText').textContent = data.receiptSerial;
                    }
                    notifyIsland(`🎉 처방 영수증 공유 완료! 보너스 +3 🪙 크레딧이 충전되었습니다 (잔여 ${data.remainingCredits} 🪙)`);
                } else {
                    notifyIsland('📋 영수증이 클립보드에 복사되었습니다! (21일 체험 시작 시 +3 🪙 보너스 즉시 적립)');
                }
            } else {
                notifyIsland('📋 청담 추구미 처방 영수증이 복사되었습니다! 친구에게 공유해 보세요 ✨');
            }
            viralReceiptModal.classList.remove('open');
        });
    }

    async function loadServerConfig() {
        try {
            const res = await fetch('/api/config');
            const data = await res.json();
            if (data && data.status === 'OK') {
                state.vipAnnualPrice = data.vipAnnualPrice;
                state.formattedVipAnnualPrice = data.formattedVipAnnualPrice;
                state.monthlyEquivalentFormatted = data.monthlyEquivalentFormatted;
                state.trialDays = data.trialDays;
                state.vipCreditCap = data.vipCreditCap;
                state.starterPrice = data.monetizationPrice;
                state.formattedStarterPrice = data.formattedPrice;
                state.starterCreditCap = data.starterCreditCap;
                state.appOwnerIdMasked = data.appOwnerIdMasked;

                ownerBadgeText.textContent = `· ${data.appOwnerIdMasked}`;
                document.getElementById('vipTrialDaysText').textContent = data.trialDays;
                document.getElementById('vipAnnualPriceText').textContent = data.formattedVipAnnualPrice;
                document.getElementById('vipMonthlyEqText').textContent = data.monthlyEquivalentFormatted;
                document.getElementById('vipCreditsText').textContent = data.vipCreditCap;
                document.getElementById('starterPriceText').textContent = data.formattedPrice;
                document.getElementById('starterCreditsText').textContent = data.starterCreditCap;
                sheetOwnerText.textContent = `${data.appOwnerIdMasked} (${data.settlementHolderMasked})`;
                syncPlanSelectionUI();
            }
        } catch (err) {
            console.error('설정 로드 오류:', err);
        }
    }

    function syncPlanSelectionUI() {
        if (state.selectedPlan === 'VIP_ANNUAL') {
            planCardVip.classList.add('selected');
            planCardStarter.classList.remove('selected');
            openPayModalBtn.textContent = `🔓 ${state.trialDays}일 무료 체험 시작하고 전체 처방전 & ${state.vipCreditCap} 크레딧 받기`;
            sheetPlanTitle.textContent = `${state.trialDays}일 무료 체험 + 연간 VIP 슬로우에이징 패스`;
            sheetSelectedTierText.textContent = `VIP_ANNUAL (${state.trialDays}일 무료 체험 포함)`;
            sheetCreditsText.textContent = `${state.vipCreditCap} 크레딧`;
            sheetPriceText.textContent = `${state.formattedVipAnnualPrice} (${state.trialDays}일 체험 후 과금)`;
        } else {
            planCardStarter.classList.add('selected');
            planCardVip.classList.remove('selected');
            openPayModalBtn.textContent = `🔓 스타터 팩(${state.formattedStarterPrice}) 결제하고 ${state.starterCreditCap} 크레딧 받기`;
            sheetPlanTitle.textContent = '단기 검증용 스타터 30 크레딧 팩';
            sheetSelectedTierText.textContent = 'STARTER_PACK (무료 체험 없음)';
            sheetCreditsText.textContent = `${state.starterCreditCap} 크레딧`;
            sheetPriceText.textContent = state.formattedStarterPrice;
        }
    }

    planCardVip.addEventListener('click', () => {
        triggerHaptic(10);
        state.selectedPlan = 'VIP_ANNUAL';
        syncPlanSelectionUI();
    });

    planCardStarter.addEventListener('click', () => {
        triggerHaptic(10);
        state.selectedPlan = 'STARTER_PACK';
        syncPlanSelectionUI();
    });

    // 테마 전환
    themeToggleBtn.addEventListener('click', () => {
        const current = document.body.getAttribute('data-theme');
        if (current === 'dark') {
            document.body.setAttribute('data-theme', 'light');
            themeToggleBtn.textContent = '🌙 다크';
            notifyIsland('☀️ 실크 샴페인 라이트 글래스 모드가 적용되었습니다');
        } else {
            document.body.setAttribute('data-theme', 'dark');
            themeToggleBtn.textContent = '☀️ 라이트';
            notifyIsland('🌙 벨벳 로즈 다크 글래스 모드가 적용되었습니다');
        }
    });

    // 비즈니스 아키텍처 평가 JSON 모달 열기
    openBizEvalModalBtn.addEventListener('click', async () => {
        bizEvalModal.classList.add('open');
        try {
            const res = await fetch('/api/business-evaluation');
            const json = await res.json();
            bizEvalJsonPre.textContent = JSON.stringify(json, null, 2);
        } catch (err) {
            bizEvalJsonPre.textContent = '평가 데이터를 불러오지 못했습니다.';
        }
    });

    closeBizEvalModalBtn.addEventListener('click', () => {
        bizEvalModal.classList.remove('open');
    });

    // 4대 여성 트렌드 모드 모핑 탭
    modeChips.forEach((chip) => {
        chip.addEventListener('click', () => {
            triggerHaptic(10);
            modeChips.forEach((c) => c.classList.remove('active'));
            chip.classList.add('active');
            state.focusMode = chip.getAttribute('data-mode');
            document.body.setAttribute('data-mode', state.focusMode);
            notifyIsland(`✨ 트렌드 모드 전환: ${chip.textContent.trim()}`);
            if (state.focusMode === 'SKIN_SCANNER_STUDIO') {
                document.getElementById('skinScannerStudioSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else {
                diagnoseForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });

    // STEP 1 -> STEP 2: 온보딩 스캔 제출 (Hard Paywall 발동 + 슬롯머신 카운트업)
    diagnoseForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        triggerHaptic([15, 30, 15]);
        notifyIsland('🔒 AES-256-GCM 암호화 및 Hard Paywall 손실 경고 연산 중...');

        const payload = {
            nickname: document.getElementById('nicknameInput').value,
            ageGroup: document.getElementById('ageGroupSelect').value,
            focusMode: state.focusMode,
            faceVibe: document.getElementById('faceVibeSelect').value,
            skinConcern: document.getElementById('skinConcernSelect').value,
            cyclePhase: document.getElementById('cyclePhaseSelect').value,
            monthlyBeautySpendManwon: Number(document.getElementById('monthlySpendInput').value) || 30
        };

        try {
            const res = await fetch('/api/glow/diagnose', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (data.status !== 'SUCCESS') return;

            state.sessionToken = data.sessionToken;
            updateCreditDisplay(0);

            const t = data.hardPaywallTeaser;
            cipherProofEl.textContent = `🔒 ${data.securityProof.algorithm} (${data.securityProof.cipherPreview})`;
            animateSlotCountUp(teaserWasteAmountEl, t.preventedWasteKrw || 1308000, 1400, (v) => `연 ₩${v.toLocaleString('ko-KR')}`);
            teaserWarningTextEl.textContent = t.urgentLossWarning;
            maskedAuraEl.textContent = t.maskedAuraPreview;
            maskedScoreEl.textContent = t.maskedScorePreview;

            hardPaywallSection.classList.remove('hidden');
            unlockedSection.classList.add('hidden');
            notifyIsland(`🚨 Hard Paywall 작동! 연간 예상 호구 손실액 ${t.preventedWasteFormatted} 감지됨`);
            hardPaywallSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (err) {
            console.error(err);
        }
    });

    openPayModalBtn.addEventListener('click', () => {
        if (!state.sessionToken) return;
        triggerHaptic(12);
        syncPlanSelectionUI();
        paymentModal.classList.add('open');
    });

    closePayModalBtn.addEventListener('click', () => {
        paymentModal.classList.remove('open');
    });

    // STEP 2 -> STEP 3: 하드 페이월 해제 및 크레딧 부여 (3단계 햅틱 & 슬롯 카운트업)
    confirmTossPayBtn.addEventListener('click', async () => {
        if (!state.sessionToken) return;
        triggerHaptic([15, 40, 25]);
        confirmTossPayBtn.disabled = true;
        confirmTossPayBtn.textContent = '토스페이 생체인증 확인 및 AES-256-GCM 복호화 중...';

        const paidAmount = state.selectedPlan === 'VIP_ANNUAL' ? state.vipAnnualPrice : state.starterPrice;

        try {
            const res = await fetch('/api/payment/unlock', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionToken: state.sessionToken,
                    planTier: state.selectedPlan,
                    paidAmount
                })
            });
            const data = await res.json();

            if (data.status === 'UNLOCKED') {
                triggerHaptic([20, 50, 40, 30, 60]);
                updateCreditDisplay(data.receipt.remainingCredits);
                const ov = data.unlockedFullReport.overview;
                const p = data.unlockedFullReport.prescriptions;

                document.getElementById('auraBadgeEl').textContent = ov.museAuraBadge;
                document.getElementById('auraTitleEl').textContent = ov.museAuraTitle;
                animateSlotCountUp(document.getElementById('glowScoreEl'), ov.glowIndexScore, 1300, (v) => String(v));
                animateSlotCountUp(document.getElementById('preventedWasteEl'), ov.preventedWasteKrw, 1600, (v) => `연 ₩${v.toLocaleString('ko-KR')}`);

                document.getElementById('summaryCommentEl').textContent = ov.summaryComment;
                document.getElementById('bioSkinAgeEl').textContent = ov.bioSkinAgeDiff;
                document.getElementById('goldenDdayEl').textContent = ov.goldenWindowDday;
                document.getElementById('unlockReceiptBadge').textContent = `🔓 ${data.receipt.planTier} (-10 🪙 진단차감 완료)`;

                // 영수증 모달 정보 동기화
                document.getElementById('receiptAuraText').textContent = ov.museAuraTitle;
                document.getElementById('receiptTotalSavedText').textContent = `₩${ov.preventedWasteKrw.toLocaleString('ko-KR')}`;

                const m = ov.balanceMetrics;
                document.getElementById('metricBarrierVal').textContent = `${m.barrierGlow}점`;
                document.getElementById('metricAuraVal').textContent = `${m.auraHarmony}점`;
                document.getElementById('metricLymphVal').textContent = `${m.lymphDePuff}점`;
                document.getElementById('metricMetaVal').textContent = `${m.bloodSugarMeta}점`;

                setTimeout(() => {
                    document.getElementById('metricBarrierBar').style.width = `${m.barrierGlow}%`;
                    document.getElementById('metricAuraBar').style.width = `${m.auraHarmony}%`;
                    document.getElementById('metricLymphBar').style.width = `${m.lymphDePuff}%`;
                    document.getElementById('metricMetaBar').style.width = `${m.bloodSugarMeta}%`;
                }, 60);

                // 4대 처방전 바인딩
                document.getElementById('p1Title').textContent = p.prescription1_Chugumi.title;
                document.getElementById('p1Insight').textContent = p.prescription1_Chugumi.coreInsight;
                document.getElementById('p1List').innerHTML = p.prescription1_Chugumi.actionItems.map((i) => `<li>${i}</li>`).join('');
                document.getElementById('p1Warning').textContent = p.prescription1_Chugumi.worstWarning;

                document.getElementById('p2Title').textContent = p.prescription2_MedicalHomeLoop.title;
                document.getElementById('p2Clinic').innerHTML = `<strong>추천 시술:</strong> ${p.prescription2_MedicalHomeLoop.recommendedClinic}`;
                document.getElementById('p2List').innerHTML = p.prescription2_MedicalHomeLoop.oliveYoungSynergy.map((i) => `<li>${i}</li>`).join('');
                document.getElementById('p2Warning').textContent = p.prescription2_MedicalHomeLoop.dangerConflict;

                document.getElementById('p3Title').textContent = p.prescription3_HormoneGoldenCalendar.title;
                document.getElementById('p3Phase').innerHTML = `<strong>${p.prescription3_HormoneGoldenCalendar.currentPhase}</strong><br/>🔥 황금기: ${p.prescription3_HormoneGoldenCalendar.goldenWindow}`;
                document.getElementById('p3List').innerHTML = p.prescription3_HormoneGoldenCalendar.stepByStepCalendar.map((i) => `<li>${i}</li>`).join('');

                document.getElementById('p4Title').textContent = p.prescription4_DePuffAndBloodSugar.title;
                document.getElementById('p4Morning').innerHTML = `<strong>💆‍♀️ 모닝 5분 붓기 삭제:</strong> ${p.prescription4_DePuffAndBloodSugar.morningRoutine}`;
                document.getElementById('p4Meal').innerHTML = `<strong>🥗 혈당 스위치온 식단:</strong> ${p.prescription4_DePuffAndBloodSugar.switchOnMeal}`;
                document.getElementById('p4Inner').textContent = `💡 ${p.prescription4_DePuffAndBloodSugar.secretInnerBeauty}`;

                paymentModal.classList.remove('open');
                hardPaywallSection.classList.add('hidden');
                unlockedSection.classList.remove('hidden');
                notifyIsland(`🎉 하드 페이월 해제 완료! 잔여 크레딧: ${data.receipt.remainingCredits} 🪙`);
                unlockedSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        } catch (err) {
            console.error(err);
        } finally {
            confirmTossPayBtn.disabled = false;
            confirmTossPayBtn.textContent = '토스페이로 1초 만에 승인하고 전체 처방전 잠금 해제하기';
        }
    });

    // Nir Eyal Hook Action A: 데일리 가변 보상 체크인 (-2 크레딧)
    runDailyCheckinBtn.addEventListener('click', async () => {
        if (!state.sessionToken) return;
        triggerHaptic(15);
        const sleepCondition = document.getElementById('hookSleepSelect').value;
        const swellingLevel = document.getElementById('hookSwellingSelect').value;

        const res = await fetch('/api/hook/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionToken: state.sessionToken,
                actionType: 'DAILY_CHECKIN',
                sleepCondition,
                swellingLevel
            })
        });
        const data = await res.json();
        if (data.status === 'HOOK_CHECKIN_SUCCESS') {
            updateCreditDisplay(data.remainingCredits);
            updateStampDisplay(data.weeklyCheckinCount);
            const r = data.variableReward;
            const bonusBanner = data.bonusCreditsAwarded > 0
                ? `<br/><strong>🎊 주 3회 습관 루프 달성! 보너스 +${data.bonusCreditsAwarded} 🪙 크레딧이 즉시 지급되었습니다!</strong>`
                : '';
            variableRewardOutput.innerHTML = `<strong>🔥 오늘의 지방연소 배율: ${r.fatBurnMultiplier}</strong> | ${r.puffinessAlert}<br/>${r.variableRewardMessage}${bonusBanner}`;
            variableRewardOutput.classList.remove('hidden');
            notifyIsland(`🎲 가변 보상 획득! (주간 체크인 ${data.weeklyCheckinCount}/3 · 잔여 ${data.remainingCredits} 🪙)`);
        } else {
            notifyIsland(`⚠️ ${data.message}`);
        }
    });

    // Nir Eyal Hook Action B: 내 파우치 금고 등록 & 독점 상극 DB 판독 (-5 크레딧)
    runPouchScanBtn.addEventListener('click', async () => {
        if (!state.sessionToken) return;
        triggerHaptic(15);
        const itemName = document.getElementById('pouchItemNameInput').value;
        const comboType = document.getElementById('pouchComboSelect').value;

        const res = await fetch('/api/hook/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionToken: state.sessionToken,
                actionType: 'POUCH_INVEST',
                itemName,
                comboType
            })
        });
        const data = await res.json();
        if (data.status === 'POUCH_INVEST_SUCCESS') {
            updateCreditDisplay(data.remainingCredits);
            const c = data.compatibilityResult;
            pouchVaultOutput.innerHTML = `<strong>${c.badge}</strong> (파우치 금고 누적 ${data.vaultTotalCount}개 · 암호화 ${data.encryptionProof})<br/>${c.analysis}`;
            pouchVaultOutput.classList.remove('hidden');
            notifyIsland(`👜 파우치 금고 암호화 축적 완료! (잔여 ${data.remainingCredits} 🪙)`);
        } else {
            notifyIsland(`⚠️ ${data.message}`);
        }
    });

    // [top-tier-app-consultant 액션 아이템]: 제휴 CPA 버튼 클릭 및 바이럴 영수증 모달 오픈
    const cpaAndViralOutput = document.getElementById('cpaAndViralOutput');
    const viralShareCreditBtn = document.getElementById('viralShareCreditBtn');
    const cpaButtons = document.querySelectorAll('.cpa-partner-btn');

    cpaButtons.forEach((btn) => {
        btn.addEventListener('click', async () => {
            if (!state.sessionToken) return;
            triggerHaptic(12);
            const partnerType = btn.getAttribute('data-partner');
            const res = await fetch('/api/hook/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionToken: state.sessionToken,
                    actionType: 'CPA_PARTNER_CLICK',
                    partnerType
                })
            });
            const data = await res.json();
            if (data.status === 'CPA_ACTION_LOGGED') {
                cpaAndViralOutput.innerHTML = `<strong>${data.partnerName}</strong><br/>${data.userBenefitMessage}`;
                cpaAndViralOutput.classList.remove('hidden');
                notifyIsland(`🎁 제휴 혜택 발급 완료! (${data.partnerName})`);
            }
        });
    });

    if (viralShareCreditBtn) {
        viralShareCreditBtn.addEventListener('click', () => {
            triggerHaptic(15);
            viralReceiptModal.classList.add('open');
        });
    }

    // 초기 쇼핑함 카운트 동기화 및 설정 로드
    renderShoppingListModalContent();
    loadServerConfig();
})();
