namespace ApiAssistente.Configuration;

/// <summary>
/// Protecao das rotas que gastam credito do OpenRouter.
///
/// Cada POST em /api/prompt dispara ate 7 chamadas pagas. Em localhost isso e
/// aceitavel; exposto na rede, e a chave da conta a disposicao de quem alcancar
/// a porta. Os padroes preservam o fluxo de desenvolvimento (sem chave exigida),
/// mas o rate limit vale sempre.
/// </summary>
public sealed class ApiProtecaoOptions
{
    public const string SectionName = "ApiProtecao";

    /// <summary>Nome da politica de rate limiting aplicada aos controllers.</summary>
    public const string RateLimitPolicy = "prompt";

    public const string ApiKeyHeader = "X-Api-Key";

    /// <summary>
    /// Se definida, toda requisicao a /api/prompt precisa enviar o header
    /// <c>X-Api-Key</c> com este valor. Vazia (padrao) deixa a API aberta e
    /// registra um aviso no startup.
    /// </summary>
    public string? ApiKey { get; set; }

    /// <summary>Requisicoes permitidas por janela, por cliente.</summary>
    public int RequisicoesPorJanela { get; set; } = 20;

    /// <summary>Tamanho da janela em segundos.</summary>
    public int JanelaSegundos { get; set; } = 60;

    /// <summary>Quantas requisicoes excedentes ficam na fila em vez de serem rejeitadas.</summary>
    public int Fila { get; set; } = 2;

    public bool ExigeApiKey => !string.IsNullOrWhiteSpace(ApiKey);
}
