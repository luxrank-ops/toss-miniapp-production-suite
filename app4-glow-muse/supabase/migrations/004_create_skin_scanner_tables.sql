-- ============================================================================
-- 파일명: 004_create_skin_scanner_tables.sql
-- 설명: [MuseGlow AI - 한국 여성 트렌드 진단 & AI 포토 스튜디오]
--       AI 피부 건강 & 장벽 정밀 스캐너(SkinScannerView) 및 4주 장벽 회복 예측 대시보드,
--       스마트 쇼핑 리스트(올리브영·네이버쇼핑·쿠팡 연동) 저장용 데이터베이스 스키마입니다.
-- 보안 원칙 (규칙 8 준수):
--   - 촬영/업로드된 원본 얼굴 사진(imageBase64)은 분석 직후 메모리에서 즉시 휘발(삭제)되며,
--     DB에는 절대 원본 이미지를 저장하지 않고 오직 AES-256-GCM으로 암호화된 진단 메타데이터만 기록합니다.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.glow_muse_skin_scans (
    scan_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    preset_or_source VARCHAR(50) NOT NULL,              -- 'CAMERA_CAPTURE' | 'FILE_UPLOAD' | 'dry_barrier' | 'pore_oil' | 'sensitive_red'
    encrypted_scan_meta TEXT NOT NULL,                  -- AES-256-GCM 암호화된 스캔 메타데이터 (나이, 이미지 SHA-256 해시 등)
    encryption_iv VARCHAR(64) NOT NULL,                 -- 초기화 벡터 (IV)
    encryption_auth_tag VARCHAR(64) NOT NULL,           -- 무결성 검증 태그 (Auth Tag)
    skin_type VARCHAR(120) NOT NULL,                    -- 판독된 피부 장벽 타입
    skin_age INTEGER NOT NULL,                          -- 추정 피부 나이
    skin_barrier_score INTEGER NOT NULL,                -- 장벽 건강 점수 (0~100)
    barrier_status VARCHAR(120) NOT NULL,               -- 진단 소견 요약
    forecast_week4_score INTEGER NOT NULL,              -- 4주 후 예상 장벽 회복 점수
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_glow_skin_scans_created ON public.glow_muse_skin_scans(created_at DESC);
