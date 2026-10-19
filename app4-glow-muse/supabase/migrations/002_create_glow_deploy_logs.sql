-- ============================================================================
-- 파일명: 002_create_glow_deploy_logs.sql
-- 설명: AGENT 6 (QA 감사) 및 AGENT 7 (토스 미니앱 파트너 콘솔 자동 배포) 이력 관리 테이블
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.glow_muse_deploy_logs (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    miniapp_id VARCHAR(100) NOT NULL,
    draft_version VARCHAR(40) NOT NULL,
    qa_audit_status VARCHAR(20) NOT NULL,               -- 'PASS' 또는 'REJECT'
    qa_score INTEGER NOT NULL,                          -- 100점 만점 기준 점수
    bundle_hash VARCHAR(128) NOT NULL,                  -- 빌드 산출물 무결성 SHA-256 해시
    endpoint_url TEXT NOT NULL,                         -- 토스 인앱 브라우저 테스트 엔드포인트
    deployed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
