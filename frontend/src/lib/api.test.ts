import { describe, it, expect, vi, afterEach } from "vitest";
import { lerRespostaApi, postApi, foiCancelado, mensagemDeErro } from "./api";

/** Monta uma Response sintetica sem depender de rede. */
function resposta(body: string, init: ResponseInit = {}): Response {
  return new Response(body, { status: 200, ...init });
}

afterEach(() => vi.restoreAllMocks());

describe("lerRespostaApi", () => {
  it("devolve o corpo tipado em caso de sucesso", async () => {
    const r = await lerRespostaApi<{ tipo_resposta: string }>(
      resposta(JSON.stringify({ tipo_resposta: "prompt_gerado" }))
    );
    expect(r.tipo_resposta).toBe("prompt_gerado");
  });

  // Regressao: o codigo original chamava res.json() sem checar res.ok, entao um
  // 500 virava um objeto sem os campos esperados e o chamador seguia adiante.
  it("lanca usando o campo 'erro' do backend quando o status e de falha", async () => {
    await expect(
      lerRespostaApi(resposta(JSON.stringify({ erro: "Etapa 1 falhou" }), { status: 502 }))
    ).rejects.toThrow("Etapa 1 falhou");
  });

  it("cai para 'detalhes' quando nao ha 'erro'", async () => {
    await expect(
      lerRespostaApi(resposta(JSON.stringify({ detalhes: "rate limit" }), { status: 429 }))
    ).rejects.toThrow("rate limit");
  });

  it("usa status e statusText quando o corpo do erro nao e JSON", async () => {
    await expect(
      lerRespostaApi(resposta("<html>502 Bad Gateway</html>", { status: 502, statusText: "Bad Gateway" }))
    ).rejects.toThrow("Erro 502 Bad Gateway");
  });

  it("rejeita corpo vazio com status 200", async () => {
    await expect(lerRespostaApi(resposta(""))).rejects.toThrow("sem conteúdo utilizável");
  });

  it("rejeita corpo nao-JSON com status 200", async () => {
    await expect(lerRespostaApi(resposta("nao sou json"))).rejects.toThrow("sem conteúdo utilizável");
  });
});

describe("postApi", () => {
  it("envia POST com JSON e devolve o corpo", async () => {
    const fetchMock = vi.fn().mockResolvedValue(resposta(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);

    const r = await postApi<{ ok: boolean }>("gerar", { ideiaBruta: "teste" });

    expect(r.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/prompt\/gerar$/);
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ ideiaBruta: "teste" });
  });

  it("traduz falha de rede em mensagem que aponta a URL configurada", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(postApi("gerar", {})).rejects.toThrow(/Verifique se o backend está rodando/);
  });

  // Cancelamento e acao do usuario: precisa chegar ao chamador como AbortError
  // para nao virar um banner de "erro de conexao".
  it("propaga AbortError sem mascarar", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError")));
    await expect(postApi("gerar", {})).rejects.toSatisfy(foiCancelado);
  });
});

describe("foiCancelado", () => {
  it("reconhece apenas AbortError", () => {
    expect(foiCancelado(new DOMException("x", "AbortError"))).toBe(true);
    expect(foiCancelado(new DOMException("x", "TimeoutError"))).toBe(false);
    expect(foiCancelado(new Error("AbortError"))).toBe(false);
    expect(foiCancelado(null)).toBe(false);
  });
});

describe("mensagemDeErro", () => {
  it("extrai a mensagem de um Error", () => {
    expect(mensagemDeErro(new Error("falhou"))).toBe("falhou");
  });

  it("tem texto de fallback para valores que nao sao Error", () => {
    expect(mensagemDeErro("string solta")).toBe("Erro desconhecido.");
    expect(mensagemDeErro(undefined)).toBe("Erro desconhecido.");
  });
});
