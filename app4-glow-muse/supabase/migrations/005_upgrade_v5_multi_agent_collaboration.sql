-- ============================================================================
-- 파일명: supabase/migrations/005_upgrade_v5_multi_agent_collaboration.sql
-- 역할: [4대 전문 서브에이전트 합동 협업 v5.0 통합 마이그레이션]
--   1. app-business-evaluator (1순위): AI 포토 스튜디오(-10 크레딧), 정밀 장벽 재스캔(-3 크레딧),
--      파우치 상극 스캔(-5 크레딧) 등 차등 크레딧 원장(Credit Deduction Matrix) 컬럼 확장
--   2. top-tier-app-consultant (2순위): 4주 회복 이원화 곡선(SOS 적용 vs 방치 시 노화 가속) 및
--      인스타/카톡 바이럴 처방 영수증 공유 리워드 로그 테이블 생성
--   3. cross-store-design-differentiator (3순위) & toss-top10-design-benchmarker (4순위):
--      AI 추구미 포토 스튜디오 4대 룩북 시뮬레이션 메타데이터(AES-256-GCM 암호화) 저장소
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.glow_muse_photo_studio_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_token TEXT NOT NULL,
    selected_vibe_look TEXT NOT NULL,
    credits_deducted INTEGER NOT NULL DEFAULT 10,
    encrypted_studio_payload TEXT NOT NULL,
    iv_hex TEXT NOT NULL,
    auth_tag_hex TEXT NOT NULL,
    encryption_algorithm TEXT NOT NULL DEFAULT 'AES-256-GCM',
    raw_photo_discarded BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.glow_muse_viral_receipt_shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_token TEXT NOT NULL,
    receipt_serial_code TEXT NOT NULL,
    bonus_credits_awarded INTEGER NOT NULL DEFAULT 3,
    share_channel TEXT NOT NULL DEFAULT 'INSTA_KAKAO_RECEIPT',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_photo_studio_session
    ON public.glow_muse_photo_studio_logs (session_token, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_viral_receipt_session
    ON public.glow_muse_viral_receipt_shares (session_token, created_at DESC);
