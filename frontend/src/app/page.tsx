"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence, Reorder, useDragControls } from "framer-motion";
import {
  ArrowRight, CheckCircle2, Copy, Check, Pencil, Zap, Shield,
  AlertTriangle, Clock, Download, Sparkles, FileText, RotateCcw,
  GripVertical, Trash2, RefreshCw, MessageSquare, Send, FolderOpen,
  Image as ImageIcon, Film, Code2, GitBranch, PenTool, Layout,
  HelpCircle, X, ChevronDown, ChevronUp
} from "lucide-react";
import { postApi, foiCancelado, mensagemDeErro } from "@/lib/api";
import { salvarLocal, lerLocal } from "@/lib/storage";
import { baixarTexto, nomeDeArquivo, copiar, lerScore, corDoScore, offsetDoScore } from "@/lib/format";

// ─────────────────────────────────────────────────────────────
// TIPOS
// ─────────────────────────────────────────────────────────────
type AppState = "home" | "clarificando" | "projeto";
type TipoObjetivo = "Imagem" | "Video" | "Codigo" | "Refatoracao" | "Copywriting" | "DesignUI" | "Outro";
type NivelDetalhe = "Conciso" | "Equilibrado" | "Exaustivo";

/** Preferências de saída enviadas ao backend em gerar e regerar. */
interface Preferencias {
  nivelDetalhe: NivelDetalhe;
  idiomaSaida: string;
  executorAlvo: string;
}

/** Versão anterior de um prompt, guardada a cada refino. */
interface VersaoPrompt {
  prompt: string;
  score: string;
  instrucao: string;
}

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
  historico?: VersaoPrompt[];
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

// A URL base vem do ambiente (ver frontend/.env.example); o localhost fica
// apenas como padrão de desenvolvimento.
const LS_KEY_QUEUE     = "pa_queue_v8";
const LS_KEY_PROJETO   = "pa_projeto_v8";
const LS_KEY_RESULTADO = "pa_resultado_v8";
const LS_KEY_PREFS     = "pa_prefs_v1";
const LS_KEY_CONTEXTO  = "pa_contexto_v1";

const PREFS_PADRAO: Preferencias = { nivelDetalhe: "Equilibrado", idiomaSaida: "auto", executorAlvo: "" };

/** Roteiro das etapas do pipeline, exibido durante a geração (estimativa). */
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
// PREFERÊNCIAS DE SAÍDA
// ─────────────────────────────────────────────────────────────
const NIVEIS: { id: NivelDetalhe; label: string; desc: string }[] = [
  { id: "Conciso",     label: "Conciso",     desc: "O essencial, sem repetição" },
  { id: "Equilibrado", label: "Equilibrado", desc: "Caminho principal e riscos prováveis" },
  { id: "Exaustivo",   label: "Exaustivo",   desc: "Casos de borda e contexto amplo" },
];

const IDIOMAS: { id: string; label: string }[] = [
  { id: "auto",  label: "Como escrevi" },
  { id: "pt-BR", label: "Português"    },
  { id: "en",    label: "Inglês"       },
];

/**
 * Executores conhecidos. Os ids batem com `ExecutorPerfis` no backend, que é
 * quem define como o prompt é moldado para cada um; aqui ficam só os rótulos.
 */
const EXECUTORES: { id: string; label: string; icon: string; desc: string }[] = [
  { id: "",             label: "Qualquer IA", icon: "✦", desc: "Prompt autocontido, sem supor acesso a arquivos ou terminal" },
  { id: "Claude Code",  label: "Claude Code", icon: "◆", desc: "Agente de terminal: objetivo e critérios verificáveis, não passo a passo" },
  { id: "Google Jules", label: "Jules",       icon: "◈", desc: "Agente assíncrono: especificação completa, sem espaço para perguntar" },
  { id: "OpenHands",    label: "OpenHands",   icon: "◉", desc: "Agente autônomo: setup, verificação e condição de parada explícitos" },
  { id: "Cursor",       label: "Cursor",      icon: "◎", desc: "Editor: escopo curto, arquivos nomeados, alteração como diff" },
  { id: "Windsurf",     label: "Windsurf",    icon: "◍", desc: "Editor com indexação: plano antes das edições, escopo de arquivos" },
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
// PREFERÊNCIAS DE SAÍDA
// ─────────────────────────────────────────────────────────────
function PreferenciasPanel({ prefs, onChange }: {
  prefs: Preferencias;
  onChange: (p: Preferencias) => void;
}) {
  const executor = EXECUTORES.find(e => e.id === prefs.executorAlvo) ?? EXECUTORES[0];

  return (
    <div className="p-4 rounded-2xl border border-zinc-800/80 bg-zinc-900/50 space-y-3">
      {/* Executor */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="mono text-[10px] text-zinc-500 tracking-[0.2em] uppercase">Executor</span>
          <span className="mono text-[10px] text-zinc-600">quem vai rodar este prompt</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {EXECUTORES.map(e => (
            <button key={e.id} onClick={() => onChange({ ...prefs, executorAlvo: e.id })}
              aria-pressed={prefs.executorAlvo === e.id} title={e.desc}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-bold transition-all ${
                prefs.executorAlvo === e.id
                  ? "border-lime-500/40 bg-lime-500/10 text-lime-400"
                  : "border-zinc-800/60 bg-zinc-900/40 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700"
              }`}>
              <span className="text-[11px]">{e.icon}</span>{e.label}
            </button>
          ))}
        </div>
        <p className="mono text-[10px] text-zinc-500 leading-relaxed">{executor.desc}.</p>
      </div>

      <div className="h-px bg-zinc-800/60" />

      {/* Nível de detalhe */}
      <div className="space-y-2">
        <span className="mono text-[10px] text-zinc-500 tracking-[0.2em] uppercase">Nível de detalhe</span>
        <div className="grid grid-cols-3 gap-2">
          {NIVEIS.map(n => (
            <button key={n.id} onClick={() => onChange({ ...prefs, nivelDetalhe: n.id })}
              aria-pressed={prefs.nivelDetalhe === n.id} title={n.desc}
              className={`px-3 py-2 rounded-xl border text-xs font-bold transition-all ${
                prefs.nivelDetalhe === n.id
                  ? "border-lime-500/40 bg-lime-500/10 text-lime-400"
                  : "border-zinc-800/60 bg-zinc-900/40 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700"
              }`}>
              {n.label}
            </button>
          ))}
        </div>
        <p className="mono text-[10px] text-zinc-500 leading-relaxed">
          {NIVEIS.find(n => n.id === prefs.nivelDetalhe)?.desc}.
        </p>
      </div>

      <div className="h-px bg-zinc-800/60" />

      {/* Idioma */}
      <div className="flex items-center gap-3">
        <span className="mono text-[10px] text-zinc-500 tracking-[0.2em] uppercase shrink-0">Idioma</span>
        <div className="flex gap-2 ml-auto">
          {IDIOMAS.map(i => (
            <button key={i.id} onClick={() => onChange({ ...prefs, idiomaSaida: i.id })}
              aria-pressed={prefs.idiomaSaida === i.id}
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                prefs.idiomaSaida === i.id
                  ? "border-lime-500/40 bg-lime-500/10 text-lime-400"
                  : "border-zinc-800/60 bg-zinc-900/40 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700"
              }`}>
              {i.label}
            </button>
          ))}
        </div>
      </div>
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
function TodoItem({ tarefa, ativo, expanded, onToggle, onEditar, onRegerar, onDeletar, onDownload, onGerar, onDragStart, onRestaurar }: {
  tarefa: TarefaQueue; ativo: boolean; expanded: boolean;
  onToggle: () => void; onEditar: (t: string, d: string) => void;
  onRegerar: (i: string) => void; onDeletar: () => void;
  onDownload: () => void; onGerar: () => void;
  onDragStart: (e: React.PointerEvent) => void;
  onRestaurar: (indice: number) => void;
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
        {/* Alça de arraste: sem onPointerDown ligado aos dragControls, o
            Reorder.Item com dragListener={false} nunca arrastava. */}
        <button onPointerDown={onDragStart} aria-label="Arrastar para reordenar"
          className="mt-1 shrink-0 cursor-grab active:cursor-grabbing touch-none text-zinc-700 hover:text-zinc-500 transition-colors">
          <GripVertical className="w-4 h-4" />
        </button>
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
                <p className={`text-xs font-bold leading-snug min-w-0 ${done?"text-zinc-500 line-through":ativo?"text-lime-300":"text-zinc-200"}`}>
                  {tarefa.titulo}
                </p>
              </div>
              {expanded && tarefa.descricao && (
                <p className="mono text-[10px] text-zinc-500 leading-relaxed mt-1">{tarefa.descricao}</p>
              )}
              {expanded && (tarefa.historico?.length ?? 0) > 0 && (
                <div className="mt-2 space-y-1 border-l border-zinc-800 pl-2">
                  <p className="mono text-[9px] text-zinc-500 uppercase tracking-widest">
                    Versões anteriores ({tarefa.historico!.length})
                  </p>
                  {tarefa.historico!.map((v, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="mono text-[9px] text-zinc-500 flex-1 leading-relaxed truncate" title={v.instrucao}>
                        v{i + 1} · {v.instrucao}
                      </span>
                      <button onClick={() => onRestaurar(i)}
                        className="mono text-[9px] text-blue-400 hover:text-blue-300 shrink-0 transition-colors">
                        restaurar
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {/* Meta + ações na mesma linha, DENTRO da coluna flexível.
                  Quando as ações ficavam numa coluna própria com shrink-0, os
                  5 botões comiam a largura da barra lateral e o título quebrava
                  letra a letra. */}
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <span className={`mono text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${meta.color} ${meta.bg}`}>
                  {tarefa.complexidade}
                </span>
                {tarefa.score && (
                  <span className="mono text-[9px] text-zinc-500">
                    score <span style={{color:corDoScore(lerScore(tarefa.score))}}>{tarefa.score}</span>
                  </span>
                )}
                {!done && !gerando && (
                  <button onClick={onGerar} className="mono text-[9px] text-blue-400 hover:text-blue-300 border border-blue-500/20 px-1.5 py-0.5 rounded transition-colors">
                    ▶ gerar
                  </button>
                )}
                <div className="flex items-center gap-0.5 ml-auto">
                  <button onClick={onToggle} aria-expanded={expanded} aria-label={expanded?"Recolher detalhes da tarefa":"Expandir detalhes da tarefa"}
                    className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors">
                    {expanded ? <ChevronUp className="w-3.5 h-3.5"/> : <ChevronDown className="w-3.5 h-3.5"/>}
                  </button>
                  <button onClick={()=>setEditando(true)} aria-label="Editar tarefa" className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-lime-400 transition-colors"><Pencil className="w-3.5 h-3.5"/></button>
                  {done && <>
                    <button onClick={()=>setShowReg(r=>!r)} aria-label="Regerar prompt desta tarefa" className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-blue-400 transition-colors"><RefreshCw className="w-3.5 h-3.5"/></button>
                    <button onClick={onDownload} aria-label="Baixar prompt desta tarefa" className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-lime-400 transition-colors"><Download className="w-3.5 h-3.5"/></button>
                  </>}
                  <button onClick={onDeletar} aria-label="Excluir tarefa" className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5"/></button>
                </div>
              </div>
            </>
          )}
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

/**
 * Envolve o item da fila com os `dragControls` do framer-motion.
 * Os controls precisam ser criados no componente que renderiza o `Reorder.Item`,
 * por isso o filho vem como render prop que recebe o disparador de arraste.
 */
function TarefaArrastavel({ tarefa, children }: {
  tarefa: TarefaQueue;
  children: (iniciarArraste: (e: React.PointerEvent) => void) => React.ReactNode;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item value={tarefa} dragListener={false} dragControls={controls}>
      {children(e => controls.start(e))}
    </Reorder.Item>
  );
}

// ─────────────────────────────────────────────────────────────
// PÁGINA DE PROJETO
// ─────────────────────────────────────────────────────────────
function PaginaProjeto({ ideiaProjeto, queue, setQueue, prefs, onVoltar }: {
  ideiaProjeto: string; queue: TarefaQueue[];
  setQueue: React.Dispatch<React.SetStateAction<TarefaQueue[]>>;
  prefs: Preferencias; onVoltar: () => void;
}) {
  const [tarefaAtivaId, setTarefaAtivaId] = useState<string|null>(null);
  const [expandedIds, setExpandedIds]     = useState<Set<string>>(new Set());
  const [promptAtivo, setPromptAtivo]     = useState<string|null>(null);
  const [tarefaPromptId, setTarefaPromptId] = useState<string|null>(null);
  const [loading, setLoading]             = useState(false);
  const [stageIndex, setStageIndex]       = useState(0);
  const [atividade, setAtividade]         = useState<{ok:boolean;texto:string}[]>([]);
  const [contexto, setContexto]           = useState("");
  const [erro, setErro]                   = useState<string|null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // Contexto compartilhado do projeto, injetado em toda geração de sub-tarefa.
  useEffect(() => { setContexto(lerLocal<string>(LS_KEY_CONTEXTO) ?? ""); }, []);
  const salvarContexto = (valor: string) => { setContexto(valor); salvarLocal(LS_KEY_CONTEXTO, valor || null); };

  useEffect(() => { logRef.current?.scrollTo({top:logRef.current.scrollHeight,behavior:"smooth"}); }, [atividade]);
  useEffect(() => { if(!loading)return; const id=setInterval(()=>setStageIndex(p=>Math.min(p+1,STAGES.length-1)),4000); return ()=>clearInterval(id); }, [loading]);

  const toggleExpand = (id:string) => setExpandedIds(s=>{
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const gerarTarefa = useCallback(async (tarefa:TarefaQueue) => {
    setLoading(true); setStageIndex(0); setTarefaAtivaId(tarefa.id); setErro(null);
    setQueue(q=>q.map(t=>t.id===tarefa.id?{...t,status:"gerando"}:t));
    try {
      const data = await postApi<PromptResult>("gerar", {
        ideiaBruta: `${tarefa.titulo}: ${tarefa.descricao}`,
        forcarSimples: true,
        tipoSugerido: tarefa.tipo,
        contextoProjeto: contexto.trim() || undefined,
        ...prefs,
      });

      if (data.tipo_resposta !== "prompt_gerado" || !data.prompt_otimizado)
        throw new Error("A API não devolveu um prompt para esta tarefa.");

      setQueue(q=>q.map(t=>t.id===tarefa.id?{...t,status:"concluido",prompt:data.prompt_otimizado,score:data.pipeline?.score_qualidade,papel:data.deteccao?.papel_detectado}:t));
      setPromptAtivo(data.prompt_otimizado); setTarefaPromptId(tarefa.id);
      setAtividade(a=>[...a,{ok:true,texto:`Prompt gerado para "${tarefa.titulo}" · score ${data.pipeline?.score_qualidade}`}]);
    } catch (e) {
      // Sem este reset a tarefa ficava presa em "gerando" para sempre.
      const msg = mensagemDeErro(e);
      setErro(msg);
      setQueue(q=>q.map(t=>t.id===tarefa.id?{...t,status:"aguardando"}:t));
      setAtividade(a=>[...a,{ok:false,texto:`Falha ao gerar "${tarefa.titulo}": ${msg}`}]);
    }
    finally { setLoading(false); setTarefaAtivaId(null); }
  },[setQueue, contexto, prefs]);

  const regerarTarefa = useCallback(async (tarefa:TarefaQueue, instrucao:string) => {
    if(!tarefa.prompt)return;
    setLoading(true); setStageIndex(4); setTarefaAtivaId(tarefa.id); setErro(null);
    setQueue(q=>q.map(t=>t.id===tarefa.id?{...t,status:"gerando"}:t));
    try {
      const data = await postApi<PromptResult>("regerar", {
        promptAtual: tarefa.prompt,
        instrucaoMelhora: instrucao,
        papel: tarefa.papel,
        tipoObjetivo: tarefa.tipo,
        ...prefs,
      });

      if (!data.prompt_otimizado)
        throw new Error("A API não devolveu o prompt regerado.");

      setQueue(q=>q.map(t=>t.id===tarefa.id?{...t,status:"concluido",historico:[...(t.historico??[]),{prompt:t.prompt!,score:t.score??"N/A",instrucao}],prompt:data.prompt_otimizado,score:data.pipeline?.score_qualidade}:t));
      setPromptAtivo(data.prompt_otimizado);
      setAtividade(a=>[...a,{ok:true,texto:`Prompt de "${tarefa.titulo}" regerado · score ${data.pipeline?.score_qualidade}`}]);
    } catch (e) {
      const msg = mensagemDeErro(e);
      setErro(msg);
      setQueue(q=>q.map(t=>t.id===tarefa.id?{...t,status:"concluido"}:t));
      setAtividade(a=>[...a,{ok:false,texto:`Falha ao regerar "${tarefa.titulo}": ${msg}`}]);
    }
    finally { setLoading(false); setTarefaAtivaId(null); }
  },[setQueue, prefs]);

  /** Volta uma tarefa para uma versão anterior do prompt, descartando as posteriores. */
  const restaurarVersao = useCallback((tarefa: TarefaQueue, indice: number) => {
    const versao = tarefa.historico?.[indice];
    if (!versao) return;
    setQueue(q => q.map(t => t.id === tarefa.id
      ? { ...t, prompt: versao.prompt, score: versao.score, historico: t.historico?.slice(0, indice) }
      : t));
    setPromptAtivo(versao.prompt);
    setTarefaPromptId(tarefa.id);
    setAtividade(a => [...a, { ok: true, texto: `Restaurada a versão v${indice + 1} de "${tarefa.titulo}"` }]);
  }, [setQueue]);

  const dl = (t:TarefaQueue) => { if(!t.prompt)return; baixarTexto(t.prompt, `${nomeDeArquivo(t.titulo)}.txt`); };
  const concluidos=queue.filter(t=>t.status==="concluido").length;
  const total=queue.length;
  const progresso=total>0?Math.round((concluidos/total)*100):0;
  const proxima=queue.find(t=>t.status==="aguardando");

  return (
    <div className="min-h-screen flex flex-col" style={{background:"#030712"}}>
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
        <div className="w-96 shrink-0 border-r border-zinc-800/60 flex flex-col" style={{background:"rgba(3,7,18,0.95)"}}>
          <div className="px-4 py-3 border-b border-zinc-800/40 flex items-center justify-between">
            <span className="mono text-[10px] text-zinc-600 tracking-widest uppercase">To-do list</span>
            <span className="mono text-[10px] text-zinc-700">{concluidos}/{total}</span>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            <Reorder.Group axis="y" values={queue} onReorder={setQueue} className="space-y-2">
              {queue.map((tarefa)=>(
                <TarefaArrastavel key={tarefa.id} tarefa={tarefa}>
                  {(iniciarArraste)=>(
                    <TodoItem tarefa={tarefa} ativo={tarefa.id===tarefaAtivaId}
                      expanded={expandedIds.has(tarefa.id)} onToggle={()=>toggleExpand(tarefa.id)}
                      onEditar={(t,d)=>setQueue(q=>q.map(x=>x.id===tarefa.id?{...x,titulo:t,descricao:d}:x))}
                      onRegerar={instr=>regerarTarefa(tarefa,instr)}
                      onDeletar={()=>setQueue(q=>q.filter(x=>x.id!==tarefa.id))}
                      onDownload={()=>dl(tarefa)} onGerar={()=>gerarTarefa(tarefa)}
                      onDragStart={iniciarArraste}
                      onRestaurar={(i)=>restaurarVersao(tarefa,i)}/>
                  )}
                </TarefaArrastavel>
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
          <AnimatePresence>
            {erro && (
              <motion.div initial={{opacity:0,y:-8}} animate={{opacity:1,y:0}} exit={{opacity:0}} role="alert"
                className="m-4 flex items-start gap-3 px-4 py-3 rounded-xl border border-red-500/25 bg-red-500/5">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5"/>
                <p className="mono text-[11px] text-red-200 break-words flex-1">{erro}</p>
                <button onClick={()=>setErro(null)} aria-label="Fechar aviso de erro"
                  className="text-zinc-600 hover:text-zinc-300 transition-colors shrink-0"><X className="w-4 h-4"/></button>
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
                    <button onClick={async()=>{ if(!await copiar(promptAtivo)) setErro("Não foi possível copiar: o navegador bloqueia a área de transferência fora de https ou localhost."); }} className="flex items-center gap-1 mono text-[10px] text-zinc-600 hover:text-lime-400 px-2 py-1.5 rounded border border-transparent hover:border-zinc-800 transition-all"><Copy className="w-3 h-3"/>copiar</button>
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

        {/* Contexto do projeto + atividade.
            Substitui o antigo "chat", que respondia com um texto fixo por
            setTimeout e não falava com nenhum backend. O contexto digitado aqui
            é injetado em toda geração de sub-tarefa. */}
        <div className="w-72 shrink-0 border-l border-zinc-800/60 flex flex-col" style={{background:"rgba(3,7,18,0.95)"}}>
          <div className="px-4 py-3 border-b border-zinc-800/40 flex items-center gap-2">
            <FileText className="w-4 h-4 text-zinc-500"/>
            <label htmlFor="contexto-projeto" className="mono text-[10px] text-zinc-500 tracking-widest uppercase">
              Contexto do projeto
            </label>
          </div>
          <div className="p-3 space-y-2 border-b border-zinc-800/40">
            <textarea id="contexto-projeto" value={contexto} onChange={e=>salvarContexto(e.target.value)}
              rows={7} placeholder="Stack, convenções, restrições... Vale para todas as tarefas deste projeto."
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-lime-500/30 resize-none leading-relaxed transition-colors"/>
            <p className="mono text-[10px] text-zinc-500">
              {contexto.trim()
                ? "Enviado junto com cada tarefa gerada."
                : "Sem contexto, cada sub-tarefa é gerada isolada."}
            </p>
          </div>

          <div className="px-4 py-2 border-b border-zinc-800/40 flex items-center gap-2">
            <MessageSquare className="w-3.5 h-3.5 text-zinc-500"/>
            <span className="mono text-[10px] text-zinc-500 tracking-widest uppercase">Atividade</span>
          </div>
          <div ref={logRef} className="flex-1 overflow-y-auto p-3 space-y-2">
            {atividade.length===0 ? (
              <p className="mono text-[11px] text-zinc-600 text-center pt-6">Nada gerado ainda.</p>
            ) : atividade.map((m,i)=>(
              <motion.div key={i} initial={{opacity:0,y:4}} animate={{opacity:1,y:0}}
                className={`px-3 py-2 rounded-lg text-[11px] leading-relaxed border ${
                  m.ok ? "bg-zinc-800/40 border-zinc-700/40 text-zinc-300"
                       : "bg-red-500/5 border-red-500/25 text-red-200"}`}>
                {m.ok ? "✓" : "✕"} {m.texto}
              </motion.div>
            ))}
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
  const [prefs, setPrefs]               = useState<Preferencias>(PREFS_PADRAO);
  const [perguntas, setPerguntas]       = useState<PerguntaClarificacao[]>([]);
  const [loading, setLoading]           = useState(false);
  const [stageIndex, setStageIndex]     = useState(0);
  const [decorrido, setDecorrido]       = useState(0);
  const [copied, setCopied]             = useState(false);
  const [erroAPI, setErroAPI]           = useState<string | null>(null);
  const [queue, setQueue]               = useState<TarefaQueue[]>([]);
  const [ideiaProjeto, setIdeiaProjeto] = useState("");
  const [versoes, setVersoes]           = useState<VersaoPrompt[]>([]);
  const [instrucaoRefino, setInstrucaoRefino] = useState("");
  const [mostrarRefino, setMostrarRefino]     = useState(false);
  const abortRef = useRef<AbortController | null>(null);
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

  // Restaura o estado salvo apenas no cliente, para não divergir do HTML do SSR.
  const [hidratado, setHidratado] = useState(false);
  useEffect(() => {
    const q = lerLocal<TarefaQueue[]>(LS_KEY_QUEUE);
    const p = lerLocal<string>(LS_KEY_PROJETO);
    const r = lerLocal<PromptResult>(LS_KEY_RESULTADO);
    const f = lerLocal<Partial<Preferencias>>(LS_KEY_PREFS);
    if (Array.isArray(q)) setQueue(q);
    if (typeof p === "string") setIdeiaProjeto(p);
    if (r?.prompt_otimizado) setResultado(r);
    if (f) setPrefs({ ...PREFS_PADRAO, ...f });
    setHidratado(true);
  }, []);

  // Só persiste depois de hidratar: gravar antes sobrescreveria o estado salvo
  // com os valores iniciais vazios.
  useEffect(() => { if(hidratado) salvarLocal(LS_KEY_QUEUE, queue); }, [queue, hidratado]);
  useEffect(() => { if(hidratado) salvarLocal(LS_KEY_RESULTADO, resultado); }, [resultado, hidratado]);
  useEffect(() => { if(hidratado) salvarLocal(LS_KEY_PROJETO, ideiaProjeto || null); }, [ideiaProjeto, hidratado]);
  useEffect(() => { if(hidratado) salvarLocal(LS_KEY_PREFS, prefs); }, [prefs, hidratado]);

  useEffect(() => { if(!loading)return; const id=setInterval(()=>setStageIndex(p=>Math.min(p+1,STAGES.length-1)),4000); return ()=>clearInterval(id); }, [loading]);

  // Tempo decorrido: o avanço das etapas é estimado, então mostrar o relógio
  // real evita passar a impressão de progresso medido.
  useEffect(() => {
    if (!loading) { setDecorrido(0); return; }
    const inicio = Date.now();
    const id = setInterval(() => setDecorrido(Math.round((Date.now() - inicio) / 1000)), 1000);
    return () => clearInterval(id);
  }, [loading]);

  // Cancela a geração em curso. O backend encadeia o cancelamento e para de
  // gastar chamadas ao OpenRouter.
  const cancelar = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
  }, []);



  const chamarAPI = useCallback(async (opts: {
    ideiaTexto: string; forcarSimples?: boolean; respostas?: Record<string, string>;
  }) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true); setResultado(null); setVersoes([]); setStageIndex(0); setErroAPI(null);
    try {
      const body: Record<string, unknown> = {
        ideiaBruta: opts.ideiaTexto,
        forcarSimples: opts.forcarSimples ?? false,
        ...prefs,
      };
      if (papelEditado.trim()) body.papel = papelEditado.trim();
      if (tipoSelecionado)     body.tipoSugerido = tipoSelecionado;
      if (opts.respostas && Object.keys(opts.respostas).length > 0) body.respostasClarificacao = opts.respostas;

      const data = await postApi<ResultData>("gerar", body, controller.signal);

      if (data.tipo_resposta === "clarificacao_necessaria") {
        setPerguntas(data.perguntas ?? []);
        setTipoConfirmado(data.tipo_confirmado);
        setAppState("clarificando");
      } else if (data.tipo_resposta === "plano_de_divisao") {
        setTipoConfirmado(data.tipo_confirmado);
        const novas: TarefaQueue[] = (data.sub_tarefas ?? []).map((s,i) => ({
          id:`${Date.now()}_${i}`, titulo:s.titulo, descricao:s.descricao,
          complexidade:s.complexidade, status:"aguardando" as const, tipo:data.tipo_confirmado,
        }));
        setQueue(novas);
        setIdeiaProjeto(opts.ideiaTexto);
        setAppState("projeto");
      } else {
        setTipoConfirmado(data.deteccao?.tipo_confirmado);
        setResultado(data);
        setAppState("home");
      }
    } catch (e) {
      // Cancelamento é ação do usuário, não erro a reportar.
      if (!foiCancelado(e)) setErroAPI(mensagemDeErro(e));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
    }
  }, [papelEditado, tipoSelecionado, prefs]);

  /**
   * Refina o prompt já gerado sem recomeçar o pipeline.
   * O endpoint /regerar existia desde o começo, mas só a página de projeto o
   * usava — no fluxo principal não havia como iterar sobre o resultado.
   */
  const refinar = useCallback(async (instrucao: string) => {
    if (!resultado || !instrucao.trim()) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const anterior = resultado;
    setLoading(true); setStageIndex(4); setErroAPI(null); setMostrarRefino(false);
    try {
      const data = await postApi<PromptResult>("regerar", {
        promptAtual: anterior.prompt_otimizado,
        instrucaoMelhora: instrucao.trim(),
        papel: anterior.deteccao?.papel_detectado,
        formato: anterior.deteccao?.formato_detectado,
        tipoObjetivo: anterior.tipo_objetivo,
        ...prefs,
      }, controller.signal);

      if (!data.prompt_otimizado) throw new Error("A API não devolveu o prompt refinado.");

      setVersoes(v => [...v, {
        prompt: anterior.prompt_otimizado,
        score: anterior.pipeline?.score_qualidade ?? "N/A",
        instrucao: instrucao.trim(),
      }]);
      setResultado({ ...anterior, ...data, deteccao: anterior.deteccao });
      setInstrucaoRefino("");
    } catch (e) {
      if (!foiCancelado(e)) setErroAPI(mensagemDeErro(e));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
    }
  }, [resultado, prefs]);

  /** Volta para uma versão anterior, descartando os refinos posteriores. */
  const restaurarVersao = useCallback((indice: number) => {
    setVersoes(v => {
      const alvo = v[indice];
      if (!alvo) return v;
      setResultado(r => r && ({
        ...r,
        prompt_otimizado: alvo.prompt,
        pipeline: { ...r.pipeline, score_qualidade: alvo.score },
      }));
      return v.slice(0, indice);
    });
  }, []);

  if (appState === "projeto") {
    return <PaginaProjeto ideiaProjeto={ideiaProjeto} queue={queue} setQueue={setQueue}
      prefs={prefs} onVoltar={()=>setAppState("home")}/>;
  }

  // O backend pode devolver "N/A"; sem esta guarda o valor virava NaN e o
  // strokeDasharray do anel de score saía inválido.
  const scoreNum   = lerScore(resultado?.pipeline?.score_qualidade);
  const scoreColor = corDoScore(scoreNum);
  const scoreDash  = offsetDoScore(scoreNum);

  return (
    <div className="relative min-h-screen overflow-hidden flex flex-col items-center py-12 px-6" style={{background:"#030712"}}>
      <div className="fixed inset-0 bg-grid pointer-events-none"/>
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        {cols.map((c,i)=><MatrixCol key={i} x={c.x} delay={c.delay} chars={c.chars} duration={c.duration}/>)}
      </div>
      <div className="fixed pointer-events-none" style={{width:700,height:700,borderRadius:"50%",top:"3%",left:"50%",transform:"translateX(-50%)",background:"radial-gradient(circle,rgba(163,230,53,0.045) 0%,transparent 65%)",filter:"blur(50px)"}}/>

      <div className="relative z-10 max-w-2xl w-full space-y-7">

        {/* Header */}
        <motion.div initial={{opacity:0,y:-20}} animate={{opacity:1,y:0}} transition={{duration:0.8,ease:[0.16,1,0.3,1]}} className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="mono text-xs text-lime-500 tracking-[0.25em] uppercase">v6.0 · Multi-objetivo</div>
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
          <p className="text-zinc-400 text-sm max-w-sm leading-relaxed">
            Selecione o objetivo e descreva a ideia. Um pipeline de agentes
            classifica, analisa, gera e audita o prompt final.
          </p>
        </motion.div>

        {/* Form */}
        <motion.div initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} transition={{duration:0.7,delay:0.12,ease:[0.16,1,0.3,1]}} className="space-y-3">

          {/* Seletor de objetivo */}
          <div className="p-4 rounded-2xl border border-zinc-800/80 bg-zinc-900/50 space-y-3">
            <ObjetivoSelector valor={tipoSelecionado} onChange={setTipoSelecionado} tipoConfirmado={tipoConfirmado}/>
          </div>

          {/* Preferências de saída: executor, nível de detalhe e idioma */}
          <PreferenciasPanel prefs={prefs} onChange={setPrefs} />

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
              aria-label="Editar o papel técnico usado no prompt"
              className="shrink-0 p-1.5 rounded-md hover:bg-zinc-800 transition-colors group">
              <Pencil className="w-3 h-3 text-zinc-600 group-hover:text-lime-400 transition-colors"/>
            </button>
          </div>



          {/* Textarea + botão */}
          <div className="space-y-2">
            <div className="relative">
              <textarea value={ideia} onChange={e=>setIdeia(e.target.value)}
                onKeyDown={e=>{ if((e.metaKey||e.ctrlKey)&&e.key==="Enter"&&ideia.trim()&&!loading) chamarAPI({ideiaTexto:ideia}); }}
                placeholder="Descreva sua ideia. Para imagem: descreva o que quer criar. Para código: explique o problema..."
                disabled={loading} aria-label="Descreva sua ideia"
                className="glow-input w-full h-44 p-5 bg-zinc-900/60 border border-zinc-800/80 rounded-2xl text-zinc-200 text-sm leading-relaxed placeholder:text-zinc-600 outline-none resize-none transition-all disabled:opacity-40"/>
              <span className="absolute bottom-3 right-4 mono text-[10px] text-zinc-500">{ideia.length}</span>
            </div>
            <div className="flex gap-2">
              <motion.button onClick={()=>chamarAPI({ideiaTexto:ideia})}
                disabled={loading||!ideia.trim()} whileHover={{scale:1.01}} whileTap={{scale:0.98}}
                className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-sm disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                style={{background:loading?"rgba(163,230,53,0.08)":"linear-gradient(135deg,#a3e635,#4ade80)",color:loading?"#a3e635":"#030712",border:loading?"1px solid rgba(163,230,53,0.25)":"none"}}>
                {loading
                  ?<><motion.div animate={{rotate:360}} transition={{duration:1,repeat:Infinity,ease:"linear"}} className="w-4 h-4 rounded-full border-2 border-lime-500 border-t-transparent"/>Processando · {decorrido}s</>
                  :<>Gerar Prompt <ArrowRight className="w-4 h-4"/></>}
              </motion.button>
              {loading && (
                <button onClick={cancelar}
                  className="px-4 py-3.5 rounded-xl text-xs font-bold text-zinc-400 hover:text-red-300 border border-zinc-800 hover:border-red-500/30 transition-colors">
                  Cancelar
                </button>
              )}
            </div>
            <p className="mono text-[10px] text-zinc-600 text-center">
              {loading ? "Cancelar interrompe também as chamadas no backend." : "⌘/Ctrl + Enter para gerar"}
            </p>
          </div>
        </motion.div>

        {/* Loading */}
        <AnimatePresence>
          {loading && (
            <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}} className="space-y-1.5" aria-live="polite">
              {/* As etapas do pipeline são um roteiro, não medição: o backend não
                  reporta progresso, então nenhuma etapa é marcada como concluída. */}
              <div className="flex items-center justify-between px-4 pb-1">
                <span className="mono text-[10px] text-zinc-500 tracking-widest uppercase">Etapas do pipeline</span>
                <span className="mono text-[10px] text-zinc-500">estimativa · {decorrido}s</span>
              </div>
              {STAGES.map((s,i)=>{const active=i===stageIndex;return(
                <motion.div key={i} initial={{opacity:0,x:-8}} animate={{opacity:active?1:0.3,x:0}} transition={{delay:i*0.04}}
                  className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-all ${active?`${s.bg} ${s.border} border`:"border-transparent"}`}>
                  <Shield className={`w-4 h-4 shrink-0 ${active?s.color:"text-zinc-600"} ${active?"animate-pulse":""}`}/>
                  <span className={`mono text-xs ${active?s.color:"text-zinc-500"}`}>{s.label}</span>
                  {active&&<div className="ml-auto flex gap-1">{[0,1,2].map(d=><motion.div key={d} className="w-1 h-1 rounded-full bg-lime-500" animate={{opacity:[0.3,1,0.3]}} transition={{duration:0.9,repeat:Infinity,delay:d*0.2}}/>)}</div>}
                </motion.div>
              );})}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Erro da API */}
        <AnimatePresence>
          {erroAPI && !loading && (
            <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0}} role="alert"
              className="flex items-start gap-3 px-4 py-3.5 rounded-xl border border-red-500/25 bg-red-500/5">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5"/>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-red-300">Erro na geração</p>
                <p className="mono text-[11px] text-zinc-500 mt-0.5 break-words">{erroAPI}</p>
                <p className="mono text-[10px] text-zinc-700 mt-1">Veja o console do dotnet para mais detalhes.</p>
              </div>
              <button onClick={()=>setErroAPI(null)} aria-label="Fechar aviso de erro" className="text-zinc-700 hover:text-zinc-400 transition-colors shrink-0">
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
                      style={{transformOrigin:"center",transform:"rotate(-90deg)","--t":`${scoreDash}`} as React.CSSProperties}/>
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
                    <button onClick={()=>baixarTexto(resultado.prompt_otimizado,"prompt.txt")}
                      className="flex items-center gap-1 mono text-[10px] text-zinc-600 hover:text-lime-400 px-2 py-1.5 rounded border border-transparent hover:border-zinc-800 transition-all">
                      <Download className="w-3 h-3"/>baixar
                    </button>
                    <motion.button onClick={async()=>{
                        if (await copiar(resultado.prompt_otimizado)) { setCopied(true); setTimeout(()=>setCopied(false),2000); }
                        else setErroAPI("Não foi possível copiar: o navegador bloqueia a área de transferência fora de https ou localhost.");
                      }}
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

              {/* Refino: itera sobre o prompt sem recomeçar o pipeline inteiro */}
              <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 overflow-hidden">
                <button onClick={()=>setMostrarRefino(r=>!r)} aria-expanded={mostrarRefino}
                  className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-zinc-900/60 transition-colors">
                  <RefreshCw className="w-3.5 h-3.5 text-blue-400 shrink-0"/>
                  <span className="text-xs font-bold text-zinc-300">Refinar este prompt</span>
                  <span className="mono text-[10px] text-zinc-500 ml-auto">
                    {versoes.length > 0 ? `${versoes.length} refino${versoes.length>1?"s":""}` : "sem recomeçar do zero"}
                  </span>
                  {mostrarRefino ? <ChevronUp className="w-3.5 h-3.5 text-zinc-500"/> : <ChevronDown className="w-3.5 h-3.5 text-zinc-500"/>}
                </button>

                <AnimatePresence>
                  {mostrarRefino && (
                    <motion.div initial={{opacity:0,height:0}} animate={{opacity:1,height:"auto"}} exit={{opacity:0,height:0}}
                      className="overflow-hidden border-t border-zinc-800/60 px-4 py-3 space-y-2">
                      <div className="flex gap-2">
                        <input value={instrucaoRefino} onChange={e=>setInstrucaoRefino(e.target.value)}
                          onKeyDown={e=>{ if(e.key==="Enter") refinar(instrucaoRefino); }}
                          disabled={loading} aria-label="O que melhorar no prompt"
                          placeholder="ex: mais específico na stack, adicione tratamento de erro..."
                          className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-blue-500/30 disabled:opacity-40 transition-colors"/>
                        <button onClick={()=>refinar(instrucaoRefino)} disabled={loading||!instrucaoRefino.trim()}
                          aria-label="Aplicar refino"
                          className="px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-400 disabled:opacity-30 hover:bg-blue-500/20 transition-colors">
                          <Send className="w-3.5 h-3.5"/>
                        </button>
                      </div>
                      <p className="mono text-[10px] text-zinc-500">
                        O prompt atual é preservado no histórico antes de cada refino.
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>

                {versoes.length > 0 && (
                  <div className="border-t border-zinc-800/60 px-4 py-3 space-y-1.5">
                    <p className="mono text-[10px] text-zinc-500 uppercase tracking-widest">Histórico</p>
                    {versoes.map((v,i)=>(
                      <div key={i} className="flex items-center gap-2">
                        <RotateCcw className="w-3 h-3 text-zinc-600 shrink-0"/>
                        <span className="mono text-[10px] text-zinc-400 flex-1 truncate" title={v.instrucao}>
                          v{i+1} · {v.instrucao}
                        </span>
                        <span className="mono text-[10px] text-zinc-500 shrink-0">score {v.score}</span>
                        <button onClick={()=>restaurarVersao(i)}
                          className="mono text-[10px] text-blue-400 hover:text-blue-300 shrink-0 transition-colors">
                          restaurar
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <p className="mono text-[10px] text-zinc-600 text-center">formato · <span className="text-zinc-400">{resultado.deteccao?.formato_detectado}</span></p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}