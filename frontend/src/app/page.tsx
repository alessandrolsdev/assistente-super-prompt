"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence, Reorder } from "framer-motion";
import {
  ArrowRight, CheckCircle2, Copy, Check, Pencil, Cpu, Zap, Shield,
  AlertTriangle, ChevronRight, Clock, Download, PanelRight, PanelRightClose,
  Sparkles, Trophy, RotateCcw, FileText, GripVertical, Trash2,
  RefreshCw, MessageSquare, X, Send, ChevronDown, ChevronUp, FolderOpen
} from "lucide-react";

// ─────────────────────────────────────────────────────────────
// TIPOS
// ─────────────────────────────────────────────────────────────
type AppState = "home" | "clarificando" | "projeto";

interface PerguntaClarificacao {
  id: string;
  texto: string;
  opcoes: string[];
  livre: boolean;
}

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
  status: "aguardando" | "gerando" | "concluido";
  prompt?: string;
  score?: string;
  papel?: string;
  historico?: { prompt: string; score: string; instrucao: string }[];
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
  tipo_resposta: "prompt_gerado" | "prompt_melhorado";
  prompt_otimizado: string;
  deteccao?: DeteccaoData;
  pipeline: PipelineData;
}

interface PlanoResult {
  tipo_resposta: "plano_de_divisao";
  aviso: string;
  sub_tarefas: SubTarefaItem[];
  recomendacao: string;
}

interface ClarificacaoResult {
  tipo_resposta: "clarificacao_necessaria";
  perguntas: PerguntaClarificacao[];
}

type ResultData = PromptResult | PlanoResult | ClarificacaoResult;

// ─────────────────────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────────────────────
const LS_KEY_QUEUE    = "pa_queue_v6";
const LS_KEY_PROJETO  = "pa_projeto_v6";
const CHARS = "01アイウエカキ∆∑∏∫≈≠∞";
const API   = "http://localhost:5117/api/prompt";

const STAGES = [
  { icon: Shield, label: "Verificando ambiguidades",      color: "text-rose-400",   bg: "bg-rose-500/10",   border: "border-rose-500/20"   },
  { icon: Shield, label: "Triando complexidade",          color: "text-amber-400",  bg: "bg-amber-500/10",  border: "border-amber-500/20"  },
  { icon: Cpu,    label: "Detectando papel técnico",      color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/20" },
  { icon: Zap,    label: "Analisando contexto",           color: "text-blue-400",   bg: "bg-blue-500/10",   border: "border-blue-500/20"   },
  { icon: Cpu,    label: "Gerando super prompt",          color: "text-lime-400",   bg: "bg-lime-500/10",   border: "border-lime-500/20"   },
  { icon: Shield, label: "Validando e calculando score",  color: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/20" },
];

const COMPLEXITY_STYLE: Record<string, { color: string; bg: string }> = {
  baixa: { color: "text-lime-400",   bg: "bg-lime-500/10"   },
  media: { color: "text-yellow-400", bg: "bg-yellow-500/10" },
  alta:  { color: "text-red-400",    bg: "bg-red-500/10"    },
};

// ─────────────────────────────────────────────────────────────
// PARTÍCULAS
// ─────────────────────────────────────────────────────────────
function MatrixCol({ x, delay }: { x: number; delay: number }) {
  const col = Array.from({ length: 14 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]);
  return (
    <motion.div className="absolute top-0 flex flex-col items-center pointer-events-none"
      style={{ left: `${x}%` }}
      animate={{ opacity: [0, 0.1, 0], y: ["0%", "110%"] }}
      transition={{ duration: 8 + Math.random() * 5, delay, repeat: Infinity, ease: "linear" }}>
      {col.map((c, i) => (
        <span key={i} className="text-[9px] font-mono leading-[13px]"
          style={{ color: i < 2 ? "#a3e635" : "#14532d", opacity: 1 - i * 0.07 }}>{c}</span>
      ))}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────
// COMPONENTE: PERGUNTAS DE CLARIFICAÇÃO
// ─────────────────────────────────────────────────────────────
function ClarificacaoWidget({
  perguntas, onResponder, onPular
}: {
  perguntas: PerguntaClarificacao[];
  onResponder: (respostas: Record<string, string>) => void;
  onPular: () => void;
}) {
  const [respostas, setRespostas] = useState<Record<string, string>>({});

  const setResposta = (id: string, valor: string) =>
    setRespostas(r => ({ ...r, [id]: valor }));

  const todasRespondidas = perguntas.every(p => respostas[p.id]);

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }} className="space-y-4">

      <div className="flex items-start gap-3 px-4 py-3.5 rounded-xl border border-rose-500/20 bg-rose-500/5">
        <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-bold text-rose-300">Ambiguidade detectada</p>
          <p className="mono text-[11px] text-zinc-500 mt-0.5 leading-relaxed">
            Antes de gerar, preciso de algumas informações para evitar erros de interpretação.
          </p>
        </div>
      </div>

      {perguntas.map((p, pi) => (
        <motion.div key={p.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
          transition={{ delay: pi * 0.08 }}
          className="space-y-2.5 p-4 rounded-xl border border-zinc-800/60 bg-zinc-900/50">

          <p className="text-sm font-bold text-zinc-200 leading-relaxed">{p.texto}</p>

          {/* Opções clicáveis */}
          <div className="flex flex-wrap gap-2">
            {p.opcoes.map((op, oi) => (
              <button key={oi} onClick={() => setResposta(p.id, op)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all border"
                style={{
                  borderColor: respostas[p.id] === op ? "rgba(163,230,53,0.5)" : "rgba(63,63,70,0.6)",
                  background:  respostas[p.id] === op ? "rgba(163,230,53,0.1)" : "rgba(9,9,11,0.5)",
                  color:       respostas[p.id] === op ? "#a3e635" : "#a1a1aa",
                }}>
                {op}
              </button>
            ))}
          </div>

          {/* Campo livre */}
          {p.livre && (
            <input value={respostas[p.id] && !p.opcoes.includes(respostas[p.id]) ? respostas[p.id] : ""}
              onChange={e => setResposta(p.id, e.target.value)}
              placeholder="Ou descreva com suas palavras..."
              className="w-full bg-zinc-950 border border-zinc-800/80 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-700 outline-none focus:border-lime-500/30 transition-colors" />
          )}
        </motion.div>
      ))}

      <div className="flex gap-3">
        <motion.button onClick={() => onResponder(respostas)} disabled={!todasRespondidas}
          whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          style={{ background: "linear-gradient(135deg,#a3e635,#4ade80)", color: "#030712" }}>
          <Send className="w-4 h-4" /> Confirmar e gerar
        </motion.button>
        <button onClick={onPular}
          className="px-4 py-3 rounded-xl text-xs text-zinc-600 hover:text-zinc-400 border border-zinc-800 hover:border-zinc-700 transition-colors">
          Pular
        </button>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────
// COMPONENTE: ITEM DO TO-DO LIST (com drag, editar, regerar, deletar)
// ─────────────────────────────────────────────────────────────
function TodoItem({
  tarefa, index, ativo, expanded, onToggleExpand,
  onEditar, onRegerar, onDeletar, onDownload, onGerar
}: {
  tarefa: TarefaQueue; index: number; ativo: boolean; expanded: boolean;
  onToggleExpand: () => void;
  onEditar: (titulo: string, descricao: string) => void;
  onRegerar: (instrucao: string) => void;
  onDeletar: () => void;
  onDownload: () => void;
  onGerar: () => void;
}) {
  const [editando, setEditando]           = useState(false);
  const [tituloEdit, setTituloEdit]       = useState(tarefa.titulo);
  const [descEdit, setDescEdit]           = useState(tarefa.descricao);
  const [mostrarRegerar, setMostrarRegerar] = useState(false);
  const [instrucaoRegerar, setInstrucaoRegerar] = useState("");

  const done    = tarefa.status === "concluido";
  const gerando = tarefa.status === "gerando";
  const cs      = COMPLEXITY_STYLE[tarefa.complexidade] ?? COMPLEXITY_STYLE.media;

  const salvarEdicao = () => {
    onEditar(tituloEdit, descEdit);
    setEditando(false);
  };

  const enviarRegerar = () => {
    if (!instrucaoRegerar.trim()) return;
    onRegerar(instrucaoRegerar);
    setInstrucaoRegerar("");
    setMostrarRegerar(false);
  };

  return (
    <div className={`relative rounded-xl border transition-all duration-200 ${
      ativo ? "border-lime-500/40 bg-lime-500/5"
      : done ? "border-zinc-800/30 bg-zinc-900/20"
      : "border-zinc-800/60 bg-zinc-900/40"}`}>

      {/* Header do item */}
      <div className="flex items-start gap-2.5 p-3">
        {/* Drag handle */}
        <div className="shrink-0 mt-1 cursor-grab active:cursor-grabbing text-zinc-700 hover:text-zinc-500 transition-colors">
          <GripVertical className="w-4 h-4" />
        </div>

        {/* Status icon */}
        <div className="shrink-0 mt-0.5">
          {done ? (
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}
              className="w-5 h-5 rounded-full bg-lime-500/20 border border-lime-500/40 flex items-center justify-center">
              <Check className="w-3 h-3 text-lime-400" />
            </motion.div>
          ) : gerando ? (
            <motion.div className="w-5 h-5 rounded-full border-2 border-blue-500 border-t-transparent"
              animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} />
          ) : (
            <div className="w-5 h-5 rounded-full bg-zinc-800/60 border border-zinc-700/40 flex items-center justify-center">
              <Clock className="w-3 h-3 text-zinc-600" />
            </div>
          )}
        </div>

        {/* Conteúdo */}
        <div className="flex-1 min-w-0">
          {editando ? (
            <div className="space-y-2">
              <input value={tituloEdit} onChange={e => setTituloEdit(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-lime-500/40" />
              <textarea value={descEdit} onChange={e => setDescEdit(e.target.value)}
                rows={2}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-400 outline-none resize-none focus:border-lime-500/40" />
              <div className="flex gap-2">
                <button onClick={salvarEdicao}
                  className="px-3 py-1 rounded-lg bg-lime-500/10 border border-lime-500/30 text-lime-400 text-xs font-bold">Salvar</button>
                <button onClick={() => setEditando(false)}
                  className="px-3 py-1 rounded-lg text-zinc-600 text-xs border border-zinc-800">Cancelar</button>
              </div>
            </div>
          ) : (
            <>
              <p className={`text-xs font-bold leading-tight ${
                done ? "text-zinc-500 line-through" : ativo ? "text-lime-300" : "text-zinc-200"}`}>
                {tarefa.titulo}
              </p>
              {expanded && tarefa.descricao && (
                <p className="mono text-[10px] text-zinc-600 leading-relaxed mt-1">{tarefa.descricao}</p>
              )}
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <span className={`mono text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${cs.color} ${cs.bg}`}>
                  {tarefa.complexidade}
                </span>
                {tarefa.score && (
                  <span className="mono text-[9px] text-zinc-600">
                    score <span style={{ color: parseInt(tarefa.score) >= 85 ? "#a3e635" : parseInt(tarefa.score) >= 70 ? "#facc15" : "#f87171" }}>
                      {tarefa.score}
                    </span>
                  </span>
                )}
                {!done && !gerando && (
                  <button onClick={onGerar}
                    className="mono text-[9px] text-blue-400 hover:text-blue-300 transition-colors border border-blue-500/20 px-1.5 py-0.5 rounded">
                    ▶ gerar
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {/* Ações */}
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onToggleExpand} className="p-1 rounded hover:bg-zinc-800 transition-colors text-zinc-600 hover:text-zinc-400">
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          {!editando && (
            <button onClick={() => setEditando(true)} className="p-1 rounded hover:bg-zinc-800 transition-colors text-zinc-600 hover:text-lime-400">
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
          {done && (
            <>
              <button onClick={() => setMostrarRegerar(r => !r)} className="p-1 rounded hover:bg-zinc-800 transition-colors text-zinc-600 hover:text-blue-400">
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <button onClick={onDownload} className="p-1 rounded hover:bg-zinc-800 transition-colors text-zinc-600 hover:text-lime-400">
                <Download className="w-3.5 h-3.5" />
              </button>
            </>
          )}
          <button onClick={onDeletar} className="p-1 rounded hover:bg-zinc-800 transition-colors text-zinc-600 hover:text-red-400">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Painel de regerar */}
      <AnimatePresence>
        {mostrarRegerar && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }} className="overflow-hidden border-t border-zinc-800/60">
            <div className="p-3 space-y-2">
              <p className="mono text-[10px] text-zinc-500">O que não agradou? Como melhorar?</p>
              <div className="flex gap-2">
                <input value={instrucaoRegerar} onChange={e => setInstrucaoRegerar(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && enviarRegerar()}
                  placeholder="ex: o papel ficou genérico, quero mais foco em acessibilidade..."
                  className="flex-1 bg-zinc-950 border border-zinc-700/60 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-700 outline-none focus:border-blue-500/30 transition-colors" />
                <button onClick={enviarRegerar} disabled={!instrucaoRegerar.trim()}
                  className="px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-bold disabled:opacity-30 hover:bg-blue-500/20 transition-colors">
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
              {tarefa.historico && tarefa.historico.length > 0 && (
                <p className="mono text-[9px] text-zinc-700">
                  {tarefa.historico.length} versão(ões) anterior(es) salva(s)
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// COMPONENTE: PÁGINA DE PROJETO (substitui home quando complexo)
// ─────────────────────────────────────────────────────────────
function PaginaProjeto({
  ideiaProjeto, queue, setQueue, onVoltar
}: {
  ideiaProjeto: string;
  queue: TarefaQueue[];
  setQueue: React.Dispatch<React.SetStateAction<TarefaQueue[]>>;
  onVoltar: () => void;
}) {
  const [tarefaAtivaId, setTarefaAtivaId]     = useState<string | null>(null);
  const [expandedIds, setExpandedIds]         = useState<Set<string>>(new Set());
  const [promptAtivo, setPromptAtivo]         = useState<string | null>(null);
  const [tarefaPromptId, setTarefaPromptId]   = useState<string | null>(null);
  const [loading, setLoading]                 = useState(false);
  const [stageIndex, setStageIndex]           = useState(0);
  const [chatMsgs, setChatMsgs]               = useState<{ role: "user"|"ia"; texto: string }[]>([]);
  const [chatInput, setChatInput]             = useState("");
  const chatRef = useRef<HTMLDivElement>(null);

  // Scroll chat
  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [chatMsgs]);

  // Loading stages
  useEffect(() => {
    if (!loading) return;
    const id = setInterval(() => setStageIndex(p => Math.min(p + 1, STAGES.length - 1)), 4000);
    return () => clearInterval(id);
  }, [loading]);

  const toggleExpand = (id: string) =>
    setExpandedIds(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const gerarTarefa = useCallback(async (tarefa: TarefaQueue) => {
    setLoading(true);
    setStageIndex(0);
    setTarefaAtivaId(tarefa.id);
    setQueue(q => q.map(t => t.id === tarefa.id ? { ...t, status: "gerando" } : t));

    try {
      const res  = await fetch(`${API}/gerar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ideiaBruta: `${tarefa.titulo}: ${tarefa.descricao}`, forcarSimples: true }),
      });
      const data = await res.json();

      if (data.tipo_resposta === "prompt_gerado") {
        setQueue(q => q.map(t => t.id === tarefa.id ? {
          ...t, status: "concluido",
          prompt: data.prompt_otimizado,
          score:  data.pipeline.score_qualidade,
          papel:  data.deteccao?.papel_detectado,
        } : t));
        setPromptAtivo(data.prompt_otimizado);
        setTarefaPromptId(tarefa.id);
        setChatMsgs(m => [...m, {
          role: "ia",
          texto: `✓ Prompt gerado para "${tarefa.titulo}" com score ${data.pipeline.score_qualidade}. Clique no item para ver ou baixar.`
        }]);
      }
    } catch {
      setQueue(q => q.map(t => t.id === tarefa.id ? { ...t, status: "aguardando" } : t));
    } finally {
      setLoading(false);
      setTarefaAtivaId(null);
    }
  }, [setQueue]);

  const regerarTarefa = useCallback(async (tarefa: TarefaQueue, instrucao: string) => {
    if (!tarefa.prompt) return;
    setLoading(true);
    setStageIndex(3);
    setTarefaAtivaId(tarefa.id);
    setQueue(q => q.map(t => t.id === tarefa.id ? { ...t, status: "gerando" } : t));

    try {
      const res  = await fetch(`${API}/regerar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promptAtual: tarefa.prompt,
          instrucaoMelhora: instrucao,
          papel: tarefa.papel,
        }),
      });
      const data = await res.json();

      if (data.prompt_otimizado) {
        setQueue(q => q.map(t => t.id === tarefa.id ? {
          ...t, status: "concluido",
          historico: [...(t.historico ?? []), { prompt: t.prompt!, score: t.score!, instrucao }],
          prompt: data.prompt_otimizado,
          score:  data.pipeline.score_qualidade,
        } : t));
        setPromptAtivo(data.prompt_otimizado);
        setChatMsgs(m => [...m, {
          role: "ia",
          texto: `✓ Prompt de "${tarefa.titulo}" regerado com score ${data.pipeline.score_qualidade}. Melhoria: "${instrucao}"`
        }]);
      }
    } catch {
      setQueue(q => q.map(t => t.id === tarefa.id ? { ...t, status: "concluido" } : t));
    } finally {
      setLoading(false);
      setTarefaAtivaId(null);
    }
  }, [setQueue]);

  const deletarTarefa = (id: string) =>
    setQueue(q => q.filter(t => t.id !== id));

  const editarTarefa = (id: string, titulo: string, descricao: string) =>
    setQueue(q => q.map(t => t.id === id ? { ...t, titulo, descricao } : t));

  const downloadPrompt = (tarefa: TarefaQueue) => {
    if (!tarefa.prompt) return;
    const blob = new Blob([tarefa.prompt], { type: "text/plain" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `${tarefa.titulo.slice(0,30)}.txt`; a.click();
    URL.revokeObjectURL(url);
  };

  const enviarChat = async () => {
    if (!chatInput.trim()) return;
    const msg = chatInput.trim();
    setChatInput("");
    setChatMsgs(m => [...m, { role: "user", texto: msg }]);

    // Chat simples: resposta da IA sobre o projeto
    setTimeout(() => {
      setChatMsgs(m => [...m, {
        role: "ia",
        texto: `Entendido. Para aplicar essa melhoria a todo o projeto, clique no ícone ↺ em cada tarefa concluída e descreva o que deseja melhorar. Posso também regerar uma tarefa específica se você indicar qual.`
      }]);
    }, 800);
  };

  const concluidos  = queue.filter(t => t.status === "concluido").length;
  const total       = queue.length;
  const progresso   = total > 0 ? Math.round((concluidos / total) * 100) : 0;
  const proximaTarefa = queue.find(t => t.status === "aguardando");

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#030712" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
        *, *::before, *::after { font-family: 'Syne', sans-serif; box-sizing: border-box; }
        .mono { font-family: 'JetBrains Mono', monospace !important; }
        .bg-grid { background-image: linear-gradient(rgba(163,230,53,0.02) 1px,transparent 1px),linear-gradient(90deg,rgba(163,230,53,0.02) 1px,transparent 1px); background-size:44px 44px; }
        ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:transparent} ::-webkit-scrollbar-thumb{background:rgba(163,230,53,0.15);border-radius:4px}
      `}</style>

      <div className="fixed inset-0 bg-grid pointer-events-none" />

      {/* Top bar */}
      <div className="relative z-10 flex items-center justify-between px-6 py-3 border-b border-zinc-800/60"
        style={{ background: "rgba(3,7,18,0.9)", backdropFilter: "blur(20px)" }}>
        <div className="flex items-center gap-3">
          <button onClick={onVoltar}
            className="flex items-center gap-1.5 mono text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors">
            <ArrowRight className="w-3.5 h-3.5 rotate-180" /> voltar
          </button>
          <div className="w-px h-4 bg-zinc-800" />
          <FolderOpen className="w-4 h-4 text-lime-500" />
          <span className="text-sm font-bold text-zinc-200 truncate max-w-xs">{ideiaProjeto.slice(0, 50)}...</span>
        </div>

        {/* Barra de progresso */}
        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-2">
            <div className="w-32 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <motion.div className="h-full rounded-full"
                style={{ background: "linear-gradient(90deg,#a3e635,#4ade80)" }}
                initial={{ width: 0 }} animate={{ width: `${progresso}%` }}
                transition={{ duration: 0.6, ease: "easeOut" }} />
            </div>
            <span className="mono text-[11px] text-zinc-500">{concluidos}/{total}</span>
          </div>
          {proximaTarefa && !loading && (
            <motion.button onClick={() => gerarTarefa(proximaTarefa)}
              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold"
              style={{ background: "linear-gradient(135deg,#a3e635,#4ade80)", color: "#030712" }}>
              <Zap className="w-3.5 h-3.5" /> Gerar próximo
            </motion.button>
          )}
        </div>
      </div>

      {/* Layout 3 colunas */}
      <div className="relative z-10 flex flex-1 overflow-hidden">

        {/* ── Coluna 1: TO-DO LIST ── */}
        <div className="w-80 shrink-0 border-r border-zinc-800/60 flex flex-col"
          style={{ background: "rgba(3,7,18,0.95)" }}>
          <div className="px-4 py-3 border-b border-zinc-800/40">
            <span className="mono text-[10px] text-zinc-600 tracking-widest uppercase">To-do list</span>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            <Reorder.Group axis="y" values={queue} onReorder={setQueue} className="space-y-2">
              {queue.map((tarefa, i) => (
                <Reorder.Item key={tarefa.id} value={tarefa} dragListener={false}>
                  <TodoItem
                    tarefa={tarefa} index={i}
                    ativo={tarefa.id === tarefaAtivaId}
                    expanded={expandedIds.has(tarefa.id)}
                    onToggleExpand={() => toggleExpand(tarefa.id)}
                    onEditar={(t, d) => editarTarefa(tarefa.id, t, d)}
                    onRegerar={instr => regerarTarefa(tarefa, instr)}
                    onDeletar={() => deletarTarefa(tarefa.id)}
                    onDownload={() => downloadPrompt(tarefa)}
                    onGerar={() => gerarTarefa(tarefa)}
                  />
                </Reorder.Item>
              ))}
            </Reorder.Group>
          </div>
        </div>

        {/* ── Coluna 2: PROMPT VIEWER ── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Loading stages */}
          <AnimatePresence>
            {loading && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="p-4 border-b border-zinc-800/40 space-y-1.5">
                {STAGES.map((s, i) => {
                  const Icon = s.icon;
                  const active = i === stageIndex, done = i < stageIndex;
                  return (
                    <motion.div key={i}
                      animate={{ opacity: done ? 0.3 : active ? 1 : 0.15 }}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${active ? `${s.bg} ${s.border} border` : "border-transparent"}`}>
                      {done ? <CheckCircle2 className="w-3.5 h-3.5 text-lime-500 shrink-0" />
                        : <Icon className={`w-3.5 h-3.5 shrink-0 ${active ? s.color : "text-zinc-700"} ${active ? "animate-pulse" : ""}`} />}
                      <span className={`mono text-[11px] ${active ? s.color : done ? "text-zinc-700 line-through" : "text-zinc-700"}`}>{s.label}</span>
                      {active && <div className="ml-auto flex gap-1">{[0,1,2].map(d=>(
                        <motion.div key={d} className="w-1 h-1 rounded-full bg-lime-500"
                          animate={{opacity:[0.3,1,0.3]}} transition={{duration:0.9,repeat:Infinity,delay:d*0.2}}/>
                      ))}</div>}
                    </motion.div>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Prompt output */}
          <div className="flex-1 overflow-y-auto p-6">
            {promptAtivo ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <motion.div className="w-2 h-2 rounded-full bg-lime-500" animate={{opacity:[1,0.3,1]}} transition={{duration:2,repeat:Infinity}}/>
                    <span className="mono text-[11px] text-zinc-500 tracking-widest uppercase">
                      {queue.find(t=>t.id===tarefaPromptId)?.titulo ?? "Prompt"}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => {
                      const t = queue.find(t=>t.id===tarefaPromptId);
                      if (t) downloadPrompt(t);
                    }} className="flex items-center gap-1 mono text-[10px] text-zinc-600 hover:text-lime-400 px-2 py-1.5 rounded border border-transparent hover:border-zinc-800 transition-all">
                      <Download className="w-3 h-3"/> baixar
                    </button>
                    <button onClick={() => navigator.clipboard.writeText(promptAtivo)}
                      className="flex items-center gap-1 mono text-[10px] text-zinc-600 hover:text-lime-400 px-2 py-1.5 rounded border border-transparent hover:border-zinc-800 transition-all">
                      <Copy className="w-3 h-3"/> copiar
                    </button>
                  </div>
                </div>
                <div className="p-5 rounded-xl border border-zinc-800/60 bg-zinc-900/40">
                  <pre className="mono text-xs text-zinc-300 leading-[1.7] whitespace-pre-wrap break-words">
                    {promptAtivo}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-zinc-800/60 border border-zinc-700/40 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-zinc-600" />
                </div>
                <p className="text-sm font-bold text-zinc-600">Nenhum prompt gerado ainda</p>
                <p className="mono text-xs text-zinc-700 max-w-xs">
                  Clique em "▶ gerar" em qualquer tarefa da lista ou use o botão "Gerar próximo" no topo.
                </p>
                {proximaTarefa && (
                  <motion.button onClick={() => gerarTarefa(proximaTarefa)}
                    whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold mt-2"
                    style={{ background: "linear-gradient(135deg,#a3e635,#4ade80)", color: "#030712" }}>
                    <Zap className="w-4 h-4" /> Começar pelo recomendado
                  </motion.button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Coluna 3: CHAT ── */}
        <div className="w-72 shrink-0 border-l border-zinc-800/60 flex flex-col"
          style={{ background: "rgba(3,7,18,0.95)" }}>
          <div className="px-4 py-3 border-b border-zinc-800/40 flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-zinc-600" />
            <span className="mono text-[10px] text-zinc-600 tracking-widest uppercase">Chat do projeto</span>
          </div>

          <div ref={chatRef} className="flex-1 overflow-y-auto p-3 space-y-2">
            {chatMsgs.length === 0 ? (
              <div className="text-center pt-8 space-y-2">
                <p className="mono text-xs text-zinc-700">Use o chat para dar direcionamentos ao projeto</p>
                <p className="mono text-[10px] text-zinc-800">ex: "aplique mais foco em acessibilidade"</p>
              </div>
            ) : (
              chatMsgs.map((m, i) => (
                <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] px-3 py-2 rounded-xl text-xs leading-relaxed ${
                    m.role === "user"
                      ? "bg-lime-500/10 border border-lime-500/20 text-lime-300"
                      : "bg-zinc-800/60 border border-zinc-700/40 text-zinc-300"}`}>
                    {m.texto}
                  </div>
                </motion.div>
              ))
            )}
          </div>

          <div className="p-3 border-t border-zinc-800/40">
            <div className="flex gap-2">
              <input value={chatInput} onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && enviarChat()}
                placeholder="Mensagem..."
                className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-700 outline-none focus:border-zinc-700 transition-colors" />
              <button onClick={enviarChat} disabled={!chatInput.trim()}
                className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors text-zinc-400 hover:text-zinc-200 disabled:opacity-30">
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// COMPONENTE PRINCIPAL (HOME)
// ─────────────────────────────────────────────────────────────
export default function Home() {
  const [appState, setAppState]             = useState<AppState>("home");
  const [ideia, setIdeia]                   = useState("");
  const [papelEditado, setPapelEditado]     = useState("");
  const [editandoPapel, setEditandoPapel]   = useState(false);
  const [resultado, setResultado]           = useState<ResultData | null>(null);
  const [perguntas, setPerguntas]           = useState<PerguntaClarificacao[]>([]);
  const [loading, setLoading]               = useState(false);
  const [stageIndex, setStageIndex]         = useState(0);
  const [copied, setCopied]                 = useState(false);
  const [queue, setQueue]                   = useState<TarefaQueue[]>([]);
  const [ideiaProjeto, setIdeiaProjeto]     = useState("");
  const [cols]                              = useState(() =>
    Array.from({ length: 22 }, (_, i) => ({ x: i * 4.8, delay: i * 0.32 }))
  );
  const inputRef = useRef<HTMLInputElement>(null);

  // LocalStorage
  useEffect(() => {
    try {
      const q = localStorage.getItem(LS_KEY_QUEUE);
      const p = localStorage.getItem(LS_KEY_PROJETO);
      if (q) setQueue(JSON.parse(q));
      if (p) setIdeiaProjeto(JSON.parse(p));
    } catch {}
  }, []);

  useEffect(() => {
    if (queue.length > 0) localStorage.setItem(LS_KEY_QUEUE, JSON.stringify(queue));
  }, [queue]);

  // Loading stages
  useEffect(() => {
    if (!loading) return;
    const id = setInterval(() => setStageIndex(p => Math.min(p + 1, STAGES.length - 1)), 4000);
    return () => clearInterval(id);
  }, [loading]);

  const chamarAPI = useCallback(async (opts: {
    ideiaTexto: string;
    forcarSimples?: boolean;
    respostas?: Record<string, string>;
  }) => {
    const { ideiaTexto, forcarSimples = false, respostas } = opts;
    setLoading(true);
    setResultado(null);
    setStageIndex(0);

    try {
      const body: Record<string, unknown> = { ideiaBruta: ideiaTexto, forcarSimples };
      if (papelEditado.trim()) body.papel = papelEditado.trim();
      if (respostas && Object.keys(respostas).length > 0) body.respostasClarificacao = respostas;

      const res  = await fetch(`${API}/gerar`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data: ResultData = await res.json();

      if (data.tipo_resposta === "clarificacao_necessaria") {
        setPerguntas((data as ClarificacaoResult).perguntas);
        setAppState("clarificando");
        setResultado(null);
      } else if (data.tipo_resposta === "plano_de_divisao") {
        const plano = data as PlanoResult;
        const novas = plano.sub_tarefas.map((s, i) => ({
          id:          `${Date.now()}_${i}`,
          titulo:      s.titulo,
          descricao:   s.descricao,
          complexidade: s.complexidade as TarefaQueue["complexidade"],
          status:      "aguardando" as const,
        }));
        setQueue(novas);
        setIdeiaProjeto(ideiaTexto);
        localStorage.setItem(LS_KEY_PROJETO, JSON.stringify(ideiaTexto));
        setAppState("projeto");
      } else {
        setResultado(data);
        setAppState("home");
      }
    } catch {
      alert("Erro ao conectar. A API C# está rodando?");
    } finally {
      setLoading(false);
    }
  }, [papelEditado]);

  const handleResponderClarificacao = (respostas: Record<string, string>) => {
    setAppState("home");
    setPerguntas([]);
    chamarAPI({ ideiaTexto: ideia, respostas });
  };

  const promptResult = resultado?.tipo_resposta === "prompt_gerado" ? resultado as PromptResult : null;
  const scoreNum     = parseInt(promptResult?.pipeline.score_qualidade ?? "0", 10);
  const scoreColor   = scoreNum >= 85 ? "#a3e635" : scoreNum >= 70 ? "#facc15" : "#f87171";

  // Página de projeto
  if (appState === "projeto") {
    return (
      <PaginaProjeto
        ideiaProjeto={ideiaProjeto}
        queue={queue}
        setQueue={setQueue}
        onVoltar={() => setAppState("home")}
      />
    );
  }

  // Home + clarificando
  return (
    <div className="relative min-h-screen overflow-hidden flex flex-col items-center py-14 px-6"
      style={{ background: "#030712" }}>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
        *, *::before, *::after { font-family: 'Syne', sans-serif; box-sizing: border-box; }
        .mono { font-family: 'JetBrains Mono', monospace !important; }
        .bg-grid { background-image: linear-gradient(rgba(163,230,53,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(163,230,53,0.025) 1px,transparent 1px); background-size:44px 44px; }
        .glow-input:focus { box-shadow: 0 0 0 1px rgba(163,230,53,0.35), 0 0 20px rgba(163,230,53,0.07); }
        .scanline::before { content:''; position:absolute; inset:0; pointer-events:none; z-index:1; background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.06) 2px,rgba(0,0,0,0.06) 4px); }
        @keyframes scoredash{from{stroke-dashoffset:226}to{stroke-dashoffset:var(--t)}} .score-ring{animation:scoredash 1.2s ease-out forwards}
        ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:transparent} ::-webkit-scrollbar-thumb{background:rgba(163,230,53,0.2);border-radius:4px}
      `}</style>

      <div className="fixed inset-0 bg-grid pointer-events-none" />
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        {cols.map((c, i) => <MatrixCol key={i} x={c.x} delay={c.delay} />)}
      </div>
      <div className="fixed pointer-events-none"
        style={{ width:700,height:700,borderRadius:"50%",top:"5%",left:"50%",transform:"translateX(-50%)",
          background:"radial-gradient(circle,rgba(163,230,53,0.05) 0%,transparent 65%)",filter:"blur(50px)" }}/>

      <div className="relative z-10 max-w-2xl w-full space-y-8">

        {/* Header */}
        <motion.div initial={{ opacity:0,y:-20 }} animate={{ opacity:1,y:0 }}
          transition={{ duration:0.8,ease:[0.16,1,0.3,1] }} className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="mono text-xs text-lime-500 tracking-[0.25em] uppercase">v5.0 · Clarificação + Projetos</div>
            {queue.length > 0 && (
              <button onClick={() => setAppState("projeto")}
                className="flex items-center gap-1.5 mono text-[11px] text-zinc-500 hover:text-lime-400 transition-colors border border-zinc-800 hover:border-lime-500/30 px-3 py-1.5 rounded-lg">
                <FolderOpen className="w-3.5 h-3.5" />
                <span>Projeto ativo ({queue.filter(t=>t.status==="aguardando").length} pendentes)</span>
              </button>
            )}
          </div>
          <h1 className="text-5xl md:text-6xl font-extrabold leading-none tracking-tighter"
            style={{ background:"linear-gradient(135deg,#fff 25%,#a3e635 65%,#4ade80)",
              WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent" }}>
            Prompt<br/>
            <span style={{ WebkitTextFillColor:"transparent",WebkitTextStroke:"1px rgba(163,230,53,0.4)" }}>
              Architect
            </span>
          </h1>
          <p className="text-zinc-500 text-sm max-w-xs leading-relaxed">
            Ideia bruta → 4 agentes. Se ambígua, pergunta primeiro. Se complexa, cria projeto.
          </p>
        </motion.div>

        {/* Form */}
        <motion.div initial={{ opacity:0,y:20 }} animate={{ opacity:1,y:0 }}
          transition={{ duration:0.7,delay:0.15,ease:[0.16,1,0.3,1] }} className="space-y-3">

          {/* Papel */}
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-zinc-800/80 bg-zinc-900/50"
            style={{ minHeight:50 }}>
            <span className="mono text-[10px] text-zinc-600 tracking-[0.2em] uppercase shrink-0">ROLE</span>
            {editandoPapel ? (
              <input ref={inputRef} value={papelEditado}
                onChange={e => setPapelEditado(e.target.value)}
                onBlur={() => setEditandoPapel(false)}
                onKeyDown={e => e.key==="Enter"&&setEditandoPapel(false)}
                placeholder="ex: Engenheiro Frontend Sênior em React 18 + Canvas API"
                className="flex-1 bg-transparent outline-none text-sm text-zinc-200 placeholder:text-zinc-700"/>
            ) : (
              <span className={`flex-1 text-sm truncate ${
                papelEditado ? "text-lime-400 font-bold"
                : promptResult?.deteccao?.papel_detectado ? "text-lime-400 font-bold"
                : "text-zinc-600 italic"}`}>
                {papelEditado||promptResult?.deteccao?.papel_detectado||"Detectado automaticamente ✦"}
              </span>
            )}
            <button type="button" onClick={() => { setEditandoPapel(true); setTimeout(()=>inputRef.current?.focus(),40); }}
              className="shrink-0 p-1.5 rounded-md hover:bg-zinc-800 transition-colors group">
              <Pencil className="w-3 h-3 text-zinc-600 group-hover:text-lime-400 transition-colors"/>
            </button>
          </div>

          {/* Textarea */}
          <div className="space-y-3">
            <div className="relative">
              <textarea value={ideia} onChange={e=>setIdeia(e.target.value)}
                placeholder="Descreva sua ideia, bagunçado mesmo. A IA organiza, clarifica e divide..."
                disabled={loading}
                className="glow-input w-full h-48 p-5 bg-zinc-900/60 border border-zinc-800/80 rounded-2xl text-zinc-200 text-sm leading-relaxed placeholder:text-zinc-700 outline-none resize-none transition-all disabled:opacity-40"/>
              <span className="absolute bottom-3 right-4 mono text-[10px] text-zinc-700">{ideia.length}</span>
            </div>
            <motion.button onClick={() => chamarAPI({ ideiaTexto: ideia })}
              disabled={loading||!ideia.trim()} whileHover={{ scale:1.01 }} whileTap={{ scale:0.98 }}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-sm disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              style={{ background:loading?"rgba(163,230,53,0.08)":"linear-gradient(135deg,#a3e635,#4ade80)",
                color:loading?"#a3e635":"#030712",
                border:loading?"1px solid rgba(163,230,53,0.25)":"none" }}>
              {loading
                ? <><motion.div animate={{rotate:360}} transition={{duration:1,repeat:Infinity,ease:"linear"}}
                    className="w-4 h-4 rounded-full border-2 border-lime-500 border-t-transparent"/>Processando</>
                : <>Gerar Prompt <ArrowRight className="w-4 h-4"/></>}
            </motion.button>
          </div>
        </motion.div>

        {/* Loading stages */}
        <AnimatePresence>
          {loading && (
            <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}} className="space-y-1.5">
              {STAGES.map((s,i) => {
                const Icon=s.icon; const active=i===stageIndex, done=i<stageIndex;
                return (
                  <motion.div key={i} initial={{opacity:0,x:-8}}
                    animate={{opacity:done?0.35:active?1:0.18,x:0}} transition={{delay:i*0.04}}
                    className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-all ${active?`${s.bg} ${s.border} border`:"border-transparent"}`}>
                    {done?<CheckCircle2 className="w-4 h-4 text-lime-500 shrink-0"/>
                      :<Icon className={`w-4 h-4 shrink-0 ${active?s.color:"text-zinc-700"} ${active?"animate-pulse":""}`}/>}
                    <span className={`mono text-xs ${active?s.color:done?"text-zinc-700 line-through":"text-zinc-700"}`}>{s.label}</span>
                    {active&&<div className="ml-auto flex gap-1">{[0,1,2].map(d=>(
                      <motion.div key={d} className="w-1 h-1 rounded-full bg-lime-500"
                        animate={{opacity:[0.3,1,0.3]}} transition={{duration:0.9,repeat:Infinity,delay:d*0.2}}/>
                    ))}</div>}
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Clarificação inline */}
        <AnimatePresence>
          {appState === "clarificando" && !loading && (
            <ClarificacaoWidget
              perguntas={perguntas}
              onResponder={handleResponderClarificacao}
              onPular={() => { setAppState("home"); chamarAPI({ ideiaTexto: ideia, forcarSimples: false, respostas: {} }); }}
            />
          )}
        </AnimatePresence>

        {/* Resultado: prompt simples */}
        <AnimatePresence>
          {promptResult && !loading && appState === "home" && (
            <motion.div initial={{opacity:0,y:24}} animate={{opacity:1,y:0}}
              transition={{duration:0.5,ease:[0.16,1,0.3,1]}} className="space-y-3">

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 px-4 py-3 rounded-xl border border-zinc-800/60 bg-zinc-900/40 space-y-1">
                  <span className="mono text-[10px] text-zinc-600 tracking-widest uppercase block">Papel detectado</span>
                  <span className="text-sm font-bold text-lime-400 leading-tight block">{promptResult.deteccao?.papel_detectado}</span>
                </div>
                <div className="px-4 py-3 rounded-xl border border-zinc-800/60 bg-zinc-900/40 flex flex-col items-center justify-center">
                  <span className="mono text-[9px] text-zinc-600 tracking-widest uppercase mb-1">Score</span>
                  <svg width="56" height="56" viewBox="0 0 80 80">
                    <circle cx="40" cy="40" r="36" fill="none" stroke="#1f2937" strokeWidth="6"/>
                    <circle cx="40" cy="40" r="36" fill="none" stroke={scoreColor} strokeWidth="6"
                      strokeLinecap="round" strokeDasharray="226" className="score-ring"
                      style={{transformOrigin:"center",transform:"rotate(-90deg)","--t":`${226-(226*scoreNum)/100}`} as React.CSSProperties}/>
                    <text x="40" y="46" textAnchor="middle" fill={scoreColor} fontSize="17"
                      fontWeight="800" fontFamily="JetBrains Mono">{promptResult.pipeline.score_qualidade}</text>
                  </svg>
                </div>
              </div>

              <div className="scanline relative rounded-2xl border border-zinc-800/60 overflow-hidden"
                style={{background:"linear-gradient(135deg,#080d08,#030712)"}}>
                <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800/60">
                  <div className="flex items-center gap-2">
                    <motion.div className="w-2 h-2 rounded-full bg-lime-500" animate={{opacity:[1,0.3,1]}} transition={{duration:2,repeat:Infinity}}/>
                    <span className="mono text-[11px] text-zinc-500 tracking-widest uppercase">Super Prompt</span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => {
                      const b=new Blob([promptResult.prompt_otimizado],{type:"text/plain"});
                      const u=URL.createObjectURL(b);const a=document.createElement("a");
                      a.href=u;a.download="prompt.txt";a.click();URL.revokeObjectURL(u);
                    }} className="flex items-center gap-1 mono text-[10px] text-zinc-600 hover:text-lime-400 transition-colors px-2 py-1.5 rounded border border-transparent hover:border-zinc-800">
                      <Download className="w-3 h-3"/> baixar
                    </button>
                    <motion.button onClick={() => { navigator.clipboard.writeText(promptResult.prompt_otimizado); setCopied(true); setTimeout(()=>setCopied(false),2000); }}
                      whileTap={{scale:0.94}}
                      className="flex items-center gap-1.5 mono text-[10px] px-3 py-1.5 rounded-lg border transition-all"
                      style={{borderColor:copied?"rgba(163,230,53,0.4)":"rgba(63,63,70,0.5)",color:copied?"#a3e635":"#71717a",background:copied?"rgba(163,230,53,0.05)":"transparent"}}>
                      {copied?<Check className="w-3 h-3"/>:<Copy className="w-3 h-3"/>}
                      {copied?"COPIADO":"COPIAR"}
                    </motion.button>
                  </div>
                </div>
                <div className="relative z-10 p-5 max-h-[460px] overflow-y-auto">
                  <pre className="mono text-xs text-zinc-300 leading-[1.7] whitespace-pre-wrap break-words">
                    {promptResult.prompt_otimizado}
                  </pre>
                </div>
                <div className="absolute bottom-0 left-0 right-0 h-10 pointer-events-none"
                  style={{background:"linear-gradient(to top,#030712,transparent)"}}/>
              </div>

              <p className="mono text-[10px] text-zinc-700 text-center">
                formato · <span className="text-zinc-500">{promptResult.deteccao?.formato_detectado}</span>
              </p>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}