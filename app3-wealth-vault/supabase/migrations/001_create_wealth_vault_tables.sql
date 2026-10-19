-- ============================================================================
-- 파일명: 001_create_wealth_vault_tables.sql
-- 위치: app3-wealth-vault/supabase/migrations/001_create_wealth_vault_tables.sql
-- 설명: [제3호 앱: 웰스볼트 AI] 사용자의 은행·증권·부동산·동산·보험 재산 및 임대/금융소득
--       정보를 AES-256-GCM으로 암호화하여 저장하는 테이블과 결제 원장 테이블
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. 암호화된 개인 재산 및 소득 진단 요청 테이블
CREATE TABLE IF NOT EXISTS public.wealth_vault_encrypted_portfolios (
    portfolio_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- 진단 포커스 모드 ('TOTAL_WEALTH', 'REALESTATE_RENT', 'FINANCE_DIVIDEND')
    focus_mode VARCHAR(50) NOT NULL DEFAULT 'TOTAL_WEALTH',
    -- 동일 사용자 판별용 단방향 SHA-256 해시
    user_lookup_hash VARCHAR(64) NOT NULL,
    -- AES-256-GCM 암호화된 사용자 이름
    encrypted_user_name TEXT NOT NULL,
    -- AES-256-GCM 암호화된 5대 자산(은행/증권/부동산/동산/보험) 및 2대 소득(임대/금융소득) 원본 페이로드
    encrypted_wealth_payload TEXT NOT NULL,
    encryption_iv VARCHAR(64) NOT NULL,
    encryption_auth_tag VARCHAR(64) NOT NULL,
    -- 재정 건전성 및 절세 방어 점수 (0~100)
    wealth_health_score INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. 동적 유료화 결제 검증 및 리포트 잠금 해제 원장 테이블
CREATE TABLE IF NOT EXISTS public.wealth_vault_payment_orders (
    order_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    portfolio_id UUID NOT NULL REFERENCES public.wealth_vault_encrypted_portfolios(portfolio_id) ON DELETE CASCADE,
    toss_payment_key VARCHAR(120) UNIQUE NOT NULL,
    app_owner_id VARCHAR(100) NOT NULL,
    charged_amount INTEGER NOT NULL CHECK (charged_amount >= 0),
    payment_status VARCHAR(20) NOT NULL DEFAULT 'PAID',
    is_unlocked BOOLEAN NOT NULL DEFAULT TRUE,
    approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.wealth_vault_encrypted_portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wealth_vault_payment_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service Role Full Access on Encrypted Portfolios"
    ON public.wealth_vault_encrypted_portfolios
    FOR ALL
    USING (auth.role() = 'service_role');

CREATE POLICY "Service Role Full Access on Wealth Payment Orders"
    ON public.wealth_vault_payment_orders
    FOR ALL
    USING (auth.role() = 'service_role');
