/**
 * Cliente HTTP do backend .NET.
 *
 * Extraído de `page.tsx` para ser testável sem montar a árvore de componentes:
 * as três falhas que ele trata — status de erro, corpo vazio e corpo não-JSON —
 * são exatamente as que passavam batido quando o `fetch` vivia inline.
 */

/** URL base do backend. Sem barra no final. Ver `frontend/.env.example`. */
export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:5117").replace(/\/+$/, "");

export const API = `${API_BASE}/api/prompt`;

/**
 * Chave enviada em `X-Api-Key` quando o backend exige (`ApiProtecao:ApiKey`).
 *
 * ATENÇÃO: por ser `NEXT_PUBLIC_`, este valor vai para o bundle e é visível a
 * qualquer pessoa que abra a página. Serve contra abuso casual e automatizado,
 * não contra um usuário determinado. Para um deploy realmente público, a chave
 * deve ficar do lado do servidor, atrás de um route handler que faça proxy para
 * o backend.
 */
const API_KEY = process.env.NEXT_PUBLIC_API_KEY ?? "";

function cabecalhos(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (API_KEY) h["X-Api-Key"] = API_KEY;
  return h;
}

/** Corpo de erro devolvido pelo backend (contrato de `PromptController`). */
export interface ApiErro {
  erro?: string;
  detalhes?: string;
  trace_id?: string;
}

/**
 * Lê a resposta tratando os três casos que um `await res.json()` cru ignora:
 * status de erro, corpo vazio e corpo que não é JSON. Sem isso, um 500 vira um
 * objeto sem os campos esperados e o chamador segue como se nada tivesse
 * acontecido.
 */
export async function lerRespostaApi<T>(res: Response): Promise<T> {
  const texto = await res.text();

  let data: unknown = null;
  if (texto) {
    try { data = JSON.parse(texto); } catch { /* resposta não-JSON: tratada abaixo */ }
  }

  if (!res.ok) {
    const erro = data as ApiErro | null;
    throw new Error(
      erro?.erro ?? erro?.detalhes ?? `Erro ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`
    );
  }

  if (data === null) throw new Error("A API respondeu sem conteúdo utilizável.");

  return data as T;
}

export async function postApi<T>(rota: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}/${rota}`, {
      method: "POST",
      headers: cabecalhos(),
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    // Cancelamento pelo usuário não é falha de conexão: propaga para o chamador
    // distinguir (o backend também aborta as chamadas ao OpenRouter).
    if (foiCancelado(e)) throw e;
    throw new Error(`Não foi possível falar com a API em ${API_BASE}. Verifique se o backend está rodando.`);
  }
  return lerRespostaApi<T>(res);
}

export function foiCancelado(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

export function mensagemDeErro(e: unknown): string {
  return e instanceof Error ? e.message : "Erro desconhecido.";
}
