using ApiAssistente.Controllers;

var builder = WebApplication.CreateBuilder(args);

// ==========================================
// 1. SERVIÇOS
// ==========================================
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddControllers()
    .AddJsonOptions(opts =>
    {
        // Aceita TipoObjetivo como string ("Imagem", "Codigo"...) alem de numero
        opts.JsonSerializerOptions.Converters.Add(
            new System.Text.Json.Serialization.JsonStringEnumConverter()
        );
    });

// ALTERAÇÃO: Tipado para injetar corretamente no PromptController
builder.Services.AddHttpClient<PromptController>();

// CORS para o Next.js
builder.Services.AddCors(options =>
{
    options.AddPolicy("PermitirNextJs", policy =>
    {
        policy.WithOrigins("http://localhost:3000")
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

// UseHttpsRedirection removido — em dev local só usamos HTTP (localhost:5117)
app.UseCors("PermitirNextJs");
app.UseAuthorization();
app.MapControllers();

// ==========================================
// 4. ENDPOINT DE TESTE DE MODELOS
// Acesse: GET /api/modelos/testar
// Testa os 3 modelos do pipeline antes de usar
// ==========================================
app.MapGet("/api/modelos/testar", async (IConfiguration config, IHttpClientFactory httpClientFactory) =>
{
    var apiKey = config["OpenRouterApiKey"]?.Trim();

    if (string.IsNullOrEmpty(apiKey))
        return Results.BadRequest(new { erro = "OpenRouterApiKey não encontrada no appsettings.json" });

    var modelos = new[]
    {
        new { nome = "Análise",   id = "arcee-ai/trinity-large-preview:free",           etapa = 1 },
        new { nome = "Geração",   id = "meta-llama/llama-3.3-70b-instruct:free",        etapa = 2 },
        new { nome = "Validação", id = "mistralai/mistral-small-3.1-24b-instruct:free", etapa = 3 },
    };

    var resultados = new List<object>();
    var client = httpClientFactory.CreateClient();

    foreach (var modelo in modelos)
    {
        var inicio = DateTime.UtcNow;
        string status;
        string detalhe;

        try
        {
            var payload = new
            {
                model = modelo.id,
                max_tokens = 50,
                temperature = 0.1,
                messages = new[]
                {
                    new { role = "user", content = "Responda apenas: OK" }
                }
            };

            using var request = new HttpRequestMessage(HttpMethod.Post, "https://openrouter.ai/api/v1/chat/completions");
            request.Headers.Add("Authorization", $"Bearer {apiKey}");
            request.Headers.Add("HTTP-Referer", "https://apiassistente.local");
            request.Headers.Add("X-Title", "ApiAssistente - Teste de Modelos");
            request.Content = new StringContent(
                System.Text.Json.JsonSerializer.Serialize(payload),
                System.Text.Encoding.UTF8,
                "application/json"
            );

            var resposta = await client.SendAsync(request);
            var json = await resposta.Content.ReadAsStringAsync();

            if (resposta.IsSuccessStatusCode)
            {
                var node = System.Text.Json.Nodes.JsonNode.Parse(json);
                var texto = node?["choices"]?[0]?["message"]?["content"]?.ToString();
                status  = "✅ online";
                detalhe = string.IsNullOrWhiteSpace(texto) ? "Respondeu (sem texto)" : $"Respondeu: \"{texto.Trim()}\"";
            }
            else
            {
                // Tenta extrair a mensagem de erro do OpenRouter
                var node = System.Text.Json.Nodes.JsonNode.Parse(json);
                var msg  = node?["error"]?["message"]?.ToString() ?? resposta.StatusCode.ToString();
                status  = "❌ offline";
                detalhe = msg;
            }
        }
        catch (Exception ex)
        {
            status  = "❌ erro";
            detalhe = ex.Message;
        }

        var latencia = (DateTime.UtcNow - inicio).TotalMilliseconds;

        resultados.Add(new
        {
            etapa        = modelo.etapa,
            nome         = modelo.nome,
            modelo       = modelo.id,
            status,
            detalhe,
            latencia_ms  = Math.Round(latencia)
        });
    }

    var todosOnline = resultados.All(r => r.ToString()!.Contains("online"));

    return Results.Ok(new
    {
        pipeline_pronto = resultados.Cast<dynamic>().All(r => ((string)r.status).Contains("online")),
        resumo          = $"{resultados.Count(r => r.ToString()!.Contains("online"))}/3 modelos disponíveis",
        modelos         = resultados
    });
})
.WithName("TestarModelos")
.WithOpenApi();

// ==========================================
// 5. LIGAR O MOTOR
// ==========================================
app.Run();

record WeatherForecast(DateOnly Date, int TemperatureC, string? Summary)
{
    public int TemperatureF => 32 + (int)(TemperatureC / 0.5556);
}