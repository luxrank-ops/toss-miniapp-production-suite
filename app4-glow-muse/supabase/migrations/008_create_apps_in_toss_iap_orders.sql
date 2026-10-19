-- ============================================================================
-- 파일명: 008_create_apps_in_toss_iap_orders.sql
-- 역할: [App-in-Toss 인앱결제(IAP)] 주문 원장 — orderId 멱등 지급 + 환불 회수
-- ----------------------------------------------------------------------------
-- 설계 원칙:
--   1) ait_order_id(토스 인앱결제 orderId)를 PK 로 두어 processProductGrant 재시도·
--      getPendingOrders 복원 시에도 크레딧이 중복 지급되지 않습니다.
--   2) user_key_hash 는 토스 로그인 userKey 의 SHA-256 (원문 미저장).
--   3) 결제 검증 상세(원격 상태·SKU 일치 여부)는 암호화 페이로드에 보관합니다.
--
-- 적용 순서: 007 이후 Supabase SQL Editor 에서 실행
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.glow_muse_iap_orders (
    ait_order_id        TEXT PRIMARY KEY,              -- Apps in Toss IAP orderId (uuid v7)
    session_token       TEXT NOT NULL,
    sku                 VARCHAR(120) NOT NULL,         -- 콘솔 등록 SKU
    plan_tier           VARCHAR(40) NOT NULL,          -- VIP_ANNUAL | STARTER_PACK
    credits_granted     INTEGER NOT NULL DEFAULT 0,
    status              VARCHAR(24) NOT NULL,          -- GRANTED | REFUNDED | REVOKED | FAILED
    user_key_hash       CHAR(64),                      -- 토스 로그인 userKey SHA-256
    internal_order_id   VARCHAR(120),                  -- 내부 결제 원장(glow_muse_runtime_orders) FK
    encrypted_payload   TEXT NOT NULL,                 -- 검증 상세·세션·SKU 정보 AES-256-GCM
    iv_hex              TEXT NOT NULL,
    auth_tag_hex        TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_iap_session
    ON public.glow_muse_iap_orders(session_token);
CREATE INDEX IF NOT EXISTS idx_iap_sku
    ON public.glow_muse_iap_orders(sku);
CREATE INDEX IF NOT EXISTS idx_iap_status
    ON public.glow_muse_iap_orders(status);
CREATE INDEX IF NOT EXISTS idx_iap_internal_order
    ON public.glow_muse_iap_orders(internal_order_id);

-- 운영 보안: RLS 활성화 (service_role 만 접근)
-- ALTER TABLE public.glow_muse_iap_orders ENABLE ROW LEVEL SECURITY;
-- ============================================================================
