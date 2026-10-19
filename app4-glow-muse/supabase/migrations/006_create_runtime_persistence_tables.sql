-- ============================================================================
-- 파일명: 006_create_runtime_persistence_tables.sql
-- 역할: [런타임 영속화(Persistence) 스키마]
--       MuseGlow AI v5.0 백엔드가 메모리(Map)에 보관하던 런타임 원장을
--       Supabase(PostgreSQL)로 이관하여 서버 재시작·다중 인스턴스 환경에서도
--       세션·주문·결제·스캔 데이터가 소실되지 않도록 합니다.
--
-- 설계 원칙:
--   1) 보안(규칙 8): 세션·결제·스캔 원본은 **AES-256-GCM으로 암호화된 페이로드
--      (encrypted_payload + iv_hex + auth_tag_hex)로만 저장**합니다.
--      특히 토스페이먼츠 영수증의 카드번호·승인정보는 반드시 암호화 대상입니다.
--   2) 무중단(Fallback): Supabase 미설정·장애 시 애플리케이션은 자동으로
--      인메모리 모드로 동작하므로 본 테이블이 없어도 서비스는 정상 구동됩니다.
--   3) 조회 성능을 위해 **검색에 쓰이는 컬럼만 평문 인덱싱**합니다.
--      (session_token, order_id, status, created_at)
--
-- 적용 방법: Supabase 대시보드 → SQL Editor 에서 실행 (또는 supabase db push)
-- ============================================================================

-- 1. 진단 세션 원장 (세션 1건 = 1행, 전체 레코드는 암호화 저장)
CREATE TABLE IF NOT EXISTS public.glow_muse_runtime_sessions (
    session_token           TEXT PRIMARY KEY,
    encrypted_payload       TEXT NOT NULL,              -- AES-256-GCM 암호화된 세션 레코드 전체(JSON)
    iv_hex                  TEXT NOT NULL,              -- 초기화 벡터(IV)
    auth_tag_hex            TEXT NOT NULL,              -- 무결성 인증 태그(Auth Tag)
    is_premium_unlocked     BOOLEAN NOT NULL DEFAULT FALSE,
    selected_plan_tier      VARCHAR(60),
    remaining_credits       INTEGER NOT NULL DEFAULT 0,
    last_order_id           VARCHAR(120),
    ai_status               VARCHAR(30),                -- PENDING | AI_READY | FALLBACK_READY
    ai_provider             VARCHAR(30),                -- gemini | openai | anthropic | null
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. 결제 주문 원장 (토스페이먼츠 주문 생성 ~ 승인/취소 전 생애주기)
CREATE TABLE IF NOT EXISTS public.glow_muse_runtime_orders (
    order_id                TEXT PRIMARY KEY,
    session_token           TEXT NOT NULL,
    plan_tier               VARCHAR(40) NOT NULL,       -- VIP_ANNUAL | STARTER_PACK
    amount_krw              INTEGER NOT NULL,           -- 서버가 확정한 금액(클라이언트 조작 불가)
    credits_granted         INTEGER NOT NULL DEFAULT 0,
    trial_days              INTEGER NOT NULL DEFAULT 0,
    order_name              TEXT,
    status                  VARCHAR(20) NOT NULL,       -- CREATED | PAID | FAILED | CANCELED
    payment_mode            VARCHAR(24),                -- TOSS_LIVE | SANDBOX_SIMULATION
    payment_key_masked      TEXT,                       -- 마스킹된 paymentKey (조회/디버깅용)
    encrypted_receipt       TEXT,                       -- AES-256-GCM 암호화된 토스 영수증(카드번호 포함)
    receipt_iv_hex          TEXT,
    receipt_auth_tag_hex    TEXT,
    app_owner_id_masked     VARCHAR(120),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. 결제 완료 원장 (정산·매출 분석용)
CREATE TABLE IF NOT EXISTS public.glow_muse_runtime_payments (
    toss_order_id           TEXT PRIMARY KEY,
    session_token           TEXT NOT NULL,
    plan_tier               VARCHAR(60),
    paid_amount_krw         INTEGER NOT NULL DEFAULT 0,
    credits_granted         INTEGER NOT NULL DEFAULT 0,
    remaining_credits       INTEGER NOT NULL DEFAULT 0,
    payment_mode            VARCHAR(24),
    ai_provider             VARCHAR(30),
    ai_applied              BOOLEAN NOT NULL DEFAULT FALSE,
    encrypted_payload       TEXT NOT NULL,              -- 암호화된 결제 상세(영수증·정산자 정보)
    iv_hex                  TEXT NOT NULL,
    auth_tag_hex            TEXT NOT NULL,
    app_owner_id_masked     VARCHAR(120),
    settlement_holder_masked VARCHAR(120),
    paid_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. AI 피부 장벽 스캔 결과 원장 (원본 사진은 저장하지 않음)
CREATE TABLE IF NOT EXISTS public.glow_muse_runtime_skin_scans (
    scan_id                 TEXT PRIMARY KEY,
    session_token           TEXT,
    encrypted_payload       TEXT NOT NULL,              -- 암호화된 스캔 메타데이터(점수·지표·루틴)
    iv_hex                  TEXT NOT NULL,
    auth_tag_hex            TEXT NOT NULL,
    skin_type               VARCHAR(160),
    skin_barrier_score      INTEGER,
    barrier_status          VARCHAR(30),
    ai_provider             VARCHAR(30),
    ai_applied              BOOLEAN NOT NULL DEFAULT FALSE,
    raw_photo_retained      BOOLEAN NOT NULL DEFAULT FALSE, -- 항상 FALSE (원본 즉시 폐기 원칙)
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. AI 추구미 포토 스튜디오 렌더링 로그
CREATE TABLE IF NOT EXISTS public.glow_muse_runtime_studio_logs (
    studio_log_id           TEXT PRIMARY KEY,
    session_token           TEXT,
    vibe_key                VARCHAR(40),
    encrypted_payload       TEXT NOT NULL,
    iv_hex                  TEXT NOT NULL,
    auth_tag_hex            TEXT NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. AI 추론 관제 로그 (Thin Wrapper 역마진 방어용 원가·지연 추적)
CREATE TABLE IF NOT EXISTS public.glow_muse_ai_inference_logs (
    id                      BIGSERIAL PRIMARY KEY,
    session_token           TEXT,
    provider                VARCHAR(30),
    model                   VARCHAR(80),
    request_kind            VARCHAR(30),                -- SKIN_SCAN | PREMIUM_REPORT
    applied                 BOOLEAN NOT NULL DEFAULT FALSE,
    fallback_used           BOOLEAN NOT NULL DEFAULT FALSE,
    latency_ms              INTEGER NOT NULL DEFAULT 0,
    error_message           TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 인덱스: 조회·정산·관제 쿼리 성능 확보
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_rt_sessions_updated ON public.glow_muse_runtime_sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_rt_sessions_order ON public.glow_muse_runtime_sessions(last_order_id);
CREATE INDEX IF NOT EXISTS idx_rt_orders_session ON public.glow_muse_runtime_orders(session_token);
CREATE INDEX IF NOT EXISTS idx_rt_orders_status ON public.glow_muse_runtime_orders(status);
CREATE INDEX IF NOT EXISTS idx_rt_payments_paid_at ON public.glow_muse_runtime_payments(paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_rt_scans_session ON public.glow_muse_runtime_skin_scans(session_token, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rt_ai_logs_created ON public.glow_muse_ai_inference_logs(created_at DESC);

-- ----------------------------------------------------------------------------
-- 보안 주의사항 (운영 전 필독)
-- ----------------------------------------------------------------------------
-- 1. 본 애플리케이션은 **서버 전용 Service Role Key** 로만 접속합니다.
--    (브라우저·미니앱 클라이언트에 절대 노출 금지)
-- 2. 운영 환경에서는 아래 RLS 정책으로 Service Role 이외의 접근을 차단하세요.
--
--    ALTER TABLE public.glow_muse_runtime_sessions ENABLE ROW LEVEL SECURITY;
--    ALTER TABLE public.glow_muse_runtime_orders ENABLE ROW LEVEL SECURITY;
--    ALTER TABLE public.glow_muse_runtime_payments ENABLE ROW LEVEL SECURITY;
--    ALTER TABLE public.glow_muse_runtime_skin_scans ENABLE ROW LEVEL SECURITY;
--    ALTER TABLE public.glow_muse_runtime_studio_logs ENABLE ROW LEVEL SECURITY;
--    ALTER TABLE public.glow_muse_ai_inference_logs ENABLE ROW LEVEL SECURITY;
--
--    (RLS를 활성화하면 anon/authenticated 롤은 정책이 없어 기본 차단되며,
--     service_role 은 RLS를 우회하므로 백엔드는 그대로 동작합니다.)
-- ============================================================================
