using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;

namespace ApiAssistente.Configuration;

/// <summary>
/// Exige o header <c>X-Api-Key</c> nas rotas sob /api/prompt quando
/// <see cref="ApiProtecaoOptions.ApiKey"/> estiver configurada.
///
/// Sem chave configurada o middleware nao bloqueia nada — o fluxo local
/// continua igual —, mas o startup avisa que a API esta aberta.
/// </summary>
public sealed class ApiKeyMiddleware
{
    private const string CaminhoProtegido = "/api/prompt";

    private readonly RequestDelegate _next;
    private readonly ApiProtecaoOptions _options;
    private readonly ILogger<ApiKeyMiddleware> _logger;

    public ApiKeyMiddleware(
        RequestDelegate next,
        IOptions<ApiProtecaoOptions> options,
        ILogger<ApiKeyMiddleware> logger)
    {
        _next = next;
        _options = options.Value;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        if (!_options.ExigeApiKey ||
            !context.Request.Path.StartsWithSegments(CaminhoProtegido, StringComparison.OrdinalIgnoreCase))
        {
            await _next(context);
            return;
        }

        var enviada = context.Request.Headers[ApiProtecaoOptions.ApiKeyHeader].ToString();

        if (!ChaveDeApi.Confere(enviada, _options.ApiKey!))
        {
            _logger.LogWarning(
                "Requisicao rejeitada em {Caminho}: {Header} ausente ou invalido.",
                context.Request.Path, ApiProtecaoOptions.ApiKeyHeader);

            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            await context.Response.WriteAsJsonAsync(new
            {
                erro = $"Header {ApiProtecaoOptions.ApiKeyHeader} ausente ou invalido."
            });
            return;
        }

        await _next(context);
    }
}

public static class ChaveDeApi
{
    /// <summary>
    /// Compara a chave recebida com a esperada em tempo fixo, para nao permitir
    /// descobrir a chave medindo o tempo de resposta. Chaves de tamanhos
    /// diferentes sao rejeitadas antes da comparacao — o tamanho por si so nao e
    /// segredo util.
    /// </summary>
    public static bool Confere(string? enviada, string? esperada)
    {
        if (string.IsNullOrEmpty(enviada) || string.IsNullOrEmpty(esperada)) return false;

        var a = Encoding.UTF8.GetBytes(enviada);
        var b = Encoding.UTF8.GetBytes(esperada);

        return a.Length == b.Length && CryptographicOperations.FixedTimeEquals(a, b);
    }
}
