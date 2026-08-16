/**
 * Persistência local, best-effort.
 *
 * Regras que a versão inline não seguia e que custaram bugs:
 * gravar valor vazio REMOVE a chave (antes, apagar a fila não limpava nada e as
 * tarefas voltavam no reload), e toda operação é protegida contra
 * `QuotaExceededError` e storage indisponível — prompts são longos e uma fila
 * com histórico chega perto do limite de 5 MB.
 */

export function salvarLocal(chave: string, valor: unknown): void {
  try {
    const vazio = valor == null || (Array.isArray(valor) && valor.length === 0);
    if (vazio) localStorage.removeItem(chave);
    else localStorage.setItem(chave, JSON.stringify(valor));
  } catch {
    // Quota estourada ou storage indisponível: a persistência é best-effort.
  }
}

export function lerLocal<T>(chave: string): T | null {
  try {
    const raw = localStorage.getItem(chave);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
