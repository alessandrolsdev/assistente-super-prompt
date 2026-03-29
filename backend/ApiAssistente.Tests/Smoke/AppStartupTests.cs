using System.Net;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace ApiAssistente.Tests.Smoke;

public class AppStartupTests
{
    [Fact]
    public async Task GetModelDiagnostics_ShouldReturn503_WhenOpenRouterKeyIsMissing()
    {
        using var factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.UseEnvironment("Production");
                builder.ConfigureAppConfiguration((_, config) =>
                {
                    config.AddInMemoryCollection(new Dictionary<string, string?>
                    {
                        ["OpenRouterApiKey"] = string.Empty,
                    });
                });
            });

        using var client = factory.CreateClient();

        var response = await client.GetAsync("/api/modelos/testar");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);

        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("OpenRouterApiKey", body, StringComparison.Ordinal);
    }
}