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
| 데이터 보관 | 인메모리(재시작 시 소실) | **Supabase 영속화**(§5) |
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

## 5. Supabase 영속화 (런타임 원장 DB 저장)

세션·주문·매출 원장을 인메모리에서 Supabase(PostgreSQL)로 이관하는 설정입니다.
**미설정 시에도 앱은 그대로 동작**하며, DB 장애 시에도 자동으로 인메모리로 폴백합니다.

### 설정 순서
1. Supabase 대시보드 → **SQL Editor**에서 `supabase/migrations/` 의 마이그레이션을 번호 순서대로 실행
   (`006_...` 영속화 → `007_...` 웹훅/자동결제 → `008_...` IAP → `009_...` AI 캐시)
2. `.env`에 아래 두 줄 추가 후 서버 재시작
```env
SUPABASE_URL=https://xxxxxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...    # ⚠️ 서버 전용. 클라이언트 노출 절대 금지
SUPABASE_PERSISTENCE=auto                # 강제로 끄려면 off
SUPABASE_TIMEOUT_MS=5000
```

### 저장되는 테이블 (`006` 마이그레이션)
| 테이블 | 내용 |
| :--- | :--- |
| `glow_muse_runtime_sessions` | 진단 세션 전체(AES-256-GCM 암호화) + 상태·크레딧 인덱스 컬럼 |
| `glow_muse_runtime_orders` | 주문 생애주기(CREATED→PAID/FAILED/CANCELED), **영수증은 암호화 저장** |
| `glow_muse_runtime_payments` | 결제 완료 원장(정산·매출 분석용) |
| `glow_muse_runtime_skin_scans` | AI 피부 스캔 결과(원본 사진 저장 안 함) |
| `glow_muse_runtime_studio_logs` | AI 포토 스튜디오 렌더링 로그 |
| `glow_muse_ai_inference_logs` | AI 추론 원가·지연 관제 로그 |

### 장애 대응 설계
- **Write-Through**: 메모리 기록 → DB upsert (DB 실패해도 메모리 값 유지)
- **Read-Through**: 캐시 미스 시 DB에서 복호화해 메모리에 적재 → **서버 재시작·다중 인스턴스에서도 세션 유지**
- **서킷 브레이커**: 연속 3회 실패 시 30초간 DB 접근 생략(응답 지연 방지), 이후 자동 재개

```bash
curl http://localhost:3003/api/persistence/status   # 영속화 상태·성공/실패 카운터
```

---

## 6. 프로덕션 확장 — 웹훅 · 자동결제 · 인앱결제 · AI 캐시

- [x] **Supabase 영속화** — `006` 마이그레이션 + Write/Read-Through · 서킷 브레이커
- [x] **토스페이먼츠 웹훅(가상계좌·정기결제)** — `007` 마이그레이션 + `/api/webhooks/toss`
- [x] **App-in-Toss 인앱 결제 SDK** — `008` 마이그레이션 + 지급 콜백 서버 검증
- [x] **AI 응답 캐싱** — `009` 마이그레이션 + 메모리 LRU · Supabase Read-Through
- [ ] **Supabase RLS 활성화** — 운영 전 `006`~`009` 마이그레이션 하단 주석의 RLS 정책 적용 권장
- [ ] **앱인토스 파트너 콘솔 심사** — IAP 상품(SKU) 등록·mTLS 인증서 발급 후 실결제 전환

### 6-1. 토스페이먼츠 웹훅 (가상계좌 입금 · 결제 상태 변경 · 빌링키 삭제)

**등록 URL** (토스 개발자센터 → 웹훅)
```
https://{PUBLIC_BASE_URL}/api/webhooks/toss?token={TOSS_WEBHOOK_PATH_TOKEN}
```

| 이벤트 | 본문 구조 | 처리 |
| :--- | :--- | :--- |
| `PAYMENT_STATUS_CHANGED` | `{ eventType, createdAt, data: Payment }` | `DONE` → 권한 지급 / `CANCELED·EXPIRED·ABORTED` → 회수 |
| `DEPOSIT_CALLBACK` | `{ createdAt, secret, status, transactionKey, orderId }` (평면) | 입금 확인 → 지급, 입금 오류 → `AWAITING_DEPOSIT` 복귀 |
| `BILLING_DELETED` | `{ eventType, data: { billingKey } }` | 해당 구독 `DELETED_BY_TOSS` 차단 |
| `CANCEL_STATUS_CHANGED` | `{ eventType, data }` | 감사 로그만 기록 |

**보안 원칙**
- 결제 웹훅에는 **서명 헤더가 없습니다**(서명은 payout/seller 이벤트 전용).
  따라서 본문의 `status`/`amount` 를 절대 신뢰하지 않고 `GET /v1/payments/{paymentKey}` 또는
  `GET /v1/payments/orders/{orderId}` 로 **재조회한 canonical 결과만** 반영합니다.
- `DEPOSIT_CALLBACK.secret` 은 최초 승인 응답의 `secret` 과 상수 시간 비교합니다.
- `tosspayments-webhook-transmission-id` 기준 멱등 처리 → 토스 재전송(최대 7회)에도 중복 지급 없음.
- 응답 코드: `200`(정상·중복·무시) / `400`(JSON 파손) / `401`(경로 토큰 불일치) / `503`(토스 API 일시 장애 → 재전송 유도)

```env
TOSS_WEBHOOK_PATH_TOKEN=무작위_공유비밀값      # 권장 (스캐너 차단)
TOSS_WEBHOOK_VERIFY_CANONICAL=true            # 실결제 모드에서는 항상 canonical 검증
TOSS_WEBHOOK_TIMEOUT_MS=8000
```

**가상계좌 흐름**: 주문 생성(`paymentMethod=VIRTUAL_ACCOUNT`) → `requestPayment` → 계좌 발급
(`AWAITING_DEPOSIT`, 잠금 유지) → 입금 → 웹훅 → 지급. 클라이언트는 `GET /api/session/report`
폴링으로 잠금 해제를 확인합니다(5초 간격, 최대 30분).

### 6-2. 자동결제(빌링) — 카드 등록 · 정기 갱신 · 재시도 · 해지

```env
TOSS_BILLING_ENABLED=auto                      # TOSS_LIVE 키가 있으면 활성
BILLING_SCHEDULER_ENABLED=auto                 # 운영 첫 배포는 false 권장 → 검증 후 on
BILLING_SCHEDULER_INTERVAL_MS=3600000          # 1시간
BILLING_RETRY_MAX=3
BILLING_RETRY_DELAY_HOURS=24
BILLING_RENEWAL_PERIOD_DAYS=365
TOSS_BILLING_ADMIN_TOKEN=관리자_전용_토큰
```

| API | 설명 |
| :--- | :--- |
| `POST /api/billing/customer-key` | 세션 → HMAC `customerKey` 파생(세션 원문 비노출) |
| `POST /api/billing/issue` | `authKey` → 빌링키 발급 + 21일 체험 즉시 부여 |
| `GET /api/billing/subscription?sessionToken=` | 구독 상태(빌링키 마스킹) |
| `POST /api/billing/charge` | 관리자 수동 청구(`force`) — `Idempotency-Key` 적용 |
| `POST /api/billing/renewals/run` | 만기 구독 일괄 갱신(스케줄러와 동일 로직) |
| `POST /api/billing/cancel` | 해지 + 토스 빌링키 삭제 |

- 갱신 청구는 최대 60초 소요 → 타임아웃 65초 + `Idempotency-Key`
- 실패 시 `failedAttempts` 누적, `retryDelayHours` 후 재시도, 한도 초과 시 `PAST_DUE`
- **자동결제는 토스페이먼츠와 별도 계약이 필요합니다.** 미계약 상태에서 `issue` 는 `NOT_SUPPORTED_METHOD` 로 실패하며, 서버는 이를 402 로 반환하고 기존 결제 흐름은 계속 동작합니다.

### 6-3. App-in-Toss 인앱 결제(IAP)

```
[클라이언트] IAP.createOneTimePurchaseOrder({ options: { sku, processProductGrant } })
   → processProductGrant({ orderId }) 안에서 POST /api/iap/grant
   → [서버] 토스 로그인 userKey + loginToken 검증 → get-order-status 재조회
   → PAYMENT_COMPLETED + SKU 일치 확인 → 멱등 지급 → true 반환 (30초 내)
```

| API | 설명 |
| :--- | :--- |
| `POST /api/iap/login` | `authorizationCode` → userKey 조회 + 10분 loginToken(세션 바인딩) |
| `POST /api/iap/grant` | 지급 콜백 — 주문 상태·SKU·userKey 검증 후 멱등 지급 |
| `POST /api/iap/sync` | 관리자 재동기화 — 환불 시 권한 회수·지급 누락 복구 |
| `GET /api/iap/products` | 콘솔 SKU ↔ 내부 플랜 카탈로그 |
| `GET /api/iap/status` | 모드·mTLS·SKU 설정 상태 |

```env
AIT_API_KEY=...                     # 없으면 SANDBOX_SIMULATION(개발 전용 시뮬레이션 지급)
AIT_APP_ID=...
AIT_MTLS_CERT_PATH=/secrets/ait-cert.pem
AIT_MTLS_KEY_PATH=/secrets/ait-key.pem
AIT_MTLS_CA_PATH=/secrets/ait-ca.pem
AIT_MTLS_KEY_PASSPHRASE=...
AIT_IAP_SKU_VIP_ANNUAL=sku.vip.annual
AIT_IAP_SKU_STARTER_PACK=sku.starter.30
AIT_IAP_SKU_VIP_SUBSCRIPTION=
AIT_IAP_ADMIN_TOKEN=관리자_전용_토큰
AIT_SESSION_SECRET=32자_이상_랜덤
AIT_IAP_ALLOW_UNBOUND_GRANT=false   # true 로 두면 loginToken 없이도 지급(권장하지 않음)
AIT_IAP_SANDBOX_GRANT=false         # 로컬 데모에서만 true (운영 기본 false)
```

- SDK 는 `frontend/js/iap.js` 가 **호스트 주입 전역(`window.AppsInTossWebFramework`) 또는
  `window.__APPS_IN_TOSS_SDK_URL__` 이 있을 때만** 사용합니다. 일반 브라우저에서는 외부 요청 없이
  비활성화되고 기존 토스페이먼츠 결제창으로 폴백합니다(앱 번들 의존성 0 유지).
- `processProductGrant` 가 30초 내 `true` 를 반환하지 못하면 토스가 자동 환불하므로,
  서버는 즉시 명확한 오류 코드를 반환합니다.
- 구버전 토스 앱(Android < 5.231.0 / iOS < 5.230.0)은 `getCompletedOrRefundedOrders` 가
  `undefined` 일 수 있으므로 방어적으로 처리합니다.

### 6-4. AI 응답 캐싱

- 캐시 키 = `SHA-256(네임스페이스 + 요청종류 + provider + model + temperature + maxTokens
  + 시스템/사용자 프롬프트 해시 + 이미지 바이트 해시)`
- 동일 입력 재요청 시 **메모리 LRU → Supabase Read-Through** 순으로 조회, 벤더 호출 0회
- 응답 본문은 **AES-256-GCM** 암호화 저장, 원본 이미지·프롬프트는 저장하지 않음
- 동일 키 동시 요청은 **Single-Flight** 로 병합해 중복 과금 방지
- TTL: 스캔 6시간 / 리포트 24시간(설정 가능), LRU 500개

```env
AI_CACHE_ENABLED=true
AI_CACHE_VERSION=v1
AI_CACHE_TTL_MS=86400000
AI_CACHE_SKIN_SCAN_TTL_MS=21600000
AI_CACHE_REPORT_TTL_MS=86400000
AI_CACHE_MAX_ENTRIES=500
AI_CACHE_MAX_PAYLOAD_BYTES=65536
AI_CACHE_UNIT_COST_USD=0.0035
AI_CACHE_PERSIST=true
```

```bash
curl http://localhost:3003/api/ai/cache/status    # 히트율·절감 추정액
curl -X POST http://localhost:3003/api/ai/cache/purge -H "x-admin-token: ..."
```

### 6-5. 검증

```bash
cd app4-glow-muse
npm run verify   # QA 100/100 + 통합 스모크 94항목
```

스모크 테스트는 목 토스페이먼츠·목 앱인토스·목 LLM 서버를 띄워
카드 승인, 가상계좌 입금 웹훅(위조·멱등·canonical), 빌링키 발급/갱신/실패 재시도/해지,
IAP 로그인·지급·중복·환불, AI 캐시 히트/미스까지 실제 HTTP 경로로 검증합니다.
