import { describe, it, expect } from "vitest";
import { nomeDeArquivo, lerScore, corDoScore, offsetDoScore } from "./format";

describe("nomeDeArquivo", () => {
  it("remove caracteres invalidos em nome de arquivo", () => {
    expect(nomeDeArquivo("Criar endpoint POST /pedidos")).toBe("Criar endpoint POST pedidos");
    expect(nomeDeArquivo('Config: "producao" <urgente>')).toBe("Config producao urgente");
  });

  it("preserva acentos, numeros, hifen e underscore", () => {
    expect(nomeDeArquivo("Refatoração_v2 - etapa 3")).toBe("Refatoração_v2 - etapa 3");
  });

  it("limita o tamanho a 40 caracteres", () => {
    expect(nomeDeArquivo("a".repeat(100))).toHaveLength(40);
  });

  it("cai para 'prompt' quando nao sobra nada utilizavel", () => {
    expect(nomeDeArquivo("///")).toBe("prompt");
    expect(nomeDeArquivo("   ")).toBe("prompt");
    expect(nomeDeArquivo("")).toBe("prompt");
  });
});

describe("lerScore", () => {
  it("converte score numerico", () => {
    expect(lerScore("88")).toBe(88);
  });

  // Regressao: o backend devolve "N/A" quando a validacao nao retorna score.
  // parseInt("N/A") era NaN e vazava para o strokeDasharray do SVG.
  it("devolve null para 'N/A', vazio, undefined e null", () => {
    expect(lerScore("N/A")).toBeNull();
    expect(lerScore("")).toBeNull();
    expect(lerScore(undefined)).toBeNull();
    expect(lerScore(null)).toBeNull();
  });

  it("limita o intervalo a 0-100", () => {
    expect(lerScore("120")).toBe(100);
    expect(lerScore("-5")).toBe(0);
  });
});

describe("corDoScore", () => {
  it("usa cinza quando nao ha score", () => {
    expect(corDoScore(null)).toBe("#71717a");
  });

  it("muda de faixa em 85 e 70", () => {
    expect(corDoScore(85)).toBe("#a3e635");
    expect(corDoScore(84)).toBe("#facc15");
    expect(corDoScore(70)).toBe("#facc15");
    expect(corDoScore(69)).toBe("#f87171");
  });
});

describe("offsetDoScore", () => {
  it("mapeia 0 e 100 nos extremos do anel", () => {
    expect(offsetDoScore(0)).toBe(226);
    expect(offsetDoScore(100)).toBe(0);
  });

  it("devolve numero finito para score ausente", () => {
    expect(Number.isFinite(offsetDoScore(null))).toBe(true);
  });
});
