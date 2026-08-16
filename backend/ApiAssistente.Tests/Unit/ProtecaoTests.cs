using ApiAssistente.Configuration;
using Xunit;

namespace ApiAssistente.Tests;

public class ChaveDeApiTests
{
    [Fact]
    public void AceitaChaveIdentica()
    {
        Assert.True(ChaveDeApi.Confere("segredo-123", "segredo-123"));
    }

    [Theory]
    [InlineData("segredo-124")]
    [InlineData("segredo-12")]
    [InlineData("segredo-1234")]
    [InlineData("SEGREDO-123")]
    public void RejeitaChaveDiferente(string enviada)
    {
        Assert.False(ChaveDeApi.Confere(enviada, "segredo-123"));
    }

    [Theory]
    [InlineData(null, "segredo")]
    [InlineData("", "segredo")]
    [InlineData("segredo", null)]
    [InlineData("segredo", "")]
    [InlineData(null, null)]
    public void RejeitaQuandoAlgumLadoEstaVazio(string? enviada, string? esperada)
    {
        // Chave esperada vazia nunca deve autorizar: sem chave configurada o
        // middleware sequer roda, entao chegar aqui e sinal de erro de config.
        Assert.False(ChaveDeApi.Confere(enviada, esperada));
    }

    [Fact]
    public void ComparaConteudoUnicodeCorretamente()
    {
        Assert.True(ChaveDeApi.Confere("chave-ção", "chave-ção"));
        Assert.False(ChaveDeApi.Confere("chave-cao", "chave-ção"));
    }
}

public class ApiProtecaoOptionsTests
{
    [Fact]
    public void PadraoNaoExigeApiKey()
    {
        // Fluxo local continua sem atrito; o startup avisa que a API esta aberta.
        Assert.False(new ApiProtecaoOptions().ExigeApiKey);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void ChaveEmBrancoNaoContaComoConfigurada(string chave)
    {
        Assert.False(new ApiProtecaoOptions { ApiKey = chave }.ExigeApiKey);
    }

    [Fact]
    public void ChavePreenchidaPassaAExigirOHeader()
    {
        Assert.True(new ApiProtecaoOptions { ApiKey = "segredo" }.ExigeApiKey);
    }

    [Fact]
    public void PadroesDeRateLimitSaoUsaveis()
    {
        var o = new ApiProtecaoOptions();

        Assert.True(o.RequisicoesPorJanela > 0);
        Assert.True(o.JanelaSegundos > 0);
        Assert.True(o.Fila >= 0);
    }
}
