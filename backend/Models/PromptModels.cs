namespace ApiAssistente.Models;

// ── REQUESTS ────────────────────────────────────────────────────────────────

public class PromptRequest
{
    public string  IdeiaBruta       { get; set; } = string.Empty;
    public string? Papel            { get; set; }
    public bool    ForcarSimples    { get; set; } = false;
    // Respostas de clarificação: dicionário {perguntaId → resposta}
    public Dictionary<string, string>? RespostasClarificacao { get; set; }
}

public class RegerarRequest
{
    public string  PromptAtual      { get; set; } = string.Empty;
    public string  InstrucaoMelhora { get; set; } = string.Empty;
    public string? Papel            { get; set; }
    public string? Formato          { get; set; }
    // IDs das outras tarefas do projeto para propagar contexto
    public List<string>? OutrasTarefas { get; set; }
}

// ── MODELS ──────────────────────────────────────────────────────────────────

public class SubTarefaItem
{
    public string Titulo       { get; set; } = string.Empty;
    public string Descricao    { get; set; } = string.Empty;
    public string Complexidade { get; set; } = "media"; // baixa | media | alta
}

public class PerguntaClarificacao
{
    public string        Id      { get; set; } = string.Empty; // ex: "contexto_canva"
    public string        Texto   { get; set; } = string.Empty; // ex: "Você se refere ao site Canva.com ou à API Canvas do HTML?"
    public List<string>  Opcoes  { get; set; } = new();        // opções clicáveis
    public bool          Livre   { get; set; } = false;        // true = campo de texto livre também
}