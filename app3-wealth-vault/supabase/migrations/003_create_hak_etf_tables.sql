-- ============================================================================
-- 파일명: 003_create_hak_etf_tables.sql
-- 위치: app3-wealth-vault/supabase/migrations/003_create_hak_etf_tables.sql
-- 설명: [HAK ETF 관리 미니앱] 사용자의 ETF 포트폴리오 설계, 목표 월배당금,
--       개인재정(증권·ISA·연금·금융소득) 연동 데이터를 AES-256-GCM으로 암호화하여
--       안전하게 저장하는 데이터베이스 테이블 정의 쿼리입니다.
-- ============================================================================

-- 1. 암호화 확장 모듈 활성화 (UUID 생성 및 암호화 지원)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. [HAK ETF 관리] 암호화된 ETF 배당·절세 시뮬레이션 저장 테이블
CREATE TABLE IF NOT EXISTS public.hak_etf_encrypted_simulations (
    -- 각 시뮬레이션마다 자동으로 부여되는 고유 번호(UUID)
    simulation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- 동일 사용자인지 식별하기 위한 단방향 HMAC-SHA256 해시값 (원본 이름 복원 불가)
    user_lookup_hash VARCHAR(64) NOT NULL,

    -- AES-256-GCM으로 암호화된 사용자 이름
    encrypted_user_name TEXT NOT NULL,

    -- AES-256-GCM으로 암호화된 ETF 포트폴리오 및 개인재정 연동 원본 데이터
    -- (투자금액, 목표 월배당금, 선택 ETF 종목 코드, 기존 금융소득 등이 암호화되어 저장됨)
    encrypted_etf_payload TEXT NOT NULL,

    -- AES-256-GCM 복호화에 필요한 초기화 벡터(IV)와 무결성 검증 태그(Auth Tag)
    encryption_iv VARCHAR(64) NOT NULL,
    encryption_auth_tag VARCHAR(64) NOT NULL,

    -- 공개 가능한 요약 지표: 선택한 ETF 종목 개수 및 예상 연 분배율(%)
    selected_etf_count INTEGER NOT NULL DEFAULT 1,
    expected_annual_yield_pct NUMERIC(5, 2) NOT NULL DEFAULT 0.00,

    -- 금융소득종합과세(2,000만 원) 안전 등급 ('SAFE', 'CAUTION', 'DANGER')
    tax_safety_grade VARCHAR(20) NOT NULL DEFAULT 'SAFE',

    -- 데이터 생성 시각
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. 행 수준 보안(RLS: Row Level Security) 활성화 (외부 무단 접근 완벽 차단)
ALTER TABLE public.hak_etf_encrypted_simulations ENABLE ROW LEVEL SECURITY;

-- 4. 백엔드 서버(Service Role)만 암호화된 테이블에 접근할 수 있도록 보안 정책 설정
CREATE POLICY "Service Role Full Access on HAK ETF Encrypted Simulations"
    ON public.hak_etf_encrypted_simulations
    FOR ALL
    USING (auth.role() = 'service_role');
