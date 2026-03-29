using Microsoft.AspNetCore.Mvc;
using ApiAssistente.Models;
using System.Text.Json;
using System.Text;
using System.Text.Json.Nodes;

namespace ApiAssistente.Controllers;

[ApiController]
[Route("api/[controller]")]
public class PromptController : ControllerBase
{
    private const string OpenRouterApiKeyMissingMessage =
        "OpenRouterApiKey nao configurada. Defina a chave via variavel de ambiente, dotnet user-secrets ou appsettings.Development.json local.";
    private readonly HttpClient _httpClient;
    private readonly string? _openRouterApiKey;

    private const string MODELO_CLASSIFICADOR = "arcee-ai/trinity-large-preview:free";
    private const string MODELO_AMBIGUIDADE   = "arcee-ai/trinity-large-preview:free";
    // -- MODELOS: fallback autom�tico se modelo retornar vazio -----------------
    private static readonly string[] MODELOS_GERACAO_FALLBACK = {
        "google/gemini-2.0-flash-exp:free",
        "meta-llama/llama-3.3-70b-instruct:free",
        "mistralai/mistral-small-3.1-24b-instruct:free",
        "qwen/qwen3-8b:free",
    };
    private static string MODELO_GERACAO  => MODELOS_GERACAO_FALLBACK[0];
    private const string MODELO_TRIAGEM   = "google/gemini-2.0-flash-exp:free";
    private const string MODELO_DETECCAO  = "google/gemini-2.0-flash-exp:free";
    private const string MODELO_ANALISE   = "google/gemini-2.0-flash-exp:free";
    private const string MODELO_VALIDACAO = "meta-llama/llama-3.3-70b-instruct:free";
    private const string OPENROUTER_URL   = "https://openrouter.ai/api/v1/chat/completions";

    public PromptController(HttpClient httpClient, IConfiguration configuration)
    {
        _httpClient = httpClient;
        _openRouterApiKey = configuration["OpenRouterApiKey"]?.Trim();
    }

    // ------------------------------------------------------------
    // POST /api/prompt/gerar
    // ------------------------------------------------------------
    [HttpPost("gerar")]
    public async Task<IActionResult> GerarPrompt([FromBody] PromptRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.IdeiaBruta))
            return BadRequest(new { erro = "ideiaBruta � obrigat�rio." });

        var configError = ValidarConfiguracaoOpenRouter();
        if (configError is not null)
            return configError;

        string modeloGeracaoUsado = MODELO_GERACAO;

        try
        {
            string contextoImagem = "";

            // -- ETAPA -2: CLASSIFICA��O DE OBJETIVO --------------------------
            var tipoFinal = await ClassificarObjetivo(request.IdeiaBruta, contextoImagem, request.TipoSugerido);
            Console.WriteLine($"[GerarPrompt] Tipo classificado: {tipoFinal}");

            var config = ObjetivoConfigs.Get(tipoFinal);

            // -- ETAPA -1: DETEC��O DE AMBIGUIDADE ----------------------------
            bool jaTemRespostas = request.RespostasClarificacao?.Count > 0;
            if (!request.ForcarSimples && !jaTemRespostas)
            {
                var perguntas = await DetectarAmbiguidade(request.IdeiaBruta, tipoFinal);
                if (perguntas.Count > 0)
                {
                    Console.WriteLine($"[GerarPrompt] {perguntas.Count} perguntas de clarifica��o geradas");
                    return Ok(new
                    {
                        tipo_resposta   = "clarificacao_necessaria",
                        perguntas       = perguntas,
                        tipo_confirmado = tipoFinal.ToString(),
                        pipeline = new { etapa_ambiguidade = new { modelo = MODELO_AMBIGUIDADE, resultado = "ambiguo" } }
                    });
                }
            }

            // -- Enriquece ideia -----------------------------------------------
            string ideiaEnriquecida = MontarIdeiaEnriquecida(
                request.IdeiaBruta, contextoImagem, request.RespostasClarificacao, request.ExecutorAlvo
            );

            // -- TRIAGEM (s� para c�digo/refatora��o/UI/outro) -----------------
            bool tipoExigeTriagem = tipoFinal == TipoObjetivo.Codigo
                                 || tipoFinal == TipoObjetivo.Refatoracao
                                 || tipoFinal == TipoObjetivo.DesignUI
                                 || tipoFinal == TipoObjetivo.Outro;

            if (!request.ForcarSimples && tipoExigeTriagem)
            {
                var triagem = await TriarComplexidade(ideiaEnriquecida);
                if (triagem.isComplexo)
                {
                    Console.WriteLine($"[GerarPrompt] Triagem: complexo � {triagem.subTarefas.Count} sub-tarefas");
                    return Ok(new
                    {
                        tipo_resposta   = "plano_de_divisao",
                        aviso           = triagem.aviso,
                        sub_tarefas     = triagem.subTarefas,
                        recomendacao    = triagem.recomendacao,
                        tipo_confirmado = tipoFinal.ToString(),
                        pipeline = new { etapa_triagem = new { modelo = MODELO_TRIAGEM, resultado = "complexo" } }
                    });
                }
            }

            // -- ETAPA 0: PAPEL + FORMATO --------------------------------------
            var deteccao = await DetectarPapelEFormato(ideiaEnriquecida, request.Papel, config);
            Console.WriteLine($"[GerarPrompt] Papel: {deteccao.papel[..Math.Min(80, deteccao.papel.Length)]}");

            // -- ETAPA 1: AN�LISE ----------------------------------------------
            var analise = await AnalisarPorTipo(ideiaEnriquecida, tipoFinal, deteccao.papel, config);
            if (string.IsNullOrWhiteSpace(analise))
            {
                Console.WriteLine($"[GerarPrompt] ERRO: Etapa 1 (An�lise) retornou vazio. Tipo={tipoFinal}");
                return StatusCode(500, new { erro = "Etapa 1 (An�lise) falhou � resposta vazia." });
            }

            // -- ETAPA 2: GERA��O ----------------------------------------------
            var (promptGerado, modeloReal) = await GerarPorTipo(
                ideiaEnriquecida, tipoFinal, analise, deteccao.papel, deteccao.formato, config
            );
            modeloGeracaoUsado = modeloReal ?? MODELO_GERACAO;

            if (string.IsNullOrWhiteSpace(promptGerado))
            {
                Console.WriteLine($"[GerarPrompt] ERRO: Etapa 2 (Gera��o) retornou vazio. Tipo={tipoFinal} Modelo={modeloGeracaoUsado}");
                return StatusCode(500, new { erro = "Etapa 2 (Gera��o) falhou � prompt vazio." });
            }
            Console.WriteLine($"[GerarPrompt] Prompt gerado ({promptGerado.Length} chars)");

            // -- ETAPA 3: VALIDA��O --------------------------------------------
            var validacao = await ValidarPorTipo(promptGerado, tipoFinal, config);

            string? promptFinal = ExtrairTagXmlRobusto(validacao ?? "", "prompt_final");
            bool promptFinalValido = promptFinal != null && promptFinal.Length > 80
                && !promptFinal.StartsWith("Nenhum") && !promptFinal.StartsWith("Corrija");

            if (!promptFinalValido && tipoFinal is TipoObjetivo.Imagem or TipoObjetivo.Video)
                promptFinalValido = promptFinal != null && promptFinal.Length > 50;

            string resultadoFinal = promptFinalValido
                ? promptFinal!
                : (tipoFinal is TipoObjetivo.Imagem or TipoObjetivo.Video
                    ? ExtrairTagXmlRobusto(promptGerado, "prompt_gerado") ?? promptGerado
                    : ExtrairTagXmlRobusto(promptGerado, "prompt_otimizado") ?? promptGerado);

            if (string.IsNullOrWhiteSpace(resultadoFinal))
            {
                Console.WriteLine($"[GerarPrompt] ERRO: resultadoFinal vazio. promptGerado={promptGerado.Length}c validacao={validacao?.Length ?? 0}c");
                return StatusCode(500, new { erro = "Resultado final vazio.", detalhes = new { promptGeradoLen = promptGerado.Length, validacaoLen = validacao?.Length } });
            }

            string scoreRaw  = ExtrairTagXmlRobusto(validacao ?? "", "score") ?? "N/A";
            var    scoreMatch = System.Text.RegularExpressions.Regex.Match(scoreRaw, @"\d+");
            string score      = scoreMatch.Success ? scoreMatch.Value : "N/A";
            Console.WriteLine($"[GerarPrompt] Score: {score} | Resultado: {resultadoFinal.Length} chars");

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
                    etapa_triagem   = new { modelo = MODELO_CLASSIFICADOR, funcao = "Classifica��o" },
                    etapa_0         = new { modelo = MODELO_DETECCAO,      funcao = "Detec��o"      },
                    etapa_1         = new { modelo = MODELO_ANALISE,       funcao = "An�lise"       },
                    etapa_2         = new { modelo = modeloGeracaoUsado,   funcao = "Gera��o"       },
                    etapa_3         = new { modelo = MODELO_VALIDACAO,     funcao = "Valida��o"     },
                    score_qualidade = score.Trim()
                }
            });
        }
        catch (HttpRequestException ex)
        {
            Console.WriteLine($"[GerarPrompt] HttpRequestException: {ex.StatusCode} � {ex.Message}");
            return StatusCode((int)(ex.StatusCode ?? System.Net.HttpStatusCode.InternalServerError),
                new { erro = "Erro OpenRouter", detalhes = ex.Message });
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[GerarPrompt] Exception: {ex.GetType().Name} � {ex.Message}");
            return StatusCode(500, new { erro = "Erro interno", detalhes = ex.Message });
        }
    }

    // ------------------------------------------------------------
    // POST /api/prompt/regerar
    // ------------------------------------------------------------
    [HttpPost("regerar")]
    public async Task<IActionResult> RegerarPrompt([FromBody] RegerarRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.PromptAtual))
            return BadRequest(new { erro = "promptAtual � obrigat�rio." });
        if (string.IsNullOrWhiteSpace(request.InstrucaoMelhora))
            return BadRequest(new { erro = "instrucaoMelhora � obrigat�rio." });

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
                    $"Melhore este prompt de {tipo.ToString().ToLower()} aplicando: {request.InstrucaoMelhora}. Mantenha estilo t�cnico para {config.FerramentasAlvo}.",
                TipoObjetivo.Codigo or TipoObjetivo.Refatoracao =>
                    $"Refine este prompt t�cnico aplicando: {request.InstrucaoMelhora}. Mantenha especificidade e crit�rios mensur�veis.",
                TipoObjetivo.Copywriting =>
                    $"Melhore este prompt de copywriting: {request.InstrucaoMelhora}. Mantenha foco em convers�o.",
                _ => $"Aplique: {request.InstrucaoMelhora}"
            };

            var (promptMelhorado, modeloUsado) = await ChamarOpenRouterComModelo(
                modelo: MODELO_GERACAO, temperature: config.Temperature,
                systemPrompt: $@"
Voc� � um Arquiteto de Prompts especializado em {tipo}.
NUNCA descarte a estrutura existente.
SEMPRE aplique a instru��o de melhora cirurgicamente.
SEMPRE mantenha 95%+ de for�a para: {config.FerramentasAlvo}.",
                userPrompt: $@"
Prompt atual:
{request.PromptAtual}

Instru��o: {instrucao}
Papel: {request.Papel ?? config.PapelPadrao}

Retorne SOMENTE dentro das tags:
<prompt_melhorado>
[prompt completo melhorado]
</prompt_melhorado>"
            );

            if (string.IsNullOrWhiteSpace(promptMelhorado))
                return StatusCode(500, new { erro = "Gera��o do prompt melhorado falhou." });

            var validacao = await ValidarPorTipo(promptMelhorado, tipo, config);
            string? final = ExtrairTagXmlRobusto(validacao ?? "", "prompt_final");
            bool finalValido = final != null && final.Length > 80
                && !final.StartsWith("Nenhum") && !final.StartsWith("Corrija");
            if (!finalValido)
                final = ExtrairTagXmlRobusto(promptMelhorado, "prompt_melhorado") ?? promptMelhorado;

            string scoreRaw = ExtrairTagXmlRobusto(validacao ?? "", "score") ?? "N/A";
            var    sm       = System.Text.RegularExpressions.Regex.Match(scoreRaw, @"\d+");

            return Ok(new
            {
                tipo_resposta    = "prompt_melhorado",
                tipo_objetivo    = tipo.ToString(),
                prompt_otimizado = final!.Trim(),
                pipeline = new
                {
                    etapa_1 = new { modelo = modeloUsado ?? MODELO_GERACAO, funcao = "Gera��o"   },
                    etapa_2 = new { modelo = modeloUsado ?? MODELO_GERACAO, funcao = "Gera��o"   },
                    etapa_3 = new { modelo = MODELO_VALIDACAO,              funcao = "Valida��o" },
                    score_qualidade = sm.Success ? sm.Value : "N/A"
                }
            });
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[RegerarPrompt] Exception: {ex.Message}");
            return StatusCode(500, new { erro = "Erro ao regerar", detalhes = ex.Message });
        }
    }

    // ------------------------------------------------------------
    // CLASSIFICA��O DE OBJETIVO
    // ------------------------------------------------------------
    private async Task<TipoObjetivo> ClassificarObjetivo(
        string ideia, string contextoImagem, TipoObjetivo? tipoSugerido)
    {
        var contextoExtra = string.IsNullOrEmpty(contextoImagem)
            ? "" : $"\nContexto visual extra�do da imagem: {contextoImagem}";

        var resultado = await ChamarOpenRouter(
            modelo: MODELO_CLASSIFICADOR, temperature: 0.1,
            systemPrompt: @"
Voc� classifica o tipo de prompt que o usu�rio quer criar.
Tipos: Imagem, Video, Codigo, Refatoracao, Copywriting, DesignUI, Outro
SEMPRE responda dentro das tags XML.",
            userPrompt: $@"
Classifique:
{(tipoSugerido.HasValue ? $"Usu�rio sugeriu: {tipoSugerido.Value}. Confirme ou corrija." : "Detecte automaticamente.")}

Pedido: '{ideia}'{contextoExtra}

<classificacao>
  <tipo>Imagem/Video/Codigo/Refatoracao/Copywriting/DesignUI/Outro</tipo>
  <confianca>alta/media/baixa</confianca>
</classificacao>"
        );

        var tipoStr = ExtrairTagXml(resultado ?? "", "tipo")?.Trim() ?? "";
        if (string.IsNullOrEmpty(tipoStr) && tipoSugerido.HasValue)
            return tipoSugerido.Value;

        return tipoStr switch
        {
            "Imagem"      => TipoObjetivo.Imagem,
            "Video"       => TipoObjetivo.Video,
            "Codigo"      => TipoObjetivo.Codigo,
            "Refatoracao" => TipoObjetivo.Refatoracao,
            "Copywriting" => TipoObjetivo.Copywriting,
            "DesignUI"    => TipoObjetivo.DesignUI,
            _             => tipoSugerido ?? TipoObjetivo.Outro
        };
    }

    // ------------------------------------------------------------
    // AN�LISE ESPECIALIZADA POR TIPO
    // ------------------------------------------------------------
    private async Task<string?> AnalisarPorTipo(
        string ideia, TipoObjetivo tipo, string papel, ObjetivoConfig config)
    {
        var campos = tipo switch
        {
            TipoObjetivo.Imagem => @"
  <elementos_visuais>Sujeito, materiais, texturas, cores, ilumina��o, composi��o.</elementos_visuais>
  <estilo_artistico>Refer�ncias visuais, movimento art�stico, artistas de refer�ncia.</estilo_artistico>
  <parametros_tecnicos>Ferramenta alvo, resolu��o, aspect ratio, par�metros especiais.</parametros_tecnicos>
  <o_que_evitar>Elementos que degradam ou conflitam com o objetivo.</o_que_evitar>",

            TipoObjetivo.Video => @"
  <cena_principal>Ambiente, sujeitos, a��o central.</cena_principal>
  <movimento_camera>Tipo de movimento, velocidade, transi��es.</movimento_camera>
  <estilo_visual>Paleta, ilumina��o, atmosfera, refer�ncias.</estilo_visual>",

            TipoObjetivo.Copywriting => @"
  <persona_alvo>Quem � o leitor, suas dores e desejos.</persona_alvo>
  <proposta_valor>O que diferencia este produto/servi�o.</proposta_valor>
  <gatilhos>Quais gatilhos usar (urg�ncia, prova social, autoridade).</gatilhos>
  <tom_voz>Tom, linguagem, n�vel de formalidade.</tom_voz>",

            TipoObjetivo.DesignUI => @"
  <componentes>Quais elementos de UI s�o necess�rios.</componentes>
  <fluxo>Jornada e intera��es do usu�rio.</fluxo>
  <tokens>Cores, tipografia, espa�amento necess�rios.</tokens>",

            _ => @"
  <objetivo_real>O que precisa ser implementado.</objetivo_real>
  <armadilhas>3 erros que uma implementa��o ruim cometeria.</armadilhas>
  <contexto_minimo>Stack, padr�es e requisitos m�nimos.</contexto_minimo>
  <restricoes>5 restri��es NUNCA/SEMPRE espec�ficas.</restricoes>"
        };

        return await ChamarOpenRouter(
            modelo: MODELO_ANALISE, temperature: 0.3,
            systemPrompt: $@"
Voc� � um analista de engenharia de prompts para {tipo}.
Papel: {papel} | Ferramentas: {config.FerramentasAlvo}
NUNCA gere o prompt final. Apenas analise.
SEMPRE responda dentro das tags XML.",
            userPrompt: $@"
Analise para {tipo} e responda SOMENTE neste XML:
<analise>
  {campos}
</analise>

Papel: {papel}
Pedido: {ideia}"
        );
    }

    // ------------------------------------------------------------
    // GERA��O ESPECIALIZADA POR TIPO
    // ------------------------------------------------------------
    private async Task<(string? texto, string? modelo)> GerarPorTipo(
        string ideia, TipoObjetivo tipo, string analise,
        string papel, string formato, ObjetivoConfig config)
    {
        var criterios = string.Join("\n    ", config.CriteriosBase.Select((c, i) => $"{i+1}. {c}"));

        // Imagem e v�deo: texto direto, sem XML
        if (tipo is TipoObjetivo.Imagem or TipoObjetivo.Video)
        {
            return await ChamarOpenRouterComModelo(
                modelo: MODELO_GERACAO, temperature: config.Temperature,
                systemPrompt: $@"
Voc� � especialista em prompt engineering para {tipo} ({config.FerramentasAlvo}).
NUNCA use XML no prompt gerado.
NUNCA adicione explica��es � apenas o prompt.
SEMPRE inclua par�metros t�cnicos da ferramenta no final.
SEMPRE extraia 95%+ do potencial da IA geradora.",
                userPrompt: $@"
Com base na an�lise:
{analise}

Crie o prompt para:
- Objetivo: {ideia}
- Ferramenta: {config.FerramentasAlvo}
- Papel: {papel}

Crit�rios obrigat�rios:
{criterios}

Retorne SOMENTE dentro das tags:
<prompt_gerado>
[prompt completo � para Midjourney inclua --ar, --v, --style no final]
</prompt_gerado>"
            );
        }

        // Outros: XML estruturado
        return await ChamarOpenRouterComModelo(
            modelo: MODELO_GERACAO, temperature: config.Temperature,
            systemPrompt: $@"
Voc� � um Arquiteto de Prompts S�nior para {tipo}.
NUNCA adicione texto fora das tags XML.
NUNCA seja gen�rico.
SEMPRE inclua crit�rios mensur�veis.",
            userPrompt: $@"
Com base na an�lise:
{analise}

Gere o prompt para:
- Papel: {papel}
- Objetivo: {ideia}
- Ferramenta: {config.FerramentasAlvo}
- Formato: {formato}

Crit�rios obrigat�rios:
{criterios}

Retorne SOMENTE neste XML:
<prompt_otimizado>
  <system_instruction>{papel}. Ferramenta: {config.FerramentasAlvo}.</system_instruction>
  <restricoes_constitucionais>6 restri��es NUNCA/SEMPRE espec�ficas para {tipo}.</restricoes_constitucionais>
  <instrucao_principal>Tarefa �nica com crit�rio de sucesso mensur�vel.</instrucao_principal>
  <criterios_de_aceitacao>{criterios}</criterios_de_aceitacao>
  <few_shot_exemplo>INPUT: exemplo realista | REASONING: racioc�nio | OUTPUT: resultado correto</few_shot_exemplo>
  <formato_resposta>{formato}</formato_resposta>
  <loop_validacao>Verifique os {config.CriteriosBase.Length} crit�rios antes de entregar.</loop_validacao>
</prompt_otimizado>"
        );
    }

    // ------------------------------------------------------------
    // VALIDA��O ESPECIALIZADA POR TIPO
    // ------------------------------------------------------------
    private async Task<string?> ValidarPorTipo(
        string promptGerado, TipoObjetivo tipo, ObjetivoConfig config)
    {
        var checklist = tipo switch
        {
            TipoObjetivo.Imagem => @"
    Sujeito principal descrito com precis�o visual: sim/n�o
    Estilo art�stico e refer�ncias especificados: sim/n�o
    Ilumina��o e composi��o inclu�dos: sim/n�o
    Par�metros t�cnicos da ferramenta presentes: sim/n�o
    Tom e atmosfera claros: sim/n�o",

            TipoObjetivo.Video => @"
    Sujeito e a��o principal claros: sim/n�o
    Movimento de c�mera especificado: sim/n�o
    Atmosfera e ilumina��o descritos: sim/n�o
    Estilo visual de refer�ncia presente: sim/n�o",

            TipoObjetivo.Copywriting => @"
    Persona-alvo claramente definida: sim/n�o
    Proposta de valor �nica presente: sim/n�o
    Gatilhos psicol�gicos espec�ficos: sim/n�o
    CTA claro e orientado � a��o: sim/n�o",

            _ => @"
    Papel t�cnico ultra-espec�fico com stack: sim/n�o
    Crit�rios de aceita��o test�veis: sim/n�o
    Exemplo few-shot t�cnico e realista: sim/n�o
    Aus�ncia de linguagem vaga: sim/n�o"
        };

        return await ChamarOpenRouter(
            modelo: MODELO_VALIDACAO, temperature: 0.1,
            systemPrompt: $@"
Voc� valida prompts para {tipo} ({config.FerramentasAlvo}).
Prompts ricos e detalhados s�o CORRETOS � n�o penalize detalhamento.
Penalize apenas genericidade e falta de especificidade.
SEMPRE responda dentro das tags XML.",
            userPrompt: $@"
Valide este prompt para {tipo}:

<validacao>
  <checklist>{checklist}</checklist>
  <problemas_encontrados>Problemas reais. Se nenhum: Nenhum problema cr�tico encontrado.</problemas_encontrados>
  <prompt_final>Corrija problemas reais. Se tudo ok: copie sem altera��es.</prompt_final>
  <score>0-100. Prompts ricos e espec�ficos devem pontuar 85+.</score>
</validacao>

Prompt:
{promptGerado}"
        );
    }

    // ------------------------------------------------------------
    // DETEC��O DE AMBIGUIDADE
    // ------------------------------------------------------------
    private async Task<List<PerguntaClarificacao>> DetectarAmbiguidade(
        string ideiaBruta, TipoObjetivo tipo)
    {
        var exemplos = tipo switch
        {
            TipoObjetivo.Imagem => "- 'personagem' ? original ou IP existente?\n- 'estilo anime' ? qual subg�nero?\n- 'fundo' ? transparente ou cen�rio elaborado?",
            TipoObjetivo.Video  => "- 'anima��o' ? 2D, 3D ou stop motion?\n- 'c�mera' ? movimento espec�fico ou est�tica?",
            TipoObjetivo.Codigo => "- 'canva' ? site Canva.com ou HTML Canvas API?\n- 'mobile' ? React Native, Flutter ou nativo?\n- 'banco' ? qual SGBD?",
            _ => "- Termos com m�ltiplos significados t�cnicos\n- Refer�ncias amb�guas a ferramentas"
        };

        var resultado = await ChamarOpenRouter(
            modelo: MODELO_AMBIGUIDADE, temperature: 0.2,
            systemPrompt: $@"
Voc� detecta ambiguidades cr�ticas em pedidos para {tipo}.
Exemplos relevantes: {exemplos}
NUNCA gere mais de 2 perguntas.
SEMPRE gere op��es clic�veis.
SEMPRE responda em XML.",
            userPrompt: $@"
Detecte ambiguidades em: '{ideiaBruta}'

<resultado>
  <tem_ambiguidade>sim/n�o</tem_ambiguidade>
  <perguntas>
    <pergunta><id>id_unico</id><texto>Pergunta direta</texto><opcoes>A | B | C</opcoes><livre>sim/n�o</livre></pergunta>
  </perguntas>
</resultado>"
        );

        var temAmbiguidade = ExtrairTagXml(resultado ?? "", "tem_ambiguidade")?.Trim().ToLower();
        if (temAmbiguidade != "sim") return new List<PerguntaClarificacao>();

        var perguntas = new List<PerguntaClarificacao>();
        var texto = resultado ?? "";
        int pos = 0;

        while (perguntas.Count < 2)
        {
            int inicio = texto.IndexOf("<pergunta>", pos);
            int fim    = texto.IndexOf("</pergunta>", pos);
            if (inicio < 0 || fim < 0) break;

            var bloco = texto[(inicio + "<pergunta>".Length)..fim];
            var id    = ExtrairTagXml(bloco, "id")?.Trim()     ?? $"q{perguntas.Count}";
            var txt   = ExtrairTagXml(bloco, "texto")?.Trim()  ?? "";
            var opts  = ExtrairTagXml(bloco, "opcoes")?.Trim() ?? "";
            var livre = ExtrairTagXml(bloco, "livre")?.Trim().ToLower() == "sim";

            if (!string.IsNullOrWhiteSpace(txt))
                perguntas.Add(new PerguntaClarificacao {
                    Id     = id,
                    Texto  = txt,
                    Opcoes = opts.Split('|', StringSplitOptions.RemoveEmptyEntries)
                                 .Select(o => o.Trim()).Where(o => !string.IsNullOrEmpty(o)).ToList(),
                    Livre  = livre
                });

            pos = fim + "</pergunta>".Length;
        }

        return perguntas;
    }

    // ------------------------------------------------------------
    // TRIAGEM DE COMPLEXIDADE
    // ------------------------------------------------------------
    private async Task<(bool isComplexo, string aviso, List<SubTarefaItem> subTarefas, string recomendacao)>
        TriarComplexidade(string ideia)
    {
        var resultado = await ChamarOpenRouter(
            modelo: MODELO_TRIAGEM, temperature: 0.1,
            systemPrompt: @"
Voc� decide se um pedido de software REALMENTE precisa ser dividido em m�ltiplas tarefas independentes.

REGRAS RIGOROSAS:
- Classifique como SIMPLES se: � uma �nica funcionalidade, refatora��o de c�digo existente, aplicar um padr�o/estilo, adicionar uma feature, corrigir bugs, criar um componente.
- Classifique como COMPLEXO APENAS se: s�o claramente sistemas separados (ex: backend + frontend + banco + deploy), ou o usu�rio explicitamente pediu uma lista de tarefas.
- NUNCA divida por se��es de uma mesma p�gina � isso � simples.
- NUNCA divida refatora��es � aplicar um padr�o a c�digo existente � SEMPRE simples.
- NUNCA divida por componentes de UI � criar v�rios componentes � uma tarefa �nica.
- Em caso de d�vida: classifique como SIMPLES.
- M�ximo 4 sub-tarefas se realmente complexo.",
            userPrompt: $@"
Pedido: '{ideia}'

<triagem>
  <classificacao>simples/complexo</classificacao>
  <justificativa>Uma frase explicando POR QUE � complexo (ou deixe vazio se simples).</justificativa>
  <sub_tarefas>TITULO | DESCRICAO | COMPLEXIDADE � uma por linha. Deixe VAZIO se simples.</sub_tarefas>
  <recomendacao>Qual implementar primeiro. Vazio se simples.</recomendacao>
</triagem>"
        );

        var classificacao = ExtrairTagXml(resultado ?? "", "classificacao")?.Trim().ToLower();
        if (classificacao != "complexo") return (false, "", new List<SubTarefaItem>(), "");

        var aviso        = ExtrairTagXml(resultado ?? "", "justificativa")?.Trim() ?? "";
        var recomendacao = ExtrairTagXml(resultado ?? "", "recomendacao")?.Trim()  ?? "";
        var rawTarefas   = ExtrairTagXml(resultado ?? "", "sub_tarefas")?.Trim()   ?? "";

        var subTarefas = rawTarefas
            .Split('\n', StringSplitOptions.RemoveEmptyEntries)
            .Select(l => l.Trim().TrimStart('-', '*', ' '))
            .Where(l => !string.IsNullOrWhiteSpace(l))
            .Select(l => { var p = l.Split('|'); return new SubTarefaItem {
                Titulo = p.Length > 0 ? p[0].Trim() : l,
                Descricao = p.Length > 1 ? p[1].Trim() : "",
                Complexidade = p.Length > 2 ? p[2].Trim().ToLower() : "media"
            }; }).Take(8).ToList();

        return (true, aviso, subTarefas, recomendacao);
    }

    // ------------------------------------------------------------
    // DETEC��O PAPEL + FORMATO
    // ------------------------------------------------------------
    private async Task<(string papel, string formato)> DetectarPapelEFormato(
        string ideia, string? papelUsuario, ObjetivoConfig config)
    {
        if (!string.IsNullOrWhiteSpace(papelUsuario))
            return (papelUsuario.Trim(), config.FormatoPadrao);

        var resultado = await ChamarOpenRouter(
            modelo: MODELO_DETECCAO, temperature: 0.2,
            systemPrompt: $@"
Identifique o papel t�cnico ideal. Padr�o: '{config.PapelPadrao}'.
NUNCA seja gen�rico. SEMPRE inclua stack espec�fica.
SEMPRE responda em XML.",
            userPrompt: $@"
<deteccao>
  <papel>Papel t�cnico ultra-espec�fico com stack.</papel>
  <formato>{config.FormatoPadrao}</formato>
</deteccao>
Tarefa: '{ideia}'"
        );

        var papel   = ExtrairTagXml(resultado ?? "", "papel")?.Trim()   ?? config.PapelPadrao;
        var formato = ExtrairTagXml(resultado ?? "", "formato")?.Trim() ?? config.FormatoPadrao;
        return (papel, formato);
    }

    // ------------------------------------------------------------
    // HELPERS
    // ------------------------------------------------------------
    private static string MontarIdeiaEnriquecida(
        string ideia, string contextoImagem, Dictionary<string, string>? respostas,
        string? executor = null)
    {
        var sb = new StringBuilder(ideia);
        if (!string.IsNullOrEmpty(contextoImagem))
            sb.Append($"\n\n[AN�LISE VISUAL DA IMAGEM DE REFER�NCIA:\n{contextoImagem}]");
        if (!string.IsNullOrEmpty(executor))
            sb.Append($"\n\n[EXECUTOR DO PROMPT: {executor} � otimize a estrutura, verbosidade e formato do prompt especificamente para este assistente de c�digo.]");
        if (respostas?.Count > 0)
        {
            sb.Append("\n\n[CONTEXTO ADICIONAL DO USU�RIO:");
            foreach (var (id, resp) in respostas)
                sb.Append($"\n- {id}: {resp}");
            sb.Append("]");
        }
        return sb.ToString();
    }

    private async Task<string?> ChamarOpenRouter(
        string modelo, double temperature, string systemPrompt, string userPrompt)
    {
        var (texto, _) = await ChamarOpenRouterComModelo(modelo, temperature, systemPrompt, userPrompt);
        return texto;
    }

    private async Task<(string? texto, string? modeloUsado)> ChamarOpenRouterComModelo(
        string modelo, double temperature, string systemPrompt, string userPrompt)
    {
        // Se modelo � o principal de gera��o, usa fallback autom�tico
        var modelos = modelo == MODELOS_GERACAO_FALLBACK[0]
            ? MODELOS_GERACAO_FALLBACK
            : new[] { modelo };

        foreach (var m in modelos)
        {
            try
            {
                var (texto, modeloUsado) = await ChamarModeloSingle(m, temperature, systemPrompt, userPrompt);
                if (!string.IsNullOrWhiteSpace(texto))
                    return (texto, modeloUsado);
                Console.WriteLine($"[Fallback] Modelo {m} retornou vazio, tentando pr�ximo...");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[Fallback] Modelo {m} falhou: {ex.GetType().Name} � {ex.Message.Split('\n')[0]}. Tentando pr�ximo...");
            }
        }
        Console.WriteLine("[Fallback] Todos os modelos falharam.");
        return (null, null);
    }

    private ObjectResult? ValidarConfiguracaoOpenRouter()
    {
        if (!string.IsNullOrWhiteSpace(_openRouterApiKey))
            return null;

        return StatusCode(StatusCodes.Status503ServiceUnavailable, new
        {
            erro = OpenRouterApiKeyMissingMessage
        });
    }

    private async Task<(string? texto, string? modeloUsado)> ChamarModeloSingle(
        string modelo, double temperature, string systemPrompt, string userPrompt)
    {
        var payload = new
        {
            model = modelo, temperature, max_tokens = 2048,
            messages = new[]
            {
                new { role = "system", content = systemPrompt.Trim() },
                new { role = "user",   content = userPrompt.Trim()   }
            }
        };

        var content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
        using var req = new HttpRequestMessage(HttpMethod.Post, OPENROUTER_URL);
        req.Headers.Add("Authorization", $"Bearer {_openRouterApiKey!}");
        req.Headers.Add("HTTP-Referer",  "https://apiassistente.local");
        req.Headers.Add("X-Title",       "ApiAssistente - Prompt Engineer");
        req.Content = content;

        // Timeout individual por chamada � evita o TaskCanceledException do cliente global
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(90));
        var res  = await _httpClient.SendAsync(req, cts.Token);
        res.EnsureSuccessStatusCode();
        var json = await res.Content.ReadAsStringAsync();
        var node = JsonNode.Parse(json);
        return (node?["choices"]?[0]?["message"]?["content"]?.ToString(), node?["model"]?.ToString());
    }

    private static string? ExtrairTagXml(string texto, string tag)
    {
        var a = $"<{tag}>"; var f = $"</{tag}>";
        int i = texto.IndexOf(a), j = texto.IndexOf(f);
        if (i < 0 || j < 0) return null;
        return texto[(i + a.Length)..j].Trim();
    }

    private static string? ExtrairTagXmlRobusto(string texto, string tag)
    {
        var abertura = $"<{tag}>"; var fechamento = $"</{tag}>";
        int inicio = texto.IndexOf(abertura), fim = texto.LastIndexOf(fechamento);
        if (inicio < 0 || fim < 0 || fim <= inicio) return null;
        return texto[(inicio + abertura.Length)..fim].Trim();
    }
}
