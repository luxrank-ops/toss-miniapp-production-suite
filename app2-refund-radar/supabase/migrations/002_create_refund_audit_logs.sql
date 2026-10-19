-- ============================================================================
-- 파일명: 002_create_refund_audit_logs.sql
-- 위치: app2-refund-radar/supabase/migrations/002_create_refund_audit_logs.sql
-- 설명: [제2호 앱: 환급레이더 AI] QA 검수 및 토스 미니앱 파트너 콘솔 배포 로그 테이블
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.refund_radar_deploy_logs (
    log_id SERIAL PRIMARY KEY,
    app_code VARCHAR(60) NOT NULL,
    qa_status VARCHAR(20) NOT NULL,
    qa_score INTEGER NOT NULL CHECK (qa_score BETWEEN 0 AND 100),
    toss_app_id VARCHAR(80) NOT NULL,
    webview_endpoint TEXT NOT NULL,
    configured_price INTEGER NOT NULL,
    deployed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.refund_radar_deploy_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service Role Full Access on Refund Deploy Logs"
    ON public.refund_radar_deploy_logs
    FOR ALL
    USING (auth.role() = 'service_role');
