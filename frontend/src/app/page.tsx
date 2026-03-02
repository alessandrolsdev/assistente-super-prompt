"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  CheckCircle2,
  Copy,
  Check,
  Pencil,
  Cpu,
  Zap,
  Shield,
  AlertTriangle,
  ChevronRight,
  Clock,
  Download,
  PanelRight,
  PanelRightClose,
  Sparkles,
  Trophy,
  RotateCcw,
  FileText,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────
// TIPOS
// ─────────────────────────────────────────────────────────────
interface SubTarefaItem {
  titulo: string;
  descricao: string;
  complexidade: "baixa" | "media" | "alta";
}

interface TarefaQueue {
  id: string;
  titulo: string;
  descricao: string;
  complexidade: "baixa" | "media" | "alta";
  status: "aguardando" | "concluido";
  prompt?: string;
  score?: string;
  papel?: string;
}

interface DeteccaoData {
  papel_detectado: string;
  formato_detectado: string;
  papel_foi_editado: boolean;
}

interface PipelineData {
  etapa_triagem?: { modelo: string; resultado: string };
  etapa_0?: { modelo: string };
  etapa_1: { modelo: string };
  etapa_2: { modelo: string };
  etapa_3: { modelo: string };
  score_qualidade: string;
}

interface PromptResult {
  tipo_resposta: "prompt_gerado";
  prompt_otimizado: string;
  deteccao: DeteccaoData;
  pipeline: PipelineData;
}

interface PlanoResult {
  tipo_resposta: "plano_de_divisao";
  aviso: string;
  sub_tarefas: SubTarefaItem[];
  recomendacao: string;
}

type ResultData = PromptResult | PlanoResult;

// ─────────────────────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────────────────────
const LS_KEY = "prompt_architect_queue";
const CHARS = "01アイウエカキ∆∑∏∫≈≠∞";

const STAGES = [
  {
    icon: Shield,
    label: "Triando complexidade",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
  },
  {
    icon: Cpu,
    label: "Detectando papel técnico",
    color: "text-yellow-400",
    bg: "bg-yellow-500/10",
    border: "border-yellow-500/20",
  },
  {
    icon: Zap,
    label: "Analisando contexto",
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
  },
  {
    icon: Cpu,
    label: "Gerando super prompt",
    color: "text-lime-400",
    bg: "bg-lime-500/10",
    border: "border-lime-500/20",
  },
  {
    icon: Shield,
    label: "Validando e calculando score",
    color: "text-purple-400",
    bg: "bg-purple-500/10",
    border: "border-purple-500/20",
  },
];

const COMPLEXITY_COLOR: Record<string, string> = {
  baixa: "text-lime-400",
  media: "text-yellow-400",
  alta: "text-red-400",
};

// ─────────────────────────────────────────────────────────────
// PARTÍCULAS DE FUNDO
// ─────────────────────────────────────────────────────────────
function MatrixCol({ x, delay }: { x: number; delay: number }) {
  const col = Array.from(
    { length: 16 },
    () => CHARS[Math.floor(Math.random() * CHARS.length)],
  );
  return (
    <motion.div
      className="absolute top-0 flex flex-col items-center pointer-events-none"
      style={{ left: `${x}%` }}
      animate={{ opacity: [0, 0.12, 0], y: ["0%", "110%"] }}
      transition={{
        duration: 7 + Math.random() * 5,
        delay,
        repeat: Infinity,
        ease: "linear",
      }}
    >
      {col.map((c, i) => (
        <span
          key={i}
          className="text-[9px] font-mono leading-[14px]"
          style={{
            color: i < 2 ? "#a3e635" : "#15532e",
            opacity: 1 - i * 0.06,
          }}
        >
          {c}
        </span>
      ))}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────
// COMPONENTE: ITEM DA FILA (lateral)
// ─────────────────────────────────────────────────────────────
function QueueItem({
  tarefa,
  index,
  expanded,
  ativo,
  onClick,
  onDownload,
}: {
  tarefa: TarefaQueue;
  index: number;
  expanded: boolean;
  ativo: boolean;
  onClick: () => void;
  onDownload: () => void;
}) {
  const done = tarefa.status === "concluido";

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      onClick={onClick}
      className="relative cursor-pointer group"
    >
      {/* Linha conectora */}
      {index > 0 && (
        <div
          className="absolute left-[18px] -top-3 w-px h-3"
          style={{
            background: done ? "rgba(163,230,53,0.3)" : "rgba(63,63,70,0.4)",
          }}
        />
      )}

      <div
        className={`relative flex gap-3 p-3 rounded-xl border transition-all duration-200 ${
          ativo
            ? "border-lime-500/40 bg-lime-500/5"
            : done
              ? "border-zinc-800/40 bg-zinc-900/20"
              : "border-zinc-800/60 bg-zinc-900/40 hover:border-zinc-700/60"
        }`}
      >
        {/* Ícone de status */}
        <div className="shrink-0 mt-0.5">
          {done ? (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="w-6 h-6 rounded-full bg-lime-500/20 border border-lime-500/40 flex items-center justify-center"
            >
              <Check className="w-3 h-3 text-lime-400" />
            </motion.div>
          ) : ativo ? (
            <motion.div
              className="w-6 h-6 rounded-full bg-blue-500/20 border border-blue-500/40 flex items-center justify-center"
              animate={{
                boxShadow: [
                  "0 0 0 0 rgba(59,130,246,0.3)",
                  "0 0 0 6px rgba(59,130,246,0)",
                  "0 0 0 0 rgba(59,130,246,0)",
                ],
              }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <Zap className="w-3 h-3 text-blue-400" />
            </motion.div>
          ) : (
            <div className="w-6 h-6 rounded-full bg-zinc-800/60 border border-zinc-700/40 flex items-center justify-center">
              <Clock className="w-3 h-3 text-zinc-600" />
            </div>
          )}
        </div>

        {/* Conteúdo */}
        <div className="flex-1 min-w-0">
          {/* Título sempre visível */}
          <p
            className={`text-xs font-bold leading-tight transition-colors ${
              done
                ? "text-zinc-500 line-through"
                : ativo
                  ? "text-lime-300"
                  : "text-zinc-300 group-hover:text-zinc-100"
            }`}
          >
            {tarefa.titulo}
          </p>

          {/* Expandido: descrição + score */}
          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="pt-2 space-y-2">
                  {tarefa.descricao && (
                    <p className="mono text-[10px] text-zinc-600 leading-relaxed">
                      {tarefa.descricao}
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    <span
                      className={`mono text-[9px] uppercase tracking-wider ${COMPLEXITY_COLOR[tarefa.complexidade]}`}
                    >
                      ◆ {tarefa.complexidade}
                    </span>
                    {tarefa.score && (
                      <span className="mono text-[9px] text-zinc-600">
                        score:{" "}
                        <span className="text-lime-500">{tarefa.score}</span>
                      </span>
                    )}
                  </div>
                  {done && tarefa.prompt && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDownload();
                      }}
                      className="flex items-center gap-1 mono text-[9px] text-zinc-600 hover:text-lime-400 transition-colors mt-1"
                    >
                      <Download className="w-3 h-3" /> baixar prompt
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Retraído: status pill */}
          {!expanded && (
            <div className="flex items-center gap-1.5 mt-1">
              <span
                className={`mono text-[9px] ${done ? "text-zinc-600" : ativo ? "text-blue-400" : "text-zinc-700"}`}
              >
                {done ? "✓ concluído" : ativo ? "▶ gerando" : "○ aguardando"}
              </span>
            </div>
          )}
        </div>

        {/* Número */}
        <span className="mono text-[10px] text-zinc-700 shrink-0">
          {String(index + 1).padStart(2, "0")}
        </span>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────
// COMPONENTE: RESUMO FINAL
// ─────────────────────────────────────────────────────────────
function ResumoFinal({
  tarefas,
  onReset,
  onDownloadAll,
}: {
  tarefas: TarefaQueue[];
  onReset: () => void;
  onDownloadAll: () => void;
}) {
  const avgScore = Math.round(
    tarefas
      .filter((t) => t.score)
      .reduce((acc, t) => acc + parseInt(t.score ?? "0"), 0) /
      (tarefas.filter((t) => t.score).length || 1),
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-5"
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 rounded-2xl border border-lime-500/20 bg-lime-500/5">
        <Trophy className="w-6 h-6 text-lime-400 shrink-0" />
        <div>
          <p className="font-bold text-lime-300 text-sm">Pipeline concluído!</p>
          <p className="mono text-[11px] text-zinc-500">
            {tarefas.length} prompts gerados · score médio {avgScore}/100
          </p>
        </div>
      </div>

      {/* Cards dos prompts */}
      <div className="space-y-3">
        {tarefas.map((t, i) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07 }}
            className="p-4 rounded-xl border border-zinc-800/60 bg-zinc-900/40 space-y-2"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-0.5 flex-1">
                <p className="text-sm font-bold text-zinc-200">{t.titulo}</p>
                {t.papel && (
                  <p className="mono text-[10px] text-zinc-600">{t.papel}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {t.score && (
                  <span
                    className="mono text-xs font-black"
                    style={{
                      color:
                        parseInt(t.score) >= 85
                          ? "#a3e635"
                          : parseInt(t.score) >= 70
                            ? "#facc15"
                            : "#f87171",
                    }}
                  >
                    {t.score}
                  </span>
                )}
                <CheckCircle2 className="w-4 h-4 text-lime-500" />
              </div>
            </div>

            {/* Prévia do prompt */}
            {t.prompt && (
              <p className="mono text-[10px] text-zinc-600 leading-relaxed line-clamp-2">
                {t.prompt.slice(0, 120)}...
              </p>
            )}

            {/* Continuidade sugerida */}
            <div className="flex items-start gap-1.5 pt-1 border-t border-zinc-800/40">
              <Sparkles className="w-3 h-3 text-zinc-600 shrink-0 mt-0.5" />
              <p className="mono text-[10px] text-zinc-600">
                Próximo passo sugerido: integre com os prompts anteriores para
                construir o sistema completo.
              </p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Ações */}
      <div className="flex gap-3">
        <button
          onClick={onDownloadAll}
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border border-lime-500/30 bg-lime-500/5 text-lime-400 text-sm font-bold hover:bg-lime-500/10 transition-colors"
        >
          <Download className="w-4 h-4" /> Baixar todos
        </button>
        <button
          onClick={onReset}
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border border-zinc-700/40 bg-zinc-900/40 text-zinc-400 text-sm font-bold hover:bg-zinc-800/40 transition-colors"
        >
          <RotateCcw className="w-4 h-4" /> Novo projeto
        </button>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────
// COMPONENTE PRINCIPAL
// ─────────────────────────────────────────────────────────────
export default function Home() {
  const [ideia, setIdeia] = useState("");
  const [papelEditado, setPapelEditado] = useState("");
  const [editandoPapel, setEditandoPapel] = useState(false);
  const [resultado, setResultado] = useState<ResultData | null>(null);
  const [loading, setLoading] = useState(false);
  const [stageIndex, setStageIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const [queue, setQueue] = useState<TarefaQueue[]>([]);
  const [queueExpanded, setQueueExpanded] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tarefaAtivaId, setTarefaAtivaId] = useState<string | null>(null);
  const [mostrarResumo, setMostrarResumo] = useState(false);
  const [cols] = useState(() =>
    Array.from({ length: 22 }, (_, i) => ({ x: i * 4.7, delay: i * 0.35 })),
  );
  const inputRef = useRef<HTMLInputElement>(null);

  // ── LocalStorage ──────────────────────────────────────────
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) setQueue(JSON.parse(saved));
    } catch {}
  }, []);

  useEffect(() => {
    if (queue.length > 0) localStorage.setItem(LS_KEY, JSON.stringify(queue));
  }, [queue]);

  // ── Loading stages ────────────────────────────────────────
  useEffect(() => {
    if (!loading) return;
    const id = setInterval(
      () => setStageIndex((p) => Math.min(p + 1, STAGES.length - 1)),
      4200,
    );
    return () => clearInterval(id);
  }, [loading]);

  // ── Checar se todos concluídos ────────────────────────────
  useEffect(() => {
    if (queue.length > 0 && queue.every((t) => t.status === "concluido"))
      setMostrarResumo(true);
  }, [queue]);

  // ── Gerar prompt ──────────────────────────────────────────
  const gerarPrompt = useCallback(
    async (opts: {
      ideiaTexto: string;
      forcarSimples?: boolean;
      tarefaId?: string;
    }) => {
      const { ideiaTexto, forcarSimples = false, tarefaId } = opts;
      if (!ideiaTexto.trim()) return;

      setLoading(true);
      setResultado(null);
      setStageIndex(0);
      setMostrarResumo(false);
      if (tarefaId) setTarefaAtivaId(tarefaId);

      try {
        const body: Record<string, unknown> = {
          ideiaBruta: ideiaTexto,
          forcarSimples,
        };
        if (papelEditado.trim()) body.papel = papelEditado.trim();

        const res = await fetch("http://localhost:5117/api/prompt/gerar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data: ResultData = await res.json();
        setResultado(data);

        // Se gerou prompt com sucesso e tem tarefaId: marcar concluído na fila
        if (data.tipo_resposta === "prompt_gerado" && tarefaId) {
          setQueue((q) =>
            q.map((t) =>
              t.id === tarefaId
                ? {
                    ...t,
                    status: "concluido",
                    prompt: data.prompt_otimizado,
                    score: data.pipeline.score_qualidade,
                    papel: data.deteccao.papel_detectado,
                  }
                : t,
            ),
          );
          setSidebarOpen(true);
        }

        // Se retornou plano: adicionar sub-tarefas à fila (sem duplicar)
        if (data.tipo_resposta === "plano_de_divisao") {
          const novas = (data as PlanoResult).sub_tarefas
            .filter((s) => !queue.some((q) => q.titulo === s.titulo))
            .map((s, i) => ({
              id: `${Date.now()}_${i}`,
              titulo: s.titulo,
              descricao: s.descricao,
              complexidade: s.complexidade as TarefaQueue["complexidade"],
              status: "aguardando" as const,
            }));
          if (novas.length) {
            setQueue((q) => [...q, ...novas]);
            setSidebarOpen(true);
          }
        }
      } catch {
        alert("Erro ao conectar. A API C# está rodando?");
      } finally {
        setLoading(false);
        setTarefaAtivaId(null);
      }
    },
    [papelEditado, queue],
  );

  const handleSubTarefaClick = (tarefa: SubTarefaItem) => {
    // Procura na fila ou usa diretamente
    const naFila = queue.find((q) => q.titulo === tarefa.titulo);
    gerarPrompt({
      ideiaTexto:
        tarefa.titulo + (tarefa.descricao ? `: ${tarefa.descricao}` : ""),
      forcarSimples: true,
      tarefaId: naFila?.id,
    });
  };

  const handleQueueItemClick = (tarefa: TarefaQueue) => {
    if (tarefa.status === "concluido") return;
    gerarPrompt({
      ideiaTexto:
        tarefa.titulo + (tarefa.descricao ? `: ${tarefa.descricao}` : ""),
      forcarSimples: true,
      tarefaId: tarefa.id,
    });
  };

  const downloadPrompt = (tarefa: TarefaQueue) => {
    if (!tarefa.prompt) return;
    const blob = new Blob([tarefa.prompt], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `prompt_${tarefa.titulo.slice(0, 30).replace(/\s+/g, "_")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadAll = () => {
    const content = queue
      .filter((t) => t.prompt)
      .map(
        (t, i) =>
          `${"=".repeat(60)}\nPROMPT ${i + 1}: ${t.titulo}\nSCORE: ${t.score ?? "N/A"}\n${"=".repeat(60)}\n\n${t.prompt}\n\n`,
      )
      .join("\n");
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "todos_os_prompts.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  const resetQueue = () => {
    setQueue([]);
    setResultado(null);
    setMostrarResumo(false);
    setIdeia("");
    localStorage.removeItem(LS_KEY);
  };

  const copiar = () => {
    if (!resultado || resultado.tipo_resposta !== "prompt_gerado") return;
    navigator.clipboard.writeText(resultado.prompt_otimizado);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const promptResult =
    resultado?.tipo_resposta === "prompt_gerado"
      ? (resultado as PromptResult)
      : null;
  const planoResult =
    resultado?.tipo_resposta === "plano_de_divisao"
      ? (resultado as PlanoResult)
      : null;
  const scoreNum = parseInt(promptResult?.pipeline.score_qualidade ?? "0", 10);
  const scoreColor =
    scoreNum >= 85 ? "#a3e635" : scoreNum >= 70 ? "#facc15" : "#f87171";
  const queuePendente = queue.filter((t) => t.status === "aguardando");
  const queueConcluido = queue.filter((t) => t.status === "concluido");

  return (
    <div
      className="relative min-h-screen flex overflow-hidden"
      style={{ background: "#030712" }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
        *, *::before, *::after { font-family: 'Syne', sans-serif; box-sizing: border-box; }
        .mono { font-family: 'JetBrains Mono', monospace !important; }
        .bg-grid {
          background-image:
            linear-gradient(rgba(163,230,53,0.025) 1px, transparent 1px),
            linear-gradient(90deg, rgba(163,230,53,0.025) 1px, transparent 1px);
          background-size: 44px 44px;
        }
        .glow-input:focus { box-shadow: 0 0 0 1px rgba(163,230,53,0.35), 0 0 20px rgba(163,230,53,0.07); }
        .scanline::before {
          content:''; position:absolute; inset:0; pointer-events:none; z-index:1;
          background: repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.06) 2px,rgba(0,0,0,0.06) 4px);
        }
        @keyframes scoredash { from{stroke-dashoffset:226} to{stroke-dashoffset:var(--t)} }
        .score-ring { animation: scoredash 1.2s ease-out forwards; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(163,230,53,0.2); border-radius: 4px; }
      `}</style>

      {/* Fundo */}
      <div className="fixed inset-0 bg-grid pointer-events-none" />
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        {cols.map((c, i) => (
          <MatrixCol key={i} x={c.x} delay={c.delay} />
        ))}
      </div>
      <div
        className="fixed pointer-events-none"
        style={{
          width: 700,
          height: 700,
          borderRadius: "50%",
          top: "5%",
          left: "50%",
          transform: "translateX(-50%)",
          background:
            "radial-gradient(circle, rgba(163,230,53,0.05) 0%, transparent 65%)",
          filter: "blur(50px)",
        }}
      />

      {/* ── ÁREA PRINCIPAL ── */}
      <main
        className={`relative z-10 flex-1 flex flex-col items-center py-14 px-6 transition-all duration-300 ${sidebarOpen ? "mr-[340px]" : ""}`}
      >
        <div className="max-w-2xl w-full space-y-8">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-2"
          >
            <div className="flex items-center justify-between">
              <div className="mono text-xs text-lime-500 tracking-[0.25em] uppercase">
                v4.0 · Pipeline Neural
              </div>
              {queue.length > 0 && (
                <button
                  onClick={() => setSidebarOpen((o) => !o)}
                  className="flex items-center gap-1.5 mono text-[11px] text-zinc-500 hover:text-lime-400 transition-colors"
                >
                  {sidebarOpen ? (
                    <PanelRightClose className="w-4 h-4" />
                  ) : (
                    <PanelRight className="w-4 h-4" />
                  )}
                  <span>{queue.length} na fila</span>
                  {queuePendente.length > 0 && (
                    <span className="px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-[9px] font-bold">
                      {queuePendente.length}
                    </span>
                  )}
                </button>
              )}
            </div>
            <h1
              className="text-5xl md:text-6xl font-extrabold leading-none tracking-tighter"
              style={{
                background:
                  "linear-gradient(135deg,#fff 25%,#a3e635 65%,#4ade80)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              Prompt
              <br />
              <span
                style={{
                  WebkitTextFillColor: "transparent",
                  WebkitTextStroke: "1px rgba(163,230,53,0.4)",
                }}
              >
                Architect
              </span>
            </h1>
            <p className="text-zinc-500 text-sm max-w-xs leading-relaxed">
              Ideia bruta → pipeline de 4 agentes → super prompt. Complexo?
              Divide e conquista.
            </p>
          </motion.div>

          {/* Form */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-3"
          >
            {/* Papel */}
            <div
              className="flex items-center gap-3 px-4 py-3 rounded-xl border border-zinc-800/80 bg-zinc-900/50"
              style={{ minHeight: 50 }}
            >
              <span className="mono text-[10px] text-zinc-600 tracking-[0.2em] uppercase shrink-0">
                ROLE
              </span>
              {editandoPapel ? (
                <input
                  ref={inputRef}
                  value={papelEditado}
                  onChange={(e) => setPapelEditado(e.target.value)}
                  onBlur={() => setEditandoPapel(false)}
                  onKeyDown={(e) =>
                    e.key === "Enter" && setEditandoPapel(false)
                  }
                  placeholder="ex: Engenheiro Frontend Sênior em React 18 + Canvas API"
                  className="flex-1 bg-transparent outline-none text-sm text-zinc-200 placeholder:text-zinc-700"
                />
              ) : (
                <span
                  className={`flex-1 text-sm truncate ${
                    papelEditado
                      ? "text-lime-400 font-bold"
                      : promptResult?.deteccao.papel_detectado
                        ? "text-lime-400 font-bold"
                        : "text-zinc-600 italic"
                  }`}
                >
                  {papelEditado ||
                    promptResult?.deteccao.papel_detectado ||
                    "Detectado automaticamente ✦"}
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  setEditandoPapel(true);
                  setTimeout(() => inputRef.current?.focus(), 40);
                }}
                className="shrink-0 p-1.5 rounded-md hover:bg-zinc-800 transition-colors group"
              >
                <Pencil className="w-3 h-3 text-zinc-600 group-hover:text-lime-400 transition-colors" />
              </button>
            </div>

            {/* Textarea */}
            <div className="space-y-3">
              <div className="relative">
                <textarea
                  value={ideia}
                  onChange={(e) => setIdeia(e.target.value)}
                  placeholder="Descreva sua ideia, bagunçado mesmo. A IA organiza tudo..."
                  disabled={loading}
                  className="glow-input w-full h-48 p-5 bg-zinc-900/60 border border-zinc-800/80 rounded-2xl text-zinc-200 text-sm leading-relaxed placeholder:text-zinc-700 outline-none resize-none transition-all disabled:opacity-40"
                />
                <span className="absolute bottom-3 right-4 mono text-[10px] text-zinc-700">
                  {ideia.length}
                </span>
              </div>

              {/* Botão fora da textarea */}
              <motion.button
                onClick={() => gerarPrompt({ ideiaTexto: ideia })}
                disabled={loading || !ideia.trim()}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-sm disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                style={{
                  background: loading
                    ? "rgba(163,230,53,0.08)"
                    : "linear-gradient(135deg,#a3e635,#4ade80)",
                  color: loading ? "#a3e635" : "#030712",
                  border: loading ? "1px solid rgba(163,230,53,0.25)" : "none",
                }}
              >
                {loading ? (
                  <>
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{
                        duration: 1,
                        repeat: Infinity,
                        ease: "linear",
                      }}
                      className="w-4 h-4 rounded-full border-2 border-lime-500 border-t-transparent"
                    />
                    Processando
                  </>
                ) : (
                  <>
                    Gerar Prompt <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </motion.button>
            </div>
          </motion.div>

          {/* Loading stages */}
          <AnimatePresence>
            {loading && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="space-y-1.5"
              >
                {STAGES.map((s, i) => {
                  const Icon = s.icon;
                  const active = i === stageIndex,
                    done = i < stageIndex;
                  return (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{
                        opacity: done ? 0.35 : active ? 1 : 0.18,
                        x: 0,
                      }}
                      transition={{ delay: i * 0.04 }}
                      className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-all ${
                        active
                          ? `${s.bg} ${s.border} border`
                          : "border-transparent"
                      }`}
                    >
                      {done ? (
                        <CheckCircle2 className="w-4 h-4 text-lime-500 shrink-0" />
                      ) : (
                        <Icon
                          className={`w-4 h-4 shrink-0 ${active ? s.color : "text-zinc-700"} ${active ? "animate-pulse" : ""}`}
                        />
                      )}
                      <span
                        className={`mono text-xs ${active ? s.color : done ? "text-zinc-700 line-through" : "text-zinc-700"}`}
                      >
                        {s.label}
                      </span>
                      {active && (
                        <div className="ml-auto flex gap-1">
                          {[0, 1, 2].map((d) => (
                            <motion.div
                              key={d}
                              className="w-1 h-1 rounded-full bg-lime-500"
                              animate={{ opacity: [0.3, 1, 0.3] }}
                              transition={{
                                duration: 0.9,
                                repeat: Infinity,
                                delay: d * 0.2,
                              }}
                            />
                          ))}
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Resultado: plano de divisão */}
          <AnimatePresence>
            {planoResult && !loading && (
              <motion.div
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                className="space-y-3"
              >
                <div className="flex items-start gap-3 px-4 py-3.5 rounded-xl border border-amber-500/20 bg-amber-500/5">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-bold text-amber-300">
                      Ideia complexa detectada
                    </p>
                    <p className="mono text-[11px] text-zinc-500 mt-0.5">
                      {planoResult.aviso}
                    </p>
                  </div>
                </div>

                <p className="mono text-[11px] text-zinc-600 px-1">
                  Sub-tarefas adicionadas à fila lateral. Clique para gerar cada
                  prompt:
                </p>

                <div className="space-y-2">
                  {planoResult.sub_tarefas.map((t, i) => (
                    <motion.button
                      key={i}
                      onClick={() => handleSubTarefaClick(t)}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      whileHover={{ x: 3 }}
                      className="w-full text-left flex items-start gap-3 px-4 py-3 rounded-xl border transition-all group"
                      style={{
                        borderColor:
                          i === 0
                            ? "rgba(163,230,53,0.3)"
                            : "rgba(63,63,70,0.5)",
                        background:
                          i === 0
                            ? "rgba(163,230,53,0.04)"
                            : "rgba(9,9,11,0.5)",
                      }}
                    >
                      <span
                        className="mono text-[10px] shrink-0 px-1.5 py-0.5 rounded font-bold mt-0.5"
                        style={{
                          background:
                            i === 0
                              ? "rgba(163,230,53,0.15)"
                              : "rgba(63,63,70,0.4)",
                          color: i === 0 ? "#a3e635" : "#52525b",
                        }}
                      >
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <div className="flex-1 space-y-0.5">
                        <p className="text-sm text-zinc-300 group-hover:text-zinc-100 transition-colors font-medium">
                          {t.titulo}
                        </p>
                        {t.descricao && (
                          <p className="mono text-[10px] text-zinc-600">
                            {t.descricao}
                          </p>
                        )}
                        <span
                          className={`mono text-[9px] uppercase ${COMPLEXITY_COLOR[t.complexidade]}`}
                        >
                          ◆ {t.complexidade}
                        </span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-zinc-700 group-hover:text-lime-400 transition-colors shrink-0 mt-0.5" />
                    </motion.button>
                  ))}
                </div>

                {planoResult.recomendacao && (
                  <div className="flex gap-2 px-4 py-3 rounded-xl border border-lime-500/10 bg-lime-500/4">
                    <Zap className="w-3.5 h-3.5 text-lime-500 shrink-0 mt-0.5" />
                    <p className="mono text-[11px] text-zinc-500">
                      <span className="text-lime-400 font-bold">
                        Recomendação:{" "}
                      </span>
                      {planoResult.recomendacao}
                    </p>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Resultado: prompt gerado */}
          <AnimatePresence>
            {promptResult && !loading && !mostrarResumo && (
              <motion.div
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                className="space-y-3"
              >
                {/* Meta row */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2 px-4 py-3 rounded-xl border border-zinc-800/60 bg-zinc-900/40 space-y-1">
                    <span className="mono text-[10px] text-zinc-600 tracking-widest uppercase block">
                      Papel detectado
                    </span>
                    <span className="text-sm font-bold text-lime-400 leading-tight block">
                      {promptResult.deteccao.papel_detectado}
                    </span>
                    {promptResult.deteccao.papel_foi_editado && (
                      <span className="mono text-[10px] text-zinc-600">
                        ✎ editado por você
                      </span>
                    )}
                  </div>
                  <div className="px-4 py-3 rounded-xl border border-zinc-800/60 bg-zinc-900/40 flex flex-col items-center justify-center">
                    <span className="mono text-[9px] text-zinc-600 tracking-widest uppercase mb-1">
                      Score
                    </span>
                    <svg width="56" height="56" viewBox="0 0 80 80">
                      <circle
                        cx="40"
                        cy="40"
                        r="36"
                        fill="none"
                        stroke="#1f2937"
                        strokeWidth="6"
                      />
                      <circle
                        cx="40"
                        cy="40"
                        r="36"
                        fill="none"
                        stroke={scoreColor}
                        strokeWidth="6"
                        strokeLinecap="round"
                        strokeDasharray="226"
                        className="score-ring"
                        style={
                          {
                            transformOrigin: "center",
                            transform: "rotate(-90deg)",
                            "--t": `${226 - (226 * scoreNum) / 100}`,
                          } as React.CSSProperties
                        }
                      />
                      <text
                        x="40"
                        y="46"
                        textAnchor="middle"
                        fill={scoreColor}
                        fontSize="17"
                        fontWeight="800"
                        fontFamily="JetBrains Mono"
                      >
                        {promptResult.pipeline.score_qualidade}
                      </text>
                    </svg>
                  </div>
                </div>

                {/* Pipeline breadcrumb */}
                <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-zinc-800/60 bg-zinc-900/40 overflow-x-auto">
                  {[
                    {
                      l: "TRIAGE",
                      m: promptResult.pipeline.etapa_triagem?.modelo,
                      c: "text-amber-400",
                    },
                    {
                      l: "DETECT",
                      m: promptResult.pipeline.etapa_0?.modelo,
                      c: "text-yellow-400",
                    },
                    {
                      l: "ANALYSE",
                      m: promptResult.pipeline.etapa_1.modelo,
                      c: "text-blue-400",
                    },
                    {
                      l: "GENERATE",
                      m: promptResult.pipeline.etapa_2.modelo,
                      c: "text-lime-400",
                    },
                    {
                      l: "VALIDATE",
                      m: promptResult.pipeline.etapa_3.modelo,
                      c: "text-purple-400",
                    },
                  ].map((s, i) => (
                    <div key={i} className="flex items-center gap-1.5 shrink-0">
                      {i > 0 && (
                        <ArrowRight className="w-3 h-3 text-zinc-800" />
                      )}
                      <div>
                        <div
                          className={`mono text-[8px] tracking-widest ${s.c} uppercase`}
                        >
                          {s.l}
                        </div>
                        <div className="flex items-center gap-1">
                          <CheckCircle2 className={`w-2.5 h-2.5 ${s.c}`} />
                          <span className="mono text-[9px] text-zinc-500">
                            {s.m?.split("/")[1]?.split(":")[0] ?? "—"}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Output card */}
                <div
                  className="scanline relative rounded-2xl border border-zinc-800/60 overflow-hidden"
                  style={{
                    background: "linear-gradient(135deg,#080d08,#030712)",
                  }}
                >
                  <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800/60">
                    <div className="flex items-center gap-2">
                      <motion.div
                        className="w-2 h-2 rounded-full bg-lime-500"
                        animate={{ opacity: [1, 0.3, 1] }}
                        transition={{ duration: 2, repeat: Infinity }}
                      />
                      <span className="mono text-[11px] text-zinc-500 tracking-widest uppercase">
                        Super Prompt
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          const t = promptResult;
                          const blob = new Blob([t.prompt_otimizado], {
                            type: "text/plain",
                          });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = "prompt.txt";
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                        className="flex items-center gap-1 mono text-[10px] text-zinc-600 hover:text-lime-400 transition-colors px-2 py-1.5 rounded-lg border border-transparent hover:border-zinc-800"
                      >
                        <Download className="w-3 h-3" /> baixar
                      </button>
                      <motion.button
                        onClick={copiar}
                        whileTap={{ scale: 0.94 }}
                        className="flex items-center gap-1.5 mono text-[10px] px-3 py-1.5 rounded-lg border transition-all"
                        style={{
                          borderColor: copied
                            ? "rgba(163,230,53,0.4)"
                            : "rgba(63,63,70,0.5)",
                          color: copied ? "#a3e635" : "#71717a",
                          background: copied
                            ? "rgba(163,230,53,0.05)"
                            : "transparent",
                        }}
                      >
                        {copied ? (
                          <Check className="w-3 h-3" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                        {copied ? "COPIADO" : "COPIAR"}
                      </motion.button>
                    </div>
                  </div>
                  <div className="relative z-10 p-5 max-h-[460px] overflow-y-auto">
                    <pre className="mono text-xs text-zinc-300 leading-[1.7] whitespace-pre-wrap break-words">
                      {promptResult.prompt_otimizado}
                    </pre>
                  </div>
                  <div
                    className="absolute bottom-0 left-0 right-0 h-10 pointer-events-none"
                    style={{
                      background: "linear-gradient(to top,#030712,transparent)",
                    }}
                  />
                </div>

                <p className="mono text-[10px] text-zinc-700 text-center">
                  formato ·{" "}
                  <span className="text-zinc-500">
                    {promptResult.deteccao.formato_detectado}
                  </span>
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Resumo final */}
          <AnimatePresence>
            {mostrarResumo && !loading && (
              <ResumoFinal
                tarefas={queue}
                onReset={resetQueue}
                onDownloadAll={downloadAll}
              />
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* ── SIDEBAR: FILA DE TAREFAS ── */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.aside
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", damping: 28, stiffness: 260 }}
            className="fixed right-0 top-0 bottom-0 w-[320px] z-20 flex flex-col border-l border-zinc-800/60"
            style={{
              background: "rgba(3,7,18,0.97)",
              backdropFilter: "blur(20px)",
            }}
          >
            {/* Header sidebar */}
            <div className="flex items-center justify-between px-4 py-4 border-b border-zinc-800/60">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-lime-500" />
                <span className="text-sm font-bold text-zinc-200">
                  Fila de Prompts
                </span>
                <span className="mono text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-800 text-zinc-500">
                  {queue.length}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setQueueExpanded((e) => !e)}
                  className="mono text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors px-2 py-1 rounded-lg border border-zinc-800 hover:border-zinc-700"
                >
                  {queueExpanded ? "retrair" : "expandir"}
                </button>
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-zinc-800 transition-colors text-zinc-600 hover:text-zinc-300"
                >
                  <PanelRightClose className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Stats */}
            <div className="flex gap-0 border-b border-zinc-800/60">
              <div className="flex-1 px-4 py-2.5 border-r border-zinc-800/40">
                <div className="mono text-[9px] text-zinc-600 uppercase tracking-wider">
                  Concluídos
                </div>
                <div className="text-lg font-black text-lime-400">
                  {queueConcluido.length}
                </div>
              </div>
              <div className="flex-1 px-4 py-2.5">
                <div className="mono text-[9px] text-zinc-600 uppercase tracking-wider">
                  Aguardando
                </div>
                <div className="text-lg font-black text-amber-400">
                  {queuePendente.length}
                </div>
              </div>
            </div>

            {/* Lista */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {queue.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-center">
                  <Clock className="w-6 h-6 text-zinc-700 mb-2" />
                  <p className="mono text-xs text-zinc-700">
                    Nenhuma tarefa na fila
                  </p>
                </div>
              ) : (
                queue.map((tarefa, i) => (
                  <QueueItem
                    key={tarefa.id}
                    tarefa={tarefa}
                    index={i}
                    expanded={queueExpanded}
                    ativo={tarefa.id === tarefaAtivaId}
                    onClick={() => handleQueueItemClick(tarefa)}
                    onDownload={() => downloadPrompt(tarefa)}
                  />
                ))
              )}
            </div>

            {/* Footer sidebar */}
            {queue.length > 0 && (
              <div className="p-3 border-t border-zinc-800/60 space-y-2">
                {queuePendente.length > 0 && (
                  <button
                    onClick={() => handleQueueItemClick(queuePendente[0])}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-sm transition-all"
                    style={{
                      background: "linear-gradient(135deg,#a3e635,#4ade80)",
                      color: "#030712",
                    }}
                  >
                    <Zap className="w-4 h-4" />
                    Gerar próximo
                  </button>
                )}
                <button
                  onClick={resetQueue}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs text-zinc-600 hover:text-zinc-400 transition-colors border border-zinc-800/40 hover:border-zinc-700/40"
                >
                  <RotateCcw className="w-3 h-3" /> Limpar fila
                </button>
              </div>
            )}
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}
