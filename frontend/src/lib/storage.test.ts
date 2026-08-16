import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { salvarLocal, lerLocal } from "./storage";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("salvarLocal", () => {
  it("grava valores serializados", () => {
    salvarLocal("k", { a: 1 });
    expect(JSON.parse(localStorage.getItem("k")!)).toEqual({ a: 1 });
  });

  // Regressao: o efeito original so gravava quando a fila tinha itens, entao
  // apagar todas as tarefas nao limpava nada e elas voltavam no reload.
  it("REMOVE a chave quando o valor e uma lista vazia", () => {
    salvarLocal("fila", [{ id: "1" }]);
    salvarLocal("fila", []);
    expect(localStorage.getItem("fila")).toBeNull();
  });

  it("REMOVE a chave para null e undefined", () => {
    salvarLocal("k", "valor");
    salvarLocal("k", null);
    expect(localStorage.getItem("k")).toBeNull();

    salvarLocal("k", "valor");
    salvarLocal("k", undefined);
    expect(localStorage.getItem("k")).toBeNull();
  });

  it("nao propaga QuotaExceededError", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    expect(() => salvarLocal("k", "grande")).not.toThrow();
  });
});

describe("lerLocal", () => {
  it("faz round-trip com salvarLocal", () => {
    salvarLocal("k", { lista: [1, 2, 3] });
    expect(lerLocal<{ lista: number[] }>("k")).toEqual({ lista: [1, 2, 3] });
  });

  it("devolve null para chave ausente", () => {
    expect(lerLocal("nao-existe")).toBeNull();
  });

  it("devolve null quando o conteudo salvo esta corrompido", () => {
    localStorage.setItem("k", "{json quebrado");
    expect(lerLocal("k")).toBeNull();
  });
});
