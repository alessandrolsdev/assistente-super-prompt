using ApiAssistente.Configuration;
using ApiAssistente.Controllers;
using ApiAssistente.Models;
using Xunit;

namespace ApiAssistente.Tests;

/// <summary>
/// A etapa de auditoria só reescreve o prompt quando aponta problema real.
/// Estes testes travam esse contrato: no caminho feliz o prompt da geração
/// precisa sair intacto, e uma "correção" degenerada não pode substituí-lo.
/// </summary>
public class ResolverPromptFinalTests
{
    private const string Gerado = "<prompt_otimizado>Implemente o endpoint POST /pedidos devolvendo 201 com Location.</prompt_otimizado>";
    private const string Conteudo = "Implemente o endpoint POST /pedidos devolvendo 201 com Location.";

    [Fact]
    public void MantemOOriginalQuandoNaoPrecisaCorrecao()
    {
        var validacao = "<validacao><precisa_correcao>não</precisa_correcao><prompt_final></prompt_final></validacao>";

        Assert.Equal(Conteudo, PromptController.ResolverPromptFinal(Gerado, "prompt_otimizado", validacao, 20));
    }

    [Fact]
    public void MantemOOriginalQuandoAValidacaoFalhouPorCompleto()
    {
        Assert.Equal(Conteudo, PromptController.ResolverPromptFinal(Gerado, "prompt_otimizado", "", 20));
    }

    [Fact]
    public void UsaACorrecaoQuandoAValidacaoApontaProblema()
    {
        var corrigido = new string('x', 100);
        var validacao = $"<validacao><precisa_correcao>sim</precisa_correcao><prompt_final>{corrigido}</prompt_final></validacao>";

        Assert.Equal(corrigido, PromptController.ResolverPromptFinal(Gerado, "prompt_otimizado", validacao, 20));
    }

    [Fact]
    public void DescartaCorrecaoCurtaDemais()
    {
        var validacao = "<validacao><precisa_correcao>sim</precisa_correcao><prompt_final>ok</prompt_final></validacao>";

        Assert.Equal(Conteudo, PromptController.ResolverPromptFinal(Gerado, "prompt_otimizado", validacao, 20));
    }

    [Theory]
    [InlineData("Nenhum problema crítico encontrado, o prompt está adequado e completo.")]
    [InlineData("Corrija problemas reais. Se tudo ok: copie sem alterações do original.")]
    [InlineData("APENAS se precisa_correcao=sim: o prompt completo corrigido vai aqui.")]
    public void DescartaCorrecaoQueEcoouAInstrucaoDoGabarito(string eco)
    {
        var validacao = $"<validacao><precisa_correcao>sim</precisa_correcao><prompt_final>{eco}</prompt_final></validacao>";

        Assert.Equal(Conteudo, PromptController.ResolverPromptFinal(Gerado, "prompt_otimizado", validacao, 20));
    }

    [Fact]
    public void CaiParaOTextoBrutoQuandoATagDeGeracaoNaoExiste()
    {
        var semTag = "o modelo respondeu sem envelopar em XML";

        Assert.Equal(semTag, PromptController.ResolverPromptFinal(semTag, "prompt_otimizado", "", 20));
    }
}

public class ExtrairScoreTests
{
    [Fact]
    public void ExtraiONumeroDaTagScore()
    {
        Assert.Equal("88", PromptController.ExtrairScore("<score>88</score>"));
    }

    [Fact]
    public void ExtraiONumeroDeUmaFraseSolta()
    {
        Assert.Equal("92", PromptController.ExtrairScore("<score>Score: 92/100</score>"));
    }

    [Fact]
    public void LimitaAFaixaDeZeroACem()
    {
        Assert.Equal("100", PromptController.ExtrairScore("<score>150</score>"));
    }

    [Theory]
    [InlineData("")]
    [InlineData("<score></score>")]
    [InlineData("<score>não avaliado</score>")]
    [InlineData("resposta sem a tag")]
    public void DevolveNAQuandoNaoHaNumero(string validacao)
    {
        Assert.Equal("N/A", PromptController.ExtrairScore(validacao));
    }
}

public class ExecutorPerfisTests
{
    [Theory]
    [InlineData("Claude Code")]
    [InlineData("claude code")]
    [InlineData("Cursor")]
    [InlineData("Google Jules")]
    [InlineData("OpenHands")]
    [InlineData("Windsurf")]
    public void ResolveOsExecutoresConhecidosIgnorandoCaixa(string id)
    {
        var perfil = ExecutorPerfis.Get(id);

        Assert.NotEmpty(perfil.Id);
        Assert.NotEmpty(perfil.Diretrizes);
        Assert.Contains(perfil.Nome, perfil.ParaPrompt());
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public void CaiNoPerfilGenericoSemExecutor(string? id)
    {
        Assert.Equal(ExecutorPerfis.Generico.Nome, ExecutorPerfis.Get(id).Nome);
    }

    [Fact]
    public void ExecutorDesconhecidoAindaEhCitadoPeloNome()
    {
        var perfil = ExecutorPerfis.Get("Aider");

        Assert.Equal("Aider", perfil.Nome);
        Assert.Contains("Aider", perfil.ParaPrompt());
    }

    [Fact]
    public void ClaudeCodeEDiferenteDeCursor()
    {
        // O ponto do recurso: perfis distintos produzem diretrizes distintas.
        Assert.NotEqual(ExecutorPerfis.Get("Claude Code").ParaPrompt(), ExecutorPerfis.Get("Cursor").ParaPrompt());
    }
}

public class PreferenciasSaidaTests
{
    [Fact]
    public void NivelPadraoEhEquilibrado()
    {
        Assert.Equal(NivelDetalhe.Equilibrado, new PreferenciasSaida().NivelOuPadrao);
    }

    [Fact]
    public void OrcamentoDeTokensAcompanhaONivel()
    {
        const int baseTokens = 4096;

        var conciso = NiveisDetalhe.MaxTokens(NivelDetalhe.Conciso, baseTokens);
        var equilibrado = NiveisDetalhe.MaxTokens(NivelDetalhe.Equilibrado, baseTokens);
        var exaustivo = NiveisDetalhe.MaxTokens(NivelDetalhe.Exaustivo, baseTokens);

        Assert.True(conciso < equilibrado);
        Assert.True(equilibrado < exaustivo);
        Assert.Equal(baseTokens, equilibrado);
    }

    [Fact]
    public void OrcamentoConcisoTemPisoParaNaoTruncar()
    {
        Assert.True(NiveisDetalhe.MaxTokens(NivelDetalhe.Conciso, 512) >= 1024);
    }

    [Fact]
    public void IdiomaAutomaticoSegueOIdiomaDaIdeia()
    {
        foreach (var valor in new string?[] { null, "", "auto", "AUTO" })
            Assert.Contains("mesmo idioma", IdiomasSaida.Diretriz(valor));
    }

    [Theory]
    [InlineData("pt-BR", "português")]
    [InlineData("en", "inglês")]
    [InlineData("es", "espanhol")]
    public void IdiomaExplicitoFixaOIdiomaDeSaida(string codigo, string esperado)
    {
        var diretriz = IdiomasSaida.Diretriz(codigo);

        Assert.Contains(esperado, diretriz);
        Assert.Contains("independentemente", diretriz);
    }

    [Fact]
    public void IdiomaDesconhecidoEhRepassadoLiteralmente()
    {
        Assert.Contains("klingon", IdiomasSaida.Diretriz("klingon"));
    }
}

public class PipelineModelOptionsTests
{
    [Fact]
    public void DistintosNaoRepeteModelos()
    {
        var modelos = new PipelineModelOptions().Distintos();

        Assert.Equal(modelos.Count, modelos.Distinct(StringComparer.OrdinalIgnoreCase).Count());
    }

    [Fact]
    public void DistintosCobreTodasAsEtapasDoPipeline()
    {
        var opcoes = new PipelineModelOptions();
        var modelos = opcoes.Distintos();

        Assert.Contains(opcoes.Classificador, modelos);
        Assert.Contains(opcoes.Validacao, modelos);
        Assert.Contains(opcoes.Geracao, modelos);
        foreach (var fallback in opcoes.GeracaoFallback)
            Assert.Contains(fallback, modelos);
    }

    [Fact]
    public void GeracaoEhOPrimeiroItemDaCadeiaDeFallback()
    {
        var opcoes = new PipelineModelOptions();
        Assert.Equal(opcoes.GeracaoFallback[0], opcoes.Geracao);
    }
}
