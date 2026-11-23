/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { SignalRecord, SignalStatus, signalKey, upsertSignal, summarizeSignals, summarizeComparisons, isConfirmed, historyGroup, wasTaken, canRecordOutcome } from "../signalHistory.js";
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
  Gauge,
  Bell
} from "lucide-react";

interface TestItem {
  id: number;
  name: string;
  description: string;
  status: "idle" | "running" | "passed" | "failed";
  resultMessage?: string;
}

const OTC_ASSETS = [
  "EUR/USD OTC", "GBP/USD OTC", "USD/BRL OTC", "EUR/JPY OTC", "AUD/USD OTC",
  "USD/JPY OTC", "GBP/JPY OTC", "NZD/USD OTC", "EUR/GBP OTC", "EUR/AUD OTC",
  "EUR/CAD OTC", "GBP/CAD OTC", "GBP/AUD OTC", "AUD/JPY OTC", "CAD/JPY OTC",
  "USD/CAD OTC", "USD/CHF OTC", "EUR/CHF OTC", "AUD/CAD OTC", "NZD/JPY OTC"
];
const REGULAR_ASSETS = [
  "EUR/USD", "GBP/USD", "USD/JPY", "EUR/JPY", "AUD/USD", "NZD/USD", "USD/CAD",
  "USD/CHF", "EUR/GBP", "EUR/AUD", "EUR/CAD", "GBP/JPY", "GBP/AUD",
  "AUD/JPY", "EUR/CHF", "GBP/CHF", "CAD/JPY", "AUD/CAD"
];

export default function App() {
  // Navigation tab
  const [activeTab, setActiveTab] = useState<"monitor" | "alerts" | "history" | "diagnostics">("monitor");

  // Configuration
  const [selectedAsset, setSelectedAsset] = useState("EUR/USD OTC");
  const [marketType, setMarketType] = useState<"OTC" | "REGULAR">("OTC");
  const [optionMode, setOptionMode] = useState<"BINARIA" | "DIGITAL">("BINARIA");
  const [customAsset, setCustomAsset] = useState("");
  const [selectedTimeframe, setSelectedTimeframe] = useState<"M1" | "M5">("M1");
  const [selectedExpiration, setSelectedExpiration] = useState<"1min" | "5min">("1min");
  
  // Monitoring & Rate Limiting Configuration
  const [minSecondsBetweenAnalysis, setMinSecondsBetweenAnalysis] = useState<number>(20); // Conservative default to reduce API calls
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
  const [extraBots, setExtraBots] = useState<any>(null);
  const [historyView, setHistoryView] = useState<"CONFIRMED" | "UNCONFIRMED" | "ALL">("CONFIRMED");
  const [signalsHistory, setSignalsHistory] = useState<SignalRecord[]>(() => {
    try {
      const raw = localStorage.getItem("tozzi_signal_history_v2");
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((item: any) =>
        typeof item.id === "string" && typeof item.key === "string" && typeof item.timestamp === "string").slice(0, 1500) : [];
    } catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem("tozzi_signal_history_v2", JSON.stringify(signalsHistory)); }
    catch (e) { console.warn("Armazenamento de histórico cheio ou indisponível", e); }
  }, [signalsHistory]);
  const recordSignal = (data: {
    targetEpoch: number; asset: string; timeframe: string; expiration: string; optionMode?: string;
    decision: SignalRecord["decision"]; status: SignalStatus; reason: string; latencyMs?: number;
  }) => {
    const at = new Date().toISOString();
    const key = signalKey(data);
    const incoming: SignalRecord = {
      id: crypto.randomUUID(), key, timestamp: at, updatedAt: at,
      targetEpoch: data.targetEpoch, asset: data.asset, timeframe: data.timeframe,
      expiration: data.expiration, optionMode: data.optionMode,
      decision: data.decision, reason: data.reason, guardReason: data.reason,
      guardPassed: data.status === "CONFIRMED" || data.status === "CLOSED",
      latencyMs: data.latencyMs || 0, status: data.status, result: "PENDENTE",
      stages: [{ status: data.status, at, reason: data.reason }]
    };
    setSignalsHistory(previous => upsertSignal(previous, incoming));
  };

  // Sound & Notifications
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);
  const [accessCode, setAccessCode] = useState("");
  const [passwordEntry, setPasswordEntry] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState("");
  useEffect(() => { localStorage.removeItem("tozzi_signals_access"); }, []);
  const submitLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loginBusy) return;
    setLoginError("");
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(passwordEntry)) {
      setLoginError("Digite o código privado (8 a 64 caracteres, letras, números, _ ou -).");
      return;
    }
    setLoginBusy(true);
    try {
      const response = await fetch("/api/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: passwordEntry })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true) throw new Error(data.error || "Não foi possível confirmar a senha.");
      setAccessCode(passwordEntry);
      setPasswordEntry("");
      setAuthenticated(true);
    } catch (e: any) { setLoginError(e.message || "Falha na confirmação do acesso."); }
    finally { setLoginBusy(false); }
  };

  // Media stream refs
  const videoRef = useRef<HTMLVideoElement | null>(null); // persistent capture decoder
  const previewRef = useRef<HTMLVideoElement | null>(null); // visible preview, may unmount
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const monitoringLoopRef = useRef<any>(null);
  const lastAnalysisTimestampRef = useRef<number>(0);
  const prevFrameDataRef = useRef<string | null>(null);
  const analysisBusyRef = useRef(false);
  const pauseRef = useRef(false);
  const sessionRef = useRef(0);
  const activeRequestRef = useRef<AbortController | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const overloadUntilRef = useRef(0);
  const [overloadUntil, setOverloadUntil] = useState(0);
  type Candidate = { targetEpoch: number; decision: "POSSÍVEL COMPRA" | "POSSÍVEL VENDA"; asset: string; timeframe: string; expiration: string; optionMode?: string; status: "PRE_ALERT" | "CONFIRMED" | "CANCELLED" | "EXPIRED" | "CLOSED" | "UNVERIFIED"; reason: string };
  const candidateRef = useRef<Candidate | null>(null);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [dismissedPopupKey, setDismissedPopupKey] = useState("");
  const [miniCountdown, setMiniCountdown] = useState<{targetEpoch:number;asset:string;decision:string;timeframe:string}|null>(null);
  const [browserNotifications, setBrowserNotifications] = useState<NotificationPermission | "unsupported">(
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported"
  );
  // One alert identity throughout PRE_ALERT -> CONFIRMED -> CLOSED.
  // Marking or dismissing a signal must never reopen the same notification.
  const popupKey = candidate ? `${candidate.targetEpoch}-${candidate.asset}-${candidate.decision}-${candidate.status === "PRE_ALERT" ? "PRE_ALERT" : "FINAL"}` : "";
  const popupVisible = Boolean(candidate) && popupKey !== dismissedPopupKey;
  const enableBrowserNotifications = async () => {
    if (!("Notification" in window)) { setBrowserNotifications("unsupported"); return; }
    try {
      const permission = await Notification.requestPermission();
      setBrowserNotifications(permission);
      if (permission === "granted") playAlertSound("TESTE");
    } catch (error) { console.warn("Browser notification permission failed:", error); }
  };
  const notifyBrowser = (signal: Candidate) => {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try {
      const prefix = signal.status === "PRE_ALERT" ? "🔔 Pré-alerta — NÃO ENTRAR" :
        signal.status === "CONFIRMED" ? "✅ Reconfirmado — confira horário" :
        signal.status === "CANCELLED" ? "⛔ Cancelado por alteração do gráfico" :
        signal.status === "UNVERIFIED" ? "⚠️ Não confirmado — NÃO ENTRAR" :
        "🕒 Horário encerrado — aviso histórico";
      const notification = new Notification(`${prefix} • ${signal.asset}`, {
        body: `${signal.decision} • ${formatEntryTime(signal.targetEpoch)} • ${signal.reason}`,
        tag: `tozzi-${signal.targetEpoch}-${signal.status}`
      });
      notification.onclick = () => { window.focus(); setActiveTab("alerts"); notification.close(); };
    } catch (error) { console.warn("Browser notification unavailable:", error); }
  };
  const [nowEpoch, setNowEpoch] = useState(Date.now());
  const confirmBusyRef = useRef(false);
  const audioRef = useRef<AudioContext | null>(null);
  const setCandidateSafe = (next: Candidate | null) => {
    const previous = candidateRef.current;
    candidateRef.current = next;
    setCandidate(next);
    if (next && (previous?.targetEpoch !== next.targetEpoch || previous.status !== next.status || previous.reason !== next.reason)) {
      recordSignal({
        targetEpoch: next.targetEpoch, asset: next.asset, timeframe: next.timeframe,
        expiration: next.expiration, optionMode: next.optionMode || optionMode, decision: next.decision,
        status: next.status, reason: next.reason
      });
      if (previous?.status !== next.status) notifyBrowser(next);
    }
  };
  useEffect(() => {
    const ticker = setInterval(() => {
      const now = Date.now();
      setNowEpoch(now);
      setMiniCountdown(previous => previous && now > previous.targetEpoch + 4000 ? null : previous);
      const pending = candidateRef.current;
      if (pending && (pending.status === "PRE_ALERT" || pending.status === "CONFIRMED") && now > pending.targetEpoch + 3000) {
        setCandidateSafe({
          ...pending,
          status: pending.status === "CONFIRMED" ? "CLOSED" : "EXPIRED",
          reason: pending.status === "CONFIRMED"
            ? "Horário de entrada encerrado. O sinal foi confirmado antes da entrada, mas o resultado WIN/LOSS não foi verificado automaticamente."
            : "Pré-alerta expirou sem confirmação. Não entre usando esse aviso."
        });
      }
    }, 1000);
    return () => clearInterval(ticker);
  }, []);
  const formatEntryTime = (timestamp: number) => new Date(timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });


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
    if (!authenticated || !accessCode || !/^[A-Za-z0-9_-]{8,64}$/.test(accessCode)) {
      setWsConnected(false);
      return;
    }
    const ws = new WebSocket(wsUrl, ["tozzi-signals", accessCode]);

    ws.onopen = () => setWsConnected(true);
    ws.onclose = () => setWsConnected(false);
    ws.onerror = () => setWsConnected(false);
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (!mediaStreamRef.current && ["PRE_ALERT", "CONFIRMED", "CANCELLED", "UNVERIFIED"].includes(data.type)) {
          const direction = data.guardResult?.finalDecision;
          const targetEpoch = Number(data.targetEpoch);
          if (!Number.isFinite(targetEpoch)) return;
          if (data.type !== "CANCELLED" && data.type !== "UNVERIFIED" && (data.guardResult?.passed !== true ||
            (direction !== "POSSÍVEL COMPRA" && direction !== "POSSÍVEL VENDA"))) return;
          const active = candidateRef.current;
          if (data.type === "PRE_ALERT") {
            if (targetEpoch < Date.now() + 30000) return;
            const next: Candidate = { targetEpoch, decision: direction, asset: data.asset,
              timeframe: data.timeframe, expiration: data.expiration, optionMode: data.optionMode,
              status: "PRE_ALERT", reason: "Pré-alerta. NÃO ENTRAR: aguarde confirmação perto do horário." };
            setCandidateSafe(next);
            if (soundEnabled) playAlertSound(direction);
          } else if (active && active.targetEpoch === targetEpoch) {
            const nextStatus: Candidate["status"] = data.type === "CANCELLED" ? "CANCELLED"
              : data.type === "UNVERIFIED" ? "UNVERIFIED" : "CONFIRMED";
            const next: Candidate = { ...active, status: nextStatus,
              reason: nextStatus === "CANCELLED"
                ? data.guardResult?.guardReason || "Conflito confirmado. Sinal cancelado."
                : nextStatus === "UNVERIFIED"
                  ? data.guardResult?.guardReason || "Sem reconfirmação. Não entrar."
                  : "Condições reconfirmadas. Confira o gráfico antes do horário previsto." };
            setCandidateSafe(next);
            if (soundEnabled) playAlertSound(data.type === "CONFIRMED" ? direction : "AGUARDAR");
            if (data.type === "CONFIRMED") {
              // setCandidateSafe has already recorded the confirmation.
            }
          }
        }
      } catch (e) {
        console.error("WS message parse error:", e);
      }
    };

    return () => {
      ws.close();
    };
  }, [soundEnabled, accessCode, authenticated]);

  // Two clear, slightly louder beeps. Browser/system volume remains authoritative.
  const playAlertSound = (decision: string) => {
    try {
      const audioCtx = audioRef.current || new (window.AudioContext || (window as any).webkitAudioContext)();
      audioRef.current = audioCtx;
      void audioCtx.resume();
      const isBuy = decision === "POSSÍVEL COMPRA";
      const isSell = decision === "POSSÍVEL VENDA";
      const frequencies = isBuy ? [880, 1100] : isSell ? [560, 440] : [620, 450];
      const start = audioCtx.currentTime + 0.02;
      frequencies.forEach((frequency, index) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        const at = start + index * 0.27;
        osc.type = "sine";
        osc.frequency.setValueAtTime(frequency, at);
        gain.gain.setValueAtTime(0.001, at);
        gain.gain.linearRampToValueAtTime(0.38, at + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.001, at + 0.20);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(at);
        osc.stop(at + 0.22);
      });
    } catch (error) { console.warn("Não foi possível reproduzir o alerta sonoro:", error); }
  };

  // Changing the chart source must invalidate pending captures; do not disable the controls.
  const changeMarket = (next: "OTC" | "REGULAR") => {
    if (next === marketType) return;
    if (isMonitoring) stopMonitoring();
    setMarketType(next);
    setCustomAsset("");
    setSelectedAsset(next === "OTC" ? OTC_ASSETS[0] : REGULAR_ASSETS[0]);
    setDismissedPopupKey("");
  };
  const changeAsset = (asset: string) => {
    if (asset === selectedAsset && !customAsset) return;
    if (isMonitoring) stopMonitoring();
    setSelectedAsset(asset);
  };
  const changeCustomAsset = (asset: string) => {
    if (isMonitoring) stopMonitoring();
    setCustomAsset(asset);
  };

  // Start Live Monitoring
  const startMonitoring = async () => {
    try {
      sessionRef.current++;
      pauseRef.current = false;
      prevFrameDataRef.current = null;
      confirmBusyRef.current = false;
      setCandidateSafe(null);
      setAnalysisError(null);
      setCurrentVisionResult(null);
      setCurrentGuardResult(null);
      setExtraBots(null);
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "window" },
        audio: false
      });

      mediaStreamRef.current = stream;
      setIsMonitoring(true);
      setIsPaused(false);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play().catch(e => console.warn("Capture decoder unavailable", e));
      }
      if (previewRef.current) {
        previewRef.current.srcObject = stream;
        void previewRef.current.play().catch(e => console.warn("Preview playback unavailable", e));
      }

      // Handle stream end by user browser UI
      stream.getVideoTracks()[0].onended = () => {
        stopMonitoring();
      };

      // Loop starts after video element has mounted.
    } catch (err: any) {
      console.error("Error starting live monitoring:", err);
      alert("Não foi possível iniciar o monitoramento ao vivo. Verifique a permissão do navegador.");
    }
  };

  // Keep capture decoding alive while tabs change. Reconnect only the visible preview.
  useEffect(() => {
    if (!isMonitoring || !mediaStreamRef.current) return;
    const stream = mediaStreamRef.current;
    const track = stream.getVideoTracks()[0];
    if (!track || track.readyState !== "live") {
      stopMonitoring();
      return;
    }
    if (videoRef.current && videoRef.current.srcObject !== stream) {
      videoRef.current.srcObject = stream;
      void videoRef.current.play().catch(e => console.warn("Decoder playback failed", e));
    }
    if (activeTab === "monitor" && previewRef.current) {
      previewRef.current.srcObject = stream;
      void previewRef.current.play().catch(e => console.warn("Preview playback failed", e));
    }
  }, [activeTab, isMonitoring]);

  // Stop Monitoring
  const stopMonitoring = () => {
    sessionRef.current++;
    setCandidateSafe(null);
    setMiniCountdown(null);
    setCurrentVisionResult(null);
    setCurrentGuardResult(null);
    setExtraBots(null);
    setAnalysisError(null);
    activeRequestRef.current?.abort();
    analysisBusyRef.current = false;
    setIsAnalyzing(false);
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
    if (videoRef.current) videoRef.current.srcObject = null;
    if (previewRef.current) previewRef.current.srcObject = null;
  };

  const togglePause = () => {
    pauseRef.current = !isPaused;
    if (!isPaused) { setCandidateSafe(null); setMiniCountdown(null); }
    if (!isPaused) {
      sessionRef.current++;
      activeRequestRef.current?.abort();
      analysisBusyRef.current = false;
      setIsAnalyzing(false);
    }
    setIsPaused(!isPaused);
  };

  // Do not run overlapping calls; reserve a fresh frame for a recheck near entry time.
  const startMonitoringLoop = () => {
    if (monitoringLoopRef.current) clearInterval(monitoringLoopRef.current);
    monitoringLoopRef.current = setInterval(() => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const track = mediaStreamRef.current?.getVideoTracks()[0];
      if (pauseRef.current || analysisBusyRef.current || Date.now() < overloadUntilRef.current ||
        !video || !canvas || !track || track.readyState !== "live" || video.videoWidth < 1) return;
      const now = Date.now();
      const pending = candidateRef.current;
      let phase: "PREPARE" | "CONFIRM" = "PREPARE";
      let targetEpoch: number;
      let priorDirection = "";
      if (pending && pending.status === "PRE_ALERT") {
        const remain = pending.targetEpoch - now;
        if (remain > 30000 || remain < 20000 || confirmBusyRef.current) return;
        phase = "CONFIRM";
        targetEpoch = pending.targetEpoch;
        priorDirection = pending.decision;
        confirmBusyRef.current = true;
      } else {
        if (pending && now < pending.targetEpoch + 3500) return;
        if (now - lastAnalysisTimestampRef.current < minSecondsBetweenAnalysis * 1000) return;
        // Target the NEXT M1/M5 candle boundary, never skip extra candles merely
        // to create a long lead time. Look only in the ~one-minute alert window.
        const bucketMs = selectedTimeframe === "M5" ? 300000 : 60000;
        targetEpoch = Math.ceil((now + 1) / bucketMs) * bucketMs;
        const leadMs = targetEpoch - now;
        // ONLY target the immediately upcoming candle. If less than ~45 seconds
        // remain before analysis, skip; never shift the signal to the next-next candle.
        if (leadMs < 45000 || leadMs > 60000) return;
      }
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) { confirmBusyRef.current = false; return; }
      canvas.width = 1024;
      canvas.height = Math.max(1, Math.round(1024 * video.videoHeight / video.videoWidth));
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      setLastCaptureTime(new Date(now).toLocaleTimeString("pt-BR"));
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 2166136261;
      const stride = Math.max(4, Math.floor(pixels.length / 256 / 4) * 4);
      for (let i = 0; i < pixels.length; i += stride) hash = Math.imul(hash ^ pixels[i], 16777619);
      const fingerprint = String(hash >>> 0);
      const changed = prevFrameDataRef.current !== fingerprint;
      prevFrameDataRef.current = fingerprint;
      setChangeDetected(changed);
      if (!changed && phase === "PREPARE") return;
      lastAnalysisTimestampRef.current = now;
      void processFrameAnalysis(canvas.toDataURL("image/jpeg", 0.7), now, sessionRef.current, phase, targetEpoch, priorDirection);
    }, 1000);
  };

  const processFrameAnalysis = async (
    dataUrl: string, captureTimestamp: number, sessionId: number,
    phase: "PREPARE" | "CONFIRM", targetEpoch: number, priorDirection: string
  ) => {
    if (analysisBusyRef.current) return;
    analysisBusyRef.current = true;
    setIsAnalyzing(true);
    const controller = new AbortController();
    activeRequestRef.current = controller;
    const timer = setTimeout(() => controller.abort(), 17000);
    try {
      const res = await fetch("/api/analyze-chart", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Tozzi-Access": accessCode },
        signal: controller.signal,
        body: JSON.stringify({
          imageBase64: dataUrl, selectedAsset: customAsset || selectedAsset,
          selectedTimeframe, selectedExpiration, phase, targetEpoch, priorDirection, captureTimestamp, optionMode
        })
      });
      if (sessionId !== sessionRef.current || pauseRef.current || !mediaStreamRef.current) return;
      const latencyMs = Date.now() - captureTimestamp;
      setTotalLatency(latencyMs);
      setApiCallCount(v => v + 1);
      if (!res.ok) {
        const details = await res.json().catch(() => ({}));
        if ((res.status === 429 || res.status === 503) &&
          ["GEMINI_QUOTA", "GEMINI_UNAVAILABLE", "API_RATE_LIMIT", "ANALYSIS_BUSY"].includes(details?.type)) {
          const retrySeconds = Math.max(1, Math.min(1800, Number(details.retryAfterSeconds) || 60));
          overloadUntilRef.current = Date.now() + retrySeconds * 1000;
          setOverloadUntil(overloadUntilRef.current);
          throw new Error(details.error || "Controle de consultas ativo. Aguardando próxima tentativa.");
        }
        throw new Error(details?.error || "Erro HTTP " + res.status);
      }
      const data = await res.json();
      if (!data?.visionResult || !data?.guardResult) throw new Error("Resposta incompleta da IA.");
      setLastAnalysisTime(new Date().toLocaleTimeString("pt-BR"));
      const guard = data.guardResult;
      const expired = latencyMs > maxLatencyLimit;
      const serverClockOffset = Number(data.serverNow) - Date.now();
      const clockMismatch = !Number.isFinite(serverClockOffset) || Math.abs(serverClockOffset) > 6000;
      const direction = guard.finalDecision;
      const approved = !expired && guard.passed === true && (direction === "POSSÍVEL COMPRA" || direction === "POSSÍVEL VENDA");
      const remain = targetEpoch - Date.now();
      const windowOk = phase === "PREPARE" ? remain >= 30000 && remain <= 60000 : remain >= 4000 && remain <= 30000;
      const allowed = approved && windowOk && !clockMismatch && (phase === "PREPARE" || priorDirection === direction);
      const reason = expired ? "SINAL EXPIRADO: " + (latencyMs / 1000).toFixed(1) + " s."
        : clockMismatch ? "Relógio do notebook e servidor estão desencontrados. Sincronize a hora antes de monitorar."
        : !windowOk ? "Fora da janela de aproximadamente 1 minuto para a próxima vela."
        : guard.guardReason || data.visionResult.reason || "Condição indefinida.";
      setCurrentVisionResult(data.visionResult);
      setExtraBots(data.bots || null);
      setCurrentGuardResult({ ...guard, passed: allowed, finalDecision: allowed ? direction : "AGUARDAR", guardReason: reason });
      setAnalysisError(null);
      overloadUntilRef.current = 0;
      setOverloadUntil(0);
      if (phase === "PREPARE") {
        if (!allowed) {
          recordSignal({
            targetEpoch, asset: customAsset || selectedAsset, timeframe: selectedTimeframe,
            expiration: selectedExpiration, optionMode,
            decision: direction === "POSSÍVEL COMPRA" || direction === "POSSÍVEL VENDA" ? direction : "AGUARDAR",
            status: "AGUARDAR", reason, latencyMs
          });
        }
        if (allowed) {
          const next: Candidate = { targetEpoch, decision: direction, asset: customAsset || selectedAsset,
            timeframe: selectedTimeframe, expiration: selectedExpiration, optionMode, status: "PRE_ALERT",
            reason: "Possível " + (direction === "POSSÍVEL COMPRA" ? "COMPRA" : "VENDA") +
              " às " + formatEntryTime(targetEpoch) + ". NÃO ENTRE ainda; aguardando reconfirmação." };
          setCandidateSafe(next);
          if (soundEnabled) playAlertSound(direction);
        }
      } else {
        const previous = candidateRef.current;
        if (previous && previous.targetEpoch === targetEpoch) {
          const next: Candidate = { ...previous, status: allowed ? "CONFIRMED" :
              data.phaseEvent === "CANCELLED" ? "CANCELLED" : "UNVERIFIED",
            reason: allowed ? "Condições reconfirmadas. Entrada prevista: " + formatEntryTime(targetEpoch) +
              ". Confira novamente o gráfico antes de qualquer operação."
               : data.phaseEvent === "CANCELLED" ? "SINAL CANCELADO POR CONFLITO: " + reason
              : "SEM CONFIRMAÇÃO: " + reason };
          setCandidateSafe(next);
          if (soundEnabled) playAlertSound(allowed ? direction : "AGUARDAR");
          if (allowed) {
            // setCandidateSafe has already recorded the confirmation.
          }
        }
      }
    } catch (err: any) {
      if (sessionId !== sessionRef.current) return;
      const reason = err?.name === "AbortError" ? "Análise demorou mais de 17 segundos; descartada." : err?.message || "Erro de análise.";
      setAnalysisError(reason);
      setCurrentVisionResult(null); // No old analysis should look like a current recommendation.
      setExtraBots(null);
      setCurrentGuardResult({ passed: false, technicalError: true, finalDecision: "AGUARDAR", guardReason: reason,
        checks: {} });
      if (phase === "CONFIRM") {
        const pending = candidateRef.current;
        if (pending && pending.targetEpoch === targetEpoch) setCandidateSafe({ ...pending, status: "UNVERIFIED", reason: "SEM CONFIRMAÇÃO: " + reason + " Não entre com base nesse pré-alerta." });
      }
      console.error("Falha de análise:", err);
    } finally {
      clearTimeout(timer);
      if (phase === "CONFIRM") confirmBusyRef.current = false;
      if (activeRequestRef.current === controller) activeRequestRef.current = null;
      if (sessionId === sessionRef.current) { analysisBusyRef.current = false; setIsAnalyzing(false); }
    }
  };

  useEffect(() => {
    if (isMonitoring && !isPaused) startMonitoringLoop();
    return () => { if (monitoringLoopRef.current) clearInterval(monitoringLoopRef.current); };
  }, [minSecondsBetweenAnalysis, isPaused, isMonitoring, selectedAsset, selectedTimeframe, selectedExpiration, activeTab]);

  // Diagnostics reflect observable state only, never simulated pass labels.
  const runDiagnosticTests = async () => {
    const track = mediaStreamRef.current?.getVideoTracks()[0];
    const mediaOk = typeof navigator.mediaDevices?.getDisplayMedia === "function";
    const streamOk = !!track && track.readyState === "live";
    const videoOk = streamOk && !!videoRef.current && videoRef.current.videoWidth > 0;
    const results: TestItem[] = [
      { id: 1, name: "Permissão de Monitoramento", description: "Suporte do navegador", status: mediaOk ? "passed" : "failed", resultMessage: mediaOk ? "API disponível (permissão deve ser verificada na captura)." : "API indisponível." },
      { id: 2, name: "Fluxo Contínuo de Vídeo", description: "Faixa de vídeo ativa", status: videoOk ? "passed" : "failed", resultMessage: videoOk ? "Vídeo recebido." : "Vídeo indisponível: inicie a captura." },
      { id: 3, name: "Detecção de Mudanças Visuais", description: "Quadro capturado", status: lastCaptureTime ? "passed" : "failed", resultMessage: lastCaptureTime || "Sem captura." },
      { id: 4, name: "Processamento Single-Flight", description: "Proteção de concorrência", status: "idle", resultMessage: "Implementado em código; ainda não validado sob carga." },
      { id: 5, name: "Identificação do Ativo OTC", description: "Comparação por IA", status: "idle", resultMessage: "Depende da imagem e resposta verificável." },
      { id: 6, name: "Vision Bot & Signal Guard", description: "Análise anterior", status: currentGuardResult ? "passed" : "idle", resultMessage: currentGuardResult?.guardReason || "Sem resultado validado." },
      { id: 7, name: "Proteção contra Atraso", description: "Última latência", status: totalLatency > 0 && totalLatency <= maxLatencyLimit ? "passed" : "failed", resultMessage: totalLatency + "ms / limite " + maxLatencyLimit + "ms" },
      { id: 8, name: "WebSocket", description: "Conexão com servidor", status: wsConnected ? "passed" : "failed", resultMessage: wsConnected ? "Conectado; entrega ao iPhone ainda requer teste." : "Desconectado." },
      { id: 9, name: "Interrupção da Captura", description: "Encerra a faixa", status: "idle", resultMessage: "Não testado automaticamente." },
      { id: 10, name: "Consumo de IA", description: "Chamadas feitas", status: "idle", resultMessage: apiCallCount + " solicitações iniciadas (cotas devem ser consultadas no provedor)." },
      { id: 11, name: "Períodos", description: "M1/M5", status: selectedTimeframe === "M1" || selectedTimeframe === "M5" ? "passed" : "failed", resultMessage: selectedTimeframe + " / " + selectedExpiration }
    ];
    setTests(results);
  };

  const markSignalAction = (targetEpoch: number, asset: string, action: "TAKEN" | "IGNORED") => {
    setSignalsHistory(previous => previous.map(item =>
      Number(item.targetEpoch) === targetEpoch && item.asset === asset && isConfirmed(item)
        ? { ...item, tradeAction: action,
            result: action === "IGNORED" ? "PENDENTE" : item.result,
            updatedAt: new Date().toISOString() } : item
    ));
  };
  const markHistoryAction = (id: string, action: "TAKEN" | "IGNORED") => {
    setSignalsHistory(previous => previous.map(item =>
      item.id === id && isConfirmed(item)
        ? { ...item, tradeAction: action,
            result: action === "IGNORED" ? "PENDENTE" : item.result,
            updatedAt: new Date().toISOString() } : item
    ));
  };
  const updateHistoryResult = (id: string, outcome: "WIN" | "LOSS") => {
    setSignalsHistory(previous => previous.map(item =>
      item.id === id && canRecordOutcome(item)
        ? { ...item, result: outcome, updatedAt: new Date().toISOString() } : item
    ));
  };
  const currentSignal = candidate ? signalsHistory.find(item => Number(item.targetEpoch) === candidate.targetEpoch && item.asset === candidate.asset && isConfirmed(item)) : undefined;
  const pickConfirmedSignal = (signal: Candidate) => {
    if (signal.status !== "CONFIRMED" || signal.targetEpoch <= Date.now()) {
      setDismissedPopupKey(popupKey);
      return;
    }
    markSignalAction(signal.targetEpoch, signal.asset, "TAKEN");
    setDismissedPopupKey(popupKey);
    setMiniCountdown({targetEpoch:signal.targetEpoch,asset:signal.asset,decision:signal.decision,timeframe:signal.timeframe});
  };
  const visibleHistory = signalsHistory.filter(item => historyView === "ALL" || historyGroup(item) === historyView);
  const historyStats = summarizeSignals(signalsHistory);
  const comparisons = summarizeComparisons(signalsHistory);
  const winRate = historyStats.winRate;
  const formatRecordDate = (iso: string) =>
    new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" });
  const exportHistoryCSV = () => {
    const cols = ["timestamp","updatedAt","asset","optionMode","timeframe","expiration",
      "decision","status","reason","guardPassed","latencyMs","tradeAction","result","targetEpoch","confirmedReason"];
    const cell = (value: unknown) => {
      const str = String(value ?? "");
      // Neutralize spreadsheet formulas in exported user/model text.
      const safe = /^[=+@\-\t\r]/.test(str) ? "'" + str : str;
      return '"' + safe.replace(/"/g, '""') + '"';
    };
    const csv = "\uFEFF" + cols.join(";") + "\r\n" +
      signalsHistory.map(item => cols.map(key => cell((item as any)[key])).join(";")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "tozzi-historico-" + new Date().toISOString().slice(0,10) + ".csv";
    a.click(); URL.revokeObjectURL(url);
  };

  if (!authenticated) return (
    <main className="min-h-screen bg-[#080a11] text-white flex items-center justify-center p-5 font-sans relative overflow-hidden">
      <div className="absolute top-[-100px] right-[-80px] h-[320px] w-[320px] rounded-full bg-purple-700/25 blur-[90px] pointer-events-none" />
      <div className="absolute bottom-[-110px] left-[-100px] h-[340px] w-[340px] rounded-full bg-orange-600/20 blur-[90px] pointer-events-none" />
      <form onSubmit={submitLogin} className="relative z-10 w-full max-w-md rounded-3xl border border-purple-500/30 bg-[#121522]/95 p-7 sm:p-9 shadow-2xl shadow-purple-950/40 space-y-6">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-gradient-to-br from-purple-600 to-orange-500 p-3 shadow-lg shadow-orange-500/20"><ShieldCheck className="h-7 w-7 text-white" /></div>
          <div>
            <h1 className="text-xl font-extrabold tracking-wide">TOZZI SINAIS IA <span className="text-orange-400">PRO</span></h1>
            <p className="text-xs text-purple-200/75">Painel privado • 7 verificadores (2 experimentais)</p>
          </div>
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-bold">Acesso protegido</h2>
          <p className="text-sm text-slate-400">Digite o mesmo código privado que você configurou em TOZZI_ACCESS_CODE no Render.</p>
        </div>
        <div className="space-y-2">
          <label htmlFor="private-password" className="block text-sm font-semibold text-orange-200">Sua senha de acesso</label>
          <input id="private-password" type="password" autoComplete="current-password" required
            value={passwordEntry} onChange={event => setPasswordEntry(event.target.value.trim())}
            placeholder="Digite seu código privado"
            className="w-full rounded-xl border border-slate-600 bg-[#0b0e17] px-4 py-3 text-base text-white outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-400/20" />
          <p className="text-[11px] text-slate-500">Sua senha não será exibida nem armazenada permanentemente neste navegador.</p>
        </div>
        {loginError && <p role="alert" className="rounded-lg border border-red-500/40 bg-red-950/40 p-3 text-sm text-red-200">{loginError}</p>}
        <button type="submit" disabled={loginBusy}
          className="w-full rounded-xl bg-gradient-to-r from-purple-600 to-orange-500 p-3.5 text-base font-bold text-white shadow-lg shadow-orange-950/30 hover:brightness-110 disabled:opacity-50">
          {loginBusy ? "Conferindo senha..." : "Confirmar e entrar"}
        </button>
        <p className="text-center text-xs text-slate-500">O aplicativo não envia ordens para a corretora. Use a conta demo para validar os sinais.</p>
      </form>
    </main>
  );

  return (
    <div className="min-h-screen bg-[#080a12] text-slate-100 flex flex-col font-sans selection:bg-orange-500/30 selection:text-white">
      {/* Hidden canvas for sampling */}
      <canvas ref={canvasRef} className="hidden" />
      {/* Stable capture decoder: never unmount it when switching navigation tabs. */}
      <video ref={videoRef} autoPlay playsInline muted className="hidden" />


      {/* Header */}
      <header className="bg-[#0d101c]/95 backdrop-blur-xl border-b border-white/10 px-4 sm:px-8 py-4 flex flex-wrap items-center justify-between gap-4 sticky top-0 z-50 shadow-xl shadow-black/40">
        <div className="flex items-center space-x-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-600 via-purple-600 to-orange-500 flex items-center justify-center shadow-lg shadow-orange-600/20 border border-white/20">
            <Zap className="w-5 h-5 text-white animate-pulse" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black tracking-tight bg-gradient-to-r from-white via-purple-200 to-orange-400 bg-clip-text text-transparent">
              TOZZI SINAIS <span className="text-orange-400">IA PRO</span>
            </h1>
            <p className="text-xs text-slate-400">CENTRAL DE INTELIGÊNCIA • M1 / M5</p>
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
            onClick={() => {
              setSoundEnabled(!soundEnabled);
              if (!soundEnabled) playAlertSound("TESTE");
            }}
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

      <section className="bg-[#0d101c] px-4 sm:px-8 py-2.5 border-b border-orange-500/15 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-emerald-300"><ShieldCheck className="h-4 w-4" /> Sessão autorizada • Monitoramento M1 / M5</div>
        <button type="button" onClick={() => {
          stopMonitoring();
          setAccessCode("");
          setAuthenticated(false);
          setPasswordEntry("");
        }} className="rounded-lg border border-orange-500/40 px-3 py-1.5 text-xs font-semibold text-orange-300 hover:bg-orange-900/20">Sair do app</button>
      </section>

      <section className="mx-4 sm:mx-8 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-orange-500/25 bg-[#181726] p-3 sm:p-4">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-orange-300" />
          <div>
            <p className="text-sm font-bold text-white">Histórico de sinais e WIN/LOSS</p>
            <p className="text-[11px] text-slate-400">{historyStats.total} registros neste dispositivo • data, hora e confirmação</p>
          </div>
        </div>
        <button type="button" onClick={() => { setActiveTab("history"); window.scrollTo({ top: 0, behavior: "smooth" }); }}
          className="rounded-xl bg-gradient-to-r from-purple-600 to-orange-500 px-5 py-3 text-sm font-extrabold text-white shadow-md shadow-orange-950/30 hover:brightness-110">
          VER HISTÓRICO
        </button>
      </section>

      <section className="mx-4 sm:mx-8 mt-5 rounded-3xl border border-orange-400/30 bg-gradient-to-br from-[#211631] via-[#141827] to-[#201522] p-5 sm:p-7 shadow-2xl shadow-purple-950/30 space-y-3 relative overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-black tracking-wider text-orange-200">CENTRAL DE SINAIS • PRÓXIMA ENTRADA</h2>
          <span className="text-xs text-slate-400">7 ROBÔS • 2 EM OBSERVAÇÃO</span>
        </div>
        {candidate ? (
          <div className="space-y-2">
            <p className={`text-lg font-bold ${candidate.status === "CANCELLED" ? "text-red-400" : candidate.status === "CONFIRMED" || candidate.status === "CLOSED" ? "text-green-300" : "text-amber-300"}`}>
              {candidate.status === "PRE_ALERT" ? "🔔 PRÉ-ALERTA — NÃO ENTRAR AINDA" :
               candidate.status === "CONFIRMED" ? "✅ RECONFIRMADO — AGUARDE O HORÁRIO" :
               candidate.status === "CLOSED" ? "🕒 HORÁRIO ENCERRADO — CONFIRMAÇÃO REGISTRADA" :
               candidate.status === "UNVERIFIED" ? "⚠️ SEM CONFIRMAÇÃO — NÃO ENTRAR" :
               candidate.status === "EXPIRED" ? "🕒 PRÉ-ALERTA EXPIRADO" : "⛔ CANCELADO POR CONFLITO"}
            </p>
            <div className={`text-sm font-bold ${candidate.status === "CONFIRMED" || candidate.status === "CLOSED" ? (candidate.decision === "POSSÍVEL COMPRA" ? "text-green-400" : "text-red-400") : "text-amber-300"}`}>
              {candidate.decision} • {candidate.asset} • {candidate.timeframe} / {candidate.expiration}
            </div>
            <div className="text-xl font-bold text-white">
              Entrada prevista: {formatEntryTime(candidate.targetEpoch)}
            </div>
            <p className="text-sm text-slate-300">
              {candidate.targetEpoch > nowEpoch
                ? "Faltam " + Math.ceil((candidate.targetEpoch - nowEpoch) / 1000) + " segundos"
                : "Horário alcançado — verifique o gráfico atual; não opere por um alerta vencido."}
            </p>
            <p className="text-xs text-amber-200">{candidate.reason}</p>
          </div>
        ) : (
          <p className="text-sm text-slate-400">Nenhum pré-alerta ativo. Quando uma oportunidade passar nos dois filtros, aparecerão direção, horário previsto e aviso sonoro. É necessário reconfirmar antes da entrada.</p>
        )}
        <p className="text-[11px] text-slate-500">Entrada prevista no início da próxima vela M1/M5, pelo relógio do notebook. Confirme o relógio e a vela atual da Safirion antes de agir; não há sincronização direta com a corretora. Áudio no iPhone depende do navegador e da tela ativa. Nenhum sinal garante WIN.</p>
        <button type="button" onClick={enableBrowserNotifications}
          className="text-xs rounded-lg border border-purple-500/40 px-3 py-2 text-purple-200 hover:bg-purple-900/30">
          {browserNotifications === "granted" ? "✓ Notificações do navegador ativadas" : "🔔 Ativar notificações do navegador"}
        </button>
        {browserNotifications === "denied" && <span className="ml-2 text-xs text-amber-300">Permissão bloqueada nas configurações do navegador.</span>}
        {browserNotifications === "unsupported" && <span className="ml-2 text-xs text-slate-400">Este navegador não oferece notificações nesta página.</span>}
      </section>

      <section className="mx-4 sm:mx-8 mt-4 rounded-3xl border border-white/10 bg-[#111624] p-5 shadow-xl shadow-black/20">
        <h3 className="text-sm font-semibold text-purple-200">EQUIPE DE ANÁLISE • 7 VERIFICADORES</h3>
        <p className="mt-1 text-xs text-slate-400">Os 5 verificadores anteriores continuam decidindo os sinais. Precision Candle e Reversal Watch estão em observação: examinam força, pavios e reversões na MESMA leitura visual, sem chamadas extras e sem interferir nas entradas.</p>
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 text-xs">
          <div className="rounded-2xl border border-white/10 bg-[#191e2e] p-4 text-slate-200 shadow-inner shadow-black/20"><strong>Vision Bot</strong><p className="text-slate-400 mt-1">Leitura do gráfico</p></div>
          <div className="rounded-2xl border border-white/10 bg-[#191e2e] p-4 text-slate-200 shadow-inner shadow-black/20"><strong>Signal Guard</strong><p className="text-slate-400 mt-1">Filtro final</p></div>
          <div className="rounded-2xl border border-white/10 bg-[#191e2e] p-4 text-slate-200 shadow-inner shadow-black/20"><strong>Timing Bot</strong><p className={extraBots?.timing?.passed ? "text-green-400 mt-1" : "text-amber-300 mt-1"}>
            {extraBots?.timing?.reason || "Aguardando análise"}
          </p></div>
          <div className="rounded-2xl border border-white/10 bg-[#191e2e] p-4 text-slate-200 shadow-inner shadow-black/20"><strong>Trend Bot</strong><p className={extraBots?.trend?.passed ? "text-green-400 mt-1" : "text-amber-300 mt-1"}>
            {extraBots?.trend?.reason || "Aguardando análise"}
          </p></div>
          <div className="rounded-2xl border border-orange-500/30 bg-gradient-to-br from-orange-900/20 to-[#191e2e] p-4 text-slate-200"><strong className="text-orange-200">Candle Bot</strong><p className={extraBots?.candles?.passed ? "text-green-400 mt-1" : "text-amber-300 mt-1"}>
            {extraBots?.candles?.reason || "Aguardando análise"}
          </p></div>
          <div className="rounded-2xl border border-violet-500/40 bg-violet-950/20 p-4 text-slate-200">
            <strong className="text-violet-200">Precision Candle Bot</strong>
            <p className="text-[10px] font-bold text-violet-300 mt-1">OBSERVAÇÃO • CORPO E PAVIOS</p>
            <p className={extraBots?.precisionCandle?.status === "FAVORAVEL" ? "text-green-400 mt-1" : extraBots?.precisionCandle?.status === "ATENCAO" ? "text-amber-300 mt-1" : "text-slate-400 mt-1"}>
              {extraBots?.precisionCandle?.reason || "Aguardando captura"}
            </p>
          </div>
          <div className="rounded-2xl border border-violet-500/40 bg-violet-950/20 p-4 text-slate-200">
            <strong className="text-violet-200">Reversal Watch Bot</strong>
            <p className="text-[10px] font-bold text-violet-300 mt-1">OBSERVAÇÃO • CONTINUAÇÃO / REVERSÃO</p>
            <p className={extraBots?.reversalWatch?.status === "FAVORAVEL" ? "text-green-400 mt-1" : extraBots?.reversalWatch?.status === "ATENCAO" ? "text-amber-300 mt-1" : "text-slate-400 mt-1"}>
              {extraBots?.reversalWatch?.reason || "Aguardando captura"}
            </p>
          </div>
        </div>
        <p className="mt-3 text-[11px] text-slate-400">Os dois novos diagnósticos são experimentais. Não são IAs independentes, não representam votos adicionais e não alteram CONFIRMADO / SEM CONFIRMAÇÃO. Acompanhe os WIN/LOSS da demo para avaliar sua utilidade.</p>
      </section>

      {/* Navigation Tabs */}
      <div className="bg-[#0d101c]/90 backdrop-blur-xl border-y border-white/10 px-4 sm:px-8 mt-5 grid grid-cols-2 md:flex md:gap-2">
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
              className={`flex items-center justify-center gap-2 py-3 px-2 sm:px-4 border-b-2 font-semibold text-xs sm:text-sm transition-all text-center ${
                isActive
                  ? "border-orange-400 text-orange-200 bg-orange-500/10"
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
      <main className="flex-1 p-4 md:p-8 max-w-[1440px] mx-auto w-full space-y-6">
        <section className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
          <div className="rounded-2xl border border-purple-400/20 bg-gradient-to-br from-[#201932] to-[#121625] p-4 sm:p-5 shadow-lg shadow-black/20">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-purple-200/80">Status do sistema</span>
              <Activity className="h-4 w-4 text-purple-300" />
            </div>
            <p className={`mt-3 text-lg sm:text-xl font-extrabold ${isMonitoring && !isPaused ? "text-emerald-300" : isPaused ? "text-amber-300" : "text-white"}`}>
              {isMonitoring ? isPaused ? "Em pausa" : "Monitorando" : "Aguardando"}
            </p>
            <p className="mt-1 text-[11px] text-slate-400">{optionMode === "DIGITAL" ? "Digital" : "Binária"} • {selectedTimeframe} • {customAsset || selectedAsset}</p>
          </div>
          <div className="rounded-2xl border border-orange-400/25 bg-gradient-to-br from-[#272033] to-[#121625] p-4 sm:p-5 shadow-lg shadow-black/20">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-orange-200/80">Sinais confirmados</span>
              <ShieldCheck className="h-4 w-4 text-orange-300" />
            </div>
            <p className="mt-3 text-2xl sm:text-3xl font-extrabold text-white tabular-nums">{historyStats.confirmed}</p>
            <p className="mt-1 text-[11px] text-slate-400">Registros deste navegador</p>
          </div>
          <div className="rounded-2xl border border-amber-400/15 bg-[#141927] p-4 sm:p-5 shadow-lg shadow-black/20">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-slate-400">Sem confirmação</span>
              <ShieldAlert className="h-4 w-4 text-amber-300" />
            </div>
            <p className="mt-3 text-2xl sm:text-3xl font-extrabold text-white tabular-nums">{historyStats.unconfirmed}</p>
            <p className="mt-1 text-[11px] text-slate-400">Não considerados operações</p>
          </div>
          <div className="rounded-2xl border border-purple-400/15 bg-[#141927] p-4 sm:p-5 shadow-lg shadow-black/20">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-slate-400">Taxa WIN informada</span>
              <TrendingUp className="h-4 w-4 text-purple-300" />
            </div>
            <p className="mt-3 text-2xl sm:text-3xl font-extrabold text-white tabular-nums">{winRate === null ? "—" : winRate + "%"}</p>
            <p className="mt-1 text-[11px] text-slate-400">{historyStats.rated} operações marcadas manualmente</p>
          </div>
        </section>
        {activeTab === "monitor" && (
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 lg:gap-6">
            {/* Left Column: Configuration & Live Controls */}
            <div className="xl:col-span-4 space-y-5">
              <div className="bg-[#111624] border border-white/10 rounded-3xl p-5 sm:p-6 shadow-2xl shadow-black/25 space-y-4">
                <h2 className="text-sm font-semibold text-purple-400 uppercase tracking-wider flex items-center space-x-2">
                  <Settings className="w-4 h-4" />
                  <span>CONFIGURAÇÃO DE OPERAÇÃO</span>
                </h2>

                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Tipo de operação</label>
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      {(["BINARIA", "DIGITAL"] as const).map(mode => (
                        <button key={mode} type="button" onClick={() => setOptionMode(mode)}
                          className={`rounded-xl border px-3 py-3 text-sm font-semibold ${optionMode === mode
                            ? "border-purple-400 bg-purple-700/40 text-white"
                            : "border-slate-700 bg-[#181d2a] text-slate-400"}`}>
                          {mode === "BINARIA" ? "Binárias" : "Digitais"}
                        </button>
                      ))}
                    </div>
                    <label className="text-xs text-slate-400 block mb-1">Mercado do gráfico</label>
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      {([{value:"OTC",label:"OTC"},{value:"REGULAR",label:"Mercado normal"}] as const).map(market => (
                        <button key={market.value} type="button" onClick={() => changeMarket(market.value)}
                          className={`rounded-xl border px-3 py-3 text-sm font-semibold ${marketType === market.value
                            ? "border-orange-400 bg-orange-800/30 text-white" : "border-slate-700 bg-[#181d2a] text-slate-400"}`}>{market.label}</button>
                      ))}
                    </div>
                    <label className="text-xs text-slate-400 block mb-1">Ativo do gráfico (mesmo da corretora)</label>
                    <select
                      value={selectedAsset}
                      onChange={(e) => changeAsset(e.target.value)}
                      className="w-full bg-[#181d2a] border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-purple-500"
                    >
                      <optgroup label={marketType === "OTC" ? "Pares OTC" : "Pares do mercado normal"}>
                        {(marketType === "OTC" ? OTC_ASSETS : REGULAR_ASSETS).map(asset => <option key={asset} value={asset}>{asset}</option>)}
                      </optgroup>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Ou Ativo Personalizado</label>
                    <input
                      type="text"
                      placeholder="Outro ativo, exatamente como aparece na Safirion"
                      value={customAsset}
                      onChange={(e) => changeCustomAsset(e.target.value)}
                      className="w-full bg-[#181d2a] border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-purple-500"
                    />
                  </div>

                  <p className="text-[11px] leading-relaxed text-amber-200/90">
                    {marketType === "REGULAR"
                      ? "Mercado normal selecionado para teste na demo. Confira se o ativo está aberto e corresponde ao gráfico da corretora."
                      : "Mercado OTC selecionado. As cotações podem seguir regras específicas da plataforma."}
                    {" "}A lista é manual e não garante disponibilidade na Safirion. O app não realiza ordens.
                    <span className="block mt-1 text-purple-200">Você pode trocar de mercado ou ativo a qualquer momento. Se houver monitoramento ativo, ele será interrompido automaticamente para evitar sinais do gráfico anterior; depois clique em Iniciar Monitoramento novamente.</span>
                  </p>

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
                      className="w-full bg-gradient-to-r from-violet-600 to-orange-500 hover:from-violet-500 hover:to-orange-400 text-white font-bold py-3 px-4 rounded-2xl shadow-lg shadow-orange-600/20 flex items-center justify-center space-x-2 transition-all cursor-pointer"
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
            <div className="xl:col-span-8 space-y-5">
              {/* Live Video Preview Card */}
              <div className="bg-[#111624] border border-white/10 rounded-3xl p-5 sm:p-6 shadow-2xl shadow-black/25 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center space-x-2">
                    <div className={`w-3 h-3 rounded-full ${isMonitoring && !isPaused ? "bg-green-500 animate-ping" : "bg-slate-600"}`} />
                    <h2 className="text-sm font-semibold text-slate-200">GRÁFICO MONITORADO • SAFIRION</h2>
                  </div>
                  <div className="text-xs text-slate-400 flex items-center space-x-3 flex-wrap">
                    <span>{lastCaptureTime ? `Captura: ${lastCaptureTime}` : "Aguardando..."}</span>
                    <span>{lastAnalysisTime ? `Análise: ${lastAnalysisTime}` : ""}</span>
                    <span className="bg-slate-800 px-2.5 py-0.5 rounded text-purple-300 font-mono">Latência: {totalLatency}ms</span>
                  </div>
                </div>

                <div className="relative aspect-video bg-[#070a11] rounded-2xl border border-white/10 overflow-hidden flex items-center justify-center">
                  <video
                    ref={previewRef}
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
                <div className="bg-[#111624] border border-white/10 rounded-3xl p-5 sm:p-6 shadow-2xl shadow-black/25 space-y-3">
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
                <div className="bg-[#111624] border border-white/10 rounded-3xl p-5 sm:p-6 shadow-2xl shadow-black/25 space-y-3">
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
                        {currentGuardResult.technicalError ? "IA INDISPONÍVEL" : currentGuardResult.passed ? "APROVADO" : "BLOQUEADO"}
                      </span>
                    )}
                  </div>

                  {analysisError && <p className="mb-2 text-xs text-amber-300">Falha técnica: {analysisError}</p>}
                  {overloadUntil > nowEpoch && <p className="mb-2 text-xs text-amber-200">
                    API em pausa automática. Nova tentativa em {Math.ceil((overloadUntil - nowEpoch) / 1000)} segundos.
                  </p>}
                  {currentGuardResult?.technicalError ? (
                    <p className="text-xs text-amber-300 rounded-xl bg-amber-950/20 p-3">
                      Serviço de IA indisponível. Nenhuma verificação do gráfico foi concluída e nenhum sinal está liberado.
                    </p>
                  ) : currentGuardResult ? (
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
              {signalsHistory.filter((s) => isConfirmed(s) && s.decision !== "AGUARDAR").length === 0 ? (
                <div className="col-span-full bg-[#121620] border border-slate-800 rounded-2xl p-12 text-center space-y-3">
                  <Clock className="w-10 h-10 text-slate-600 mx-auto animate-spin" />
                  <p className="text-sm font-medium text-slate-300">Aguardando oportunidade de compra ou venda validada...</p>
                  <p className="text-xs text-slate-500">O Signal Guard está analisando o fluxo contínuo do gráfico.</p>
                </div>
              ) : (
                signalsHistory
                  .filter((s) => isConfirmed(s) && s.decision !== "AGUARDAR")
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

                      <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-800 text-xs">
                      <button type="button" onClick={() => markHistoryAction(signal.id, "TAKEN")}
                        className={`rounded-lg px-3 py-2 font-bold ${wasTaken(signal) ? "bg-purple-600 text-white" : "bg-slate-700 text-slate-200"}`}>✓ PEGUEI O SINAL</button>
                      <button type="button" onClick={() => markHistoryAction(signal.id, "IGNORED")}
                        className={`rounded-lg px-3 py-2 font-bold ${signal.tradeAction === "IGNORED" ? "bg-amber-600 text-black" : "bg-slate-700 text-slate-200"}`}>IGNORAR</button>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-xs">
                        <span className="text-slate-500">Resultado da Operação:</span>
                        <div className="flex space-x-1">
                          <button
                            disabled={!canRecordOutcome(signal)}
                            title="Marque PEGUEI antes de registrar WIN/LOSS."
                            onClick={() => updateHistoryResult(signal.id, "WIN")}
                            className={`px-2 py-1 rounded font-bold text-[10px] transition-all ${
                              signal.result === "WIN" ? "bg-green-600 text-white shadow" : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                            }`}
                          >
                            WIN
                          </button>
                          <button
                            disabled={!canRecordOutcome(signal)}
                            title="Marque PEGUEI antes de registrar WIN/LOSS."
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
                  Registros com data e hora, inclusive oportunidades sem confirmação. Somente sinais confirmados entram na aba inicial. Marque PEGUEI O SINAL ou IGNOREI; WIN e LOSS são manuais apenas para sinais que você pegou.
                  <span className="block text-amber-200/80 mt-1">Salvo neste navegador. Para guardar uma cópia ou analisar em outro dispositivo, exporte o CSV.</span>
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="bg-[#181d2a] px-4 py-2 rounded-xl border border-orange-500/25 text-center">
                  <span className="text-[10px] text-orange-200 block">Todos os sinais</span>
                  <span className="text-lg font-bold text-white">{historyStats.total}</span>
                </div>
                <div className="bg-[#181d2a] px-4 py-2 rounded-xl border border-green-500/25 text-center">
                  <span className="text-[10px] text-green-200 block">Confirmados</span>
                  <span className="text-lg font-bold text-green-300">{historyStats.confirmed}</span>
                </div>
                <div className="bg-[#181d2a] px-4 py-2 rounded-xl border border-amber-500/25 text-center">
                  <span className="text-[10px] text-amber-200 block">Sem confirmação</span>
                  <span className="text-lg font-bold text-amber-300">{historyStats.unconfirmed}</span>
                </div>
                <div className="bg-[#181d2a] px-4 py-2 rounded-xl border border-slate-700 text-center">
                  <span className="text-[10px] text-slate-400 block">WIN / LOSS marcados</span>
                  <span className="text-lg font-bold text-purple-300">{historyStats.wins} / {historyStats.losses}</span>
                </div>
                <div className="bg-[#181d2a] px-4 py-2 rounded-xl border border-orange-500/25 text-center">
                  <span className="text-[10px] text-slate-400 block">Taxa de acerto manual</span>
                  <span className="text-lg font-bold text-orange-300">{winRate !== null ? `${winRate}%` : "Sem dados"}</span>
                </div>
                <button type="button" onClick={exportHistoryCSV}
                  className="rounded-xl border border-orange-500/50 px-4 py-3 text-sm font-semibold text-orange-200 hover:bg-orange-950/30">
                  Exportar CSV
                </button>
              </div>
            </div>

            <section className="space-y-4 rounded-2xl border border-purple-500/25 bg-[#121620] p-4 sm:p-5" aria-label="Comparativo de desempenho">
              <div>
                <h3 className="text-base font-bold text-white">Comparativo por mercado e tipo de opção</h3>
                <p className="mt-1 text-xs text-slate-400">
                  Somente operações confirmadas, marcadas como PEGUEI e com WIN/LOSS informado. Sinais ignorados e sem confirmação não entram nas taxas.
                  Os resultados antigos permanecem salvos neste navegador.
                </p>
              </div>
              {([
                { title: "Mercado", rows: comparisons.markets },
                { title: "Tipo de opção", rows: comparisons.modes },
                { title: "Combinações", rows: comparisons.combinations }
              ]).map(group => (
                <div key={group.title} className="space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wide text-purple-300">{group.title}</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                    {group.rows.map(row => (
                      <div key={row.key} className="rounded-xl border border-white/10 bg-[#191e2e] p-3 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <strong className="text-xs text-slate-100">{row.label}</strong>
                          <span className="text-[11px] font-bold text-slate-200">{row.winRate === null ? "Sem resultados" : row.winRate.toFixed(1).replace(".", ",") + "% WIN"}</span>
                        </div>
                        <p className="text-[11px] text-slate-300">
                          <span className="text-green-300">{row.wins} WIN</span>
                          {" · "}
                          <span className="text-red-300">{row.losses} LOSS</span>
                          {" · "}{row.rated} operações
                        </p>
                        <div className="h-1.5 rounded-full bg-slate-700 overflow-hidden">
                          <div className="h-full bg-green-500" style={{width: (row.winRate ?? 0) + "%"}}/>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <p className="text-[11px] text-amber-200/80">
                Taxas descritivas, não previsões. Amostras pequenas não demonstram vantagem.
                Registros antigos sem tipo identificado aparecem como “Tipo não informado”; o mercado é inferido pelo nome OTC do ativo.
              </p>
            </section>

            <div className="flex flex-wrap gap-2 rounded-2xl bg-[#121620] p-3 border border-slate-800" role="group" aria-label="Filtrar histórico de sinais">
              {([{value:"CONFIRMED",label:"✅ Confirmados"}, {value:"UNCONFIRMED",label:"⚠️ Sem confirmação"}, {value:"ALL",label:"Todos"}] as const).map(filter => (
                <button key={filter.value} type="button" onClick={() => setHistoryView(filter.value)}
                  className={`rounded-xl px-4 py-2.5 text-sm font-bold ${historyView === filter.value ? "bg-purple-600 text-white" : "bg-[#1c2030] text-slate-300 hover:bg-slate-700"}`}>{filter.label}</button>
              ))}
              <span className="ml-auto text-xs text-slate-400 self-center">{visibleHistory.length} registros nesta visualização</span>
            </div>
            <div className="bg-[#121620] border border-slate-800/80 rounded-2xl overflow-hidden shadow-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#181d2a] border-b border-slate-800 text-slate-400 uppercase">
                    <tr>
                      <th className="p-3">Data e hora</th>
                      <th className="p-3">Ativo</th>
                      <th className="p-3">Período/Exp</th>
                      <th className="p-3">Decisão Bot</th>
                      <th className="p-3">Situação do sinal</th>
                      <th className="p-3">Latência</th>
                      <th className="p-3">Resultado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-slate-300">
                    {visibleHistory.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-6 text-center text-slate-500 italic">
                          Nenhum registro no histórico ainda. Inicie o monitoramento ao vivo.
                        </td>
                      </tr>
                    ) : (
                      visibleHistory.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-900/40 transition-colors">
                          <td className="p-3 font-mono text-slate-400 whitespace-nowrap">{formatRecordDate(item.timestamp)}</td>
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
                            <span className={`text-xs font-semibold ${isConfirmed(item) ? "text-green-400" :
                              item.status === "CANCELLED" ? "text-red-400" :
                              item.status === "PRE_ALERT" ? "text-orange-300" : "text-amber-300"}`}
                              title={item.reason}>
                              {isConfirmed(item) ? (item.tradeAction === "IGNORED" ? "CONFIRMADO · IGNORADO" : wasTaken(item) ? "CONFIRMADO · PEGUEI" : "CONFIRMADO · A DECIDIR") :
                                item.status === "CANCELLED" ? "CANCELADO" :
                                item.status === "PRE_ALERT" ? "PRÉ-ALERTA" : "SEM CONFIRMAÇÃO"}
                            </span>
                            <p className="max-w-[250px] text-[10px] text-slate-500 mt-1">{item.confirmedReason || item.reason}</p>
                          </td>
                          <td className="p-3 font-mono">{item.latencyMs}ms</td>
                          <td className="p-3">
                            {isConfirmed(item) ? <div className="flex flex-wrap gap-1 mb-2">
                              <button type="button" onClick={() => markHistoryAction(item.id, "TAKEN")}
                                className={`rounded px-2 py-1 text-[10px] font-bold ${wasTaken(item) ? "bg-purple-600 text-white" : "bg-slate-700 text-slate-200"}`}>PEGUEI</button>
                              <button type="button" onClick={() => markHistoryAction(item.id, "IGNORED")}
                                className={`rounded px-2 py-1 text-[10px] font-bold ${item.tradeAction === "IGNORED" ? "bg-amber-600 text-black" : "bg-slate-700 text-slate-200"}`}>IGNOREI</button>
                            </div> : <span className="text-amber-300 text-[10px] font-bold">NÃO ENTRAR · SEM RESULTADO</span>}
                            <div className="flex space-x-1">
                              <button
                                disabled={!canRecordOutcome(item)}
                                title={!canRecordOutcome(item) ? "Primeiro marque PEGUEI. Sinais ignorados ou sem confirmação não são operações." : "Registrar WIN manualmente."}
                                onClick={() => updateHistoryResult(item.id, "WIN")}
                                className={`px-2 py-0.5 rounded font-bold text-[10px] ${item.result === "WIN" ? "bg-green-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}
                              >
                                WIN
                              </button>
                              <button
                                disabled={!canRecordOutcome(item)}
                                title={!canRecordOutcome(item) ? "Primeiro marque PEGUEI. Sinais ignorados ou sem confirmação não são operações." : "Registrar LOSS manualmente."}
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

      {/* Compact popup on the lower-right: never treats a preview as an executed trade. */}
      {popupVisible && candidate && (
        <div role="alertdialog" aria-label="Alerta Tozzi Sinais IA" aria-live="assertive"
          className="fixed bottom-4 right-4 left-4 sm:left-auto sm:w-[370px] z-[100] rounded-2xl border border-purple-400/50 bg-[#121620] p-4 shadow-2xl shadow-purple-950/80">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <Bell className="w-5 h-5 text-purple-300" />
              <strong className="text-sm text-white">TOZZI SINAIS IA</strong>
            </div>
            <button type="button" onClick={() => setDismissedPopupKey(popupKey)}
              aria-label="Fechar notificação" className="rounded-lg p-1 text-slate-400 hover:bg-slate-700 hover:text-white">
              <XCircle className="w-5 h-5" />
            </button>
          </div>
          <div className={`mt-3 rounded-lg p-3 ${candidate.status === "CANCELLED" ? "bg-red-950/50 text-red-200" :
            candidate.status === "CONFIRMED" || candidate.status === "CLOSED" ? "bg-green-950/40 text-green-200" : "bg-amber-950/40 text-amber-200"}`}>
            <p className="text-sm font-bold">
              {candidate.status === "PRE_ALERT" ? "🔔 PRÉ-ALERTA — NÃO ENTRAR" :
                candidate.status === "CONFIRMED" ? "✅ SINAL RECONFIRMADO" :
                candidate.status === "CLOSED" ? "🕒 HORÁRIO ENCERRADO — RECONFIRMADO" :
                candidate.status === "UNVERIFIED" ? "⚠️ SEM CONFIRMAÇÃO — NÃO ENTRAR" :
                candidate.status === "EXPIRED" ? "🕒 PRÉ-ALERTA EXPIRADO" : "⛔ CANCELADO POR CONFLITO"}
            </p>
            <p className={`mt-2 rounded-lg border px-3 py-2 text-xl font-extrabold ${candidate.status === "CONFIRMED" || candidate.status === "CLOSED" ?
              (candidate.decision === "POSSÍVEL COMPRA" ? "border-green-500/60 bg-green-500/20 text-green-300" : "border-red-500/60 bg-red-500/20 text-red-300")
              : "border-amber-500/60 bg-amber-500/15 text-amber-300"}`}>{candidate.decision}</p>
            <p className="text-xs">{candidate.asset} · {candidate.timeframe} · Exp. {candidate.expiration}</p>
            <p className="mt-2 text-base font-semibold">Entrada prevista: {formatEntryTime(candidate.targetEpoch)}</p>
            <p className="text-xs mt-1">{candidate.targetEpoch > nowEpoch
              ? `Faltam ${Math.ceil((candidate.targetEpoch - nowEpoch) / 1000)} segundos`
              : "Horário previsto já alcançado"}</p>
          </div>
          <p className="my-3 text-xs text-slate-300">{candidate.reason}</p>
          {(candidate.status === "CONFIRMED" || candidate.status === "CLOSED") && (
            <div className="grid grid-cols-2 gap-2 mb-3">
              <button type="button" disabled={candidate.status !== "CONFIRMED" || candidate.targetEpoch <= nowEpoch}
                onClick={() => pickConfirmedSignal(candidate)}
                className={`rounded-xl px-3 py-3 text-xs font-extrabold ${currentSignal && wasTaken(currentSignal) ? "bg-purple-600 text-white ring-2 ring-purple-300" : "bg-green-700 text-white hover:bg-green-600"}`}>✓ PEGAR SINAL</button>
              <button type="button" onClick={() => { markSignalAction(candidate.targetEpoch, candidate.asset, "IGNORED"); setMiniCountdown(null); setDismissedPopupKey(popupKey); }}
                className={`rounded-xl px-3 py-3 text-xs font-extrabold ${currentSignal?.tradeAction === "IGNORED" ? "bg-amber-500 text-black" : "bg-slate-700 text-white hover:bg-slate-600"}`}>✕ IGNORAR</button>
            </div>
          )}
          {candidate.status === "CLOSED" && <p className="mb-3 text-xs font-bold text-amber-300">Horário já encerrado: não é possível pegar este sinal agora.</p>}
          {candidate.status === "PRE_ALERT" && <p className="mb-3 text-xs font-bold text-amber-300">Aguarde a reconfirmação. Ainda não é permitido pegar este sinal.</p>}
          {["UNVERIFIED","CANCELLED","EXPIRED"].includes(candidate.status) && <p className="mb-3 text-xs font-bold text-amber-300">Sem confirmação: não pode ser marcado como operação.</p>}
          <button type="button" onClick={() => { setActiveTab("alerts"); setDismissedPopupKey(popupKey); }}
            className="w-full rounded-xl bg-purple-600 hover:bg-purple-500 text-sm font-bold text-white p-3">
            Visualizar sinal
          </button>
          <p className="mt-2 text-[10px] text-slate-500">Aviso educativo; não executa ordens e não garante acerto.</p>
        </div>
      )}

      {/* Small countdown is informational, not a broker-synchronised entry trigger. */}
      {miniCountdown && (
        <div role="status" aria-live="off"
          className="fixed top-20 right-3 z-[105] w-[215px] rounded-2xl border border-purple-400/50 bg-[#111626]/95 p-3 shadow-2xl shadow-purple-950/70 backdrop-blur">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold text-purple-200">SINAL MARCADO · DEMO</span>
            <button type="button" onClick={() => setMiniCountdown(null)} aria-label="Fechar cronômetro"
              className="rounded p-1 text-slate-400 hover:text-white"><XCircle className="h-4 w-4"/></button>
          </div>
          <p className="mt-1 text-xs text-white font-semibold">{miniCountdown.asset} · {miniCountdown.timeframe}</p>
          <p className="text-[11px] text-slate-300">{miniCountdown.decision}</p>
          <p className={`mt-1 text-center font-mono text-4xl font-black tabular-nums ${nowEpoch >= miniCountdown.targetEpoch ? "text-amber-300" : "text-green-300"}`}>
            {nowEpoch >= miniCountdown.targetEpoch ? "00" : String(Math.ceil((miniCountdown.targetEpoch - nowEpoch)/1000)).padStart(2,"0")}
          </p>
          <p className="text-center text-[11px] text-slate-300">{nowEpoch >= miniCountdown.targetEpoch ? "HORÁRIO ALCANÇADO · NÃO ENTRE ATRASADA" : "Segundos até o horário previsto"}</p>
          <p className="mt-1 text-center text-[10px] text-amber-200">Relógio do dispositivo; confira a vela e a hora da corretora.</p>
        </div>
      )}

      {/* Footer */}
      <footer className="bg-[#121620] border-t border-slate-800/80 py-4 px-6 text-center text-xs text-slate-500">
        Tozzi Sinais IA PRO • 5 verificadores ativos + 2 em observação • Resultados registrados manualmente • Sem execução de operações.
      </footer>
    </div>
  );
}
