-- ============================================================================
-- 파일명: 001_create_glow_muse_tables.sql
-- 설명: 뮤즈글로우 AI (여성 맞춤형 추구미·슬로우에이징·호르몬 황금기 진단 앱) 데이터베이스 스키마
-- 주의사항: 모든 개인 식별 정보 및 민감한 체질/주기 데이터는 백엔드에서 AES-256-GCM으로
--           암호화된 상태(encrypted_payload, iv, auth_tag)로만 저장됩니다. (평문 저장 절대 금지)
-- ============================================================================

-- 1. 여성 뷰티·웰니스 진단 요청 및 AES-256-GCM 암호화 저장 테이블
CREATE TABLE IF NOT EXISTS public.glow_muse_diagnoses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_token VARCHAR(64) NOT NULL UNIQUE,
    focus_mode VARCHAR(40) NOT NULL,                    -- 'CHUGUMI_MOOD' | 'SLOW_AGING_LOOP' | 'HORMONE_DIET'
    encrypted_user_profile TEXT NOT NULL,               -- AES-256-GCM 암호화된 사용자 입력(닉네임, 연령대, 피부/체질, 주기)
    encryption_iv VARCHAR(64) NOT NULL,                 -- 초기화 벡터 (IV)
    encryption_auth_tag VARCHAR(64) NOT NULL,           -- 무결성 검증 태그 (Auth Tag)
    muse_aura_title VARCHAR(120) NOT NULL,              -- 무료 요약: 진단된 나의 추구미 아우라 타이틀
    glow_index_score INTEGER NOT NULL,                  -- 무료 요약: 슬로우에이징 & 아우라 총점 (0~100)
    annual_saved_waste_krw BIGINT NOT NULL DEFAULT 0,   -- 무료 요약: 연간 방어 가능한 피부과·올영·다이어트 호구 비용(원)
    is_premium_unlocked BOOLEAN NOT NULL DEFAULT FALSE, -- 유료 시크릿 처방전 잠금 해제 여부
    applied_price_krw INTEGER NOT NULL,                 -- 진단 시점의 동적 유료화 설정 금액 (환경변수 주입값)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. 토스 인앱 결제 및 정산 원장 테이블
CREATE TABLE IF NOT EXISTS public.glow_muse_payments (
    payment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_token VARCHAR(64) NOT NULL REFERENCES public.glow_muse_diagnoses(session_token) ON DELETE CASCADE,
    toss_order_id VARCHAR(100) NOT NULL UNIQUE,
    paid_amount_krw INTEGER NOT NULL,                   -- 실제 결제된 동적 금액
    app_owner_id_masked VARCHAR(100) NOT NULL,          -- 마스킹된 정산 소유자 ID
    payment_status VARCHAR(30) NOT NULL DEFAULT 'COMPLETED',
    paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 빠른 세션 조회를 위한 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_glow_muse_session_token ON public.glow_muse_diagnoses(session_token);
CREATE INDEX IF NOT EXISTS idx_glow_muse_order_id ON public.glow_muse_payments(toss_order_id);
