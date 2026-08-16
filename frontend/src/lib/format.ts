/**
 * Formatação e utilitários de saída, sem dependência de React.
 */

export function baixarTexto(conteudo: string, nome: string): void {
  const url = URL.createObjectURL(new Blob([conteudo], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Títulos vêm do LLM e podem trazer `/`, `:` e afins, inválidos em nome de
 * arquivo. Mantém letras (com acento), números, espaço, hífen e underscore.
 */
export function nomeDeArquivo(titulo: string): string {
  const limpo = titulo.replace(/[^\p{L}\p{N} _-]/gu, "").trim().slice(0, 40);
  return limpo || "prompt";
}

export async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    // clipboard exige contexto seguro (https ou localhost).
    return false;
  }
}

/**
 * Converte o score do backend, que pode vir como "N/A", em número utilizável.
 * Sem esta guarda, `parseInt("N/A")` virava NaN e o `strokeDasharray` do anel
 * de score saía inválido.
 */
export function lerScore(valor: string | undefined | null): number | null {
  const n = Number.parseInt(valor ?? "", 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), 100) : null;
}

export function corDoScore(score: number | null): string {
  if (score === null) return "#71717a";
  return score >= 85 ? "#a3e635" : score >= 70 ? "#facc15" : "#f87171";
}

/** Offset do anel de score (circunferência 226). Score ausente = anel vazio. */
export function offsetDoScore(score: number | null): number {
  return score === null ? 226 : 226 - (226 * score) / 100;
}
