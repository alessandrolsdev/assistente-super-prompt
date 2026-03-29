using ApiAssistente.Models;

namespace ApiAssistente.Tests.Unit;

public class ObjetivoConfigsTests
{
    [Fact]
    public void Get_ShouldReturnCodeConfiguration_WhenTipoObjetivoIsCodigo()
    {
        var config = ObjetivoConfigs.Get(TipoObjetivo.Codigo);

        Assert.Equal(0.2, config.Temperature);
        Assert.Contains("Claude", config.FerramentasAlvo, StringComparison.Ordinal);
        Assert.Equal("Markdown com seções e blocos de código", config.FormatoPadrao);
        Assert.NotEmpty(config.CriteriosBase);
    }

    [Fact]
    public void Map_ShouldContainConfiguration_ForEveryTipoObjetivo()
    {
        foreach (var tipo in Enum.GetValues<TipoObjetivo>())
        {
            var config = ObjetivoConfigs.Get(tipo);

            Assert.False(string.IsNullOrWhiteSpace(config.PapelPadrao));
            Assert.False(string.IsNullOrWhiteSpace(config.FormatoPadrao));
            Assert.False(string.IsNullOrWhiteSpace(config.FerramentasAlvo));
            Assert.NotEmpty(config.CriteriosBase);
        }
    }
}