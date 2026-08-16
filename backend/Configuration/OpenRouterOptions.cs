namespace ApiAssistente.Configuration;

/// <summary>
/// Configuração da integração com o OpenRouter.
/// Os valores padrão preservam o comportamento anterior do pipeline: qualquer um
/// pode ser sobrescrito pela seção "OpenRouter" de appsettings, por variáveis de
/// ambiente ou por dotnet user-secrets, sem recompilar.
/// </summary>
public sealed class OpenRouterOptions
{
    public const string SectionName = "OpenRouter";

    /// <summary>Nome do HttpClient nomeado registrado em Program.cs.</summary>
    public const string HttpClientName = "openrouter";

    public const string ApiKeyMissingMessage =
        "OpenRouterApiKey nao configurada. Defina a chave via variavel de ambiente, dotnet user-secrets ou appsettings.Development.json local.";

    /// <summary>
    /// Chave da API. Aceita tanto "OpenRouter:ApiKey" quanto a chave de raiz
    /// "OpenRouterApiKey" documentada no README (compatibilidade).
    /// </summary>
    public string? ApiKey { get; set; }

    public string BaseUrl { get; set; } = "https://openrouter.ai/api/v1/chat/completions";

    /// <summary>Enviado como HTTP-Referer; o OpenRouter usa para atribuição de uso.</summary>
    public string Referer { get; set; } = "https://apiassistente.local";

    public string Title { get; set; } = "ApiAssistente - Prompt Engineer";

    /// <summary>
    /// Teto de tokens por chamada. O padrão anterior (2048) truncava o prompt XML
    /// da etapa de geração, o que fazia a tag de fechamento sumir e o resultado
    /// cair no texto bruto.
    /// </summary>
    public int MaxTokens { get; set; } = 4096;

    /// <summary>Timeout por chamada individual ao modelo.</summary>
    public int TimeoutSeconds { get; set; } = 90;

    /// <summary>Timeout do HttpClient, que cobre o pipeline inteiro.</summary>
    public int HttpClientTimeoutMinutes { get; set; } = 8;

    public PipelineModelOptions Models { get; set; } = new();

    public bool TemApiKey => !string.IsNullOrWhiteSpace(ApiKey);
}

/// <summary>
/// Modelos usados em cada etapa do pipeline. Ficam em um único lugar para que o
/// endpoint de diagnóstico teste exatamente os modelos que o pipeline usa.
/// </summary>
public sealed class PipelineModelOptions
{
    public string Classificador { get; set; } = "arcee-ai/trinity-large-preview:free";
    public string Ambiguidade   { get; set; } = "arcee-ai/trinity-large-preview:free";
    public string Triagem       { get; set; } = "google/gemini-2.0-flash-exp:free";
    public string Deteccao      { get; set; } = "google/gemini-2.0-flash-exp:free";
    public string Analise       { get; set; } = "google/gemini-2.0-flash-exp:free";
    public string Validacao     { get; set; } = "meta-llama/llama-3.3-70b-instruct:free";

    /// <summary>
    /// Cadeia de geração: o primeiro item é o modelo preferido e os demais são
    /// tentados em ordem quando o anterior falha ou devolve resposta vazia.
    /// </summary>
    public string[] GeracaoFallback { get; set; } =
    {
        "google/gemini-2.0-flash-exp:free",
        "meta-llama/llama-3.3-70b-instruct:free",
        "mistralai/mistral-small-3.1-24b-instruct:free",
        "qwen/qwen3-8b:free",
    };

    public string Geracao => GeracaoFallback.Length > 0
        ? GeracaoFallback[0]
        : "google/gemini-2.0-flash-exp:free";

    /// <summary>Todos os modelos distintos do pipeline, na ordem em que são acionados.</summary>
    public IReadOnlyList<string> Distintos() =>
        new[] { Classificador, Ambiguidade, Triagem, Deteccao, Analise }
            .Concat(GeracaoFallback)
            .Append(Validacao)
            .Where(m => !string.IsNullOrWhiteSpace(m))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
}
