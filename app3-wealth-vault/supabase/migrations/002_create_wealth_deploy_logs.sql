-- ============================================================================
-- 파일명: 002_create_wealth_deploy_logs.sql
-- 위치: app3-wealth-vault/supabase/migrations/002_create_wealth_deploy_logs.sql
-- 설명: [제3호 앱: 웰스볼트 AI] QA 검수 및 토스 파트너 콘솔 배포 로그 테이블
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.wealth_vault_deploy_logs (
    log_id SERIAL PRIMARY KEY,
    app_code VARCHAR(60) NOT NULL,
    qa_status VARCHAR(20) NOT NULL,
    qa_score INTEGER NOT NULL CHECK (qa_score BETWEEN 0 AND 100),
    toss_app_id VARCHAR(80) NOT NULL,
    webview_endpoint TEXT NOT NULL,
    configured_price INTEGER NOT NULL,
    deployed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.wealth_vault_deploy_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service Role Full Access on Wealth Deploy Logs"
    ON public.wealth_vault_deploy_logs
    FOR ALL
    USING (auth.role() = 'service_role');
