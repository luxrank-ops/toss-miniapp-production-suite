-- ============================================================================
-- 파일명: 003_upgrade_business_evaluator_override.sql
-- 설명: [App Business Evaluator 최우선 결정(Override) 반영]
--       1. Hard Paywall 전환 및 21일 장기 체험 + 연간 VIP 패스(RLTV 극대화) 과금 컬럼 추가
--       2. Thin Wrapper 역마진 방어를 위한 글로우 크레딧 한도(remaining_credits) 컬럼 추가
--       3. Nir Eyal Hook 모델 4단계(주 3회 체크인 스탬프 & 암호화된 내 화장품 파우치 금고) 테이블 생성
-- ============================================================================

-- 1. 진단 세션 테이블에 하드 페이월, 크레딧 한도, 주간 훅 스탬프 컬럼 추가
ALTER TABLE IF EXISTS public.glow_muse_diagnoses
    ADD COLUMN IF NOT EXISTS paywall_type VARCHAR(30) NOT NULL DEFAULT 'HARD_PAYWALL',
    ADD COLUMN IF NOT EXISTS selected_plan_tier VARCHAR(40) NOT NULL DEFAULT 'LOCKED',
    ADD COLUMN IF NOT EXISTS remaining_credits INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS weekly_checkin_count INTEGER NOT NULL DEFAULT 0;

-- 2. Nir Eyal Hook 4단계(Investment Loop): 사용자 화장품 파우치 & 시술 히스토리 암호화 금고 테이블
CREATE TABLE IF NOT EXISTS public.glow_muse_pouch_vault (
    vault_item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_token VARCHAR(64) NOT NULL REFERENCES public.glow_muse_diagnoses(session_token) ON DELETE CASCADE,
    encrypted_item_payload TEXT NOT NULL,               -- AES-256-GCM으로 암호화된 보유 화장품/시술 정보
    encryption_iv VARCHAR(64) NOT NULL,                 -- 초기화 벡터 (IV)
    encryption_auth_tag VARCHAR(64) NOT NULL,           -- 무결성 검증 태그 (Auth Tag)
    compatibility_verdict VARCHAR(60) NOT NULL,         -- 독점 캐싱 DB 판독 결과 ('SYNERGY_GOLD' | 'CONFLICT_DANGER')
    credits_deducted INTEGER NOT NULL DEFAULT 5,        -- 스캔 시 차감된 AI 크레딧
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_glow_pouch_vault_session ON public.glow_muse_pouch_vault(session_token);
