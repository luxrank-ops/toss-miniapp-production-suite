/**
 * ============================================================================
 * 파일명: src/types.ts
 * 역할: MuseGlow AI - 한국 여성 트렌드 진단 & AI 포토 스튜디오의 TypeScript 인터페이스 정의
 * 교육용 설명:
 *   - SkinScannerView 컴포넌트와 BarrierRecoveryDashboard, 스마트 쇼핑 리스트에서
 *     공통으로 사용하는 데이터 구조(Type)를 정의합니다.
 * ============================================================================
 */

export interface SkinMetricItem {
  label: string;
  score: number;
  status: string;
  color: 'emerald' | 'amber' | 'rose' | 'sky';
}

export interface RecommendedIngredient {
  name: string;
  reason: string;
}

export interface SkinScanResult {
  success: boolean;
  skinType: string;
  skinAge: number;
  skinBarrierScore: number;
  barrierStatus: string;
  aiAnalysisText: string;
  metrics: SkinMetricItem[];
  sosCareRoutine: string[];
  recommendedIngredients: RecommendedIngredient[];
  forecast4Weeks?: {
    week: string;
    expectedScore: number;
    milestone: string;
  }[];
}

export interface SmartShoppingItem {
  id: string;
  name: string;
  searchKeyword: string;
  category: string;
  tag: string;
  estimatedPriceWon: number;
  effect: string;
  checked: boolean;
  oliveYoungUrl: string;
  naverShoppingUrl: string;
  coupangUrl: string;
}
