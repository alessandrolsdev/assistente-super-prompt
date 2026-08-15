using System.Globalization;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using ApiAssistente.Configuration;
using ApiAssistente.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace ApiAssistente.Controllers;

[ApiController]
[Route("api/[controller]")]
public class PromptController : ControllerBase
{
    private readonly HttpClient _httpClient;
    private readonly OpenRouterOptions _options;
    private readonly ILogger<PromptController> _logger;

    private PipelineModelOptions Modelos => _options.Models;

    public PromptController(
        IHttpClientFactory httpClientFactory,
        IOptions<OpenRouterOptions> options,
        ILogger<PromptController> logger)
    {
        _options = options.Value;
        _logger = logger;
        _httpClient = httpClientFactory.CreateClient(OpenRouterOptions.HttpClientName);
    }

    // ------------------------------------------------------------
    // POST /api/prompt/gerar
    // ------------------------------------------------------------
    [HttpPost("gerar")]
    public async Task<IActionResult> GerarPrompt([FromBody] PromptRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.IdeiaBruta))
            return BadRequest(new { erro = "ideiaBruta é obrigatório." });

        var configError = ValidarConfiguracaoOpenRouter();
        if (configError is not null)
            return configError;

        try
        {
            // -- ETAPA -2: CLASSIFICAÇÃO DE OBJETIVO --------------------------
            var tipoFinal = await ClassificarObjetivo(request.IdeiaBruta, request.TipoSugerido, cancellationToken);
            _logger.LogInformation("[GerarPrompt] Tipo classificado: {Tipo}", tipoFinal);

            var config = ObjetivoConfigs.Get(tipoFinal);

            // -- ETAPA -1: DETECÇÃO DE AMBIGUIDADE ----------------------------
            var jaTemRespostas = request.RespostasClarificacao?.Count > 0;
            if (!request.ForcarSimples && !jaTemRespostas)
            {
                var perguntas = await DetectarAmbiguidade(request.IdeiaBruta, tipoFinal, cancellationToken);
                if (perguntas.Count > 0)
                {
                    _logger.LogInformation("[GerarPrompt] {Total} perguntas de clarificação geradas", perguntas.Count);
                    return Ok(new
                    {
                        tipo_resposta   = "clarificacao_necessaria",
                        perguntas,
                        tipo_confirmado = tipoFinal.ToString(),
                        pipeline = new { etapa_ambiguidade = new { modelo = Modelos.Ambiguidade, resultado = "ambiguo" } }
                    });
                }
            }

            // -- Enriquece ideia -----------------------------------------------
            var ideiaEnriquecida = MontarIdeiaEnriquecida(
                request.IdeiaBruta, request.RespostasClarificacao, request.ExecutorAlvo);

            // -- TRIAGEM (só para código/refatoração/UI/outro) -----------------
            var tipoExigeTriagem = tipoFinal is TipoObjetivo.Codigo
                                              or TipoObjetivo.Refatoracao
                                              or TipoObjetivo.DesignUI
                                              or TipoObjetivo.Outro;

            if (!request.ForcarSimples && tipoExigeTriagem)
            {
                var triagem = await TriarComplexidade(ideiaEnriquecida, cancellationToken);
                if (triagem.isComplexo)
                {
                    _logger.LogInformation("[GerarPrompt] Triagem: complexo — {Total} sub-tarefas", triagem.subTarefas.Count);
                    return Ok(new
                    {
                        tipo_resposta   = "plano_de_divisao",
                        aviso           = triagem.aviso,
                        sub_tarefas     = triagem.subTarefas,
                        recomendacao    = triagem.recomendacao,
                        tipo_confirmado = tipoFinal.ToString(),
                        pipeline = new { etapa_triagem = new { modelo = Modelos.Triagem, resultado = "complexo" } }
                    });
                }
            }

            // -- ETAPA 0: PAPEL + FORMATO --------------------------------------
            var deteccao = await DetectarPapelEFormato(ideiaEnriquecida, request.Papel, config, cancellationToken);
            _logger.LogInformation("[GerarPrompt] Papel: {Papel}", Truncar(deteccao.papel, 80));

            // -- ETAPA 1: ANÁLISE ----------------------------------------------
            var analise = await AnalisarPorTipo(ideiaEnriquecida, tipoFinal, deteccao.papel, config, cancellationToken);
            if (!analise.Sucesso)
            {
                _logger.LogError("[GerarPrompt] Etapa 1 (Análise) sem resposta. Tipo={Tipo} Erro={Erro}", tipoFinal, analise.Erro);
                return FalhaUpstream("Etapa 1 (Análise)", analise);
            }

            // -- ETAPA 2: GERAÇÃO ----------------------------------------------
            var geracao = await GerarPorTipo(
                ideiaEnriquecida, tipoFinal, analise.Texto!, deteccao.papel, deteccao.formato, config, cancellationToken);
            var modeloGeracaoUsado = geracao.ModeloUsado ?? Modelos.Geracao;

            if (!geracao.Sucesso)
            {
                _logger.LogError("[GerarPrompt] Etapa 2 (Geração) sem resposta. Tipo={Tipo} Erro={Erro}", tipoFinal, geracao.Erro);
                return FalhaUpstream("Etapa 2 (Geração)", geracao);
            }

            var promptGerado = geracao.Texto!;
            _logger.LogInformation("[GerarPrompt] Prompt gerado ({Chars} chars) por {Modelo}", promptGerado.Length, modeloGeracaoUsado);

            // -- ETAPA 3: VALIDAÇÃO --------------------------------------------
            // A validação é best-effort: se falhar, seguimos com o prompt da etapa 2.
            var validacao = await ValidarPorTipo(promptGerado, tipoFinal, config, cancellationToken);
            var textoValidacao = validacao.Texto ?? "";

            var promptFinal = ExtrairTagXmlRobusto(textoValidacao, "prompt_final");
            var tamanhoMinimo = tipoFinal is TipoObjetivo.Imagem or TipoObjetivo.Video ? 50 : 80;
            var promptFinalValido = promptFinal is not null
                && promptFinal.Length > tamanhoMinimo
                && !promptFinal.StartsWith("Nenhum", StringComparison.OrdinalIgnoreCase)
                && !promptFinal.StartsWith("Corrija", StringComparison.OrdinalIgnoreCase);

            var tagGeracao = tipoFinal is TipoObjetivo.Imagem or TipoObjetivo.Video
                ? "prompt_gerado"
                : "prompt_otimizado";

            var resultadoFinal = promptFinalValido
                ? promptFinal!
                : ExtrairTagXmlRobusto(promptGerado, tagGeracao) ?? promptGerado;

            if (string.IsNullOrWhiteSpace(resultadoFinal))
            {
                _logger.LogError(
                    "[GerarPrompt] Resultado final vazio. promptGerado={GeradoLen}c validacao={ValidacaoLen}c",
                    promptGerado.Length, textoValidacao.Length);
                return StatusCode(StatusCodes.Status502BadGateway, new
                {
                    erro = "O modelo devolveu um resultado vazio. Tente novamente."
                });
            }

            var score = ExtrairScore(textoValidacao);
            _logger.LogInformation("[GerarPrompt] Score: {Score} | Resultado: {Chars} chars", score, resultadoFinal.Length);

            return Ok(new
            {
                tipo_resposta    = "prompt_gerado",
                tipo_objetivo    = tipoFinal.ToString(),
                prompt_otimizado = resultadoFinal.Trim(),
                deteccao = new
                {
                    papel_detectado   = deteccao.papel,
                    formato_detectado = deteccao.formato,
                    papel_foi_editado = !string.IsNullOrWhiteSpace(request.Papel),
                    tipo_confirmado   = tipoFinal.ToString(),
                    ferramentas_alvo  = config.FerramentasAlvo
                },
                pipeline = new
                {
                    etapa_triagem   = new { modelo = Modelos.Classificador, funcao = "Classificação" },
                    etapa_0         = new { modelo = Modelos.Deteccao,      funcao = "Detecção"      },
                    etapa_1         = new { modelo = Modelos.Analise,       funcao = "Análise"       },
                    etapa_2         = new { modelo = modeloGeracaoUsado,    funcao = "Geração"       },
                    etapa_3         = new { modelo = Modelos.Validacao,     funcao = "Validação"     },
                    score_qualidade = score
                }
            });
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // Cliente desistiu: não é erro do servidor e não precisa de corpo.
            // 499 é a convenção (nginx) para "client closed request".
            _logger.LogInformation("[GerarPrompt] Requisição cancelada pelo cliente.");
            return StatusCode(499);
        }
        catch (Exception ex)
        {
            return ErroInterno(ex, nameof(GerarPrompt));
        }
    }

    // ------------------------------------------------------------
    // POST /api/prompt/regerar
    // ------------------------------------------------------------
    [HttpPost("regerar")]
    public async Task<IActionResult> RegerarPrompt([FromBody] RegerarRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.PromptAtual))
            return BadRequest(new { erro = "promptAtual é obrigatório." });
        if (string.IsNullOrWhiteSpace(request.InstrucaoMelhora))
            return BadRequest(new { erro = "instrucaoMelhora é obrigatório." });

        var configError = ValidarConfiguracaoOpenRouter();
        if (configError is not null)
            return configError;

        var tipo   = request.TipoObjetivo ?? TipoObjetivo.Outro;
        var config = ObjetivoConfigs.Get(tipo);

        try
        {
            var instrucao = tipo switch
            {
                TipoObjetivo.Imagem or TipoObjetivo.Video =>
                    $"Melhore este prompt de {tipo.ToString().ToLowerInvariant()} aplicando: {request.InstrucaoMelhora}. Mantenha estilo técnico para {config.FerramentasAlvo}.",
                TipoObjetivo.Codigo or TipoObjetivo.Refatoracao =>
                    $"Refine este prompt técnico aplicando: {request.InstrucaoMelhora}. Mantenha especificidade e critérios mensuráveis.",
                TipoObjetivo.Copywriting =>
                    $"Melhore este prompt de copywriting: {request.InstrucaoMelhora}. Mantenha foco em conversão.",
                _ => $"Aplique: {request.InstrucaoMelhora}"
            };

            var melhoria = await ChamarCadeiaGeracao(
                temperature: config.Temperature,
                systemPrompt: $@"
Você é um Arquiteto de Prompts especializado em {tipo}.
NUNCA descarte a estrutura existente.
SEMPRE aplique a instrução de melhora cirurgicamente.
SEMPRE mantenha 95%+ de força para: {config.FerramentasAlvo}.",
                userPrompt: $@"
Prompt atual:
{request.PromptAtual}

Instrução: {instrucao}
Papel: {request.Papel ?? config.PapelPadrao}

Retorne SOMENTE dentro das tags:
<prompt_melhorado>
[prompt completo melhorado]
</prompt_melhorado>",
                cancellationToken: cancellationToken);

            if (!melhoria.Sucesso)
            {
                _logger.LogError("[RegerarPrompt] Geração do prompt melhorado falhou. Erro={Erro}", melhoria.Erro);
                return FalhaUpstream("Geração do prompt melhorado", melhoria);
            }

            var promptMelhorado = melhoria.Texto!;
            var modeloUsado = melhoria.ModeloUsado ?? Modelos.Geracao;

            var validacao = await ValidarPorTipo(promptMelhorado, tipo, config, cancellationToken);
            var textoValidacao = validacao.Texto ?? "";

            var final = ExtrairTagXmlRobusto(textoValidacao, "prompt_final");
            var finalValido = final is not null
                && final.Length > 80
                && !final.StartsWith("Nenhum", StringComparison.OrdinalIgnoreCase)
                && !final.StartsWith("Corrija", StringComparison.OrdinalIgnoreCase);

            if (!finalValido)
                final = ExtrairTagXmlRobusto(promptMelhorado, "prompt_melhorado") ?? promptMelhorado;

            return Ok(new
            {
                tipo_resposta    = "prompt_melhorado",
                tipo_objetivo    = tipo.ToString(),
                prompt_otimizado = final!.Trim(),
                pipeline = new
                {
                    etapa_1 = new { modelo = modeloUsado,      funcao = "Geração"   },
                    etapa_2 = new { modelo = modeloUsado,      funcao = "Geração"   },
                    etapa_3 = new { modelo = Modelos.Validacao, funcao = "Validação" },
                    score_qualidade = ExtrairScore(textoValidacao)
                }
            });
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            _logger.LogInformation("[RegerarPrompt] Requisição cancelada pelo cliente.");
            return StatusCode(499);
        }
        catch (Exception ex)
        {
            return ErroInterno(ex, nameof(RegerarPrompt));
        }
    }

    // ------------------------------------------------------------
    // CLASSIFICAÇÃO DE OBJETIVO
    // ------------------------------------------------------------
    private async Task<TipoObjetivo> ClassificarObjetivo(
        string ideia, TipoObjetivo? tipoSugerido, CancellationToken cancellationToken)
    {
        var resposta = await ChamarModelo(
            modelo: Modelos.Classificador, temperature: 0.1,
            systemPrompt: @"
Você classifica o tipo de prompt que o usuário quer criar.
Tipos: Imagem, Video, Codigo, Refatoracao, Copywriting, DesignUI, Outro
SEMPRE responda dentro das tags XML.",
            userPrompt: $@"
Classifique:
{(tipoSugerido.HasValue ? $"Usuário sugeriu: {tipoSugerido.Value}. Confirme ou corrija." : "Detecte automaticamente.")}

Pedido: '{ideia}'

<classificacao>
  <tipo>Imagem/Video/Codigo/Refatoracao/Copywriting/DesignUI/Outro</tipo>
  <confianca>alta/media/baixa</confianca>
</classificacao>",
            cancellationToken: cancellationToken);

        var tipoStr = ExtrairTagXml(resposta.Texto ?? "", "tipo")?.Trim() ?? "";

        // Os modelos gratuitos costumam responder com acento ou caixa diferente
        // ("Código", "codigo", "VIDEO"), então a comparação é normalizada.
        return TentarConverterTipo(tipoStr) ?? tipoSugerido ?? TipoObjetivo.Outro;
    }

    // ------------------------------------------------------------
    // ANÁLISE ESPECIALIZADA POR TIPO
    // ------------------------------------------------------------
    private async Task<RespostaModelo> AnalisarPorTipo(
        string ideia, TipoObjetivo tipo, string papel, ObjetivoConfig config, CancellationToken cancellationToken)
    {
        var campos = tipo switch
        {
            TipoObjetivo.Imagem => @"
  <elementos_visuais>Sujeito, materiais, texturas, cores, iluminação, composição.</elementos_visuais>
  <estilo_artistico>Referências visuais, movimento artístico, artistas de referência.</estilo_artistico>
  <parametros_tecnicos>Ferramenta alvo, resolução, aspect ratio, parâmetros especiais.</parametros_tecnicos>
  <o_que_evitar>Elementos que degradam ou conflitam com o objetivo.</o_que_evitar>",

            TipoObjetivo.Video => @"
  <cena_principal>Ambiente, sujeitos, ação central.</cena_principal>
  <movimento_camera>Tipo de movimento, velocidade, transições.</movimento_camera>
  <estilo_visual>Paleta, iluminação, atmosfera, referências.</estilo_visual>",

            TipoObjetivo.Copywriting => @"
  <persona_alvo>Quem é o leitor, suas dores e desejos.</persona_alvo>
  <proposta_valor>O que diferencia este produto/serviço.</proposta_valor>
  <gatilhos>Quais gatilhos usar (urgência, prova social, autoridade).</gatilhos>
  <tom_voz>Tom, linguagem, nível de formalidade.</tom_voz>",

            TipoObjetivo.DesignUI => @"
  <componentes>Quais elementos de UI são necessários.</componentes>
  <fluxo>Jornada e interações do usuário.</fluxo>
  <tokens>Cores, tipografia, espaçamento necessários.</tokens>",

            _ => @"
  <objetivo_real>O que precisa ser implementado.</objetivo_real>
  <armadilhas>3 erros que uma implementação ruim cometeria.</armadilhas>
  <contexto_minimo>Stack, padrões e requisitos mínimos.</contexto_minimo>
  <restricoes>5 restrições NUNCA/SEMPRE específicas.</restricoes>"
        };

        return await ChamarModelo(
            modelo: Modelos.Analise, temperature: 0.3,
            systemPrompt: $@"
Você é um analista de engenharia de prompts para {tipo}.
Papel: {papel} | Ferramentas: {config.FerramentasAlvo}
NUNCA gere o prompt final. Apenas analise.
SEMPRE responda dentro das tags XML.",
            userPrompt: $@"
Analise para {tipo} e responda SOMENTE neste XML:
<analise>
  {campos}
</analise>

Papel: {papel}
Pedido: {ideia}",
            cancellationToken: cancellationToken);
    }

    // ------------------------------------------------------------
    // GERAÇÃO ESPECIALIZADA POR TIPO
    // ------------------------------------------------------------
    private async Task<RespostaModelo> GerarPorTipo(
        string ideia, TipoObjetivo tipo, string analise,
        string papel, string formato, ObjetivoConfig config, CancellationToken cancellationToken)
    {
        var criterios = string.Join("\n    ", config.CriteriosBase.Select((c, i) => $"{i + 1}. {c}"));

        // Imagem e vídeo: texto direto, sem XML
        if (tipo is TipoObjetivo.Imagem or TipoObjetivo.Video)
        {
            return await ChamarCadeiaGeracao(
                temperature: config.Temperature,
                systemPrompt: $@"
Você é especialista em prompt engineering para {tipo} ({config.FerramentasAlvo}).
NUNCA use XML no prompt gerado.
NUNCA adicione explicações — apenas o prompt.
SEMPRE inclua parâmetros técnicos da ferramenta no final.
SEMPRE extraia 95%+ do potencial da IA geradora.",
                userPrompt: $@"
Com base na análise:
{analise}

Crie o prompt para:
- Objetivo: {ideia}
- Ferramenta: {config.FerramentasAlvo}
- Papel: {papel}

Critérios obrigatórios:
{criterios}

Retorne SOMENTE dentro das tags:
<prompt_gerado>
[prompt completo — para Midjourney inclua --ar, --v, --style no final]
</prompt_gerado>",
                cancellationToken: cancellationToken);
        }

        // Outros: XML estruturado
        return await ChamarCadeiaGeracao(
            temperature: config.Temperature,
            systemPrompt: $@"
Você é um Arquiteto de Prompts Sênior para {tipo}.
NUNCA adicione texto fora das tags XML.
NUNCA seja genérico.
SEMPRE inclua critérios mensuráveis.",
            userPrompt: $@"
Com base na análise:
{analise}

Gere o prompt para:
- Papel: {papel}
- Objetivo: {ideia}
- Ferramenta: {config.FerramentasAlvo}
- Formato: {formato}

Critérios obrigatórios:
{criterios}

Retorne SOMENTE neste XML:
<prompt_otimizado>
  <system_instruction>{papel}. Ferramenta: {config.FerramentasAlvo}.</system_instruction>
  <restricoes_constitucionais>6 restrições NUNCA/SEMPRE específicas para {tipo}.</restricoes_constitucionais>
  <instrucao_principal>Tarefa única com critério de sucesso mensurável.</instrucao_principal>
  <criterios_de_aceitacao>{criterios}</criterios_de_aceitacao>
  <few_shot_exemplo>INPUT: exemplo realista | REASONING: raciocínio | OUTPUT: resultado correto</few_shot_exemplo>
  <formato_resposta>{formato}</formato_resposta>
  <loop_validacao>Verifique os {config.CriteriosBase.Length} critérios antes de entregar.</loop_validacao>
</prompt_otimizado>",
            cancellationToken: cancellationToken);
    }

    // ------------------------------------------------------------
    // VALIDAÇÃO ESPECIALIZADA POR TIPO
    // ------------------------------------------------------------
    private async Task<RespostaModelo> ValidarPorTipo(
        string promptGerado, TipoObjetivo tipo, ObjetivoConfig config, CancellationToken cancellationToken)
    {
        var checklist = tipo switch
        {
            TipoObjetivo.Imagem => @"
    Sujeito principal descrito com precisão visual: sim/não
    Estilo artístico e referências especificados: sim/não
    Iluminação e composição incluídos: sim/não
    Parâmetros técnicos da ferramenta presentes: sim/não
    Tom e atmosfera claros: sim/não",

            TipoObjetivo.Video => @"
    Sujeito e ação principal claros: sim/não
    Movimento de câmera especificado: sim/não
    Atmosfera e iluminação descritos: sim/não
    Estilo visual de referência presente: sim/não",

            TipoObjetivo.Copywriting => @"
    Persona-alvo claramente definida: sim/não
    Proposta de valor única presente: sim/não
    Gatilhos psicológicos específicos: sim/não
    CTA claro e orientado à ação: sim/não",

            _ => @"
    Papel técnico ultra-específico com stack: sim/não
    Critérios de aceitação testáveis: sim/não
    Exemplo few-shot técnico e realista: sim/não
    Ausência de linguagem vaga: sim/não"
        };

        return await ChamarModelo(
            modelo: Modelos.Validacao, temperature: 0.1,
            systemPrompt: $@"
Você valida prompts para {tipo} ({config.FerramentasAlvo}).
Prompts ricos e detalhados são CORRETOS — não penalize detalhamento.
Penalize apenas genericidade e falta de especificidade.
SEMPRE responda dentro das tags XML.",
            userPrompt: $@"
Valide este prompt para {tipo}:

<validacao>
  <checklist>{checklist}</checklist>
  <problemas_encontrados>Problemas reais. Se nenhum: Nenhum problema crítico encontrado.</problemas_encontrados>
  <prompt_final>Corrija problemas reais. Se tudo ok: copie sem alterações.</prompt_final>
  <score>0-100. Prompts ricos e específicos devem pontuar 85+.</score>
</validacao>

Prompt:
{promptGerado}",
            cancellationToken: cancellationToken);
    }

    // ------------------------------------------------------------
    // DETECÇÃO DE AMBIGUIDADE
    // ------------------------------------------------------------
    private async Task<List<PerguntaClarificacao>> DetectarAmbiguidade(
        string ideiaBruta, TipoObjetivo tipo, CancellationToken cancellationToken)
    {
        var exemplos = tipo switch
        {
            TipoObjetivo.Imagem => "- 'personagem' → original ou IP existente?\n- 'estilo anime' → qual subgênero?\n- 'fundo' → transparente ou cenário elaborado?",
            TipoObjetivo.Video  => "- 'animação' → 2D, 3D ou stop motion?\n- 'câmera' → movimento específico ou estática?",
            TipoObjetivo.Codigo => "- 'canva' → site Canva.com ou HTML Canvas API?\n- 'mobile' → React Native, Flutter ou nativo?\n- 'banco' → qual SGBD?",
            _ => "- Termos com múltiplos significados técnicos\n- Referências ambíguas a ferramentas"
        };

        var resposta = await ChamarModelo(
            modelo: Modelos.Ambiguidade, temperature: 0.2,
            systemPrompt: $@"
Você detecta ambiguidades críticas em pedidos para {tipo}.
Exemplos relevantes: {exemplos}
NUNCA gere mais de 2 perguntas.
SEMPRE gere opções clicáveis.
SEMPRE responda em XML.",
            userPrompt: $@"
Detecte ambiguidades em: '{ideiaBruta}'

<resultado>
  <tem_ambiguidade>sim/não</tem_ambiguidade>
  <perguntas>
    <pergunta><id>id_unico</id><texto>Pergunta direta</texto><opcoes>A | B | C</opcoes><livre>sim/não</livre></pergunta>
  </perguntas>
</resultado>",
            cancellationToken: cancellationToken);

        var texto = resposta.Texto ?? "";
        var temAmbiguidade = ExtrairTagXml(texto, "tem_ambiguidade")?.Trim().ToLowerInvariant();
        if (temAmbiguidade != "sim") return new List<PerguntaClarificacao>();

        return ExtrairPerguntas(texto);
    }

    /// <summary>
    /// Percorre os blocos &lt;pergunta&gt; da resposta. A busca pelo fechamento parte
    /// da abertura correspondente — antes ambos os índices partiam da mesma posição,
    /// o que podia produzir um intervalo invertido e derrubar a requisição.
    /// </summary>
    internal static List<PerguntaClarificacao> ExtrairPerguntas(string texto)
    {
        const string abertura = "<pergunta>";
        const string fechamento = "</pergunta>";

        var perguntas = new List<PerguntaClarificacao>();
        var pos = 0;

        while (perguntas.Count < 2 && pos < texto.Length)
        {
            var inicio = texto.IndexOf(abertura, pos, StringComparison.Ordinal);
            if (inicio < 0) break;

            var conteudoInicio = inicio + abertura.Length;
            var fim = texto.IndexOf(fechamento, conteudoInicio, StringComparison.Ordinal);
            if (fim < 0) break;

            var bloco = texto[conteudoInicio..fim];
            var txt = ExtrairTagXml(bloco, "texto")?.Trim() ?? "";

            if (!string.IsNullOrWhiteSpace(txt))
            {
                var opcoes = ExtrairTagXml(bloco, "opcoes")?.Trim() ?? "";
                perguntas.Add(new PerguntaClarificacao
                {
                    Id    = ExtrairTagXml(bloco, "id")?.Trim() is { Length: > 0 } id ? id : $"q{perguntas.Count}",
                    Texto = txt,
                    Opcoes = opcoes.Split('|', StringSplitOptions.RemoveEmptyEntries)
                                   .Select(o => o.Trim())
                                   .Where(o => o.Length > 0)
                                   .ToList(),
                    Livre = string.Equals(ExtrairTagXml(bloco, "livre")?.Trim(), "sim", StringComparison.OrdinalIgnoreCase)
                });
            }

            pos = fim + fechamento.Length;
        }

        return perguntas;
    }

    // ------------------------------------------------------------
    // TRIAGEM DE COMPLEXIDADE
    // ------------------------------------------------------------
    private async Task<(bool isComplexo, string aviso, List<SubTarefaItem> subTarefas, string recomendacao)>
        TriarComplexidade(string ideia, CancellationToken cancellationToken)
    {
        var resposta = await ChamarModelo(
            modelo: Modelos.Triagem, temperature: 0.1,
            systemPrompt: @"
Você decide se um pedido de software REALMENTE precisa ser dividido em múltiplas tarefas independentes.

REGRAS RIGOROSAS:
- Classifique como SIMPLES se: é uma única funcionalidade, refatoração de código existente, aplicar um padrão/estilo, adicionar uma feature, corrigir bugs, criar um componente.
- Classifique como COMPLEXO APENAS se: são claramente sistemas separados (ex: backend + frontend + banco + deploy), ou o usuário explicitamente pediu uma lista de tarefas.
- NUNCA divida por seções de uma mesma página — isso é simples.
- NUNCA divida refatorações — aplicar um padrão a código existente é SEMPRE simples.
- NUNCA divida por componentes de UI — criar vários componentes é uma tarefa única.
- Em caso de dúvida: classifique como SIMPLES.
- Máximo 4 sub-tarefas se realmente complexo.",
            userPrompt: $@"
Pedido: '{ideia}'

<triagem>
  <classificacao>simples/complexo</classificacao>
  <justificativa>Uma frase explicando POR QUE é complexo (ou deixe vazio se simples).</justificativa>
  <sub_tarefas>TITULO | DESCRICAO | COMPLEXIDADE — uma por linha. Deixe VAZIO se simples.</sub_tarefas>
  <recomendacao>Qual implementar primeiro. Vazio se simples.</recomendacao>
</triagem>",
            cancellationToken: cancellationToken);

        var texto = resposta.Texto ?? "";
        var classificacao = ExtrairTagXml(texto, "classificacao")?.Trim().ToLowerInvariant();
        if (classificacao != "complexo")
            return (false, "", new List<SubTarefaItem>(), "");

        var aviso        = ExtrairTagXml(texto, "justificativa")?.Trim() ?? "";
        var recomendacao = ExtrairTagXml(texto, "recomendacao")?.Trim()  ?? "";
        var subTarefas   = ExtrairSubTarefas(ExtrairTagXml(texto, "sub_tarefas")?.Trim() ?? "");

        // Sem sub-tarefas utilizáveis o "plano de divisão" seria uma tela vazia:
        // nesse caso seguimos o fluxo simples.
        if (subTarefas.Count == 0)
            return (false, "", subTarefas, "");

        return (true, aviso, subTarefas, recomendacao);
    }

    internal static List<SubTarefaItem> ExtrairSubTarefas(string raw) =>
        raw.Split('\n', StringSplitOptions.RemoveEmptyEntries)
           .Select(l => l.Trim().TrimStart('-', '*', ' '))
           .Where(l => !string.IsNullOrWhiteSpace(l))
           .Select(l =>
           {
               var p = l.Split('|');
               return new SubTarefaItem
               {
                   Titulo       = p[0].Trim(),
                   Descricao    = p.Length > 1 ? p[1].Trim() : "",
                   Complexidade = p.Length > 2 ? NormalizarComplexidade(p[2]) : "media"
               };
           })
           .Where(t => !string.IsNullOrWhiteSpace(t.Titulo))
           .Take(8)
           .ToList();

    /// <summary>
    /// O frontend só sabe renderizar "baixa" | "media" | "alta"; qualquer outra
    /// coisa vinda do modelo vira "media".
    /// </summary>
    private static string NormalizarComplexidade(string valor)
    {
        var normalizado = RemoverAcentos(valor.Trim()).ToLowerInvariant();
        return normalizado switch
        {
            "baixa" or "low"  => "baixa",
            "alta"  or "high" => "alta",
            _                 => "media"
        };
    }

    // ------------------------------------------------------------
    // DETECÇÃO PAPEL + FORMATO
    // ------------------------------------------------------------
    private async Task<(string papel, string formato)> DetectarPapelEFormato(
        string ideia, string? papelUsuario, ObjetivoConfig config, CancellationToken cancellationToken)
    {
        if (!string.IsNullOrWhiteSpace(papelUsuario))
            return (papelUsuario.Trim(), config.FormatoPadrao);

        var resposta = await ChamarModelo(
            modelo: Modelos.Deteccao, temperature: 0.2,
            systemPrompt: $@"
Identifique o papel técnico ideal. Padrão: '{config.PapelPadrao}'.
NUNCA seja genérico. SEMPRE inclua stack específica.
SEMPRE responda em XML.",
            userPrompt: $@"
<deteccao>
  <papel>Papel técnico ultra-específico com stack.</papel>
  <formato>{config.FormatoPadrao}</formato>
</deteccao>
Tarefa: '{ideia}'",
            cancellationToken: cancellationToken);

        var texto   = resposta.Texto ?? "";
        var papel   = ExtrairTagXml(texto, "papel")?.Trim();
        var formato = ExtrairTagXml(texto, "formato")?.Trim();

        return (
            string.IsNullOrWhiteSpace(papel)   ? config.PapelPadrao   : papel,
            string.IsNullOrWhiteSpace(formato) ? config.FormatoPadrao : formato);
    }

    // ------------------------------------------------------------
    // HELPERS
    // ------------------------------------------------------------
    internal static string MontarIdeiaEnriquecida(
        string ideia, Dictionary<string, string>? respostas, string? executor = null)
    {
        var sb = new StringBuilder(ideia);

        if (!string.IsNullOrWhiteSpace(executor))
            sb.Append($"\n\n[EXECUTOR DO PROMPT: {executor} — otimize a estrutura, verbosidade e formato do prompt especificamente para este assistente de código.]");

        if (respostas?.Count > 0)
        {
            sb.Append("\n\n[CONTEXTO ADICIONAL DO USUÁRIO:");
            foreach (var (id, resp) in respostas)
                sb.Append($"\n- {id}: {resp}");
            sb.Append(']');
        }

        return sb.ToString();
    }

    /// <summary>Chama um único modelo, sem cadeia de fallback.</summary>
    private Task<RespostaModelo> ChamarModelo(
        string modelo, double temperature, string systemPrompt, string userPrompt,
        CancellationToken cancellationToken) =>
        ChamarComFallback(new[] { modelo }, temperature, systemPrompt, userPrompt, cancellationToken);

    /// <summary>
    /// Chama a cadeia de geração, caindo para o próximo modelo quando o anterior
    /// falha ou devolve vazio. Antes a cadeia era escolhida comparando o id do
    /// modelo com o primeiro item da lista, o que ligava o fallback por acidente
    /// a qualquer etapa que usasse o mesmo id.
    /// </summary>
    private Task<RespostaModelo> ChamarCadeiaGeracao(
        double temperature, string systemPrompt, string userPrompt,
        CancellationToken cancellationToken) =>
        ChamarComFallback(Modelos.GeracaoFallback, temperature, systemPrompt, userPrompt, cancellationToken);

    private async Task<RespostaModelo> ChamarComFallback(
        IReadOnlyList<string> modelos, double temperature, string systemPrompt, string userPrompt,
        CancellationToken cancellationToken)
    {
        string? ultimoErro = null;
        HttpStatusCode? ultimoStatus = null;

        foreach (var modelo in modelos)
        {
            cancellationToken.ThrowIfCancellationRequested();

            try
            {
                var (texto, modeloUsado) = await ChamarModeloSingle(modelo, temperature, systemPrompt, userPrompt, cancellationToken);
                if (!string.IsNullOrWhiteSpace(texto))
                    return RespostaModelo.Ok(texto, modeloUsado ?? modelo);

                ultimoErro = $"O modelo {modelo} respondeu vazio.";
                _logger.LogWarning("[Fallback] Modelo {Modelo} retornou vazio, tentando próximo...", modelo);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (OperationCanceledException)
            {
                // Estouro do timeout individual da chamada.
                ultimoErro = $"O modelo {modelo} excedeu {_options.TimeoutSeconds}s.";
                _logger.LogWarning("[Fallback] Timeout no modelo {Modelo}, tentando próximo...", modelo);
            }
            catch (HttpRequestException ex)
            {
                ultimoStatus = ex.StatusCode;
                ultimoErro = PrimeiraLinha(ex.Message);
                _logger.LogWarning(ex, "[Fallback] Modelo {Modelo} falhou ({Status}), tentando próximo...", modelo, ex.StatusCode);
            }
            catch (Exception ex)
            {
                ultimoErro = PrimeiraLinha(ex.Message);
                _logger.LogWarning(ex, "[Fallback] Modelo {Modelo} falhou, tentando próximo...", modelo);
            }
        }

        _logger.LogError("[Fallback] Todos os modelos falharam. Último erro: {Erro}", ultimoErro);
        return RespostaModelo.Falha(ultimoErro ?? "Nenhum modelo respondeu.", ultimoStatus);
    }

    private async Task<(string? texto, string? modeloUsado)> ChamarModeloSingle(
        string modelo, double temperature, string systemPrompt, string userPrompt,
        CancellationToken cancellationToken)
    {
        var payload = new
        {
            model = modelo,
            temperature,
            max_tokens = _options.MaxTokens,
            messages = new[]
            {
                new { role = "system", content = systemPrompt.Trim() },
                new { role = "user",   content = userPrompt.Trim()   }
            }
        };

        using var req = new HttpRequestMessage(HttpMethod.Post, _options.BaseUrl);
        req.Headers.Add("Authorization", $"Bearer {_options.ApiKey}");
        req.Headers.Add("HTTP-Referer", _options.Referer);
        req.Headers.Add("X-Title", _options.Title);
        req.Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");

        // Timeout individual por chamada, encadeado ao cancelamento da requisição:
        // se o cliente desiste, paramos de gastar chamadas ao OpenRouter.
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        cts.CancelAfter(TimeSpan.FromSeconds(_options.TimeoutSeconds));

        using var res = await _httpClient.SendAsync(req, cts.Token);
        res.EnsureSuccessStatusCode();

        var json = await res.Content.ReadAsStringAsync(cts.Token);
        var node = JsonNode.Parse(json);

        return (node?["choices"]?[0]?["message"]?["content"]?.ToString(), node?["model"]?.ToString());
    }

    private ObjectResult? ValidarConfiguracaoOpenRouter()
    {
        if (_options.TemApiKey)
            return null;

        return StatusCode(StatusCodes.Status503ServiceUnavailable, new
        {
            erro = OpenRouterOptions.ApiKeyMissingMessage
        });
    }

    /// <summary>
    /// Falha vinda do provedor externo. Vira 429 quando é limite de uso e 502 no
    /// resto — antes qualquer falha do OpenRouter virava um 500 genérico de
    /// "resposta vazia", escondendo a causa real (chave inválida, modelo removido,
    /// rate limit).
    /// </summary>
    private ObjectResult FalhaUpstream(string etapa, RespostaModelo resposta)
    {
        var status = resposta.StatusUpstream == HttpStatusCode.TooManyRequests
            ? StatusCodes.Status429TooManyRequests
            : StatusCodes.Status502BadGateway;

        return StatusCode(status, new
        {
            erro = $"{etapa} falhou: nenhum modelo do OpenRouter respondeu.",
            detalhes = Truncar(resposta.Erro ?? "", 300)
        });
    }

    /// <summary>
    /// Erros inesperados são registrados no log e devolvidos sem a mensagem da
    /// exceção, que pode carregar detalhes internos. O trace id permite achar a
    /// entrada correspondente no log.
    /// </summary>
    private ObjectResult ErroInterno(Exception ex, string operacao)
    {
        _logger.LogError(ex, "[{Operacao}] Erro inesperado. TraceId={TraceId}", operacao, HttpContext.TraceIdentifier);

        return StatusCode(StatusCodes.Status500InternalServerError, new
        {
            erro = "Erro interno ao processar o pedido.",
            trace_id = HttpContext.TraceIdentifier
        });
    }

    private static string ExtrairScore(string validacao)
    {
        var scoreRaw = ExtrairTagXmlRobusto(validacao, "score");
        if (string.IsNullOrWhiteSpace(scoreRaw)) return "N/A";

        var match = Regex.Match(scoreRaw, @"\d+");
        if (!match.Success) return "N/A";

        return int.TryParse(match.Value, out var valor)
            ? Math.Clamp(valor, 0, 100).ToString(CultureInfo.InvariantCulture)
            : "N/A";
    }

    private static readonly Dictionary<string, TipoObjetivo> TiposPorNome =
        new(StringComparer.OrdinalIgnoreCase)
        {
            ["imagem"]      = TipoObjetivo.Imagem,
            ["image"]       = TipoObjetivo.Imagem,
            ["video"]       = TipoObjetivo.Video,
            ["codigo"]      = TipoObjetivo.Codigo,
            ["code"]        = TipoObjetivo.Codigo,
            ["refatoracao"] = TipoObjetivo.Refatoracao,
            ["refactor"]    = TipoObjetivo.Refatoracao,
            ["copywriting"] = TipoObjetivo.Copywriting,
            ["copy"]        = TipoObjetivo.Copywriting,
            ["designui"]    = TipoObjetivo.DesignUI,
            ["design"]      = TipoObjetivo.DesignUI,
            ["ui"]          = TipoObjetivo.DesignUI,
            ["uiux"]        = TipoObjetivo.DesignUI,
            ["outro"]       = TipoObjetivo.Outro,
        };

    internal static TipoObjetivo? TentarConverterTipo(string? valor)
    {
        if (string.IsNullOrWhiteSpace(valor)) return null;

        var chave = RemoverAcentos(valor.Trim()).Replace("/", "").Replace("-", "").Replace(" ", "");
        return TiposPorNome.TryGetValue(chave, out var tipo) ? tipo : null;
    }

    private static string RemoverAcentos(string texto) =>
        new(texto.Normalize(NormalizationForm.FormD)
                 .Where(c => CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark)
                 .ToArray());

    private static string PrimeiraLinha(string texto) =>
        texto.Split('\n', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault()?.Trim() ?? texto;

    private static string Truncar(string texto, int max) =>
        texto.Length <= max ? texto : texto[..max];

    /// <summary>
    /// Extrai o conteúdo do primeiro par &lt;tag&gt;...&lt;/tag&gt;. O fechamento é
    /// procurado a partir da abertura: buscar os dois índices do início do texto
    /// permitia um intervalo invertido e um ArgumentOutOfRangeException sempre que
    /// o modelo ecoava a tag de fechamento antes da de abertura.
    /// </summary>
    internal static string? ExtrairTagXml(string texto, string tag)
    {
        var abertura = $"<{tag}>";
        var fechamento = $"</{tag}>";

        var inicio = texto.IndexOf(abertura, StringComparison.Ordinal);
        if (inicio < 0) return null;

        var conteudoInicio = inicio + abertura.Length;
        var fim = texto.IndexOf(fechamento, conteudoInicio, StringComparison.Ordinal);
        if (fim < 0) return null;

        return texto[conteudoInicio..fim].Trim();
    }

    /// <summary>
    /// Variante que casa a abertura com o ÚLTIMO fechamento, para blocos que contêm
    /// tags aninhadas de mesmo nome.
    /// </summary>
    internal static string? ExtrairTagXmlRobusto(string texto, string tag)
    {
        var abertura = $"<{tag}>";
        var fechamento = $"</{tag}>";

        var inicio = texto.IndexOf(abertura, StringComparison.Ordinal);
        if (inicio < 0) return null;

        var conteudoInicio = inicio + abertura.Length;
        var fim = texto.LastIndexOf(fechamento, StringComparison.Ordinal);
        if (fim < conteudoInicio) return null;

        return texto[conteudoInicio..fim].Trim();
    }

    /// <summary>Resultado de uma chamada ao provedor de modelos.</summary>
    private sealed record RespostaModelo(
        string? Texto, string? ModeloUsado, string? Erro, HttpStatusCode? StatusUpstream)
    {
        public bool Sucesso => !string.IsNullOrWhiteSpace(Texto);

        public static RespostaModelo Ok(string texto, string modeloUsado) =>
            new(texto, modeloUsado, null, null);

        public static RespostaModelo Falha(string erro, HttpStatusCode? status) =>
            new(null, null, erro, status);
    }
}
