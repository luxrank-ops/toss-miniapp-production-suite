-- ============================================================================
-- 파일명: 009_create_ai_response_cache.sql
-- 역할: [AI 응답 캐싱] 동일 입력 재요청 시 LLM/Vision 호출 비용 절감
-- ----------------------------------------------------------------------------
-- 설계 원칙:
--   1) 캐시 키 = SHA-256(프롬프트 버전 + provider/model + temperature/maxTokens
--      + 시스템/사용자 프롬프트 해시 + 이미지 바이트 해시)
--      → 모델·프롬프트 변경 시 자동 미스 (stale 응답 재사용 방지)
--   2) 원본 이미지·프롬프트는 저장하지 않습니다. 이미지 해시와 응답 JSON 만 저장.
--   3) 응답 본문은 개인화 정보를 포함하므로 AES-256-GCM 암호화 페이로드로만 저장.
--   4) expires_at 기반 TTL. 만료 행은 조회 시 논리 삭제되고, 운영 배치로 정리 가능.
--
-- 적용 순서: 008 이후 Supabase SQL Editor 에서 실행
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.glow_muse_ai_response_cache (
    cache_key           CHAR(64) PRIMARY KEY,          -- SHA-256 hex
    request_kind        VARCHAR(30) NOT NULL,          -- SKIN_SCAN | PREMIUM_REPORT
    provider            VARCHAR(30),
    model               VARCHAR(80),
    image_hash          CHAR(64),                      -- 원본 이미지 바이트 SHA-256 (원본 미저장)
    expires_at          TIMESTAMPTZ NOT NULL,
    hit_count           INTEGER NOT NULL DEFAULT 0,
    last_hit_at         TIMESTAMPTZ,
    encrypted_payload   TEXT NOT NULL,                 -- AI 응답 JSON AES-256-GCM
    iv_hex              TEXT NOT NULL,
    auth_tag_hex        TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_cache_expires
    ON public.glow_muse_ai_response_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_ai_cache_kind
    ON public.glow_muse_ai_response_cache(request_kind, expires_at);

-- 만료 캐시 정리 예시 (운영 스케줄러에서 주기 실행 권장)
-- DELETE FROM public.glow_muse_ai_response_cache WHERE expires_at < NOW();

-- 운영 보안: RLS 활성화 (service_role 만 접근)
-- ALTER TABLE public.glow_muse_ai_response_cache ENABLE ROW LEVEL SECURITY;
-- ============================================================================
