-- ============================================================================
-- 파일명: 001_create_refund_radar_tables.sql
-- 위치: app2-refund-radar/supabase/migrations/001_create_refund_radar_tables.sql
-- 설명: [제2호 앱: 환급레이더 AI] 사용자의 AES-256-GCM 암호화 프로필 및 환급 리포트 결제 테이블
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. 암호화된 환급 스캔 요청 테이블
CREATE TABLE IF NOT EXISTS public.refund_radar_encrypted_scans (
    scan_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- 타겟 모드 ('WORKER_REFUND', 'SENIOR_MEDICAL', 'FREELANCE_TAX')
    scan_mode VARCHAR(50) NOT NULL DEFAULT 'WORKER_REFUND',
    -- 동일 사용자 판별용 단방향 SHA-256 해시
    user_lookup_hash VARCHAR(64) NOT NULL,
    -- AES-256-GCM 암호화된 사용자 이름
    encrypted_user_name TEXT NOT NULL,
    -- AES-256-GCM 암호화된 생년월일 및 지출/의료 프로필 페이로드
    encrypted_profile_payload TEXT NOT NULL,
    encryption_iv VARCHAR(64) NOT NULL,
    encryption_auth_tag VARCHAR(64) NOT NULL,
    -- 무료 스캔으로 산출된 총 예상 환급액 합계 (원)
    estimated_total_refund INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. 동적 유료화 결제 및 잠금 해제 원장 테이블
CREATE TABLE IF NOT EXISTS public.refund_radar_payment_orders (
    order_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scan_id UUID NOT NULL REFERENCES public.refund_radar_encrypted_scans(scan_id) ON DELETE CASCADE,
    toss_payment_key VARCHAR(120) UNIQUE NOT NULL,
    app_owner_id VARCHAR(100) NOT NULL,
    charged_amount INTEGER NOT NULL CHECK (charged_amount >= 0),
    payment_status VARCHAR(20) NOT NULL DEFAULT 'PAID',
    is_unlocked BOOLEAN NOT NULL DEFAULT TRUE,
    approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.refund_radar_encrypted_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refund_radar_payment_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service Role Full Access on Refund Scans"
    ON public.refund_radar_encrypted_scans
    FOR ALL
    USING (auth.role() = 'service_role');

CREATE POLICY "Service Role Full Access on Refund Orders"
    ON public.refund_radar_payment_orders
    FOR ALL
    USING (auth.role() = 'service_role');
