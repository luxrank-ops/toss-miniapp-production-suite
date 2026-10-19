# 🔌 MuseGlow AI v5.0 — 실제 AI API & 토스페이먼츠 실결제 연동 가이드

> 이 문서는 `app4-glow-muse`를 **"목업 데모"에서 "실제 운영 가능한 서비스"로 전환**하기 위한 설정 가이드입니다.
> 연동 전에도 앱은 100% 정상 동작합니다(자동 폴백 설계). 키를 주입하면 즉시 실서비스로 전환됩니다.

---

## 0. 지금 무슨 상태인가?

| 구분 | 연동 전 (기본값) | 연동 후 |
| :--- | :--- | :--- |
| 피부 스캔 | 로컬 결정론적 엔진(목업) | **실제 Vision 모델**(Gemini / GPT / Claude) 분석 |
| 프리미엄 처방전 | 하드코딩 문구 | **실제 LLM 개인화 생성** |
| 결제 | 샌드박스 시뮬레이션 | **토스페이먼츠 실결제**(서버 최종 승인) |
| 앱 상태 배지 | `🧠 LOCAL 목업 엔진` | `🧠 LIVE · GEMINI` |

**.env 키가 없으면 자동으로 왼쪽, 있으면 오른쪽으로 동작합니다. 코드 수정은 필요 없습니다.**

---

## 1. 실제 AI 연동 (3사 중 아무거나 1개만 넣으면 됩니다)

`app4-glow-muse/.env` 파일을 만들고(`.env.example` 복사) 아래 중 **하나**만 채우세요.

```bash
cp app4-glow-muse/.env.example app4-glow-muse/.env
```

### 옵션 A. Google Gemini (권장 — Vision 가성비 최고)
```env
AI_PROVIDER=gemini
GEMINI_API_KEY=AIzaSy...
GEMINI_MODEL=gemini-2.5-flash
```
→ 발급: https://aistudio.google.com/apikey

### 옵션 B. OpenAI (GPT-4o mini 등)
```env
AI_PROVIDER=openai
OPENAI_API_KEY=sk-proj-...
OPENAI_MODEL=gpt-4o-mini
```
→ 발급: https://platform.openai.com/api-keys
→ Vision 모델을 쓰려면 `gpt-4o` / `gpt-4o-mini` 계열을 권장합니다.

### 옵션 C. Anthropic Claude
```env
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-3-7-sonnet-latest
```
→ 발급: https://console.anthropic.com/settings/keys

### 공통 옵션
```env
AI_TIMEOUT_MS=20000     # AI 응답 타임아웃(ms). 초과 시 즉시 로컬 엔진 폴백
AI_MAX_TOKENS=2048
AI_TEMPERATURE=0.7      # 스캔은 0.4, 리포트는 0.8 로 내부 분리 적용됨
```

### 목업으로 강제 고정하고 싶을 때 (QA/데모)
```env
AI_PROVIDER=none
```

---

## 2. 토스페이먼츠 실결제 연동

```env
# 토스페이먼츠 개발자센터 → 연동 키 (https://developers.tosspayments.com/)
TOSS_PAYMENTS_CLIENT_KEY=test_ck_...   # 브라우저 노출 O (결제위젯용)
TOSS_PAYMENTS_SECRET_KEY=test_sk_...   # ⚠️ 서버 전용. 절대 프론트·깃에 노출 금지

# 결제 성공/실패 리다이렉트 URL 생성용 (배포 도메인으로 반드시 변경)
PUBLIC_BASE_URL=http://localhost:3003
```

- **테스트 키(`test_ck_` / `test_sk_`)** 는 실제 돈이 빠져나가지 않습니다. 먼저 테스트 키로 검증하세요.
- 실서비스 전환 시 **라이브 키(`live_ck_` / `live_sk_`)** 로 교체 + 사업자 심사 완료 필요.

### 결제 흐름 (보안 설계)
```
[프론트] 결제 버튼
   ↓ ① POST /api/payment/order   ← 서버가 금액을 확정(₩79,000). 클라이언트는 금액을 못 건드림
[서버]   주문 원장 생성 → orderId + clientKey + successUrl/failUrl 반환
   ↓ ② 토스 결제위젯(requestPayment) → 사용자 카드/생체 인증
[토스]   /payments/success?paymentKey=...&orderId=...&amount=... 로 리다이렉트
   ↓ ③ 리다이렉트 페이지가 부모 창에 postMessage로 paymentKey 전달
[프론트] ④ POST /api/payment/unlock { paymentKey, orderId }
[서버]   ⑤ 토스 API POST /v1/payments/confirm (Basic 인증)
           ├ 금액 재검증(서버 확정액과 1원이라도 다르면 거절)
           ├ 중복 승인 방지(같은 orderId 재승인 시 크레딧 추가 지급 안 함)
           └ 승인 성공 시에만 크레딧 지급 + AI 리포트 잠금 해제
```

---

## 3. 검증 방법

```bash
cd app4-glow-muse

# ① 정적 품질 감사 (100/100점, 신규 QA-07 포함)
npm run qa

# ② AI·결제 전체 경로 통합 스모크 테스트 (39개 항목)
npm run test:integration

# ③ 서버 실행
npm start
```

`npm run test:integration`은 **외부 벤더에 접속하지 않고** 로컬에 "OpenAI 호환 목 LLM 서버"와
"목 토스페이먼츠 서버"를 띄워 실제 코드 경로를 그대로 검증합니다.

| 시나리오 | 검증 내용 |
| :--- | :--- |
| A | AI 키 없음 → 로컬 폴백 정상 동작 |
| B | AI 키 있음 → 실제 Vision 분석·리포트 병합·회복곡선 재계산 |
| C | 토스 실결제 → 서버 금액 확정, 타 세션 도용 차단, 승인 실패 시 잠금 유지, **중복 승인 시 크레딧 이중 지급 방지**, 환불 시 재잠금 |

### 운영 중 상태 확인 API
```bash
curl http://localhost:3003/api/ai/status     # AI 제공자·모델·폴백 여부
curl http://localhost:3003/api/config        # ai + payments 블록
```

---

## 4. 발견·수정된 실제 결제 취약점

연동 작업 중 실제 코드에서 발견되어 수정한 항목입니다.

| # | 취약점 | 수정 내용 |
| :-- | :--- | :--- |
| 1 | `planTier`만 맞으면 **금액을 검증하지 않아** `paidAmount=100`으로 VIP 해제 가능 | 플랜 금액과 요청 금액이 **1원 단위로 일치해야만** 승인하도록 서버 검증 강화 |
| 2 | 결제 인증 없이 `/api/payment/unlock` 호출만으로 잠금 해제 가능 | TOSS_LIVE 모드에서는 `paymentKey`·`orderId` 필수, 토스 confirm 성공 시에만 해제 |
| 3 | 타인의 `orderId`로 잠금 해제 가능 | 주문의 `sessionToken`과 요청 세션이 일치하는지 검증 (`SESSION_ORDER_MISMATCH`) |
| 4 | 결제 재시도/새로고침 시 **크레딧 무한 복제** | 동일 `orderId` 재승인 시 크레딧 추가 지급 차단(멱등성 보장) |
| 5 | AI가 `999999점`, 500자 문자열 등 환각 값을 반환하면 화면·원장 오염 | 모든 AI 응답에 **스키마 검증 + 범위 클램핑 + 길이 절단** 적용 |
| 6 | AI가 임의의 절약 금액·점수를 생성 | **금액·점수 원장은 서버(결정론적 엔진)가 통제**하고 AI는 "텍스트만" 생성 |

---

## 5. 아직 남아 있는 것 (다음 단계)

- [ ] **Supabase 영속화** — 현재 주문·세션 원장은 인메모리 `Map`이라 서버 재시작 시 소실. `supabase/migrations/` 스키마로 이관 필요
- [ ] **토스페이먼츠 웹훅(가상계좌·정기결제)** — 현재는 즉시 승인(카드)만 지원
- [ ] **App-in-Toss 인앱 결제 SDK** — 토스 미니앱 전용 결제는 파트너 콘솔 승인 후 별도 연동 필요
- [ ] **AI 응답 캐싱** — 동일 입력 재요청 시 비용 절감(현재는 매 호출 신규 추론)
