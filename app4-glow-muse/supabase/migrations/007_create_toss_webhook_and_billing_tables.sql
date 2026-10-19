-- ============================================================================
-- 파일명: 007_create_toss_webhook_and_billing_tables.sql
-- 역할: [토스페이먼츠 웹훅 + 자동결제(빌링)] 운영 스키마
-- ----------------------------------------------------------------------------
-- 1) 웹훅 수신 로그  : transmission_id 멱등성 + 감사 추적 (본문은 AES-256-GCM 암호화)
-- 2) 빌링 구독 원장  : 빌링키는 암호화 페이로드에만 저장, 평문에는 SHA-256 해시/마스킹만
-- 3) 주문 원장 확장  : 가상계좌/자동결제/IAP 지급 상태 컬럼 추가
--
-- 적용 순서: 006 이후 Supabase SQL Editor 에서 실행
-- 주의: 앱은 본 마이그레이션이 없어도 인메모리 폴백으로 계속 동작합니다.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 주문 원장 확장 (006 테이블에 컬럼 추가)
-- ----------------------------------------------------------------------------
ALTER TABLE public.glow_muse_runtime_orders
    ADD COLUMN IF NOT EXISTS payment_method VARCHAR(24) DEFAULT 'CARD',
    ADD COLUMN IF NOT EXISTS payment_source VARCHAR(40) DEFAULT 'TOSS_PAYMENTS',
    ADD COLUMN IF NOT EXISTS subscription_id VARCHAR(80),
    ADD COLUMN IF NOT EXISTS customer_name VARCHAR(80),
    ADD COLUMN IF NOT EXISTS bank VARCHAR(40),
    ADD COLUMN IF NOT EXISTS virtual_account_json TEXT,
    ADD COLUMN IF NOT EXISTS entitlements_granted BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_rt_orders_subscription
    ON public.glow_muse_runtime_orders(subscription_id);
CREATE INDEX IF NOT EXISTS idx_rt_orders_entitlement
    ON public.glow_muse_runtime_orders(entitlements_granted);

-- ----------------------------------------------------------------------------
-- 2. 웹훅 수신 로그 (멱등성 + 감사 추적)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.glow_muse_payment_webhook_logs (
    transmission_id     TEXT PRIMARY KEY,              -- tosspayments-webhook-transmission-id
    event_type          VARCHAR(40) NOT NULL,          -- PAYMENT_STATUS_CHANGED | DEPOSIT_CALLBACK | BILLING_DELETED ...
    order_id            VARCHAR(120),                  -- 조회/추적용 평문 인덱스
    payment_status      VARCHAR(30),
    processed_result    VARCHAR(60),                   -- FULFILLED | REVOKED | AWAITING_DEPOSIT | IGNORED_* ...
    retried_count       INTEGER NOT NULL DEFAULT 0,    -- 토스 재전송 횟수
    encrypted_payload   TEXT NOT NULL,                 -- 웹훅 원본(카드/계좌 정보 포함) AES-256-GCM
    iv_hex              TEXT NOT NULL,
    auth_tag_hex        TEXT NOT NULL,
    received_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wh_order ON public.glow_muse_payment_webhook_logs(order_id);
CREATE INDEX IF NOT EXISTS idx_wh_event_type ON public.glow_muse_payment_webhook_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_wh_received ON public.glow_muse_payment_webhook_logs(received_at DESC);

-- ----------------------------------------------------------------------------
-- 3. 자동결제(빌링) 구독 원장
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.glow_muse_billing_subscriptions (
    subscription_id     TEXT PRIMARY KEY,
    customer_key        VARCHAR(60) NOT NULL,          -- 세션 토큰 HMAC 파생값(원문 세션 미노출)
    plan_tier           VARCHAR(40) NOT NULL,          -- VIP_ANNUAL
    amount_krw          INTEGER NOT NULL DEFAULT 0,
    status              VARCHAR(24) NOT NULL,          -- ACTIVE | PAST_DUE | CANCELED | DELETED_BY_TOSS
    next_charge_at      TIMESTAMPTZ,                   -- 다음 갱신(청구) 시각
    failed_attempts     INTEGER NOT NULL DEFAULT 0,
    billing_key_masked  VARCHAR(80),
    billing_key_hash    CHAR(64),                      -- 웹훅(BILLING_DELETED) 매칭용 SHA-256
    encrypted_payload   TEXT NOT NULL,                 -- 빌링키 원문·세션토큰·체험 정보 AES-256-GCM
    iv_hex              TEXT NOT NULL,
    auth_tag_hex        TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_customer ON public.glow_muse_billing_subscriptions(customer_key);
CREATE INDEX IF NOT EXISTS idx_billing_status_due
    ON public.glow_muse_billing_subscriptions(status, next_charge_at);
CREATE INDEX IF NOT EXISTS idx_billing_key_hash
    ON public.glow_muse_billing_subscriptions(billing_key_hash);

-- ----------------------------------------------------------------------------
-- 운영 보안: RLS 활성화 (service_role 만 접근)
-- ----------------------------------------------------------------------------
-- ALTER TABLE public.glow_muse_payment_webhook_logs ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.glow_muse_billing_subscriptions ENABLE ROW LEVEL SECURITY;
-- (RLS 정책이 없으면 anon/authenticated 는 기본 차단, service_role 은 우회)
-- ============================================================================
