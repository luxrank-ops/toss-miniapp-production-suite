-- ============================================================================
-- 파일명: 002_create_deployment_logs_table.sql
-- 위치: supabase/migrations/002_create_deployment_logs_table.sql
-- 설명: AGENT 0 ~ AGENT 7 자율 스쿼드의 세대별 트렌드 발굴 및 토스 미니앱 자동 배포 로그 테이블
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.miniapp_factory_cycles (
    cycle_id SERIAL PRIMARY KEY,
    -- 루프 회차 (Loop #1: MZ세대, Loop #2: 시니어세대, Loop #3: 알파세대 등)
    loop_number INTEGER NOT NULL,
    target_generation VARCHAR(50) NOT NULL,
    miniapp_title VARCHAR(150) NOT NULL,
    -- QA 에이전트(AGENT 6) 검수 결과 ('PASS' or 'REJECT')
    qa_audit_status VARCHAR(20) NOT NULL,
    qa_score INTEGER NOT NULL CHECK (qa_score BETWEEN 0 AND 100),
    -- 배포 에이전트(AGENT 7)가 발급받은 토스 파트너 콘솔 가상 App ID 및 버전
    toss_app_id VARCHAR(80) NOT NULL,
    draft_version VARCHAR(30) NOT NULL,
    -- 토스 인앱 브라우저 테스트 엔드포인트
    webview_endpoint_url TEXT NOT NULL,
    -- 배포 당시 설정된 동적 가격 (MONETIZATION_PRICE)
    configured_price INTEGER NOT NULL,
    -- 배포 완료 시각
    deployed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS 보안 활성화
ALTER TABLE public.miniapp_factory_cycles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Backend Service Role Full Access on Factory Cycles"
    ON public.miniapp_factory_cycles
    FOR ALL
    USING (auth.role() = 'service_role');
