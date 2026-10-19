/**
 * ============================================================================
 * 파일명: src/components/SkinScannerView.tsx
 * 역할: [MuseGlow AI - 한국 여성 트렌드 진단 & AI 포토 스튜디오]
 *       실시간 셀카 촬영, 사진 업로드, 3종 1초 샘플 프리셋을 통해
 *       피부 장벽 손상도(TEWL), 모공 밀도, 붉은기 등 5대 정밀 지표를 스캔하고
 *       오늘 밤 긴급 SOS 루틴과 스마트 쇼핑 리스트 1-클릭 담기를 제공하는 핵심 뷰입니다.
 * ============================================================================
 */

import React, { useState, useRef, useEffect } from 'react';
import { SkinScanResult } from '../types';
import {
  Camera,
  Upload,
  Sparkles,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  ShoppingCart,
  ChevronRight,
  Info,
  Maximize2,
  Zap,
} from 'lucide-react';
import { BarrierRecoveryDashboard } from './BarrierRecoveryDashboard';

interface SkinScannerViewProps {
  onGoToShoppingList?: () => void;
}

export const SkinScannerView: React.FC<SkinScannerViewProps> = ({ onGoToShoppingList }) => {
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanStepText, setScanStepText] = useState<string>('피부 장벽 표피층 분석 중...');
  const [scanResult, setScanResult] = useState<SkinScanResult | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 컴포넌트 언마운트 시 카메라 스트림 안전 종료
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // 1초 빠른 측정을 위한 3종 샘플 프리셋
  const samplePresets = [
    {
      id: 'dry_barrier',
      label: '속건조 U존 장벽 손상형',
      tag: '수부지 20대',
      image:
        'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=600&q=80',
    },
    {
      id: 'pore_oil',
      label: 'T존 모공·피지 과다형',
      tag: '모공집중 20대',
      image:
        'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80',
    },
    {
      id: 'sensitive_red',
      label: '홍조·극민감 붉은기형',
      tag: '진정SOS 30대',
      image:
        'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=600&q=80',
    },
  ];

  // 실시간 셀카 카메라 시작
  const handleStartCamera = async () => {
    setCameraError(null);
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 640 } },
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
        setIsCameraActive(true);
        setImagePreview(null);
      } else {
        setCameraError('이 브라우저에서는 카메라 접근이 지원되지 않습니다. 사진 업로드를 이용해 주세요.');
      }
    } catch (err: any) {
      console.warn('Camera error:', err);
      setCameraError('카메라 접근 권한이 필요합니다. 사진 파일 업로드를 이용해 주세요.');
    }
  };

  // 웹캠 화면 캡처 후 즉시 분석 실행
  const handleCapturePhoto = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 640;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      setImagePreview(dataUrl);

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      setIsCameraActive(false);

      runAnalysis(dataUrl);
    }
  };

  // 사진 앨범 파일 업로드 핸들러
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        setImagePreview(dataUrl);
        setIsCameraActive(false);
        runAnalysis(dataUrl);
      };
      reader.readAsDataURL(file);
    }
  };

  // 빠른 샘플 프리셋 선택 핸들러
  const handleSelectPreset = (url: string) => {
    setImagePreview(url);
    setIsCameraActive(false);
    runAnalysis(url);
  };

  // 백엔드 /api/skin/scan 연동 AI 진피·장벽 스캔 실행
  const runAnalysis = async (imgBase64: string) => {
    setIsScanning(true);
    setScanResult(null);

    const steps = [
      'U존 & T존 유수분 밸런스 감지 중...',
      '각질 세포간 지질 손상도(TEWL) 측정 중...',
      '나비존 모공 탄력 및 진피층 붉은기 스캔 중...',
      '청담 피부 장벽 맞춤 솔루션 도출 완료!',
    ];

    let stepIdx = 0;
    const interval = setInterval(() => {
      stepIdx++;
      if (stepIdx < steps.length) {
        setScanStepText(steps[stepIdx]);
      }
    }, 700);

    try {
      const res = await fetch('/api/skin/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: imgBase64,
          userAge: 27,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setTimeout(() => {
          setScanResult(data);
          setIsScanning(false);
          clearInterval(interval);
        }, 2200);
      }
    } catch (err) {
      console.error('Scan error:', err);
      setIsScanning(false);
      clearInterval(interval);
    }
  };

  // 추천 성분을 로컬 스토리지 스마트 쇼핑 리스트(museglow_smart_shopping_list)에 추가
  const handleAddItemsToShoppingList = () => {
    if (!scanResult) return;
    const existing = localStorage.getItem('museglow_smart_shopping_list');
    let list: any[] = [];
    if (existing) {
      try {
        list = JSON.parse(existing);
      } catch {}
    }

    scanResult.recommendedIngredients.forEach((ing) => {
      list.unshift({
        id: `scan-${Date.now()}-${ing.name}`,
        name: `${ing.name} (피부 스캔 긴급 처방)`,
        searchKeyword: ing.name,
        category: 'BARRIER_REPAIR',
        tag: '장벽 긴급 SOS',
        estimatedPriceWon: 29000,
        effect: ing.reason,
        checked: false,
        oliveYoungUrl: `https://www.oliveyoung.co.kr/store/search/getSearchMain.do?query=${encodeURIComponent(ing.name)}`,
        naverShoppingUrl: `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(ing.name)}`,
        coupangUrl: `https://www.coupang.com/np/search?q=${encodeURIComponent(ing.name)}`,
      });
    });

    localStorage.setItem('museglow_smart_shopping_list', JSON.stringify(list));
    alert('스캔으로 추천된 성분이 스마트 쇼핑 리스트에 추가되었습니다!');
    if (onGoToShoppingList) onGoToShoppingList();
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="rounded-2xl bg-gradient-to-br from-slate-900 via-rose-950 to-slate-900 p-5 text-white sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-rose-500 text-white">
                <Sparkles className="h-3 w-3" />
              </span>
              <span className="text-xs font-bold text-rose-300">
                AI 피부 건강 & 장벽 정밀 스캐너
              </span>
            </div>
            <h2 className="mt-1 text-xl font-extrabold tracking-tight sm:text-2xl">
              셀카 1장으로 측정하는 피부 장벽 손상도 & 속건조 지수
            </h2>
            <p className="mt-1 text-xs text-slate-300">
              U존 수분 손실율(TEWL), 모공 밀도, 붉은기를 정밀 스캔하여 오늘 밤 긴급 처방을 제시합니다.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="rounded-xl bg-white/10 px-3 py-1.5 font-mono text-xs font-bold text-rose-200">
              2026 청담 메디컬 비전 AI
            </span>
          </div>
        </div>
      </div>

      {/* Main Scanner Workspace */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: Camera & Photo Viewer (7 Cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            {/* Viewport Header */}
            <div className="flex items-center justify-between border-b border-slate-100 p-4 dark:border-slate-800">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200">
                <Camera className="h-4 w-4 text-rose-500" />
                <span>AI 피부 측정 뷰포트</span>
              </div>
              <span className="text-[10px] text-slate-400">
                정면 얼굴이 잘 보이도록 촬영해 주세요
              </span>
            </div>

            {/* Video / Image Display Area with Scan HUD */}
            <div className="relative aspect-square w-full bg-slate-950 flex items-center justify-center overflow-hidden">
              {isCameraActive && (
                <video
                  ref={videoRef}
                  playsInline
                  autoPlay
                  muted
                  className="h-full w-full object-cover"
                />
              )}

              {!isCameraActive && imagePreview && (
                <img
                  src={imagePreview}
                  alt="피부 스캔 대상"
                  className="h-full w-full object-cover"
                />
              )}

              {!isCameraActive && !imagePreview && (
                <div className="flex flex-col items-center justify-center p-6 text-center text-slate-400">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-900 text-rose-400 shadow-inner">
                    <Camera className="h-8 w-8" />
                  </div>
                  <p className="mt-3 text-xs font-semibold text-slate-300">
                    셀카를 촬영하거나 사진을 업로드해 주세요
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    메이크업 유무와 관계없이 피부 장벽 텍스처를 스캔합니다
                  </p>
                </div>
              )}

              {isScanning && (
                <div className="absolute inset-0 flex flex-col items-center justify-between bg-slate-950/60 p-6 text-white backdrop-blur-xs">
                  <div className="grid h-full w-full grid-cols-4 grid-rows-4 border border-rose-500/30">
                    {Array.from({ length: 16 }).map((_, i) => (
                      <div key={i} className="border border-rose-500/10" />
                    ))}
                  </div>

                  <div className="absolute left-0 right-0 top-0 h-1 bg-gradient-to-r from-transparent via-rose-500 to-transparent shadow-[0_0_15px_#f43f5e] animate-[bounce_2s_infinite]" />

                  <div className="absolute bottom-6 flex items-center gap-2 rounded-full bg-slate-900/90 px-4 py-2 text-xs font-bold shadow-xl border border-rose-500/40">
                    <RefreshCw className="h-4 w-4 animate-spin text-rose-400" />
                    <span>{scanStepText}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Camera / Upload Controls */}
            <div className="p-4 bg-slate-50 border-t border-slate-100 dark:bg-slate-800/40 dark:border-slate-800">
              {cameraError && (
                <div className="mb-3 rounded-lg bg-red-50 p-2 text-[11px] text-red-600 dark:bg-red-950/40 dark:text-red-300">
                  {cameraError}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {isCameraActive ? (
                  <button
                    onClick={handleCapturePhoto}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-rose-500 py-2.5 text-xs font-bold text-white shadow-md hover:bg-rose-600 active:scale-95"
                  >
                    <Camera className="h-4 w-4" />
                    <span>지금 찰칵 촬영하기</span>
                  </button>
                ) : (
                  <button
                    onClick={handleStartCamera}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-slate-900 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-slate-800 active:scale-95 dark:bg-white dark:text-slate-900"
                  >
                    <Camera className="h-4 w-4 text-rose-400" />
                    <span>실시간 셀카 촬영</span>
                  </button>
                )}

                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-700 shadow-xs hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  <Upload className="h-4 w-4 text-slate-500" />
                  <span>사진 앨범 업로드</span>
                </button>
                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </div>

              {/* Quick 1-Click Sample Presets */}
              <div className="mt-3.5">
                <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  또는 1초 빠른 샘플로 즉시 측정해보기:
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {samplePresets.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => handleSelectPreset(preset.image)}
                      className="flex flex-col rounded-xl border border-slate-200 bg-white p-2 text-left hover:border-rose-400 dark:border-slate-700 dark:bg-slate-800"
                    >
                      <span className="text-[10px] font-bold text-rose-500">
                        {preset.tag}
                      </span>
                      <span className="mt-0.5 text-[11px] font-bold text-slate-800 dark:text-slate-200 line-clamp-1">
                        {preset.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Skin Health Report & SOS Care Solution (5 Cols) */}
        <div className="lg:col-span-5 space-y-4">
          {scanResult ? (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
              <div className="rounded-2xl border border-rose-200/80 bg-white p-5 shadow-sm dark:border-rose-950/60 dark:bg-slate-900">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
                  <div>
                    <span className="text-[10px] font-bold text-rose-500">
                      AI 정밀 피부 장벽 판독서
                    </span>
                    <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                      {scanResult.skinType}
                    </h3>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-slate-400">피부 추정 나이</span>
                    <div className="font-mono text-lg font-black text-slate-900 dark:text-white">
                      만 {scanResult.skinAge}세
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
                  <div>
                    <span className="text-xs text-slate-500">장벽 건강 점수</span>
                    <div className="flex items-baseline gap-1 mt-0.5">
                      <span className="font-mono text-3xl font-black text-rose-600 dark:text-rose-400">
                        {scanResult.skinBarrierScore}
                      </span>
                      <span className="text-xs text-slate-400">/ 100점</span>
                    </div>
                  </div>

                  <div className="rounded-lg bg-amber-50 px-3 py-1.5 text-right dark:bg-amber-950/40">
                    <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                      진단 소견
                    </span>
                    <div className="text-xs font-bold text-amber-900 dark:text-amber-200">
                      {scanResult.barrierStatus}
                    </div>
                  </div>
                </div>

                <p className="mt-3 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                  {scanResult.aiAnalysisText}
                </p>

                <div className="mt-4 space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    5대 정밀 세부 지표
                  </div>
                  {scanResult.metrics.map((m, idx) => (
                    <div key={idx} className="space-y-1">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-slate-600 dark:text-slate-400">{m.label}</span>
                        <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                          {m.score}점 ({m.status})
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <div
                          className={`h-full rounded-full ${
                            m.color === 'emerald'
                              ? 'bg-emerald-500'
                              : m.color === 'amber'
                              ? 'bg-amber-500'
                              : m.color === 'rose'
                              ? 'bg-rose-500'
                              : 'bg-sky-500'
                          }`}
                          style={{ width: `${m.score}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-white">
                  <Zap className="h-4 w-4 text-amber-500" />
                  <span>오늘 밤 긴급 SOS 장벽 복구 솔루션</span>
                </div>

                <div className="mt-3 space-y-2 text-xs">
                  {scanResult.sosCareRoutine.map((routine, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-2 rounded-xl bg-slate-50 p-2.5 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300"
                    >
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                      <span className="text-[11px] leading-relaxed">{routine}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <div className="text-[11px] font-bold text-slate-800 dark:text-slate-200">
                    지금 꼭 필요한 처방 성분:
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {scanResult.recommendedIngredients.map((ing, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between rounded-lg bg-rose-50/60 px-2.5 py-1.5 text-[11px] text-rose-950 dark:bg-rose-950/40 dark:text-rose-200"
                      >
                        <span className="font-bold">{ing.name}</span>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400">
                          {ing.reason}
                        </span>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={handleAddItemsToShoppingList}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-rose-500 py-3 text-xs font-bold text-white shadow-md hover:bg-rose-600 active:scale-95"
                  >
                    <ShoppingCart className="h-3.5 w-3.5" />
                    <span>추천 성분을 내 쇼핑 리스트에 1-클릭 담기</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white">
                <Info className="h-4 w-4 text-rose-500" />
                <span>AI 피부 장벽 스캐너 측정 안내</span>
              </div>
              <div className="mt-3 space-y-2.5 text-xs text-slate-600 dark:text-slate-400">
                <div className="flex items-start gap-2">
                  <span className="font-bold text-rose-500">1.</span>
                  <span>
                    조명이 너무 어둡거나 강한 역광을 피해 얼굴 정면을 비춰주세요.
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="font-bold text-rose-500">2.</span>
                  <span>
                    안경이나 마스크를 벗고 측정하시면 U존과 모공의 정확도가 높아집니다.
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="font-bold text-rose-500">3.</span>
                  <span>
                    측정 결과는 피부과 전문의 임상 기준(TEWL 지표 및 모공 밀도)에 따라 자동 분석됩니다.
                  </span>
                </div>
              </div>

              <div className="mt-5 rounded-xl bg-rose-50/70 p-3.5 text-xs dark:bg-rose-950/40">
                <div className="font-bold text-rose-800 dark:text-rose-300">
                  💡 개인정보 안심 보장
                </div>
                <p className="mt-1 text-[11px] text-rose-700/90 dark:text-rose-300/80">
                  업로드하거나 촬영한 얼굴 사진은 피부 장벽 스캔 직후 분석에만 사용되며, 서버에 영구 저장되지 않고 즉시 휘발 처리됩니다.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 4-Week Skin Barrier Recovery Forecast Dashboard */}
      <BarrierRecoveryDashboard
        currentBarrierScore={scanResult ? scanResult.skinBarrierScore : 74}
        onGoToShoppingList={onGoToShoppingList}
      />
    </div>
  );
};
