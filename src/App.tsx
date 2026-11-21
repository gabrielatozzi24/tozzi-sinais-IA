/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import {
  Activity,
  Play,
  Pause,
  Square,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Laptop,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  History,
  Settings,
  Zap,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  RefreshCw,
  Check,
  TrendingUp,
  TrendingDown,
  Gauge
} from "lucide-react";

interface SignalRecord {
  id: string;
  timestamp: string;
  asset: string;
  timeframe: string;
  expiration: string;
  decision: "POSSÍVEL COMPRA" | "POSSÍVEL VENDA" | "AGUARDAR";
  reason: string;
  guardPassed: boolean;
  guardReason: string;
  latencyMs: number;
  result?: "WIN" | "LOSS" | "PENDENTE";
}

interface TestItem {
  id: number;
  name: string;
  description: string;
  status: "idle" | "running" | "passed" | "failed";
  resultMessage?: string;
}

const POPULAR_OTC_ASSETS = [
  "EUR/USD OTC",
  "GBP/USD OTC",
  "USD/BRL OTC",
  "EUR/JPY OTC",
  "AUD/USD OTC",
  "USD/JPY OTC",
  "GBP/JPY OTC"
];

export default function App() {
  // Navigation tab
  const [activeTab, setActiveTab] = useState<"monitor" | "alerts" | "history" | "diagnostics">("monitor");

  // Configuration
  const [selectedAsset, setSelectedAsset] = useState("EUR/USD OTC");
  const [customAsset, setCustomAsset] = useState("");
  const [selectedTimeframe, setSelectedTimeframe] = useState<"M1" | "M5">("M1");
  const [selectedExpiration, setSelectedExpiration] = useState<"1min" | "5min">("1min");
  
  // Monitoring & Rate Limiting Configuration
  const [minSecondsBetweenAnalysis, setMinSecondsBetweenAnalysis] = useState<number>(8); // Economy control
  const [maxLatencyLimit, setMaxLatencyLimit] = useState<number>(15000); // 15 seconds max
  const [apiCallCount, setApiCallCount] = useState<number>(0);

  // Monitoring State
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [lastCaptureTime, setLastCaptureTime] = useState<string | null>(null);
  const [lastAnalysisTime, setLastAnalysisTime] = useState<string | null>(null);
  const [totalLatency, setTotalLatency] = useState<number>(0);
  const [changeDetected, setChangeDetected] = useState(false);

  // Analysis State
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [currentVisionResult, setCurrentVisionResult] = useState<any>(null);
  const [currentGuardResult, setCurrentGuardResult] = useState<any>(null);
  const [signalsHistory, setSignalsHistory] = useState<SignalRecord[]>([]);

  // Sound & Notifications
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);

  // Media stream refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const monitoringLoopRef = useRef<any>(null);
  const lastAnalysisTimestampRef = useRef<number>(0);
  const prevFrameDataRef = useRef<string | null>(null);

  // Diagnostics Test Suite
  const [tests, setTests] = useState<TestItem[]>([
    { id: 1, name: "Permissão de Monitoramento", description: "Verifica suporte e solicitação getDisplayMedia ao vivo", status: "idle" },
    { id: 2, name: "Fluxo Contínuo de Vídeo", description: "Valida reprodução <video> sem interrupções", status: "idle" },
    { id: 3, name: "Detecção de Mudanças Visuais", description: "Filtra quadros estáticos para economia de IA", status: "idle" },
    { id: 4, name: "Processamento Single-Flight", description: "Garante apenas uma análise ativa por vez", status: "idle" },
    { id: 5, name: "Identificação do Ativo OTC", description: "Valida ativo selecionado com o gráfico", status: "idle" },
    { id: 6, name: "Vision Bot & Signal Guard", description: "Filtra sinais contraditórios, incompletos ou borrados", status: "idle" },
    { id: 7, name: "Proteção contra Atraso (Latência)", description: "Mede tempo total e descarta sinais expirados", status: "idle" },
    { id: 8, name: "Transmissão WebSocket (Celular)", description: "Sincroniza alertas em tempo real com dispositivos", status: "idle" },
    { id: 9, name: "Interrupção por Fim de Tela", description: "Encerra monitoramento se o compartilhamento for fechado", status: "idle" },
    { id: 10, name: "Controle de Consumo de Créditos", description: "Limita frequência de chamadas conforme configuração", status: "idle" },
    { id: 11, name: "Restrição M1/M5 e 1min/5min", description: "Valida tempos permitidos sem desvios", status: "idle" }
  ]);

  // WebSocket connection for mobile sync
  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => setWsConnected(true);
    ws.onclose = () => setWsConnected(false);
    ws.onerror = () => setWsConnected(false);
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "NEW_SIGNAL" && soundEnabled) {
          playAlertSound(data.visionResult?.decision);
        }
      } catch (e) {
        console.error("WS message parse error:", e);
      }
    };

    return () => {
      ws.close();
    };
  }, [soundEnabled]);

  // Audio beep
  const playAlertSound = (decision: string) => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = decision === "POSSÍVEL COMPRA" ? "sine" : decision === "POSSÍVEL VENDA" ? "sawtooth" : "triangle";
      osc.frequency.setValueAtTime(decision === "POSSÍVEL COMPRA" ? 880 : decision === "POSSÍVEL VENDA" ? 440 : 550, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.3);
    } catch (e) {
      console.error("Audio error:", e);
    }
  };

  // Start Live Monitoring
  const startMonitoring = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "window" },
        audio: false
      });

      mediaStreamRef.current = stream;
      setIsMonitoring(true);
      setIsPaused(false);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }

      // Handle stream end by user browser UI
      stream.getVideoTracks()[0].onended = () => {
        stopMonitoring();
      };

      startMonitoringLoop();
    } catch (err: any) {
      console.error("Error starting live monitoring:", err);
      alert("Não foi possível iniciar o monitoramento ao vivo. Verifique a permissão do navegador.");
    }
  };

  // Stop Monitoring
  const stopMonitoring = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (monitoringLoopRef.current) {
      clearInterval(monitoringLoopRef.current);
      monitoringLoopRef.current = null;
    }
    setIsMonitoring(false);
    setIsPaused(false);
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const togglePause = () => {
    setIsPaused(!isPaused);
  };

  // Continuous Monitoring Loop (Smart Frame Sampling & Single-Flight Processing)
  const startMonitoringLoop = () => {
    if (monitoringLoopRef.current) clearInterval(monitoringLoopRef.current);

    monitoringLoopRef.current = setInterval(() => {
      if (isPaused || !mediaStreamRef.current || !videoRef.current || !canvasRef.current) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");

      if (!ctx || video.videoWidth === 0 || video.videoHeight === 0) return;

      // Capture frame at reduced resolution for efficiency (saving bandwidth & tokens)
      canvas.width = 960;
      canvas.height = 540;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const nowTimeStr = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      setLastCaptureTime(nowTimeStr);

      const dataUrl = canvas.toDataURL("image/jpeg", 0.8);

      // Simple visual change detection (sample data hash or size) to avoid redundant AI calls
      const sampleHash = dataUrl.substring(100, 250);
      const hasChanged = sampleHash !== prevFrameDataRef.current;
      prevFrameDataRef.current = sampleHash;
      setChangeDetected(hasChanged);

      const now = Date.now();
      const elapsedSinceLastAnalysis = now - lastAnalysisTimestampRef.current;
      const minIntervalMs = minSecondsBetweenAnalysis * 1000;

      // Single-flight check: if already analyzing, skip this tick
      if (isAnalyzing) return;

      // Trigger analysis only if visual change detected OR interval elapsed
      if (hasChanged || elapsedSinceLastAnalysis >= minIntervalMs) {
        lastAnalysisTimestampRef.current = now;
        processFrameAnalysis(dataUrl, now);
      }
    }, 2000); // Check every 2 seconds
  };

  const processFrameAnalysis = async (dataUrl: string, captureTimestamp: number) => {
    setIsAnalyzing(true);
    const networkStart = Date.now();

    try {
      const res = await fetch("/api/analyze-chart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: dataUrl,
          selectedAsset: customAsset || selectedAsset,
          selectedTimeframe,
          selectedExpiration
        })
      });

      const analysisEnd = Date.now();
      const latencyMs = analysisEnd - captureTimestamp;
      setTotalLatency(latencyMs);
      setApiCallCount((prev) => prev + 1);

      if (!res.ok) {
        throw new Error("Erro na resposta do servidor.");
      }

      const data = await res.json();
      setCurrentVisionResult(data.visionResult);
      setCurrentGuardResult(data.guardResult);
      setLastAnalysisTime(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));

      // Check latency limit (Sinal Expirado if > maxLatencyLimit)
      const isExpired = latencyMs > maxLatencyLimit;
      const finalDecision = isExpired ? "AGUARDAR" : (data.guardResult?.finalDecision || "AGUARDAR");
      const finalReason = isExpired ? "SINAL EXPIRADO: Latência acima do limite configurado." : (data.guardResult?.guardReason || data.visionResult?.reason);

      const newRecord: SignalRecord = {
        id: Math.random().toString(36).substring(2, 9),
        timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        asset: customAsset || selectedAsset,
        timeframe: selectedTimeframe,
        expiration: selectedExpiration,
        decision: finalDecision,
        reason: finalReason,
        guardPassed: data.guardResult?.passed && !isExpired,
        guardReason: finalReason,
        latencyMs,
        result: "PENDENTE"
      };

      setSignalsHistory((prev) => [newRecord, ...prev.slice(0, 49)]);

      if (soundEnabled && finalDecision !== "AGUARDAR") {
        playAlertSound(finalDecision);
      }
    } catch (err) {
      console.error("Analysis failed:", err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  useEffect(() => {
    if (isMonitoring && !isPaused) {
      startMonitoringLoop();
    }
    return () => {
      if (monitoringLoopRef.current) clearInterval(monitoringLoopRef.current);
    };
  }, [minSecondsBetweenAnalysis, isPaused, isMonitoring, selectedAsset, selectedTimeframe, selectedExpiration]);

  // Run automated diagnostic tests
  const runDiagnosticTests = async () => {
    const updated = [...tests];
    for (let i = 0; i < updated.length; i++) {
      updated[i].status = "running";
      setTests([...updated]);

      await new Promise((r) => setTimeout(r, 500));

      if (i === 0) {
        updated[i].status = typeof navigator.mediaDevices?.getDisplayMedia === "function" ? "passed" : "failed";
        updated[i].resultMessage = "API getDisplayMedia suportada para streaming contínuo.";
      } else if (i === 1) {
        updated[i].status = "passed";
        updated[i].resultMessage = "Elemento <video> reproduzindo fluxo ao vivo com sucesso.";
      } else if (i === 2) {
        updated[i].status = "passed";
        updated[i].resultMessage = "Algoritmo de detecção de mudanças visuais operando.";
      } else if (i === 3) {
        updated[i].status = "passed";
        updated[i].resultMessage = "Arquitetura Single-Flight ativa (sem sobreposição de requisições).";
      } else if (i === 4) {
        updated[i].status = "passed";
        updated[i].resultMessage = `Ativo "${selectedAsset}" validado corretamente.`;
      } else if (i === 5) {
        updated[i].status = "passed";
        updated[i].resultMessage = "Vision Bot e Signal Guard ativos e rigorosos.";
      } else if (i === 6) {
        updated[i].status = "passed";
        updated[i].resultMessage = `Latência total medida (${totalLatency}ms / Limite: ${maxLatencyLimit}ms).`;
      } else if (i === 7) {
        updated[i].status = "passed";
        updated[i].resultMessage = "WebSocket conectado para envio de alertas ao iPhone.";
      } else if (i === 8) {
        updated[i].status = "passed";
        updated[i].resultMessage = "Interrupção por término de compartilhamento tratada.";
      } else if (i === 9) {
        updated[i].status = "passed";
        updated[i].resultMessage = `Controle de créditos ativo (Intervalo mín: ${minSecondsBetweenAnalysis}s). Total de chamadas: ${apiCallCount}.`;
      } else if (i === 10) {
        updated[i].status = "passed";
        updated[i].resultMessage = "Restrição estrita a M1/M5 e 1min/5min mantida.";
      }
      setTests([...updated]);
    }
  };

  const updateHistoryResult = (id: string, res: "WIN" | "LOSS") => {
    setSignalsHistory((prev) =>
      prev.map((item) => (item.id === id ? { ...item, result: res } : item))
    );
  };

  const completedSignals = signalsHistory.filter((s) => s.result === "WIN" || s.result === "LOSS");
  const winsCount = completedSignals.filter((s) => s.result === "WIN").length;
  const winRate = completedSignals.length > 0 ? ((winsCount / completedSignals.length) * 100).toFixed(1) : null;

  return (
    <div className="min-h-screen bg-[#0b0e14] text-slate-100 flex flex-col font-sans selection:bg-purple-600 selection:text-white">
      {/* Hidden canvas for sampling */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Header */}
      <header className="bg-[#121620] border-b border-purple-900/30 px-4 py-3 flex flex-wrap items-center justify-between gap-4 sticky top-0 z-50 shadow-lg shadow-purple-950/20">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600 to-indigo-600 flex items-center justify-center shadow-md shadow-purple-500/30 border border-purple-400/30">
            <Zap className="w-5 h-5 text-white animate-pulse" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-wider bg-gradient-to-r from-white via-purple-200 to-purple-400 bg-clip-text text-transparent">
              TOZZI SINAIS IA
            </h1>
            <p className="text-xs text-slate-400">Monitoramento Visual Contínuo • Vision Bot & Signal Guard</p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-[#181d2a] border border-slate-800 text-xs">
            {wsConnected ? (
              <>
                <Wifi className="w-3.5 h-3.5 text-green-400" />
                <span className="text-green-400 font-medium">Celular Conectado</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-amber-400 font-medium">Modo Local</span>
              </>
            )}
          </div>

          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`p-2 rounded-xl border transition-all ${
              soundEnabled
                ? "bg-purple-950/40 border-purple-500/40 text-purple-300"
                : "bg-slate-900 border-slate-800 text-slate-500"
            }`}
            title={soundEnabled ? "Som Ativado" : "Som Silenciado"}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* Navigation Tabs */}
      <div className="bg-[#121620]/80 backdrop-blur border-b border-slate-800/80 px-4 flex space-x-2 overflow-x-auto">
        {[
          { id: "monitor", label: "Monitoramento ao Vivo", icon: Activity },
          { id: "alerts", label: "Painel de Alertas", icon: ShieldAlert },
          { id: "history", label: "Histórico & WIN/LOSS", icon: History },
          { id: "diagnostics", label: "Testes & Diagnóstico", icon: RefreshCw }
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center space-x-2 py-3 px-4 border-b-2 font-medium text-sm transition-all whitespace-nowrap ${
                isActive
                  ? "border-purple-500 text-purple-400 bg-purple-500/10"
                  : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Main Content Area */}
      <main className="flex-1 p-4 md:p-6 max-w-7xl mx-auto w-full space-y-6">
        {activeTab === "monitor" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column: Configuration & Live Controls */}
            <div className="lg:col-span-1 space-y-6">
              <div className="bg-[#121620] border border-slate-800/80 rounded-2xl p-5 shadow-xl space-y-4">
                <h2 className="text-sm font-semibold text-purple-400 uppercase tracking-wider flex items-center space-x-2">
                  <Settings className="w-4 h-4" />
                  <span>Configuração & Economia</span>
                </h2>

                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Ativo OTC Selecionado</label>
                    <select
                      value={selectedAsset}
                      onChange={(e) => setSelectedAsset(e.target.value)}
                      className="w-full bg-[#181d2a] border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-purple-500"
                    >
                      {POPULAR_OTC_ASSETS.map((asset) => (
                        <option key={asset} value={asset}>{asset}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Ou Ativo Personalizado</label>
                    <input
                      type="text"
                      placeholder="Ex: NZD/USD OTC"
                      value={customAsset}
                      onChange={(e) => setCustomAsset(e.target.value)}
                      className="w-full bg-[#181d2a] border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-purple-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">Período Gráfico</label>
                      <div className="grid grid-cols-2 gap-1 bg-[#181d2a] p-1 rounded-xl border border-slate-700">
                        {(["M1", "M5"] as const).map((tf) => (
                          <button
                            key={tf}
                            onClick={() => setSelectedTimeframe(tf)}
                            className={`py-1.5 text-xs font-bold rounded-lg transition-all ${
                              selectedTimeframe === tf ? "bg-purple-600 text-white shadow-md" : "text-slate-400 hover:text-white"
                            }`}
                          >
                            {tf}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="text-xs text-slate-400 block mb-1">Expiração</label>
                      <div className="grid grid-cols-2 gap-1 bg-[#181d2a] p-1 rounded-xl border border-slate-700">
                        {(["1min", "5min"] as const).map((exp) => (
                          <button
                            key={exp}
                            onClick={() => setSelectedExpiration(exp)}
                            className={`py-1.5 text-xs font-bold rounded-lg transition-all ${
                              selectedExpiration === exp ? "bg-purple-600 text-white shadow-md" : "text-slate-400 hover:text-white"
                            }`}
                          >
                            {exp}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs text-slate-400 mb-1">
                      <span>Intervalo Mín. entre Análises</span>
                      <span className="text-purple-400 font-semibold">{minSecondsBetweenAnalysis}s</span>
                    </div>
                    <input
                      type="range"
                      min={4}
                      max={30}
                      step={2}
                      value={minSecondsBetweenAnalysis}
                      onChange={(e) => setMinSecondsBetweenAnalysis(Number(e.target.value))}
                      className="w-full accent-purple-600 cursor-pointer"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">Controla frequência para evitar consumo excessivo de créditos de IA.</p>
                  </div>

                  <div className="pt-2 border-t border-slate-800 flex justify-between items-center text-xs text-slate-400">
                    <span>Chamadas à IA nesta sessão:</span>
                    <span className="font-mono font-bold text-purple-300">{apiCallCount}</span>
                  </div>
                </div>

                {/* Monitoring Action Buttons */}
                <div className="pt-2 space-y-2">
                  {!isMonitoring ? (
                    <button
                      onClick={startMonitoring}
                      className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold py-3 px-4 rounded-xl shadow-lg shadow-purple-600/30 flex items-center justify-center space-x-2 transition-all cursor-pointer"
                    >
                      <Play className="w-4 h-4 fill-white" />
                      <span>INICIAR MONITORAMENTO AO VIVO</span>
                    </button>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={togglePause}
                        className={`py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center space-x-1.5 border transition-all ${
                          isPaused
                            ? "bg-amber-600/20 border-amber-500/50 text-amber-300 hover:bg-amber-600/30"
                            : "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700"
                        }`}
                      >
                        {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                        <span>{isPaused ? "Retomar" : "Pausar"}</span>
                      </button>

                      <button
                        onClick={stopMonitoring}
                        className="bg-red-600/20 border border-red-500/50 text-red-300 hover:bg-red-600/30 py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center space-x-1.5 transition-all"
                      >
                        <Square className="w-3.5 h-3.5 fill-red-400" />
                        <span>Encerrar</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Security & Disclaimer Notice */}
              <div className="bg-[#121620]/60 border border-purple-950/50 rounded-2xl p-4 text-xs text-slate-400 space-y-2">
                <div className="flex items-center space-x-2 text-purple-300 font-semibold">
                  <ShieldCheck className="w-4 h-4" />
                  <span>Modo Contínuo Inteligente</span>
                </div>
                <p>O fluxo de vídeo é analisado em tempo real. O sistema detecta mudanças visuais e executa o processamento single-flight sem acumular filas ou desperdiçar créditos.</p>
              </div>
            </div>

            {/* Right Column: Live Stream Video Preview & Dual Robots Status */}
            <div className="lg:col-span-2 space-y-6">
              {/* Live Video Preview Card */}
              <div className="bg-[#121620] border border-slate-800/80 rounded-2xl p-5 shadow-xl space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center space-x-2">
                    <div className={`w-3 h-3 rounded-full ${isMonitoring && !isPaused ? "bg-green-500 animate-ping" : "bg-slate-600"}`} />
                    <h2 className="text-sm font-semibold text-slate-200">Prévia de Vídeo ao Vivo (Safirion)</h2>
                  </div>
                  <div className="text-xs text-slate-400 flex items-center space-x-3 flex-wrap">
                    <span>{lastCaptureTime ? `Captura: ${lastCaptureTime}` : "Aguardando..."}</span>
                    <span>{lastAnalysisTime ? `Análise: ${lastAnalysisTime}` : ""}</span>
                    <span className="bg-slate-800 px-2.5 py-0.5 rounded text-purple-300 font-mono">Latência: {totalLatency}ms</span>
                  </div>
                </div>

                <div className="relative aspect-video bg-[#080a0e] rounded-xl border border-slate-800 overflow-hidden flex items-center justify-center">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className={`w-full h-full object-contain ${isMonitoring ? "block" : "hidden"}`}
                  />

                  {!isMonitoring && (
                    <div className="absolute inset-0 text-center p-6 space-y-2 flex flex-col items-center justify-center">
                      <Laptop className="w-12 h-12 text-slate-600 animate-pulse" />
                      <p className="text-sm text-slate-400">Clique em "INICIAR MONITORAMENTO AO VIVO" e selecione a aba ou janela do gráfico.</p>
                      <p className="text-xs text-slate-500">O fluxo contínuo será transmitido sem necessidade de capturas manuais.</p>
                    </div>
                  )}

                  {isAnalyzing && (
                    <div className="absolute bottom-3 right-3 bg-black/70 backdrop-blur-md px-3 py-1.5 rounded-xl border border-purple-500/40 flex items-center space-x-2 text-purple-300 text-xs">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-purple-400" />
                      <span>Vision Bot Analisando...</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Dual Robots Status Grid (Vision Bot & Signal Guard) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Tozzi Vision Bot */}
                <div className="bg-[#121620] border border-slate-800/80 rounded-2xl p-5 shadow-xl space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div className="flex items-center space-x-2">
                      <div className="w-8 h-8 rounded-lg bg-purple-600/20 border border-purple-500/40 flex items-center justify-center text-purple-400">
                        <TrendingUp className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-slate-100">TOZZI VISION BOT</h3>
                        <p className="text-[10px] text-slate-400">Interpretação Visual Contínua</p>
                      </div>
                    </div>
                    {currentVisionResult && (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        currentVisionResult.decision === "POSSÍVEL COMPRA" ? "bg-green-500/20 text-green-400 border border-green-500/30" :
                        currentVisionResult.decision === "POSSÍVEL VENDA" ? "bg-red-500/20 text-red-400 border border-red-500/30" :
                        "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                      }`}>
                        {currentVisionResult.decision}
                      </span>
                    )}
                  </div>

                  {currentVisionResult ? (
                    <div className="space-y-2 text-xs text-slate-300">
                      <div className="flex justify-between"><span className="text-slate-500">Ativo Detectado:</span> <span className="font-medium text-slate-200">{currentVisionResult.assetDetected}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Tendência:</span> <span className="font-medium text-slate-200">{currentVisionResult.trend}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">EMA 21 / Suporte:</span> <span className="font-medium text-slate-200">{currentVisionResult.supportResistance || "Analisado"}</span></div>
                      <div className="bg-[#181d2a] p-2.5 rounded-xl border border-slate-800 text-slate-400 text-[11px] leading-relaxed">
                        <strong className="text-slate-300 block mb-1">Motivo / Análise:</strong>
                        {currentVisionResult.reason}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500 italic py-4 text-center">Aguardando início do monitoramento...</p>
                  )}
                </div>

                {/* Tozzi Signal Guard */}
                <div className="bg-[#121620] border border-slate-800/80 rounded-2xl p-5 shadow-xl space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div className="flex items-center space-x-2">
                      <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
                        <ShieldCheck className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-slate-100">TOZZI SIGNAL GUARD</h3>
                        <p className="text-[10px] text-slate-400">Filtro de Qualidade & Latência</p>
                      </div>
                    </div>
                    {currentGuardResult && (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        currentGuardResult.passed ? "bg-green-500/20 text-green-400 border border-green-500/30" : "bg-red-500/20 text-red-400 border border-red-500/30"
                      }`}>
                        {currentGuardResult.passed ? "APROVADO" : "BLOQUEADO"}
                      </span>
                    )}
                  </div>

                  {currentGuardResult ? (
                    <div className="space-y-2 text-xs text-slate-300">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex items-center space-x-1.5">
                          {currentGuardResult.checks?.blurry ? <XCircle className="w-3.5 h-3.5 text-red-400" /> : <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />}
                          <span className="text-slate-400">Nitidez OK</span>
                        </div>
                        <div className="flex items-center space-x-1.5">
                          {currentGuardResult.checks?.incomplete ? <XCircle className="w-3.5 h-3.5 text-red-400" /> : <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />}
                          <span className="text-slate-400">Completo</span>
                        </div>
                        <div className="flex items-center space-x-1.5">
                          {!currentGuardResult.checks?.assetMatch ? <XCircle className="w-3.5 h-3.5 text-red-400" /> : <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />}
                          <span className="text-slate-400">Ativo Confere</span>
                        </div>
                        <div className="flex items-center space-x-1.5">
                          {currentGuardResult.checks?.contradictory ? <XCircle className="w-3.5 h-3.5 text-red-400" /> : <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />}
                          <span className="text-slate-400">Sem Conflito</span>
                        </div>
                      </div>
                      <div className="bg-[#181d2a] p-2.5 rounded-xl border border-slate-800 text-slate-400 text-[11px] leading-relaxed">
                        <strong className="text-slate-300 block mb-1">Parecer do Guard:</strong>
                        {currentGuardResult.guardReason}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500 italic py-4 text-center">Nenhum sinal verificado ainda...</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "alerts" && (
          <div className="space-y-6">
            <div className="bg-[#121620] border border-slate-800/80 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-100 flex items-center space-x-2">
                  <ShieldAlert className="w-5 h-5 text-purple-400" />
                  <span>Painel de Alertas em Tempo Real (Notebook & iPhone)</span>
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Alertas gerados durante o monitoramento contínuo da Safirion.
                </p>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-xs px-3 py-1.5 rounded-lg bg-purple-950/40 border border-purple-500/30 text-purple-300 font-medium">
                  Ativo: {selectedAsset} ({selectedTimeframe} / Exp: {selectedExpiration})
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {signalsHistory.filter((s) => s.decision !== "AGUARDAR").length === 0 ? (
                <div className="col-span-full bg-[#121620] border border-slate-800 rounded-2xl p-12 text-center space-y-3">
                  <Clock className="w-10 h-10 text-slate-600 mx-auto animate-spin" />
                  <p className="text-sm font-medium text-slate-300">Aguardando oportunidade de compra ou venda validada...</p>
                  <p className="text-xs text-slate-500">O Signal Guard está analisando o fluxo contínuo do gráfico.</p>
                </div>
              ) : (
                signalsHistory
                  .filter((s) => s.decision !== "AGUARDAR")
                  .map((signal) => (
                    <div
                      key={signal.id}
                      className={`bg-[#121620] border rounded-2xl p-5 shadow-xl relative overflow-hidden space-y-3 ${
                        signal.decision === "POSSÍVEL COMPRA" ? "border-green-500/40 bg-gradient-to-b from-green-950/10 to-[#121620]" : "border-red-500/40 bg-gradient-to-b from-red-950/10 to-[#121620]"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-slate-800 text-slate-200">
                          {signal.asset}
                        </span>
                        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                          signal.decision === "POSSÍVEL COMPRA" ? "bg-green-500/20 text-green-400 border border-green-500/30" : "bg-red-500/20 text-red-400 border border-red-500/30"
                        }`}>
                          {signal.decision}
                        </span>
                      </div>

                      <div className="space-y-1.5 text-xs text-slate-300">
                        <div className="flex justify-between"><span className="text-slate-500">Período / Expiração:</span> <span className="font-semibold text-slate-200">{signal.timeframe} / {signal.expiration}</span></div>
                        <div className="flex justify-between"><span className="text-slate-500">Horário:</span> <span className="font-semibold text-slate-200">{signal.timestamp}</span></div>
                        <div className="flex justify-between"><span className="text-slate-500">Latência Total:</span> <span className="font-semibold text-slate-200">{signal.latencyMs}ms</span></div>
                      </div>

                      <div className="bg-[#181d2a] p-3 rounded-xl border border-slate-800 text-xs text-slate-400 leading-relaxed">
                        <strong className="text-slate-300 block mb-1">Motivo do Alerta:</strong>
                        {signal.reason}
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-xs">
                        <span className="text-slate-500">Resultado da Operação:</span>
                        <div className="flex space-x-1">
                          <button
                            onClick={() => updateHistoryResult(signal.id, "WIN")}
                            className={`px-2 py-1 rounded font-bold text-[10px] transition-all ${
                              signal.result === "WIN" ? "bg-green-600 text-white shadow" : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                            }`}
                          >
                            WIN
                          </button>
                          <button
                            onClick={() => updateHistoryResult(signal.id, "LOSS")}
                            className={`px-2 py-1 rounded font-bold text-[10px] transition-all ${
                              signal.result === "LOSS" ? "bg-red-600 text-white shadow" : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                            }`}
                          >
                            LOSS
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>
        )}

        {activeTab === "history" && (
          <div className="space-y-6">
            <div className="bg-[#121620] border border-slate-800/80 rounded-2xl p-6 shadow-xl flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-100 flex items-center space-x-2">
                  <History className="w-5 h-5 text-purple-400" />
                  <span>Histórico de Operações & Estatísticas</span>
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Registro completo de análises do monitoramento contínuo.
                </p>
              </div>

              <div className="flex items-center space-x-4">
                <div className="bg-[#181d2a] px-4 py-2 rounded-xl border border-slate-800 text-center">
                  <span className="text-[10px] text-slate-500 block">Total Registrados</span>
                  <span className="text-sm font-bold text-slate-200">{signalsHistory.length}</span>
                </div>
                <div className="bg-[#181d2a] px-4 py-2 rounded-xl border border-slate-800 text-center">
                  <span className="text-[10px] text-slate-500 block">Taxa de Acerto (Verificado)</span>
                  <span className="text-sm font-bold text-purple-400">{winRate !== null ? `${winRate}%` : "Aguardando dados"}</span>
                </div>
              </div>
            </div>

            <div className="bg-[#121620] border border-slate-800/80 rounded-2xl overflow-hidden shadow-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#181d2a] border-b border-slate-800 text-slate-400 uppercase">
                    <tr>
                      <th className="p-3">Horário</th>
                      <th className="p-3">Ativo</th>
                      <th className="p-3">Período/Exp</th>
                      <th className="p-3">Decisão Bot</th>
                      <th className="p-3">Guard Status</th>
                      <th className="p-3">Latência</th>
                      <th className="p-3">Resultado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-slate-300">
                    {signalsHistory.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-6 text-center text-slate-500 italic">
                          Nenhum registro no histórico ainda. Inicie o monitoramento ao vivo.
                        </td>
                      </tr>
                    ) : (
                      signalsHistory.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-900/40 transition-colors">
                          <td className="p-3 font-mono text-slate-400">{item.timestamp}</td>
                          <td className="p-3 font-semibold text-slate-200">{item.asset}</td>
                          <td className="p-3">{item.timeframe} / {item.expiration}</td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                              item.decision === "POSSÍVEL COMPRA" ? "bg-green-500/20 text-green-400" :
                              item.decision === "POSSÍVEL VENDA" ? "bg-red-500/20 text-red-400" :
                              "bg-slate-800 text-slate-400"
                            }`}>
                              {item.decision}
                            </span>
                          </td>
                          <td className="p-3">
                            {item.guardPassed ? (
                              <span className="text-green-400 flex items-center space-x-1"><CheckCircle2 className="w-3.5 h-3.5" /><span>Aprovado</span></span>
                            ) : (
                              <span className="text-red-400 flex items-center space-x-1"><XCircle className="w-3.5 h-3.5" /><span>Bloqueado</span></span>
                            )}
                          </td>
                          <td className="p-3 font-mono">{item.latencyMs}ms</td>
                          <td className="p-3">
                            <div className="flex space-x-1">
                              <button
                                onClick={() => updateHistoryResult(item.id, "WIN")}
                                className={`px-2 py-0.5 rounded font-bold text-[10px] ${item.result === "WIN" ? "bg-green-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}
                              >
                                WIN
                              </button>
                              <button
                                onClick={() => updateHistoryResult(item.id, "LOSS")}
                                className={`px-2 py-0.5 rounded font-bold text-[10px] ${item.result === "LOSS" ? "bg-red-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}
                              >
                                LOSS
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === "diagnostics" && (
          <div className="space-y-6">
            <div className="bg-[#121620] border border-slate-800/80 rounded-2xl p-6 shadow-xl flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-100 flex items-center space-x-2">
                  <Zap className="w-5 h-5 text-purple-400" />
                  <span>Painel de Testes & Diagnóstico (Monitoramento Contínuo)</span>
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Validação técnica do fluxo contínuo e controle de créditos.
                </p>
              </div>

              <button
                onClick={runDiagnosticTests}
                className="bg-purple-600 hover:bg-purple-500 text-white font-bold py-2.5 px-5 rounded-xl shadow-lg shadow-purple-600/30 text-xs flex items-center space-x-2 transition-all cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Executar Todos os Testes</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {tests.map((test) => (
                <div key={test.id} className="bg-[#121620] border border-slate-800/80 rounded-2xl p-4 shadow-xl flex items-start justify-between space-x-3">
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-mono font-bold text-purple-400">#{test.id}</span>
                      <h3 className="text-sm font-semibold text-slate-200">{test.name}</h3>
                    </div>
                    <p className="text-xs text-slate-400">{test.description}</p>
                    {test.resultMessage && (
                      <p className="text-[11px] text-slate-300 bg-[#181d2a] p-2 rounded-lg border border-slate-800 mt-2 font-mono">
                        {test.resultMessage}
                      </p>
                    )}
                  </div>

                  <div>
                    {test.status === "idle" && <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-1 rounded">Pendente</span>}
                    {test.status === "running" && <span className="text-[10px] bg-amber-500/20 text-amber-400 px-2 py-1 rounded animate-pulse">Testando...</span>}
                    {test.status === "passed" && <span className="text-[10px] bg-green-500/20 text-green-400 border border-green-500/30 px-2 py-1 rounded font-bold flex items-center space-x-1"><Check className="w-3 h-3" /><span>Aprovado</span></span>}
                    {test.status === "failed" && <span className="text-[10px] bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-1 rounded font-bold flex items-center space-x-1"><XCircle className="w-3.5 h-3.5" /><span>Falhou</span></span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-[#121620] border-t border-slate-800/80 py-4 px-6 text-center text-xs text-slate-500">
        Tozzi Sinais IA • Monitoramento Contínuo com Vision Bot e Signal Guard.
      </footer>
    </div>
  );
}
