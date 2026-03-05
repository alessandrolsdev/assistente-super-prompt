"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence, Reorder } from "framer-motion";
import {
  ArrowRight, CheckCircle2, Copy, Check, Pencil, Cpu, Zap, Shield,
  AlertTriangle, Clock, Download, Sparkles, RotateCcw, FileText,
  GripVertical, Trash2, RefreshCw, MessageSquare, Send, FolderOpen,
  Image as ImageIcon, Film, Code2, GitBranch, PenTool, Layout,
  HelpCircle, X, ChevronDown, ChevronUp, ChevronRight
} from "lucide-react";

// ─────────────────────────────────────────────────────────────
// TIPOS
// ─────────────────────────────────────────────────────────────
type AppState = "home" | "clarificando" | "projeto";
type TipoObjetivo = "Imagem" | "Video" | "Codigo" | "Refatoracao" | "Copywriting" | "DesignUI" | "Outro";

interface ObjetivoMeta {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bg: string;
  border: string;
  desc: string;
  ferramentas: string;
}

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
  tipo?: TipoObjetivo;
  historico?: { prompt: string; score: string; instrucao: string }[];
}

interface PromptResult {
  tipo_resposta: "prompt_gerado" | "prompt_melhorado";
  tipo_objetivo: TipoObjetivo;
  prompt_otimizado: string;
  deteccao?: {
    papel_detectado: string;
    formato_detectado: string;
    tipo_confirmado: TipoObjetivo;
    ferramentas_alvo: string;
  };
  pipeline: { etapa_2: { modelo: string }; etapa_3: { modelo: string }; score_qualidade: string;
    etapa_triagem?: { modelo: string }; etapa_0?: { modelo: string };
    etapa_1: { modelo: string };
  };
}

interface PlanoResult {
  tipo_resposta: "plano_de_divisao";
  aviso: string;
  sub_tarefas: SubTarefaItem[];
  recomendacao: string;
  tipo_confirmado: TipoObjetivo;
}

interface ClarificacaoResult {
  tipo_resposta: "clarificacao_necessaria";
  perguntas: PerguntaClarificacao[];
  tipo_confirmado: TipoObjetivo;
}

type ResultData = PromptResult | PlanoResult | ClarificacaoResult;

// ─────────────────────────────────────────────────────────────
// CONFIGURAÇÕES DOS OBJETIVOS
// ─────────────────────────────────────────────────────────────
const OBJETIVOS: Record<TipoObjetivo, ObjetivoMeta> = {
  Imagem:      { label: "Imagem",      icon: ImageIcon,  color: "text-pink-400",   bg: "bg-pink-500/10",   border: "border-pink-500/25",   desc: "Midjourney, DALL-E, Stable Diffusion",   ferramentas: "Midjourney · DALL-E · SD" },
  Video:       { label: "Vídeo",       icon: Film,       color: "text-violet-400", bg: "bg-violet-500/10", border: "border-violet-500/25", desc: "Sora, Runway, Kling, Pika",              ferramentas: "Sora · Runway · Kling"   },
  Codigo:      { label: "Código",      icon: Code2,      color: "text-lime-400",   bg: "bg-lime-500/10",   border: "border-lime-500/25",   desc: "Implementar do zero",                     ferramentas: "Claude · GPT-4 · Gemini" },
  Refatoracao: { label: "Refatoração", icon: GitBranch,  color: "text-blue-400",   bg: "bg-blue-500/10",   border: "border-blue-500/25",   desc: "Melhorar código existente",               ferramentas: "Claude · GPT-4 · Gemini" },
  Copywriting: { label: "Copy",        icon: PenTool,    color: "text-amber-400",  bg: "bg-amber-500/10",  border: "border-amber-500/25",  desc: "Textos persuasivos e marketing",          ferramentas: "Claude · GPT-4 · Gemini" },
  DesignUI:    { label: "UI/UX",       icon: Layout,     color: "text-cyan-400",   bg: "bg-cyan-500/10",   border: "border-cyan-500/25",   desc: "Interfaces e sistemas de design",         ferramentas: "Claude · GPT-4 · Gemini" },
  Outro:       { label: "Outro",       icon: HelpCircle, color: "text-zinc-400",   bg: "bg-zinc-500/10",   border: "border-zinc-500/25",   desc: "IA detecta automaticamente",              ferramentas: "IA detecta"              },
};

const CHARS = "01アイウエカキ∆∑∏∫≈≠∞";
const API   = "http://localhost:5117/api/prompt";
const LS_KEY_QUEUE   = "pa_queue_v8";
const LS_KEY_PROJETO = "pa_projeto_v8";
const LS_KEY_RESULTADO = "pa_resultado_v8";

const STAGES = [
  { label: "Classificando objetivo",       color: "text-pink-400",   bg: "bg-pink-500/10",   border: "border-pink-500/20"   },
  { label: "Verificando ambiguidades",     color: "text-rose-400",   bg: "bg-rose-500/10",   border: "border-rose-500/20"   },
  { label: "Triando complexidade",         color: "text-amber-400",  bg: "bg-amber-500/10",  border: "border-amber-500/20"  },
  { label: "Detectando papel técnico",     color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/20" },
  { label: "Análise especializada",        color: "text-blue-400",   bg: "bg-blue-500/10",   border: "border-blue-500/20"   },
  { label: "Gerando super prompt",         color: "text-lime-400",   bg: "bg-lime-500/10",   border: "border-lime-500/20"   },
  { label: "Validando e calculando score", color: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/20" },
];

// ─────────────────────────────────────────────────────────────
// PARTÍCULAS
// ─────────────────────────────────────────────────────────────
function MatrixCol({ x, delay, chars, duration }: { x: number; delay: number; chars: string[]; duration: number }) {
  return (
    <motion.div className="absolute top-0 flex flex-col items-center pointer-events-none"
      style={{ left: `${x}%` }}
      animate={{ opacity: [0, 0.08, 0], y: ["0%", "110%"] }}
      transition={{ duration, delay, repeat: Infinity, ease: "linear" }}>
      {chars.map((c, i) => (
        <span key={i} className="text-[9px] font-mono leading-[13px]"
          style={{ color: i < 2 ? "#a3e635" : "#14532d", opacity: 1 - i * 0.07 }}>{c}</span>
      ))}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────
// SELETOR DE OBJETIVO
// ─────────────────────────────────────────────────────────────
function ObjetivoSelector({
  valor, onChange, tipoConfirmado
}: {
  valor: TipoObjetivo | null;
  onChange: (t: TipoObjetivo) => void;
  tipoConfirmado?: TipoObjetivo;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="mono text-[10px] text-zinc-600 tracking-[0.2em] uppercase">Objetivo</span>
        {tipoConfirmado && tipoConfirmado !== valor && (
          <motion.span initial={{ opacity: 0, x: 4 }} animate={{ opacity: 1, x: 0 }}
            className="mono text-[10px] text-lime-500 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            IA confirmou: {tipoConfirmado}
          </motion.span>
        )}
      </div>
      <div className="grid grid-cols-4 gap-2">
        {(Object.entries(OBJETIVOS) as [TipoObjetivo, ObjetivoMeta][]).map(([tipo, meta]) => {
          const Icon = meta.icon;
          const sel  = valor === tipo;
          const conf = tipoConfirmado === tipo && !sel;
          return (
            <motion.button key={tipo} onClick={() => onChange(tipo)}
              whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
              className={`relative flex flex-col items-center gap-1.5 px-2 py-2.5 rounded-xl border text-center transition-all ${
                sel ? `${meta.bg} ${meta.border} border` : "border-zinc-800/60 bg-zinc-900/40 hover:border-zinc-700/60"
              }`}>
              {conf && (
                <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-lime-500 border-2 border-zinc-950" />
              )}
              <Icon className={`w-4 h-4 ${sel ? meta.color : "text-zinc-600"}`} />
              <span className={`text-[10px] font-bold leading-none ${sel ? meta.color : "text-zinc-600"}`}>
                {meta.label}
              </span>
            </motion.button>
          );
        })}
      </div>
      {valor && (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-800/40 bg-zinc-900/30">
          <span className={`text-xs font-medium ${OBJETIVOS[valor].color}`}>{OBJETIVOS[valor].desc}</span>
          <span className="mono text-[10px] text-zinc-700 ml-auto">{OBJETIVOS[valor].ferramentas}</span>
        </motion.div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// CLARIFICAÇÃO
// ─────────────────────────────────────────────────────────────
function ClarificacaoWidget({ perguntas, onResponder, onPular }: {
  perguntas: PerguntaClarificacao[];
  onResponder: (r: Record<string, string>) => void;
  onPular: () => void;
}) {
  const [respostas, setRespostas] = useState<Record<string, string>>({});
  const set = (id: string, val: string) => setRespostas(r => ({ ...r, [id]: val }));
  const ok  = perguntas.every(p => respostas[p.id]);

  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -14 }} className="space-y-4">
      <div className="flex items-start gap-3 px-4 py-3.5 rounded-xl border border-rose-500/20 bg-rose-500/5">
        <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-bold text-rose-300">Ambiguidade detectada</p>
          <p className="mono text-[11px] text-zinc-500 mt-0.5">Preciso de contexto para evitar erro de interpretação.</p>
        </div>
      </div>
      {perguntas.map((p, pi) => (
        <motion.div key={p.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
          transition={{ delay: pi * 0.08 }}
          className="space-y-2.5 p-4 rounded-xl border border-zinc-800/60 bg-zinc-900/50">
          <p className="text-sm font-bold text-zinc-200">{p.texto}</p>
          <div className="flex flex-wrap gap-2">
            {p.opcoes.map((op, oi) => (
              <button key={oi} onClick={() => set(p.id, op)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all border"
                style={{
                  borderColor: respostas[p.id]===op ? "rgba(163,230,53,0.5)" : "rgba(63,63,70,0.6)",
                  background:  respostas[p.id]===op ? "rgba(163,230,53,0.1)" : "rgba(9,9,11,0.5)",
                  color:       respostas[p.id]===op ? "#a3e635" : "#a1a1aa",
                }}>{op}</button>
            ))}
          </div>
          {p.livre && (
            <input value={respostas[p.id] && !p.opcoes.includes(respostas[p.id]) ? respostas[p.id] : ""}
              onChange={e => set(p.id, e.target.value)}
              placeholder="Ou descreva com suas palavras..."
              className="w-full bg-zinc-950 border border-zinc-800/80 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-700 outline-none focus:border-lime-500/30 transition-colors" />
          )}
        </motion.div>
      ))}
      <div className="flex gap-3">
        <motion.button onClick={() => onResponder(respostas)} disabled={!ok}
          whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm disabled:opacity-30 transition-all"
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
// TODO ITEM (projeto)
// ─────────────────────────────────────────────────────────────
function TodoItem({ tarefa, ativo, expanded, onToggle, onEditar, onRegerar, onDeletar, onDownload, onGerar }: {
  tarefa: TarefaQueue; ativo: boolean; expanded: boolean;
  onToggle: () => void; onEditar: (t: string, d: string) => void;
  onRegerar: (i: string) => void; onDeletar: () => void;
  onDownload: () => void; onGerar: () => void;
}) {
  const [editando, setEditando]   = useState(false);
  const [tEdit, setTEdit]         = useState(tarefa.titulo);
  const [dEdit, setDEdit]         = useState(tarefa.descricao);
  const [showReg, setShowReg]     = useState(false);
  const [instrReg, setInstrReg]   = useState("");
  const done    = tarefa.status === "concluido";
  const gerando = tarefa.status === "gerando";
  const meta    = tarefa.tipo ? OBJETIVOS[tarefa.tipo] : OBJETIVOS.Outro;

  return (
    <div className={`rounded-xl border transition-all duration-200 ${
      ativo ? "border-lime-500/40 bg-lime-500/5" : done ? "border-zinc-800/30 bg-zinc-900/20" : "border-zinc-800/60 bg-zinc-900/40"
    }`}>
      <div className="flex items-start gap-2 p-3">
        <GripVertical className="w-4 h-4 text-zinc-700 mt-1 shrink-0 cursor-grab" />
        <div className="shrink-0 mt-0.5">
          {done ? (
            <motion.div initial={{scale:0}} animate={{scale:1}}
              className="w-5 h-5 rounded-full bg-lime-500/20 border border-lime-500/40 flex items-center justify-center">
              <Check className="w-3 h-3 text-lime-400"/>
            </motion.div>
          ) : gerando ? (
            <motion.div className="w-5 h-5 rounded-full border-2 border-blue-500 border-t-transparent"
              animate={{rotate:360}} transition={{duration:1,repeat:Infinity,ease:"linear"}}/>
          ) : (
            <div className="w-5 h-5 rounded-full bg-zinc-800/60 border border-zinc-700/40 flex items-center justify-center">
              <Clock className="w-3 h-3 text-zinc-600"/>
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          {editando ? (
            <div className="space-y-1.5">
              <input value={tEdit} onChange={e=>setTEdit(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-200 outline-none"/>
              <textarea value={dEdit} onChange={e=>setDEdit(e.target.value)} rows={2}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-400 outline-none resize-none"/>
              <div className="flex gap-2">
                <button onClick={()=>{onEditar(tEdit,dEdit);setEditando(false);}}
                  className="px-2.5 py-1 rounded-lg bg-lime-500/10 border border-lime-500/30 text-lime-400 text-xs font-bold">Salvar</button>
                <button onClick={()=>setEditando(false)} className="px-2.5 py-1 rounded-lg text-zinc-600 text-xs border border-zinc-800">×</button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-1.5 mb-0.5">
                {tarefa.tipo && (() => { const Icon=meta.icon; return <Icon className={`w-3 h-3 ${meta.color} shrink-0`}/>; })()}
                <p className={`text-xs font-bold leading-tight ${done?"text-zinc-500 line-through":ativo?"text-lime-300":"text-zinc-200"}`}>
                  {tarefa.titulo}
                </p>
              </div>
              {expanded && tarefa.descricao && (
                <p className="mono text-[10px] text-zinc-600 leading-relaxed mt-1">{tarefa.descricao}</p>
              )}
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className={`mono text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${meta.color} ${meta.bg}`}>
                  {tarefa.complexidade}
                </span>
                {tarefa.score && (
                  <span className="mono text-[9px] text-zinc-600">
                    score <span style={{color:parseInt(tarefa.score)>=85?"#a3e635":parseInt(tarefa.score)>=70?"#facc15":"#f87171"}}>{tarefa.score}</span>
                  </span>
                )}
                {!done && !gerando && (
                  <button onClick={onGerar} className="mono text-[9px] text-blue-400 hover:text-blue-300 border border-blue-500/20 px-1.5 py-0.5 rounded transition-colors">
                    ▶ gerar
                  </button>
                )}
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onToggle} className="p-1 rounded hover:bg-zinc-800 text-zinc-600 hover:text-zinc-400 transition-colors">
            {expanded ? <ChevronUp className="w-3.5 h-3.5"/> : <ChevronDown className="w-3.5 h-3.5"/>}
          </button>
          {!editando && <button onClick={()=>setEditando(true)} className="p-1 rounded hover:bg-zinc-800 text-zinc-600 hover:text-lime-400 transition-colors"><Pencil className="w-3.5 h-3.5"/></button>}
          {done && <>
            <button onClick={()=>setShowReg(r=>!r)} className="p-1 rounded hover:bg-zinc-800 text-zinc-600 hover:text-blue-400 transition-colors"><RefreshCw className="w-3.5 h-3.5"/></button>
            <button onClick={onDownload} className="p-1 rounded hover:bg-zinc-800 text-zinc-600 hover:text-lime-400 transition-colors"><Download className="w-3.5 h-3.5"/></button>
          </>}
          <button onClick={onDeletar} className="p-1 rounded hover:bg-zinc-800 text-zinc-600 hover:text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5"/></button>
        </div>
      </div>
      <AnimatePresence>
        {showReg && (
          <motion.div initial={{opacity:0,height:0}} animate={{opacity:1,height:"auto"}} exit={{opacity:0,height:0}}
            className="overflow-hidden border-t border-zinc-800/60 px-3 py-2.5 space-y-2">
            <p className="mono text-[10px] text-zinc-500">O que não agradou?</p>
            <div className="flex gap-2">
              <input value={instrReg} onChange={e=>setInstrReg(e.target.value)}
                onKeyDown={e=>{ if(e.key==="Enter"&&instrReg.trim()){ onRegerar(instrReg); setInstrReg(""); setShowReg(false); }}}
                placeholder="ex: papel muito genérico, quero mais especificidade..."
                className="flex-1 bg-zinc-950 border border-zinc-700/60 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-700 outline-none"/>
              <button onClick={()=>{ if(instrReg.trim()){ onRegerar(instrReg); setInstrReg(""); setShowReg(false); }}}
                disabled={!instrReg.trim()}
                className="px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-400 disabled:opacity-30 hover:bg-blue-500/20 transition-colors">
                <Send className="w-3.5 h-3.5"/>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// PÁGINA DE PROJETO
// ─────────────────────────────────────────────────────────────
function PaginaProjeto({ ideiaProjeto, queue, setQueue, onVoltar }: {
  ideiaProjeto: string; queue: TarefaQueue[];
  setQueue: React.Dispatch<React.SetStateAction<TarefaQueue[]>>; onVoltar: () => void;
}) {
  const [tarefaAtivaId, setTarefaAtivaId] = useState<string|null>(null);
  const [expandedIds, setExpandedIds]     = useState<Set<string>>(new Set());
  const [promptAtivo, setPromptAtivo]     = useState<string|null>(null);
  const [tarefaPromptId, setTarefaPromptId] = useState<string|null>(null);
  const [loading, setLoading]             = useState(false);
  const [stageIndex, setStageIndex]       = useState(0);
  const [chatMsgs, setChatMsgs]           = useState<{role:"user"|"ia";texto:string}[]>([]);
  const [chatInput, setChatInput]         = useState("");
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => { chatRef.current?.scrollTo({top:chatRef.current.scrollHeight,behavior:"smooth"}); }, [chatMsgs]);
  useEffect(() => { if(!loading)return; const id=setInterval(()=>setStageIndex(p=>Math.min(p+1,STAGES.length-1)),4000); return ()=>clearInterval(id); }, [loading]);

  const toggleExpand = (id:string) => setExpandedIds(s=>{const n=new Set(s);n.has(id)?n.delete(id):n.add(id);return n;});

  const gerarTarefa = useCallback(async (tarefa:TarefaQueue) => {
    setLoading(true); setStageIndex(0); setTarefaAtivaId(tarefa.id);
    setQueue(q=>q.map(t=>t.id===tarefa.id?{...t,status:"gerando"}:t));
    try {
      const res = await fetch(`${API}/gerar`,{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ideiaBruta:`${tarefa.titulo}: ${tarefa.descricao}`,forcarSimples:true,tipoSugerido:tarefa.tipo})});
      const data = await res.json();
      if(data.tipo_resposta==="prompt_gerado"){
        setQueue(q=>q.map(t=>t.id===tarefa.id?{...t,status:"concluido",prompt:data.prompt_otimizado,score:data.pipeline?.score_qualidade,papel:data.deteccao?.papel_detectado}:t));
        setPromptAtivo(data.prompt_otimizado); setTarefaPromptId(tarefa.id);
        setChatMsgs(m=>[...m,{role:"ia",texto:`✓ Prompt gerado para "${tarefa.titulo}" · score ${data.pipeline?.score_qualidade}`}]);
      }
    } catch { setQueue(q=>q.map(t=>t.id===tarefa.id?{...t,status:"aguardando"}:t)); }
    finally { setLoading(false); setTarefaAtivaId(null); }
  },[setQueue]);

  const regerarTarefa = useCallback(async (tarefa:TarefaQueue, instrucao:string) => {
    if(!tarefa.prompt)return;
    setLoading(true); setStageIndex(4); setTarefaAtivaId(tarefa.id);
    setQueue(q=>q.map(t=>t.id===tarefa.id?{...t,status:"gerando"}:t));
    try {
      const res = await fetch(`${API}/regerar`,{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({promptAtual:tarefa.prompt,instrucaoMelhora:instrucao,papel:tarefa.papel,tipoObjetivo:tarefa.tipo})});
      const data = await res.json();
      if(data.prompt_otimizado){
        setQueue(q=>q.map(t=>t.id===tarefa.id?{...t,status:"concluido",historico:[...(t.historico??[]),{prompt:t.prompt!,score:t.score!,instrucao}],prompt:data.prompt_otimizado,score:data.pipeline?.score_qualidade}:t));
        setPromptAtivo(data.prompt_otimizado);
        setChatMsgs(m=>[...m,{role:"ia",texto:`✓ Prompt de "${tarefa.titulo}" regerado · score ${data.pipeline?.score_qualidade}`}]);
      }
    } catch { setQueue(q=>q.map(t=>t.id===tarefa.id?{...t,status:"concluido"}:t)); }
    finally { setLoading(false); setTarefaAtivaId(null); }
  },[setQueue]);

  const dl = (t:TarefaQueue) => { if(!t.prompt)return; const b=new Blob([t.prompt],{type:"text/plain"}); const u=URL.createObjectURL(b); const a=document.createElement("a"); a.href=u;a.download=`${t.titulo.slice(0,30)}.txt`;a.click();URL.revokeObjectURL(u); };
  const concluidos=queue.filter(t=>t.status==="concluido").length;
  const total=queue.length;
  const progresso=total>0?Math.round((concluidos/total)*100):0;
  const proxima=queue.find(t=>t.status==="aguardando");

  return (
    <div className="min-h-screen flex flex-col" style={{background:"#030712"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800&family=JetBrains+Mono:wght@400;500&display=swap');*,*::before,*::after{font-family:'Syne',sans-serif;box-sizing:border-box}.mono{font-family:'JetBrains Mono',monospace!important}.bg-grid{background-image:linear-gradient(rgba(163,230,53,0.02) 1px,transparent 1px),linear-gradient(90deg,rgba(163,230,53,0.02) 1px,transparent 1px);background-size:44px 44px}::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:rgba(163,230,53,0.15);border-radius:4px}`}</style>
      <div className="fixed inset-0 bg-grid pointer-events-none"/>
      {/* Top bar */}
      <div className="relative z-10 flex items-center justify-between px-6 py-3 border-b border-zinc-800/60" style={{background:"rgba(3,7,18,0.9)",backdropFilter:"blur(20px)"}}>
        <div className="flex items-center gap-3">
          <button onClick={onVoltar} className="flex items-center gap-1.5 mono text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors"><ArrowRight className="w-3.5 h-3.5 rotate-180"/> voltar</button>
          <div className="w-px h-4 bg-zinc-800"/>
          <FolderOpen className="w-4 h-4 text-lime-500"/>
          <span className="text-sm font-bold text-zinc-200 truncate max-w-xs">{ideiaProjeto.slice(0,50)}...</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-2">
            <div className="w-32 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <motion.div className="h-full rounded-full" style={{background:"linear-gradient(90deg,#a3e635,#4ade80)"}}
                initial={{width:0}} animate={{width:`${progresso}%`}} transition={{duration:0.6,ease:"easeOut"}}/>
            </div>
            <span className="mono text-[11px] text-zinc-500">{concluidos}/{total}</span>
          </div>
          {proxima && !loading && (
            <motion.button onClick={()=>gerarTarefa(proxima)} whileHover={{scale:1.02}} whileTap={{scale:0.97}}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold"
              style={{background:"linear-gradient(135deg,#a3e635,#4ade80)",color:"#030712"}}>
              <Zap className="w-3.5 h-3.5"/> Gerar próximo
            </motion.button>
          )}
        </div>
      </div>

      {/* 3 colunas */}
      <div className="relative z-10 flex flex-1 overflow-hidden">
        {/* To-do */}
        <div className="w-80 shrink-0 border-r border-zinc-800/60 flex flex-col" style={{background:"rgba(3,7,18,0.95)"}}>
          <div className="px-4 py-3 border-b border-zinc-800/40 flex items-center justify-between">
            <span className="mono text-[10px] text-zinc-600 tracking-widest uppercase">To-do list</span>
            <span className="mono text-[10px] text-zinc-700">{concluidos}/{total}</span>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            <Reorder.Group axis="y" values={queue} onReorder={setQueue} className="space-y-2">
              {queue.map((tarefa,i)=>(
                <Reorder.Item key={tarefa.id} value={tarefa} dragListener={false}>
                  <TodoItem tarefa={tarefa} ativo={tarefa.id===tarefaAtivaId}
                    expanded={expandedIds.has(tarefa.id)} onToggle={()=>toggleExpand(tarefa.id)}
                    onEditar={(t,d)=>setQueue(q=>q.map(x=>x.id===tarefa.id?{...x,titulo:t,descricao:d}:x))}
                    onRegerar={instr=>regerarTarefa(tarefa,instr)}
                    onDeletar={()=>setQueue(q=>q.filter(x=>x.id!==tarefa.id))}
                    onDownload={()=>dl(tarefa)} onGerar={()=>gerarTarefa(tarefa)}/>
                </Reorder.Item>
              ))}
            </Reorder.Group>
          </div>
        </div>

        {/* Viewer */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <AnimatePresence>
            {loading && (
              <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="p-4 border-b border-zinc-800/40 space-y-1.5">
                {STAGES.map((s,i)=>{
                  const active=i===stageIndex,done=i<stageIndex;
                  return (
                    <motion.div key={i} animate={{opacity:done?0.3:active?1:0.15}}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${active?`${s.bg} ${s.border} border`:"border-transparent"}`}>
                      {done?<CheckCircle2 className="w-3.5 h-3.5 text-lime-500 shrink-0"/>:<Shield className={`w-3.5 h-3.5 shrink-0 ${active?s.color:"text-zinc-700"} ${active?"animate-pulse":""}`}/>}
                      <span className={`mono text-[11px] ${active?s.color:done?"text-zinc-700 line-through":"text-zinc-700"}`}>{s.label}</span>
                      {active&&<div className="ml-auto flex gap-1">{[0,1,2].map(d=><motion.div key={d} className="w-1 h-1 rounded-full bg-lime-500" animate={{opacity:[0.3,1,0.3]}} transition={{duration:0.9,repeat:Infinity,delay:d*0.2}}/>)}</div>}
                    </motion.div>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
          <div className="flex-1 overflow-y-auto p-6">
            {promptAtivo ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <motion.div className="w-2 h-2 rounded-full bg-lime-500" animate={{opacity:[1,0.3,1]}} transition={{duration:2,repeat:Infinity}}/>
                    <span className="mono text-[11px] text-zinc-500 tracking-widest uppercase">{queue.find(t=>t.id===tarefaPromptId)?.titulo??"Prompt"}</span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={()=>{const t=queue.find(t=>t.id===tarefaPromptId);if(t)dl(t);}} className="flex items-center gap-1 mono text-[10px] text-zinc-600 hover:text-lime-400 px-2 py-1.5 rounded border border-transparent hover:border-zinc-800 transition-all"><Download className="w-3 h-3"/>baixar</button>
                    <button onClick={()=>navigator.clipboard.writeText(promptAtivo)} className="flex items-center gap-1 mono text-[10px] text-zinc-600 hover:text-lime-400 px-2 py-1.5 rounded border border-transparent hover:border-zinc-800 transition-all"><Copy className="w-3 h-3"/>copiar</button>
                  </div>
                </div>
                <div className="p-5 rounded-xl border border-zinc-800/60 bg-zinc-900/40">
                  <pre className="mono text-xs text-zinc-300 leading-[1.7] whitespace-pre-wrap break-words">{promptAtivo}</pre>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center space-y-3">
                <Sparkles className="w-8 h-8 text-zinc-700"/>
                <p className="text-sm font-bold text-zinc-600">Selecione uma tarefa para gerar</p>
                {proxima&&<motion.button onClick={()=>gerarTarefa(proxima)} whileHover={{scale:1.02}} whileTap={{scale:0.97}}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold"
                  style={{background:"linear-gradient(135deg,#a3e635,#4ade80)",color:"#030712"}}>
                  <Zap className="w-4 h-4"/> Começar pelo recomendado
                </motion.button>}
              </div>
            )}
          </div>
        </div>

        {/* Chat */}
        <div className="w-72 shrink-0 border-l border-zinc-800/60 flex flex-col" style={{background:"rgba(3,7,18,0.95)"}}>
          <div className="px-4 py-3 border-b border-zinc-800/40 flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-zinc-600"/>
            <span className="mono text-[10px] text-zinc-600 tracking-widest uppercase">Chat do projeto</span>
          </div>
          <div ref={chatRef} className="flex-1 overflow-y-auto p-3 space-y-2">
            {chatMsgs.length===0?(
              <div className="text-center pt-8"><p className="mono text-xs text-zinc-700">Direcionamentos gerais do projeto</p></div>
            ):chatMsgs.map((m,i)=>(
              <motion.div key={i} initial={{opacity:0,y:4}} animate={{opacity:1,y:0}}
                className={`flex ${m.role==="user"?"justify-end":"justify-start"}`}>
                <div className={`max-w-[85%] px-3 py-2 rounded-xl text-xs leading-relaxed ${m.role==="user"?"bg-lime-500/10 border border-lime-500/20 text-lime-300":"bg-zinc-800/60 border border-zinc-700/40 text-zinc-300"}`}>
                  {m.texto}
                </div>
              </motion.div>
            ))}
          </div>
          <div className="p-3 border-t border-zinc-800/40">
            <div className="flex gap-2">
              <input value={chatInput} onChange={e=>setChatInput(e.target.value)}
                onKeyDown={e=>{ if(e.key!=="Enter"||!chatInput.trim())return; setChatMsgs(m=>[...m,{role:"user",texto:chatInput}]); setChatInput(""); setTimeout(()=>setChatMsgs(m=>[...m,{role:"ia",texto:"Entendido. Use o ↺ em cada tarefa para aplicar melhorias específicas."}]),600); }}
                placeholder="Mensagem..." className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-700 outline-none"/>
              <button onClick={()=>{ if(!chatInput.trim())return; setChatMsgs(m=>[...m,{role:"user",texto:chatInput}]); setChatInput(""); }} disabled={!chatInput.trim()} className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 disabled:opacity-30 transition-colors"><Send className="w-3.5 h-3.5"/></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// HOME PRINCIPAL
// ─────────────────────────────────────────────────────────────
export default function Home() {
  const [appState, setAppState]         = useState<AppState>("home");
  const [ideia, setIdeia]               = useState("");
  const [papelEditado, setPapelEditado] = useState("");
  const [editandoPapel, setEditandoPapel] = useState(false);
  const [tipoSelecionado, setTipoSelecionado] = useState<TipoObjetivo | null>(null);
  const [tipoConfirmado, setTipoConfirmado]   = useState<TipoObjetivo | undefined>();
  const [resultado, setResultado]       = useState<PromptResult | null>(null);
  const [executorSelecionado, setExecutorSelecionado] = useState<string>("");
  const [perguntas, setPerguntas]       = useState<PerguntaClarificacao[]>([]);
  const [loading, setLoading]           = useState(false);
  const [stageIndex, setStageIndex]     = useState(0);
  const [copied, setCopied]             = useState(false);
  const [erroAPI, setErroAPI]           = useState<string | null>(null);
  const [queue, setQueue]               = useState<TarefaQueue[]>([]);
  const [ideiaProjeto, setIdeiaProjeto] = useState("");
  const [cols] = useState(() =>
    Array.from({ length: 22 }, (_, i) => ({
      x: i * 4.8,
      delay: i * 0.32,
      // Usa índice como seed para ser determinístico no SSR e no cliente
      chars: Array.from({ length: 14 }, (_, j) => CHARS[(i * 7 + j * 3) % CHARS.length]),
      duration: 9 + (i % 5),
    }))
  );
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { try { const q=localStorage.getItem(LS_KEY_QUEUE); const p=localStorage.getItem(LS_KEY_PROJETO); const r=localStorage.getItem(LS_KEY_RESULTADO); if(q)setQueue(JSON.parse(q)); if(p)setIdeiaProjeto(JSON.parse(p)); if(r)setResultado(JSON.parse(r)); } catch{} }, []);
  useEffect(() => { if(queue.length>0)localStorage.setItem(LS_KEY_QUEUE,JSON.stringify(queue)); }, [queue]);
  useEffect(() => { if(resultado)localStorage.setItem(LS_KEY_RESULTADO,JSON.stringify(resultado)); }, [resultado]);
  useEffect(() => { if(!loading)return; const id=setInterval(()=>setStageIndex(p=>Math.min(p+1,STAGES.length-1)),4000); return ()=>clearInterval(id); }, [loading]);



  const chamarAPI = useCallback(async (opts: {
    ideiaTexto: string; forcarSimples?: boolean; respostas?: Record<string, string>;
  }) => {
    setLoading(true); setResultado(null); setStageIndex(0); setErroAPI(null);
    try {
      const body: Record<string, unknown> = {
        ideiaBruta: opts.ideiaTexto,
        forcarSimples: opts.forcarSimples ?? false,
      };
      if (papelEditado.trim()) body.papel = papelEditado.trim();
      if (tipoSelecionado)     body.tipoSugerido = tipoSelecionado;
      if (opts.respostas && Object.keys(opts.respostas).length > 0) body.respostasClarificacao = opts.respostas;
      if (executorSelecionado.trim()) body.executorAlvo = executorSelecionado.trim();

      setErroAPI(null);
      const res  = await fetch(`${API}/gerar`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body) });
      const data: any = await res.json();

      if (!res.ok) {
        const msg = data?.erro ?? data?.detalhes ?? `Erro ${res.status}`;
        setErroAPI(msg);
        return;
      }

      if (data.tipo_resposta === "clarificacao_necessaria") {
        const c = data as ClarificacaoResult;
        setPerguntas(c.perguntas);
        setTipoConfirmado(c.tipo_confirmado);
        setAppState("clarificando");
      } else if (data.tipo_resposta === "plano_de_divisao") {
        const p = data as PlanoResult;
        setTipoConfirmado(p.tipo_confirmado);
        const novas = p.sub_tarefas.map((s,i) => ({
          id:`${Date.now()}_${i}`, titulo:s.titulo, descricao:s.descricao,
          complexidade:s.complexidade as TarefaQueue["complexidade"],
          status:"aguardando" as const, tipo:p.tipo_confirmado,
        }));
        setQueue(novas); setIdeiaProjeto(opts.ideiaTexto);
        localStorage.setItem(LS_KEY_PROJETO, JSON.stringify(opts.ideiaTexto));
        setAppState("projeto");
      } else {
        const pr = data as PromptResult;
        setTipoConfirmado(pr.deteccao?.tipo_confirmado);
        setResultado(pr);
        setAppState("home");
      }
    } catch (e: any) {
      setErroAPI(`Erro de conexão: ${e?.message ?? "Verifique se a API C# está rodando em localhost:5117"}`);
    } finally { setLoading(false); }
  }, [papelEditado, tipoSelecionado, executorSelecionado]);

  if (appState === "projeto") {
    return <PaginaProjeto ideiaProjeto={ideiaProjeto} queue={queue} setQueue={setQueue} onVoltar={()=>setAppState("home")}/>;
  }

  const scoreNum   = parseInt(resultado?.pipeline?.score_qualidade ?? "0", 10);
  const scoreColor = scoreNum >= 85 ? "#a3e635" : scoreNum >= 70 ? "#facc15" : "#f87171";

  return (
    <div className="relative min-h-screen overflow-hidden flex flex-col items-center py-12 px-6" style={{background:"#030712"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
        *,*::before,*::after{font-family:'Syne',sans-serif;box-sizing:border-box}
        .mono{font-family:'JetBrains Mono',monospace!important}
        .bg-grid{background-image:linear-gradient(rgba(163,230,53,0.022) 1px,transparent 1px),linear-gradient(90deg,rgba(163,230,53,0.022) 1px,transparent 1px);background-size:44px 44px}
        .glow-input:focus{box-shadow:0 0 0 1px rgba(163,230,53,0.3),0 0 18px rgba(163,230,53,0.06)}
        .scanline::before{content:'';position:absolute;inset:0;pointer-events:none;z-index:1;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.05) 2px,rgba(0,0,0,0.05) 4px)}
        @keyframes sd{from{stroke-dashoffset:226}to{stroke-dashoffset:var(--t)}}.score-ring{animation:sd 1.2s ease-out forwards}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:rgba(163,230,53,0.18);border-radius:4px}
      `}</style>

      <div className="fixed inset-0 bg-grid pointer-events-none"/>
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        {cols.map((c,i)=><MatrixCol key={i} x={c.x} delay={c.delay} chars={c.chars} duration={c.duration}/>)}
      </div>
      <div className="fixed pointer-events-none" style={{width:700,height:700,borderRadius:"50%",top:"3%",left:"50%",transform:"translateX(-50%)",background:"radial-gradient(circle,rgba(163,230,53,0.045) 0%,transparent 65%)",filter:"blur(50px)"}}/>

      <div className="relative z-10 max-w-2xl w-full space-y-7">

        {/* Header */}
        <motion.div initial={{opacity:0,y:-20}} animate={{opacity:1,y:0}} transition={{duration:0.8,ease:[0.16,1,0.3,1]}} className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="mono text-xs text-lime-500 tracking-[0.25em] uppercase">v6.0 · Multi-objetivo + Visão</div>
            {queue.length > 0 && (
              <button onClick={()=>setAppState("projeto")}
                className="flex items-center gap-1.5 mono text-[11px] text-zinc-500 hover:text-lime-400 border border-zinc-800 hover:border-lime-500/30 px-3 py-1.5 rounded-lg transition-all">
                <FolderOpen className="w-3.5 h-3.5"/>
                Projeto ativo ({queue.filter(t=>t.status==="aguardando").length} pendentes)
              </button>
            )}
          </div>
          <h1 className="text-5xl md:text-6xl font-extrabold leading-none tracking-tighter"
            style={{background:"linear-gradient(135deg,#fff 25%,#a3e635 65%,#4ade80)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>
            Prompt<br/>
            <span style={{WebkitTextFillColor:"transparent",WebkitTextStroke:"1px rgba(163,230,53,0.4)"}}>Architect</span>
          </h1>
          <p className="text-zinc-500 text-sm max-w-xs leading-relaxed">
            Selecione o objetivo, descreva a ideia. 95%+ de força em qualquer IA.
          </p>
        </motion.div>

        {/* Form */}
        <motion.div initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} transition={{duration:0.7,delay:0.12,ease:[0.16,1,0.3,1]}} className="space-y-3">

          {/* Seletor de objetivo */}
          <div className="p-4 rounded-2xl border border-zinc-800/80 bg-zinc-900/50 space-y-3">
            <ObjetivoSelector valor={tipoSelecionado} onChange={setTipoSelecionado} tipoConfirmado={tipoConfirmado}/>
          </div>

          {/* Executor */}
          <div className="p-4 rounded-2xl border border-zinc-800/80 bg-zinc-900/50 space-y-2">
            <div className="flex items-center justify-between">
              <span className="mono text-[10px] text-zinc-600 tracking-[0.2em] uppercase">Executor</span>
              <span className="mono text-[10px] text-zinc-700">quem vai rodar este prompt</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {([
                { id:"",              label:"Qualquer IA",  icon:"✦" },
                { id:"Claude Code",   label:"Claude Code",  icon:"◆" },
                { id:"Google Jules",  label:"Jules",        icon:"◈" },
                { id:"OpenHands",     label:"OpenHands",    icon:"◉" },
                { id:"Cursor",        label:"Cursor",       icon:"◎" },
                { id:"Windsurf",      label:"Windsurf",     icon:"◍" },
              ] as {id:string;label:string;icon:string}[]).map(e => (
                <button key={e.id} onClick={()=>setExecutorSelecionado(e.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-bold transition-all ${executorSelecionado===e.id ? "border-lime-500/40 bg-lime-500/10 text-lime-400" : "border-zinc-800/60 bg-zinc-900/40 text-zinc-600 hover:text-zinc-400 hover:border-zinc-700"}`}>
                  <span className="text-[11px]">{e.icon}</span>{e.label}
                </button>
              ))}
            </div>
            {executorSelecionado && (
              <p className="mono text-[10px] text-zinc-600">
                Prompt otimizado para <span className="text-lime-500">{executorSelecionado}</span> — estrutura, verbosidade e formato adaptados.
              </p>
            )}
          </div>

          {/* Papel */}
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-zinc-800/80 bg-zinc-900/50" style={{minHeight:50}}>
            <span className="mono text-[10px] text-zinc-600 tracking-[0.2em] uppercase shrink-0">ROLE</span>
            {editandoPapel ? (
              <input ref={inputRef} value={papelEditado} onChange={e=>setPapelEditado(e.target.value)}
                onBlur={()=>setEditandoPapel(false)} onKeyDown={e=>e.key==="Enter"&&setEditandoPapel(false)}
                placeholder="ex: Especialista em prompt para Midjourney v6"
                className="flex-1 bg-transparent outline-none text-sm text-zinc-200 placeholder:text-zinc-700"/>
            ) : (
              <span className={`flex-1 text-sm truncate ${papelEditado?"text-lime-400 font-bold":resultado?.deteccao?.papel_detectado?"text-lime-400 font-bold":"text-zinc-600 italic"}`}>
                {papelEditado||resultado?.deteccao?.papel_detectado||"Detectado automaticamente ✦"}
              </span>
            )}
            <button onClick={()=>{setEditandoPapel(true);setTimeout(()=>inputRef.current?.focus(),40);}}
              className="shrink-0 p-1.5 rounded-md hover:bg-zinc-800 transition-colors group">
              <Pencil className="w-3 h-3 text-zinc-600 group-hover:text-lime-400 transition-colors"/>
            </button>
          </div>



          {/* Textarea + botão */}
          <div className="space-y-2">
            <div className="relative">
              <textarea value={ideia} onChange={e=>setIdeia(e.target.value)}
                placeholder="Descreva sua ideia. Para imagem: descreva o que quer criar. Para código: explique o problema..."
                disabled={loading}
                className="glow-input w-full h-44 p-5 bg-zinc-900/60 border border-zinc-800/80 rounded-2xl text-zinc-200 text-sm leading-relaxed placeholder:text-zinc-700 outline-none resize-none transition-all disabled:opacity-40"/>
              <span className="absolute bottom-3 right-4 mono text-[10px] text-zinc-700">{ideia.length}</span>
            </div>
            <motion.button onClick={()=>chamarAPI({ideiaTexto:ideia})}
              disabled={loading||!ideia.trim()} whileHover={{scale:1.01}} whileTap={{scale:0.98}}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-sm disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              style={{background:loading?"rgba(163,230,53,0.08)":"linear-gradient(135deg,#a3e635,#4ade80)",color:loading?"#a3e635":"#030712",border:loading?"1px solid rgba(163,230,53,0.25)":"none"}}>
              {loading
                ?<><motion.div animate={{rotate:360}} transition={{duration:1,repeat:Infinity,ease:"linear"}} className="w-4 h-4 rounded-full border-2 border-lime-500 border-t-transparent"/>Processando</>
                :<>Gerar Prompt <ArrowRight className="w-4 h-4"/></>}
            </motion.button>
          </div>
        </motion.div>

        {/* Loading */}
        <AnimatePresence>
          {loading && (
            <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}} className="space-y-1.5">
              {STAGES.map((s,i)=>{const active=i===stageIndex,done=i<stageIndex;return(
                <motion.div key={i} initial={{opacity:0,x:-8}} animate={{opacity:done?0.35:active?1:0.18,x:0}} transition={{delay:i*0.04}}
                  className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-all ${active?`${s.bg} ${s.border} border`:"border-transparent"}`}>
                  {done?<CheckCircle2 className="w-4 h-4 text-lime-500 shrink-0"/>:<Shield className={`w-4 h-4 shrink-0 ${active?s.color:"text-zinc-700"} ${active?"animate-pulse":""}`}/>}
                  <span className={`mono text-xs ${active?s.color:done?"text-zinc-700 line-through":"text-zinc-700"}`}>{s.label}</span>
                  {active&&<div className="ml-auto flex gap-1">{[0,1,2].map(d=><motion.div key={d} className="w-1 h-1 rounded-full bg-lime-500" animate={{opacity:[0.3,1,0.3]}} transition={{duration:0.9,repeat:Infinity,delay:d*0.2}}/>)}</div>}
                </motion.div>
              );})}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Erro da API */}
        <AnimatePresence>
          {erroAPI && !loading && (
            <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0}}
              className="flex items-start gap-3 px-4 py-3.5 rounded-xl border border-red-500/25 bg-red-500/5">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5"/>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-red-300">Erro na geração</p>
                <p className="mono text-[11px] text-zinc-500 mt-0.5 break-words">{erroAPI}</p>
                <p className="mono text-[10px] text-zinc-700 mt-1">Veja o console do dotnet para mais detalhes.</p>
              </div>
              <button onClick={()=>setErroAPI(null)} className="text-zinc-700 hover:text-zinc-400 transition-colors shrink-0">
                <X className="w-4 h-4"/>
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Clarificação */}
        <AnimatePresence>
          {appState==="clarificando" && !loading && (
            <ClarificacaoWidget perguntas={perguntas}
              onResponder={r=>{setAppState("home");setPerguntas([]);chamarAPI({ideiaTexto:ideia,respostas:r});}}
              onPular={()=>{setAppState("home");setPerguntas([]);chamarAPI({ideiaTexto:ideia});}}/>
          )}
        </AnimatePresence>

        {/* Resultado */}
        <AnimatePresence>
          {resultado && !loading && appState==="home" && (
            <motion.div initial={{opacity:0,y:24}} animate={{opacity:1,y:0}} transition={{duration:0.5,ease:[0.16,1,0.3,1]}} className="space-y-3">
              {/* Meta */}
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 px-4 py-3 rounded-xl border border-zinc-800/60 bg-zinc-900/40 space-y-1.5">
                  {resultado.deteccao?.tipo_confirmado && (() => {
                    const meta=OBJETIVOS[resultado.deteccao!.tipo_confirmado]; const Icon=meta.icon;
                    return (
                      <div className={`flex items-center gap-1.5 ${meta.color}`}>
                        <Icon className="w-3.5 h-3.5"/><span className="mono text-[10px] font-bold uppercase tracking-wider">{meta.label}</span>
                      </div>
                    );
                  })()}
                  <span className="text-sm font-bold text-lime-400 leading-tight block">{resultado.deteccao?.papel_detectado}</span>
                  <span className="mono text-[10px] text-zinc-600 block">{resultado.deteccao?.ferramentas_alvo}</span>
                </div>
                <div className="px-4 py-3 rounded-xl border border-zinc-800/60 bg-zinc-900/40 flex flex-col items-center justify-center">
                  <span className="mono text-[9px] text-zinc-600 tracking-widest uppercase mb-1">Score</span>
                  <svg width="56" height="56" viewBox="0 0 80 80">
                    <circle cx="40" cy="40" r="36" fill="none" stroke="#1f2937" strokeWidth="6"/>
                    <circle cx="40" cy="40" r="36" fill="none" stroke={scoreColor} strokeWidth="6" strokeLinecap="round" strokeDasharray="226" className="score-ring"
                      style={{transformOrigin:"center",transform:"rotate(-90deg)","--t":`${226-(226*scoreNum)/100}`} as React.CSSProperties}/>
                    <text x="40" y="46" textAnchor="middle" fill={scoreColor} fontSize="17" fontWeight="800" fontFamily="JetBrains Mono">{resultado?.pipeline?.score_qualidade}</text>
                  </svg>
                </div>
              </div>



              {/* Output */}
              <div className="scanline relative rounded-2xl border border-zinc-800/60 overflow-hidden" style={{background:"linear-gradient(135deg,#080d08,#030712)"}}>
                <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800/60">
                  <div className="flex items-center gap-2">
                    <motion.div className="w-2 h-2 rounded-full bg-lime-500" animate={{opacity:[1,0.3,1]}} transition={{duration:2,repeat:Infinity}}/>
                    <span className="mono text-[11px] text-zinc-500 tracking-widest uppercase">Super Prompt</span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={()=>{const b=new Blob([resultado.prompt_otimizado],{type:"text/plain"});const u=URL.createObjectURL(b);const a=document.createElement("a");a.href=u;a.download="prompt.txt";a.click();URL.revokeObjectURL(u);}}
                      className="flex items-center gap-1 mono text-[10px] text-zinc-600 hover:text-lime-400 px-2 py-1.5 rounded border border-transparent hover:border-zinc-800 transition-all">
                      <Download className="w-3 h-3"/>baixar
                    </button>
                    <motion.button onClick={()=>{navigator.clipboard.writeText(resultado.prompt_otimizado);setCopied(true);setTimeout(()=>setCopied(false),2000);}}
                      whileTap={{scale:0.94}}
                      className="flex items-center gap-1.5 mono text-[10px] px-3 py-1.5 rounded-lg border transition-all"
                      style={{borderColor:copied?"rgba(163,230,53,0.4)":"rgba(63,63,70,0.5)",color:copied?"#a3e635":"#71717a",background:copied?"rgba(163,230,53,0.05)":"transparent"}}>
                      {copied?<Check className="w-3 h-3"/>:<Copy className="w-3 h-3"/>}{copied?"COPIADO":"COPIAR"}
                    </motion.button>
                  </div>
                </div>
                <div className="relative z-10 p-5 max-h-[460px] overflow-y-auto">
                  <pre className="mono text-xs text-zinc-300 leading-[1.7] whitespace-pre-wrap break-words">{resultado.prompt_otimizado}</pre>
                </div>
                <div className="absolute bottom-0 left-0 right-0 h-10 pointer-events-none" style={{background:"linear-gradient(to top,#030712,transparent)"}}/>
              </div>
              <p className="mono text-[10px] text-zinc-700 text-center">formato · <span className="text-zinc-500">{resultado.deteccao?.formato_detectado}</span></p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}