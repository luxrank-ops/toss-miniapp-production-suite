# 🏛️ 토스 미니앱 프로덕션 팩토리 & MuseGlow AI v5.0

본 저장소는 **4대 전문 서브에이전트 합동 오케스트레이션 아키텍처**로 설계·구현된 토스 미니앱(App-in-Toss) 프로덕션 스위트입니다.

---

## 👑 4대 전문 서브에이전트 의사결정 계층 (`AGENTS.md`)

1. **🥇 1순위 (`app-business-evaluator` — Supreme Override)**
   - Freemium(전환율 2.1%) 기각 ➔ **전면 Hard Paywall(전환율 중앙값 10.7%)** 강제 적용
   - **21일 장기 무료 체험(전환율 42.5%) + 연간 VIP 패스(₩79,000, RLTV 6배 향상)** 메인 배치
   - **차등 크레딧 차감 매트릭스(Credit Deduction Matrix)** 및 독점 상극 성분 DB 해자(Moat)로 매출총이익률 82.5% 이상 방어
2. **🥈 2순위 (`top-tier-app-consultant` — 실전 그로스·CPA 컨설턴트)**
   - 4주 피부 장벽 회복 이원화 비교 곡선(SOS 적용 95점 회복 vs 방치 48점 붕괴) + 24시간 골든타임 타이머
   - 스마트 쇼핑함 최저가 절약 배지(올리브영·네이버쇼핑·쿠팡) & 청담 피부과 VIP 비공개 CPA 수익 파이프라인
   - 인스타 스토리·카톡 공유용 **'청담 시크릿 처방 영수증 모달(공유 시 +3🪙 크레딧)'** 바이럴 루프
3. **🥉 3순위 (`cross-store-design-differentiator` — 글로벌 양대 스토어 차별화 UI/UX)**
   - Google Play Material 3 Expressive 모핑 × Apple iOS 20 Spatial Liquid Glass & Bento Grid
   - **AI 추구미 포토 스튜디오 (Before/After 비교 슬라이더 & 4대 추구미 룩북 시뮬레이터)**
   - Holographic Shimmer VIP 카드 & 4주 인터랙티브 회복 게이지
4. **🏅 4순위 (`toss-top10-design-benchmarker` — 토스 인기 Top 10 마이크로 인터랙션)**
   - 상단 실시간 소셜 프루프 라이브 티커(3.5초 자동 롤링)
   - 슬롯머신 숫자 카운트업(`easeOutExpo`) & 3단계 햅틱 피드백(`navigator.vibrate`)

---

## 📂 수록된 미니앱 라인업

| 앱 폴더 | 서비스명 | 기본 포트 | 핵심 기능 |
| :--- | :--- | :---: | :--- |
| `./` (Root) | **제1호: AI 사주·타로 금전운 리포트** | `3000` | 사주·타로 금전운 스캔 & 토스페이 프리미엄 리포트 |
| `./app2-refund-radar` | **제2호: 환급레이더 AI** | `3001` | 숨은 병원비·건보료·통신비 환급금 스캔 & 1분 신청 치트키 |
| `./app3-wealth-vault` | **제3호: 프라이빗 자산 금고 마스터** | `3002` | 은행·증권·부동산·보험 통합 순자산 & 절세/연금 진단 |
| `./app4-glow-muse` | **제4호: MuseGlow AI v5.0 (추구미 & 피부 장벽 스캐너 & AI 포토 스튜디오)** | `3003` | 실시간 셀카 피부 장벽 스캐너(5대 지표) · 4주 회복 예측 대시보드 · AI 추구미 포토 스튜디오 · 스마트 쇼핑함 |

---

## 🚀 빠른 실행 방법 (MuseGlow AI v5.0)

```bash
# 1. 환경변수 설정 (.env.example 복사 후 값 입력)
cp app4-glow-muse/.env.example app4-glow-muse/.env

# 2. 통합 QA 감사 (100/100점 검증) 및 배포 번들 생성
node app4-glow-muse/scripts/toss-deploy-agent.js

# 3. 로컬 서버 실행 (http://localhost:3003)
node app4-glow-muse/backend/server.js
```

---

## 🔌 실제 AI API & 토스페이먼츠 실결제 연동 (제4호 MuseGlow AI)

`app4-glow-muse`는 **키가 없으면 로컬 목업 엔진으로, 키를 넣으면 즉시 실서비스로** 전환되는 이중 모드로 동작합니다.

| 영역 | 연동 전 (기본) | 연동 후 |
| :--- | :--- | :--- |
| AI 피부 스캔 | 결정론적 로컬 엔진 | **Gemini / OpenAI / Anthropic Vision** 실시간 분석 |
| 프리미엄 처방전 | 하드코딩 문구 | **실제 LLM 개인화 생성** (결제 전 백그라운드 사전 생성) |
| 결제 | 샌드박스 시뮬레이션 | **토스페이먼츠 실결제** (서버 최종 승인 / Server Confirm) |
| 데이터 | 인메모리(재시작 시 소실) | **Supabase 영속화** (세션·주문·매출 원장 DB 저장, §추가) |

```bash
cd app4-glow-muse
cp .env.example .env      # AI 키 + 토스페이먼츠 키 + Supabase 키 주입
npm run verify            # QA 감사(100/100) + 통합 스모크 테스트(94항목)
```

영속화는 `supabase/migrations/006_create_runtime_persistence_tables.sql` 실행 후
`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` 를 주입하면 활성화됩니다.
미설정·DB 장애 시에는 **자동으로 인메모리 모드로 폴백**하여 서비스가 중단되지 않습니다.

- 상세 설정 가이드: [`app4-glow-muse/docs/AI_PAYMENT_SETUP.md`](./app4-glow-muse/docs/AI_PAYMENT_SETUP.md)
- 연동 중 발견해 수정한 실제 취약점(금액 위변조·크레딧 이중 지급·타 세션 주문 도용 등)도 위 문서에 정리되어 있습니다.

---

## 🔒 보안 및 데이터베이스 원칙
- 모든 민감 정보(개인 프로필, 파우치 금고, 피부 스캔 메타데이터)는 **`AES-256-GCM`** 양방향 암호화 모듈로 암호화되어 저장됩니다.
- AI 피부 장벽 스캐너에 입력된 원본 얼굴 사진(`imageBase64`)은 서버 디스크나 DB에 저장되지 않으며 **분석 직후 메모리에서 즉시 파기**됩니다.
- 모든 Supabase SQL 마이그레이션 파일은 `supabase/migrations/` 폴더 내에 `001_` ~ `005_` 순서 번호 규칙을 엄격히 준수합니다.
