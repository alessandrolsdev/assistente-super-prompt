namespace ApiAssistente.Models;

public class PromptRequest
{
    public string  IdeiaBruta   { get; set; } = string.Empty;
    public string? Papel        { get; set; }
    public bool    ForcarSimples { get; set; } = false; // true = pula triagem (vem de sub-tarefa)
}

public class PromptResponse
{
    public string PromptOtimizado { get; set; } = string.Empty;
}

public class SubTarefaItem
{
    public string Titulo       { get; set; } = string.Empty;
    public string Descricao    { get; set; } = string.Empty;
    public string Complexidade { get; set; } = "media"; // baixa | media | alta
}