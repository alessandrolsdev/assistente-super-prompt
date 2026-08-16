using ApiAssistente.Controllers;
using Xunit;

namespace ApiAssistente.Tests;

/// <summary>
/// Cobre o parsing das respostas dos modelos. Estas funções lidam com saída de
/// modelos gratuitos e pequenos, que ecoam templates, cortam tags e trocam a
/// ordem — foi exatamente aí que os bugs P0-3 e P1-8 moravam.
/// </summary>
public class ExtracaoXmlTests
{
    [Fact]
    public void ExtrairTagXml_DevolveConteudoEntreAsTags()
    {
        Assert.Equal("Codigo", PromptController.ExtrairTagXml("<tipo>Codigo</tipo>", "tipo"));
    }

    [Fact]
    public void ExtrairTagXml_IgnoraEspacosAoRedor()
    {
        Assert.Equal("Codigo", PromptController.ExtrairTagXml("<tipo>\n  Codigo\n</tipo>", "tipo"));
    }

    [Fact]
    public void ExtrairTagXml_DevolveNullQuandoFaltaAlgumaTag()
    {
        Assert.Null(PromptController.ExtrairTagXml("<tipo>Codigo", "tipo"));
        Assert.Null(PromptController.ExtrairTagXml("Codigo</tipo>", "tipo"));
        Assert.Null(PromptController.ExtrairTagXml("", "tipo"));
    }

    /// <summary>
    /// Regressão do P0-3: a versão original buscava abertura e fechamento do
    /// início do texto de forma independente. Com o fechamento vindo primeiro,
    /// o intervalo saía invertido e derrubava a requisição com
    /// ArgumentOutOfRangeException.
    /// </summary>
    [Fact]
    public void ExtrairTagXml_NaoLancaQuandoFechamentoVemAntesDaAbertura()
    {
        var caotico = "</tipo> lixo antes <tipo>Codigo</tipo>";

        var excecao = Record.Exception(() => PromptController.ExtrairTagXml(caotico, "tipo"));

        Assert.Null(excecao);
        Assert.Equal("Codigo", PromptController.ExtrairTagXml(caotico, "tipo"));
    }

    [Fact]
    public void ExtrairTagXml_PegaOPrimeiroBlocoQuandoHaVarios()
    {
        Assert.Equal("um", PromptController.ExtrairTagXml("<t>um</t><t>dois</t>", "t"));
    }

    [Fact]
    public void ExtrairTagXmlRobusto_CasaComOUltimoFechamento()
    {
        // Usado para blocos que contêm tags aninhadas de mesmo nome.
        var texto = "<p><p>interno</p> resto</p>";
        Assert.Equal("<p>interno</p> resto", PromptController.ExtrairTagXmlRobusto(texto, "p"));
    }

    [Fact]
    public void ExtrairTagXmlRobusto_DevolveNullQuandoOFechamentoAntecedeAAbertura()
    {
        Assert.Null(PromptController.ExtrairTagXmlRobusto("</p> texto <p>", "p"));
    }

    [Fact]
    public void ExtrairTagXmlRobusto_DevolveNullQuandoATagFoiTruncada()
    {
        // Cenário do P1-3: max_tokens curto cortava a resposta antes do fechamento.
        Assert.Null(PromptController.ExtrairTagXmlRobusto("<prompt_otimizado>comeco sem fim", "prompt_otimizado"));
    }
}
