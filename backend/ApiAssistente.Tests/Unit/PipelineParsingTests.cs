using ApiAssistente.Controllers;
using ApiAssistente.Models;
using Xunit;

namespace ApiAssistente.Tests;

public class ExtrairPerguntasTests
{
    private const string Resposta = """
        <resultado>
          <tem_ambiguidade>sim</tem_ambiguidade>
          <perguntas>
            <pergunta><id>plataforma</id><texto>Qual plataforma?</texto><opcoes>Web | Mobile | Ambas</opcoes><livre>sim</livre></pergunta>
            <pergunta><id>banco</id><texto>Qual SGBD?</texto><opcoes>Postgres | MySQL</opcoes><livre>nao</livre></pergunta>
          </perguntas>
        </resultado>
        """;

    [Fact]
    public void ExtraiPerguntasComOpcoesSeparadasPorBarra()
    {
        var perguntas = PromptController.ExtrairPerguntas(Resposta);

        Assert.Equal(2, perguntas.Count);
        Assert.Equal("plataforma", perguntas[0].Id);
        Assert.Equal("Qual plataforma?", perguntas[0].Texto);
        Assert.Equal(new[] { "Web", "Mobile", "Ambas" }, perguntas[0].Opcoes);
        Assert.True(perguntas[0].Livre);
        Assert.False(perguntas[1].Livre);
    }

    [Fact]
    public void LimitaEmDuasPerguntas()
    {
        var muitas = string.Concat(Enumerable.Repeat(
            "<pergunta><id>x</id><texto>T</texto><opcoes>A | B</opcoes><livre>nao</livre></pergunta>", 5));

        Assert.Equal(2, PromptController.ExtrairPerguntas(muitas).Count);
    }

    [Fact]
    public void DescartaPerguntaSemTexto()
    {
        var semTexto = "<pergunta><id>x</id><texto></texto><opcoes>A | B</opcoes></pergunta>";
        Assert.Empty(PromptController.ExtrairPerguntas(semTexto));
    }

    /// <summary>
    /// Regressão do P1-8: os dois índices eram buscados a partir da mesma
    /// posição, o que podia produzir um intervalo invertido.
    /// </summary>
    [Fact]
    public void NaoLancaComBlocoMalformado()
    {
        var malformado = "</pergunta><pergunta><id>a</id><texto>Ok?</texto><opcoes>S | N</opcoes></pergunta>";

        var excecao = Record.Exception(() => PromptController.ExtrairPerguntas(malformado));

        Assert.Null(excecao);
    }

    [Fact]
    public void NaoEntraEmLacoInfinitoComAberturaSemFechamento()
    {
        var excecao = Record.Exception(() => PromptController.ExtrairPerguntas("<pergunta><texto>sem fim"));
        Assert.Null(excecao);
    }
}

public class ExtrairSubTarefasTests
{
    [Fact]
    public void SeparaTituloDescricaoEComplexidadePorBarra()
    {
        var raw = """
            Criar entidade | Modelar Pedido no EF Core | baixa
            Criar endpoint | POST /pedidos com validacao | alta
            """;

        var tarefas = PromptController.ExtrairSubTarefas(raw);

        Assert.Equal(2, tarefas.Count);
        Assert.Equal("Criar entidade", tarefas[0].Titulo);
        Assert.Equal("Modelar Pedido no EF Core", tarefas[0].Descricao);
        Assert.Equal("baixa", tarefas[0].Complexidade);
        Assert.Equal("alta", tarefas[1].Complexidade);
    }

    [Fact]
    public void RemoveMarcadoresDeLista()
    {
        var tarefas = PromptController.ExtrairSubTarefas("- Criar entidade | desc | baixa\n* Outra | desc | alta");

        Assert.Equal("Criar entidade", tarefas[0].Titulo);
        Assert.Equal("Outra", tarefas[1].Titulo);
    }

    /// <summary>O frontend só sabe renderizar baixa | media | alta.</summary>
    [Theory]
    [InlineData("MÉDIA", "media")]
    [InlineData("Baixa", "baixa")]
    [InlineData("high", "alta")]
    [InlineData("qualquer coisa", "media")]
    public void NormalizaComplexidade(string entrada, string esperado)
    {
        var tarefas = PromptController.ExtrairSubTarefas($"T | D | {entrada}");
        Assert.Equal(esperado, tarefas[0].Complexidade);
    }

    [Fact]
    public void UsaMediaQuandoAComplexidadeNaoFoiInformada()
    {
        Assert.Equal("media", PromptController.ExtrairSubTarefas("Só o titulo")[0].Complexidade);
    }

    [Fact]
    public void LimitaEmOitoTarefas()
    {
        var raw = string.Join("\n", Enumerable.Range(1, 20).Select(i => $"T{i} | D | baixa"));
        Assert.Equal(8, PromptController.ExtrairSubTarefas(raw).Count);
    }

    [Fact]
    public void DevolveListaVaziaParaEntradaVazia()
    {
        Assert.Empty(PromptController.ExtrairSubTarefas(""));
        Assert.Empty(PromptController.ExtrairSubTarefas("   \n  \n"));
    }
}

public class TentarConverterTipoTests
{
    /// <summary>
    /// Regressão do P1-6: a comparação era exata, então "codigo" e "Código"
    /// caíam em Outro e o pipeline seguia com a configuração errada.
    /// </summary>
    [Theory]
    [InlineData("Codigo", TipoObjetivo.Codigo)]
    [InlineData("codigo", TipoObjetivo.Codigo)]
    [InlineData("CÓDIGO", TipoObjetivo.Codigo)]
    [InlineData("Código", TipoObjetivo.Codigo)]
    [InlineData("code", TipoObjetivo.Codigo)]
    [InlineData("Vídeo", TipoObjetivo.Video)]
    [InlineData("refatoração", TipoObjetivo.Refatoracao)]
    [InlineData("UI/UX", TipoObjetivo.DesignUI)]
    [InlineData("design ui", TipoObjetivo.DesignUI)]
    [InlineData("copy", TipoObjetivo.Copywriting)]
    [InlineData("  imagem  ", TipoObjetivo.Imagem)]
    public void ConverteIgnorandoCaixaAcentoEPontuacao(string entrada, TipoObjetivo esperado)
    {
        Assert.Equal(esperado, PromptController.TentarConverterTipo(entrada));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    [InlineData("marketing")]
    public void DevolveNullQuandoNaoReconhece(string? entrada)
    {
        Assert.Null(PromptController.TentarConverterTipo(entrada));
    }
}

public class MontarIdeiaEnriquecidaTests
{
    [Fact]
    public void DevolveAIdeiaIntactaSemContextoNemRespostas()
    {
        Assert.Equal("criar login", PromptController.MontarIdeiaEnriquecida("criar login", null));
    }

    [Fact]
    public void AnexaContextoDoProjeto()
    {
        var r = PromptController.MontarIdeiaEnriquecida("criar login", null, ".NET 8 e Postgres");

        Assert.Contains("criar login", r);
        Assert.Contains("CONTEXTO DO PROJETO", r);
        Assert.Contains(".NET 8 e Postgres", r);
    }

    [Fact]
    public void AnexaRespostasDeClarificacao()
    {
        var respostas = new Dictionary<string, string> { ["plataforma"] = "Web", ["banco"] = "Postgres" };

        var r = PromptController.MontarIdeiaEnriquecida("criar login", respostas);

        Assert.Contains("CONTEXTO ADICIONAL DO USUÁRIO", r);
        Assert.Contains("plataforma: Web", r);
        Assert.Contains("banco: Postgres", r);
    }

    [Fact]
    public void IgnoraContextoEmBranco()
    {
        Assert.Equal("ideia", PromptController.MontarIdeiaEnriquecida("ideia", null, "   "));
    }
}
