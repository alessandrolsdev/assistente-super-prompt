using ApiAssistente.Controllers;

var builder = WebApplication.CreateBuilder(args);

/// <summary>
/// Initial application configuration and service dependency injection.
/// </summary>
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddControllers();
builder.Services.AddHttpClient();
builder.Services.AddHttpClient<PromptController>();

builder.Services.AddCors(options =>
{
    options.AddPolicy("PermitirNextJs", policy =>
    {
        policy.WithOrigins("http://localhost:3000")
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

/// <summary>
/// Application builder pipeline instantiation.
/// </summary>
var app = builder.Build();

/// <summary>
/// Middlewares pipeline configuration including CORS and Swagger generation.
/// </summary>
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();
app.UseCors("PermitirNextJs");
app.UseAuthorization();
app.MapControllers();

/// <summary>
/// Diagnostic Endpoint: GET /api/modelos/testar
/// Tests all free-tier OpenRouter AI models for latency and availability.
/// Includes the official OpenRouter fallback router model.
/// </summary>
app.MapGet("/api/modelos/testar", async (IConfiguration config, IHttpClientFactory httpClientFactory) =>
{
    var apiKey = config["OpenRouterApiKey"]?.Trim();

    if (string.IsNullOrEmpty(apiKey))
        return Results.BadRequest(new { erro = "OpenRouterApiKey não encontrada no appsettings.json" });

    // Lista de candidatos gratuitos para testar
    // Inclui o roteador oficial openrouter/free como fallback garantido
    var modelos = new[]
    {
        new { nome = "Auto Router (fallback oficial)", id = "openrouter/free",                              etapa = 0 },
        new { nome = "Arcee Trinity Large",            id = "arcee-ai/trinity-large-preview:free",          etapa = 1 },
        new { nome = "Llama 3.3 70B",                  id = "meta-llama/llama-3.3-70b-instruct:free",       etapa = 2 },
        new { nome = "Mistral Small 3.1",              id = "mistralai/mistral-small-3.1-24b-instruct:free", etapa = 3 },
        new { nome = "Gemma 3 27B",                    id = "google/gemma-3-27b-it:free",                   etapa = 4 },
        new { nome = "Qwen3 235B Thinking",            id = "qwen/qwen3-235b-a22b-thinking-2507:free",      etapa = 5 },
        new { nome = "DeepSeek R1",                    id = "deepseek/deepseek-r1:free",                    etapa = 6 },
    };

    var resultados = new List<object>();
    var client = httpClientFactory.CreateClient();

    foreach (var modelo in modelos)
    {
        var inicio = DateTime.UtcNow;
        string status;
        string detalhe;
        string modeloUsado = modelo.id;

        try
        {
            var payload = new
            {
                model = modelo.id,
                max_tokens = 30,
                temperature = 0.1,
                messages = new[]
                {
                    new { role = "user", content = "Responda apenas a palavra: OK" }
                }
            };

            using var request = new HttpRequestMessage(HttpMethod.Post, "https://openrouter.ai/api/v1/chat/completions");
            request.Headers.Add("Authorization", $"Bearer {apiKey}");
            request.Headers.Add("HTTP-Referer", "https://apiassistente.local");
            request.Headers.Add("X-Title", "ApiAssistente - Teste");
            request.Content = new System.Net.Http.StringContent(
                System.Text.Json.JsonSerializer.Serialize(payload),
                System.Text.Encoding.UTF8,
                "application/json"
            );

            var resposta = await client.SendAsync(request);
            var json = await resposta.Content.ReadAsStringAsync();
            var node = System.Text.Json.Nodes.JsonNode.Parse(json);

            if (resposta.IsSuccessStatusCode)
            {
                var texto = node?["choices"]?[0]?["message"]?["content"]?.ToString();
                // openrouter/free retorna qual modelo foi usado de verdade
                modeloUsado = node?["model"]?.ToString() ?? modelo.id;
                status  = "✅ online";
                detalhe = string.IsNullOrWhiteSpace(texto)
                    ? "Respondeu sem texto"
                    : $"Respondeu: \"{texto.Trim()}\"";
            }
            else
            {
                var msg = node?["error"]?["message"]?.ToString() ?? resposta.StatusCode.ToString();
                status  = "❌ offline";
                detalhe = msg;
            }
        }
        catch (Exception ex)
        {
            status  = "❌ erro";
            detalhe = ex.Message;
            modeloUsado = modelo.id;
        }

        var latencia = (DateTime.UtcNow - inicio).TotalMilliseconds;

        resultados.Add(new
        {
            etapa          = modelo.etapa,
            nome           = modelo.nome,
            modelo_testado = modelo.id,
            modelo_usado   = modeloUsado,
            status,
            detalhe,
            latencia_ms    = Math.Round(latencia)
        });
    }

    var onlineCount = resultados.Count(r => r.ToString()!.Contains("✅"));

    return Results.Ok(new
    {
        resumo          = $"{onlineCount}/{modelos.Length} modelos disponíveis",
        instrucao       = "Use os IDs com ✅ online para configurar o pipeline no PromptController",
        modelos         = resultados
    });
})
.WithName("TestarModelos")
.WithOpenApi();

// Application execution bootstrapper.
app.Run();