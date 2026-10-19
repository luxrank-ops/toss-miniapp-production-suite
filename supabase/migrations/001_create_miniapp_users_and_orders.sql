-- ============================================================================
-- 파일명: 001_create_miniapp_users_and_orders.sql
-- 위치: supabase/migrations/001_create_miniapp_users_and_orders.sql
-- 설명: 토스 미니앱 이용자의 암호화된 개인정보 및 동적 유료 결제(주문) 내역을 저장하는 테이블
-- 보안 규칙 준수: 생년월일, 이름 등 모든 민감 개인정보는 애플리케이션 단에서
--               AES-256-GCM으로 암호화된 상태(encrypted_*)로만 저장됩니다.
-- ============================================================================

-- 1. UUID 생성을 위한 확장 기능 활성화
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. 미니앱 분석 요청 및 암호화된 사용자 프로필 테이블 생성
CREATE TABLE IF NOT EXISTS public.miniapp_encrypted_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- 타겟 세대 및 미니앱 종류 (예: 'MZ_SAJU', 'SENIOR_HEALTH', 'ALPHA_FEEL')
    app_category VARCHAR(50) NOT NULL DEFAULT 'MZ_SAJU',
    -- 사용자 식별 해시 (평문 노출 없이 동일 사용자 여부만 판별하기 위한 SHA-256 단방향 해시)
    user_lookup_hash VARCHAR(64) NOT NULL,
    -- AES-256-GCM으로 암호화된 사용자 이름/닉네임 (평문 저장 절대 금지)
    encrypted_user_name TEXT NOT NULL,
    -- AES-256-GCM으로 암호화된 생년월일시 및 민감 입력 데이터 페이로드
    encrypted_birth_payload TEXT NOT NULL,
    -- 암호화 초기화 벡터(IV) 및 인증 태그(Auth Tag) 메타데이터
    encryption_iv VARCHAR(64) NOT NULL,
    encryption_auth_tag VARCHAR(64) NOT NULL,
    -- 선택된 고민 카테고리 (비민감 통계용 데이터)
    concern_topic VARCHAR(50) NOT NULL,
    -- 생성 일시
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. 토스 미니앱 동적 유료화 결제 검증 및 정산 원장 테이블 생성
CREATE TABLE IF NOT EXISTS public.miniapp_payment_orders (
    order_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES public.miniapp_encrypted_requests(id) ON DELETE CASCADE,
    -- 토스 페이먼츠 / 인앱 결제 트랜잭션 고유 키
    toss_payment_key VARCHAR(120) UNIQUE NOT NULL,
    -- 환경변수(APP_OWNER_ID / USER_IDENTITY)에서 동적으로 주입된 판매자 식별자
    app_owner_id VARCHAR(100) NOT NULL,
    -- 환경변수(MONETIZATION_PRICE / REVENUE_PRICE)에서 동적으로 주입된 결제 금액 (원)
    charged_amount INTEGER NOT NULL CHECK (charged_amount >= 0),
    -- 결제 상태 ('READY', 'PAID', 'CANCELLED', 'FAILED')
    payment_status VARCHAR(20) NOT NULL DEFAULT 'PAID',
    -- 프리미엄 리포트 잠금 해제 여부
    is_unlocked BOOLEAN NOT NULL DEFAULT TRUE,
    -- 결제 승인 시각
    approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Row Level Security (RLS, 행 수준 보안) 활성화로 외부 무단 접근 원천 차단
ALTER TABLE public.miniapp_encrypted_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.miniapp_payment_orders ENABLE ROW LEVEL SECURITY;

-- 5. 서비스 역할(Service Role - 백엔드 서버)만 접근 가능하도록 보안 정책 설정
CREATE POLICY "Backend Service Role Full Access on Requests"
    ON public.miniapp_encrypted_requests
    FOR ALL
    USING (auth.role() = 'service_role');

CREATE POLICY "Backend Service Role Full Access on Orders"
    ON public.miniapp_payment_orders
    FOR ALL
    USING (auth.role() = 'service_role');
