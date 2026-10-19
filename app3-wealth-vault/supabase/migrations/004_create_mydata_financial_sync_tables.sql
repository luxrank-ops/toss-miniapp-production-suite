-- ============================================================================
-- 파일명: 004_create_mydata_financial_sync_tables.sql
-- 위치: app3-wealth-vault/supabase/migrations/004_create_mydata_financial_sync_tables.sql
-- 설명: [금융권 마이데이터 통합 자산 불러오기] 카카오페이, 시중은행·신협, 증권사, 보험사 등
--       금융권에서 불러온 사용자의 계좌 잔고 및 이자·배당 내역을 AES-256-GCM으로
--       암호화하여 저장하는 데이터베이스 테이블 정의 쿼리입니다.
-- ============================================================================

-- 1. 암호화 확장 모듈 활성화 (UUID 생성 및 암호화 지원)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. 금융권 마이데이터 암호화 자산 연동 내역 저장 테이블
CREATE TABLE IF NOT EXISTS public.mydata_encrypted_financial_syncs (
    -- 각 자산 불러오기 실행마다 부여되는 고유 식별자(UUID)
    sync_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- 동일 사용자 판별용 단방향 HMAC-SHA256 해시값 (원본 복원 불가)
    user_lookup_hash VARCHAR(64) NOT NULL,

    -- AES-256-GCM으로 암호화된 사용자 이름
    encrypted_user_name TEXT NOT NULL,

    -- AES-256-GCM으로 암호화된 금융기관별 상세 계좌 잔고, 연간 이자·배당금, 보유 ETF 원본 데이터
    encrypted_accounts_payload TEXT NOT NULL,

    -- AES-256-GCM 복호화용 초기화 벡터(IV) 및 무결성 인증 태그(Auth Tag)
    encryption_iv VARCHAR(64) NOT NULL,
    encryption_auth_tag VARCHAR(64) NOT NULL,

    -- 연동된 금융기관 총 개수 (예: 카카오페이, 신협, 삼성증권 등 7개 기관)
    synced_institution_count INTEGER NOT NULL DEFAULT 0,

    -- 연동된 계좌 총 개수
    synced_account_count INTEGER NOT NULL DEFAULT 0,

    -- 불러온 시각
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. 행 수준 보안(RLS: Row Level Security) 활성화 (외부 무단 조회 차단)
ALTER TABLE public.mydata_encrypted_financial_syncs ENABLE ROW LEVEL SECURITY;

-- 4. 백엔드 서버(Service Role)만 암호화 원장에 접근할 수 있도록 보안 정책 적용
CREATE POLICY "Service Role Full Access on MyData Encrypted Financial Syncs"
    ON public.mydata_encrypted_financial_syncs
    FOR ALL
    USING (auth.role() = 'service_role');
