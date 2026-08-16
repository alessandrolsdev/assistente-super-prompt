using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using ApiAssistente.Configuration;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;

var builder = WebApplication.CreateBuilder(args);

const string CorsPolicyName = "PermitirNextJs";

// ==========================================
// 1. SERVIÇOS
// ==========================================
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddControllers()
    .AddJsonOptions(opts =>
    {
        // Aceita TipoObjetivo como string ("Imagem", "Codigo"...) além de número
        opts.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());
    });

builder.Services.AddOptions<OpenRouterOptions>()
    .Bind(builder.Configuration.GetSection(OpenRouterOptions.SectionName))
    .PostConfigure(opts =>
    {
        // Compatibilidade com o formato documentado no README: a chave também pode
        // vir da raiz da configuração como "OpenRouterApiKey".
        if (string.IsNullOrWhiteSpace(opts.ApiKey))
            opts.ApiKey = builder.Configuration["OpenRouterApiKey"];

        opts.ApiKey = opts.ApiKey?.Trim();
    });

// HttpClient nomeado: o pipeline resolve via IHttpClientFactory, o que evita
// depender da ativação de controllers pelo container para injetar HttpClient.
builder.Services.AddHttpClient(OpenRouterOptions.HttpClientName, (sp, client) =>
{
    var opts = sp.GetRequiredService<IOptions<OpenRouterOptions>>().Value;
    // Timeout global generoso — cada chamada individual tem seu próprio
    // CancellationToken (OpenRouterOptions.TimeoutSeconds).
    client.Timeout = TimeSpan.FromMinutes(opts.HttpClientTimeoutMinutes);
});

builder.Services.Configure<ApiProtecaoOptions>(
    builder.Configuration.GetSection(ApiProtecaoOptions.SectionName));

// Rate limiting: cada POST em /api/prompt dispara ate 7 chamadas pagas ao
// OpenRouter, entao a rota precisa de teto mesmo em uso legitimo.
var protecao = builder.Configuration
    .GetSection(ApiProtecaoOptions.SectionName)
    .Get<ApiProtecaoOptions>() ?? new ApiProtecaoOptions();

builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    options.AddFixedWindowLimiter(ApiProtecaoOptions.RateLimitPolicy, limite =>
    {
        limite.PermitLimit = protecao.RequisicoesPorJanela;
        limite.Window = TimeSpan.FromSeconds(protecao.JanelaSegundos);
        limite.QueueLimit = protecao.Fila;
        limite.QueueProcessingOrder = QueueProcessingOrder.OldestFirst;
    });

    options.OnRejected = async (contexto, cancellationToken) =>
    {
        contexto.HttpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;
        await contexto.HttpContext.Response.WriteAsJsonAsync(new
        {
            erro = $"Limite de {protecao.RequisicoesPorJanela} requisicoes por {protecao.JanelaSegundos}s atingido. Tente novamente em instantes."
        }, cancellationToken);
    };
});

// CORS para o Next.js. As origens são configuráveis para não travar o deploy.
var origensPermitidas = builder.Configuration
    .GetSection("Cors:AllowedOrigins")
    .Get<string[]>();

if (origensPermitidas is null || origensPermitidas.Length == 0)
    origensPermitidas = new[] { "http://localhost:3000" };

builder.Services.AddCors(options =>
{
    options.AddPolicy(CorsPolicyName, policy =>
    {
        policy.WithOrigins(origensPermitidas)
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

// ==========================================
// 2. CONSTRUÇÃO DA APLICAÇÃO
// ==========================================
var app = builder.Build();

// ==========================================
// 3. PIPELINE
// ==========================================
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// UseHttpsRedirection removido — em dev local só usamos HTTP (localhost:5117).
app.UseCors(CorsPolicyName);
app.UseRateLimiter();
app.UseMiddleware<ApiKeyMiddleware>();

if (!protecao.ExigeApiKey)
{
    app.Logger.LogWarning(
        "ApiProtecao:ApiKey nao configurada: /api/prompt esta aberta. Cada requisicao " +
        "gasta credito do OpenRouter — defina uma chave antes de expor esta API na rede.");
}

app.MapControllers().RequireRateLimiting(ApiProtecaoOptions.RateLimitPolicy);

// ==========================================
// 4. ENDPOINT DE TESTE DE MODELOS
// Acesse: GET /api/modelos/testar
// Testa os modelos reais do pipeline antes de usar.
// ==========================================
app.MapGet("/api/modelos/testar", async (
    IOptions<OpenRouterOptions> optionsAccessor,
    IHttpClientFactory httpClientFactory,
    ILoggerFactory loggerFactory,
    CancellationToken cancellationToken) =>
{
    var options = optionsAccessor.Value;
    var logger = loggerFactory.CreateLogger("Diagnostico.Modelos");

    if (!options.TemApiKey)
    {
        return Results.Json(
            new { erro = OpenRouterOptions.ApiKeyMissingMessage },
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }

    // Os modelos testados são exatamente os do pipeline — antes esta lista era
    // uma cópia independente e podia divergir do que o PromptController usava.
    var modelos = options.Models.Distintos();
    var client = httpClientFactory.CreateClient(OpenRouterOptions.HttpClientName);
    var resultados = new List<ResultadoDiagnostico>(modelos.Count);

    for (var i = 0; i < modelos.Count; i++)
    {
        var modelo = modelos[i];
        var inicio = DateTime.UtcNow;
        bool disponivel;
        string detalhe;

        try
        {
            var payload = new
            {
                model = modelo,
                max_tokens = 50,
                temperature = 0.1,
                messages = new[]
                {
                    new { role = "user", content = "Responda apenas: OK" }
                }
            };

            using var request = new HttpRequestMessage(HttpMethod.Post, options.BaseUrl);
            request.Headers.Add("Authorization", $"Bearer {options.ApiKey}");
            request.Headers.Add("HTTP-Referer", options.Referer);
            request.Headers.Add("X-Title", "ApiAssistente - Teste de Modelos");
            request.Content = new StringContent(
                JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");

            using var resposta = await client.SendAsync(request, cancellationToken);
            var json = await resposta.Content.ReadAsStringAsync(cancellationToken);
            var node = JsonNode.Parse(json);

            if (resposta.IsSuccessStatusCode)
            {
                var texto = node?["choices"]?[0]?["message"]?["content"]?.ToString();
                disponivel = true;
                detalhe = string.IsNullOrWhiteSpace(texto)
                    ? "Respondeu (sem texto)"
                    : $"Respondeu: \"{texto.Trim()}\"";
            }
            else
            {
                // Tenta extrair a mensagem de erro do OpenRouter
                disponivel = false;
                detalhe = node?["error"]?["message"]?.ToString() ?? resposta.StatusCode.ToString();
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Falha ao testar o modelo {Modelo}", modelo);
            disponivel = false;
            detalhe = ex.Message;
        }

        resultados.Add(new ResultadoDiagnostico(
            Etapa: i + 1,
            Modelo: modelo,
            Disponivel: disponivel,
            Status: disponivel ? "online" : "offline",
            Detalhe: detalhe,
            LatenciaMs: Math.Round((DateTime.UtcNow - inicio).TotalMilliseconds)));
    }

    var online = resultados.Count(r => r.Disponivel);

    return Results.Ok(new
    {
        pipeline_pronto = online == resultados.Count,
        resumo = $"{online}/{resultados.Count} modelos disponiveis",
        modelos = resultados
    });
})
.WithName("TestarModelos")
.WithOpenApi();

// ==========================================
// 5. LIGAR O MOTOR
// ==========================================
app.Run();

internal sealed record ResultadoDiagnostico(
    [property: JsonPropertyName("etapa")]       int Etapa,
    [property: JsonPropertyName("modelo")]      string Modelo,
    [property: JsonPropertyName("disponivel")]  bool Disponivel,
    [property: JsonPropertyName("status")]      string Status,
    [property: JsonPropertyName("detalhe")]     string Detalhe,
    [property: JsonPropertyName("latencia_ms")] double LatenciaMs);
