/**
 * ============================================================================
 * 파일명: src/components/BarrierRecoveryDashboard.tsx
 * 역할: SkinScannerView 하단에 렌더링되는 '4주간 피부 장벽 회복 예측 대시보드' 컴포넌트입니다.
 * 교육용 설명:
 *   - 현재 측정된 피부 장벽 점수(currentBarrierScore)를 기준으로, 맞춤 처방 성분을
 *     꾸준히 사용했을 때 1주차~4주차 동안 장벽 점수가 어떻게 회복되는지 시각화합니다.
 * ============================================================================
 */

import React from 'react';
import { ShieldCheck, Sparkles, ShoppingCart, TrendingUp } from 'lucide-react';

interface BarrierRecoveryDashboardProps {
  currentBarrierScore: number;
  onGoToShoppingList?: () => void;
}

export const BarrierRecoveryDashboard: React.FC<BarrierRecoveryDashboardProps> = ({
  currentBarrierScore,
  onGoToShoppingList,
}) => {
  const baseScore = Math.max(40, Math.min(92, currentBarrierScore || 74));
  const week1 = Math.min(96, baseScore + 6);
  const week2 = Math.min(97, baseScore + 12);
  const week3 = Math.min(98, baseScore + 17);
  const week4 = Math.min(99, baseScore + 22);

  const forecastSteps = [
    {
      week: '현재 (Day 0)',
      score: baseScore,
      title: '장벽 미세 손상 & 수분 증발 구간',
      desc: '세안 후 속건조 및 각질 세포간 지질 약화 상태',
    },
    {
      week: 'Week 1 (7일 차)',
      score: week1,
      title: '급성 붉은기 진정 & 수분막 형성',
      desc: '판테놀·시카 집중 공급으로 표피 열감 -2.5°C 감소',
    },
    {
      week: 'Week 2 (14일 차)',
      score: week2,
      title: '세라마이드 3:1:1 지질 장벽 재건',
      desc: 'U존 수분 손실률(TEWL) 38% 방어 및 화장 들뜸 해소',
    },
    {
      week: 'Week 3 (21일 차)',
      score: week3,
      title: '나비존 모공 코르셋 & 속광 안착',
      desc: 'PDRN·펩타이드 시너지로 모공 세로 늘어짐 탄력 복원',
    },
    {
      week: 'Week 4 (28일 완주)',
      score: week4,
      title: '청담 올드머니 실크광 장벽 완성',
      desc: '피부 턴오버 28일 주기 완성 및 외부 자극 면역력 극대화',
    },
  ];

  return (
    <div className="rounded-2xl border border-rose-200/70 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-bold text-rose-500">
            <TrendingUp className="h-4 w-4" />
            <span>28일 피부 턴오버 시뮬레이션</span>
          </div>
          <h3 className="mt-1 text-base font-extrabold text-slate-900 dark:text-white">
            4주간 피부 장벽 회복 예측 대시보드 (현재 {baseScore}점 ➔ 4주 후 {week4}점)
          </h3>
        </div>
        {onGoToShoppingList && (
          <button
            onClick={onGoToShoppingList}
            className="flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-bold text-white hover:bg-slate-800 dark:bg-rose-500"
          >
            <ShoppingCart className="h-3.5 w-3.5" />
            <span>내 스마트 쇼핑 리스트 열기</span>
          </button>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-5">
        {forecastSteps.map((item, idx) => (
          <div
            key={idx}
            className="flex flex-col justify-between rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/50"
          >
            <div>
              <div className="flex items-center justify-between text-[11px] font-bold text-rose-500">
                <span>{item.week}</span>
                <ShieldCheck className="h-3.5 w-3.5" />
              </div>
              <div className="mt-1 font-mono text-2xl font-black text-slate-900 dark:text-white">
                {item.score}
                <span className="text-xs font-normal text-slate-400">점</span>
              </div>
              <div className="mt-1 text-xs font-bold text-slate-800 dark:text-slate-200">
                {item.title}
              </div>
              <p className="mt-1 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                {item.desc}
              </p>
            </div>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div
                className="h-full rounded-full bg-gradient-to-r from-rose-500 to-amber-500"
                style={{ width: `${item.score}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
