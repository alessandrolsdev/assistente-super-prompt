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
    private readonly HttpClient _httpClient;
    private readonly string _openRouterApiKey;

    private const string MODELO_CLASSIFICADOR = "arcee-ai/trinity-large-preview:free";
    private const string MODELO_AMBIGUIDADE   = "arcee-ai/trinity-large-preview:free";
    private const string MODELO_TRIAGEM       = "arcee-ai/trinity-large-preview:free";
    private const string MODELO_DETECCAO      = "arcee-ai/trinity-large-preview:free";
    private const string MODELO_ANALISE       = "arcee-ai/trinity-large-preview:free";
    private const string MODELO_GERACAO       = "openrouter/free";
    private const string MODELO_VALIDACAO     = "arcee-ai/trinity-large-preview:free";
    private const string OPENROUTER_URL       = "https://openrouter.ai/api/v1/chat/completions";

    public PromptController(HttpClient httpClient, IConfiguration configuration)
    {
        _httpClient = httpClient;
        _openRouterApiKey = configuration["OpenRouterApiKey"]?.Trim()
            ?? throw new ArgumentNullException("OpenRouterApiKey não encontrada");
    }

    // ════════════════════════════════════════════════════════════
    // POST /api/prompt/gerar
    // ════════════════════════════════════════════════════════════
    [HttpPost("gerar")]
    public async Task<IActionResult> GerarPrompt([FromBody] PromptRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.IdeiaBruta))
            return BadRequest(new { erro = "ideiaBruta é obrigatório." });

        string modeloGeracaoUsado = MODELO_GERACAO;

        try
        {
            string contextoImagem = "";

            // ── ETAPA -2: CLASSIFICAÇÃO DE OBJETIVO ──────────────────────────
            var tipoFinal = await ClassificarObjetivo(request.IdeiaBruta, contextoImagem, request.TipoSugerido);
            Console.WriteLine($"[GerarPrompt] Tipo classificado: {tipoFinal}");

            var config = ObjetivoConfigs.Get(tipoFinal);

            // ── ETAPA -1: DETECÇÃO DE AMBIGUIDADE ────────────────────────────
            bool jaTemRespostas = request.RespostasClarificacao?.Count > 0;
            if (!request.ForcarSimples && !jaTemRespostas)
            {
                var perguntas = await DetectarAmbiguidade(request.IdeiaBruta, tipoFinal);
                if (perguntas.Count > 0)
                {
                    Console.WriteLine($"[GerarPrompt] {perguntas.Count} perguntas de clarificação geradas");
                    return Ok(new
                    {
                        tipo_resposta   = "clarificacao_necessaria",
                        perguntas       = perguntas,
                        tipo_confirmado = tipoFinal.ToString(),
                        pipeline = new { etapa_ambiguidade = new { modelo = MODELO_AMBIGUIDADE, resultado = "ambiguo" } }
                    });
                }
            }

            // ── Enriquece ideia ───────────────────────────────────────────────
            string ideiaEnriquecida = MontarIdeiaEnriquecida(
                request.IdeiaBruta, contextoImagem, request.RespostasClarificacao, request.ExecutorAlvo
            );

            // ── TRIAGEM (só para código/refatoração/UI/outro) ─────────────────
            bool tipoExigeTriagem = tipoFinal == TipoObjetivo.Codigo
                                 || tipoFinal == TipoObjetivo.Refatoracao
                                 || tipoFinal == TipoObjetivo.DesignUI
                                 || tipoFinal == TipoObjetivo.Outro;

            if (!request.ForcarSimples && tipoExigeTriagem)
            {
                var triagem = await TriarComplexidade(ideiaEnriquecida);
                if (triagem.isComplexo)
                {
                    Console.WriteLine($"[GerarPrompt] Triagem: complexo — {triagem.subTarefas.Count} sub-tarefas");
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

            // ── ETAPA 0: PAPEL + FORMATO ──────────────────────────────────────
            var deteccao = await DetectarPapelEFormato(ideiaEnriquecida, request.Papel, config);
            Console.WriteLine($"[GerarPrompt] Papel: {deteccao.papel[..Math.Min(80, deteccao.papel.Length)]}");

            // ── ETAPA 1: ANÁLISE ──────────────────────────────────────────────
            var analise = await AnalisarPorTipo(ideiaEnriquecida, tipoFinal, deteccao.papel, config);
            if (string.IsNullOrWhiteSpace(analise))
            {
                Console.WriteLine($"[GerarPrompt] ERRO: Etapa 1 (Análise) retornou vazio. Tipo={tipoFinal}");
                return StatusCode(500, new { erro = "Etapa 1 (Análise) falhou — resposta vazia." });
            }

            // ── ETAPA 2: GERAÇÃO ──────────────────────────────────────────────
            var (promptGerado, modeloReal) = await GerarPorTipo(
                ideiaEnriquecida, tipoFinal, analise, deteccao.papel, deteccao.formato, config
            );
            modeloGeracaoUsado = modeloReal ?? MODELO_GERACAO;

            if (string.IsNullOrWhiteSpace(promptGerado))
            {
                Console.WriteLine($"[GerarPrompt] ERRO: Etapa 2 (Geração) retornou vazio. Tipo={tipoFinal} Modelo={modeloGeracaoUsado}");
                return StatusCode(500, new { erro = "Etapa 2 (Geração) falhou — prompt vazio." });
            }
            Console.WriteLine($"[GerarPrompt] Prompt gerado ({promptGerado.Length} chars)");

            // ── ETAPA 3: VALIDAÇÃO ────────────────────────────────────────────
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
                    etapa_triagem   = new { modelo = MODELO_CLASSIFICADOR, funcao = "Classificação" },
                    etapa_0         = new { modelo = MODELO_DETECCAO,      funcao = "Detecção"      },
                    etapa_1         = new { modelo = MODELO_ANALISE,       funcao = "Análise"       },
                    etapa_2         = new { modelo = modeloGeracaoUsado,   funcao = "Geração"       },
                    etapa_3         = new { modelo = MODELO_VALIDACAO,     funcao = "Validação"     },
                    score_qualidade = score.Trim()
                }
            });
        }
        catch (HttpRequestException ex)
        {
            Console.WriteLine($"[GerarPrompt] HttpRequestException: {ex.StatusCode} — {ex.Message}");
            return StatusCode((int)(ex.StatusCode ?? System.Net.HttpStatusCode.InternalServerError),
                new { erro = "Erro OpenRouter", detalhes = ex.Message });
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[GerarPrompt] Exception: {ex.GetType().Name} — {ex.Message}");
            return StatusCode(500, new { erro = "Erro interno", detalhes = ex.Message });
        }
    }

    // ════════════════════════════════════════════════════════════
    // POST /api/prompt/regerar
    // ════════════════════════════════════════════════════════════
    [HttpPost("regerar")]
    public async Task<IActionResult> RegerarPrompt([FromBody] RegerarRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.PromptAtual))
            return BadRequest(new { erro = "promptAtual é obrigatório." });
        if (string.IsNullOrWhiteSpace(request.InstrucaoMelhora))
            return BadRequest(new { erro = "instrucaoMelhora é obrigatório." });

        var tipo   = request.TipoObjetivo ?? TipoObjetivo.Outro;
        var config = ObjetivoConfigs.Get(tipo);

        try
        {
            var instrucao = tipo switch
            {
                TipoObjetivo.Imagem or TipoObjetivo.Video =>
                    $"Melhore este prompt de {tipo.ToString().ToLower()} aplicando: {request.InstrucaoMelhora}. Mantenha estilo técnico para {config.FerramentasAlvo}.",
                TipoObjetivo.Codigo or TipoObjetivo.Refatoracao =>
                    $"Refine este prompt técnico aplicando: {request.InstrucaoMelhora}. Mantenha especificidade e critérios mensuráveis.",
                TipoObjetivo.Copywriting =>
                    $"Melhore este prompt de copywriting: {request.InstrucaoMelhora}. Mantenha foco em conversão.",
                _ => $"Aplique: {request.InstrucaoMelhora}"
            };

            var (promptMelhorado, modeloUsado) = await ChamarOpenRouterComModelo(
                modelo: MODELO_GERACAO, temperature: config.Temperature,
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
</prompt_melhorado>"
            );

            if (string.IsNullOrWhiteSpace(promptMelhorado))
                return StatusCode(500, new { erro = "Geração do prompt melhorado falhou." });

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
                    etapa_1 = new { modelo = modeloUsado ?? MODELO_GERACAO, funcao = "Geração"   },
                    etapa_2 = new { modelo = modeloUsado ?? MODELO_GERACAO, funcao = "Geração"   },
                    etapa_3 = new { modelo = MODELO_VALIDACAO,              funcao = "Validação" },
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

    // ════════════════════════════════════════════════════════════
    // CLASSIFICAÇÃO DE OBJETIVO
    // ════════════════════════════════════════════════════════════
    private async Task<TipoObjetivo> ClassificarObjetivo(
        string ideia, string contextoImagem, TipoObjetivo? tipoSugerido)
    {
        var contextoExtra = string.IsNullOrEmpty(contextoImagem)
            ? "" : $"\nContexto visual extraído da imagem: {contextoImagem}";

        var resultado = await ChamarOpenRouter(
            modelo: MODELO_CLASSIFICADOR, temperature: 0.1,
            systemPrompt: @"
Você classifica o tipo de prompt que o usuário quer criar.
Tipos: Imagem, Video, Codigo, Refatoracao, Copywriting, DesignUI, Outro
SEMPRE responda dentro das tags XML.",
            userPrompt: $@"
Classifique:
{(tipoSugerido.HasValue ? $"Usuário sugeriu: {tipoSugerido.Value}. Confirme ou corrija." : "Detecte automaticamente.")}

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

    // ════════════════════════════════════════════════════════════
    // ANÁLISE ESPECIALIZADA POR TIPO
    // ════════════════════════════════════════════════════════════
    private async Task<string?> AnalisarPorTipo(
        string ideia, TipoObjetivo tipo, string papel, ObjetivoConfig config)
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

        return await ChamarOpenRouter(
            modelo: MODELO_ANALISE, temperature: 0.3,
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
Pedido: {ideia}"
        );
    }

    // ════════════════════════════════════════════════════════════
    // GERAÇÃO ESPECIALIZADA POR TIPO
    // ════════════════════════════════════════════════════════════
    private async Task<(string? texto, string? modelo)> GerarPorTipo(
        string ideia, TipoObjetivo tipo, string analise,
        string papel, string formato, ObjetivoConfig config)
    {
        var criterios = string.Join("\n    ", config.CriteriosBase.Select((c, i) => $"{i+1}. {c}"));

        // Imagem e vídeo: texto direto, sem XML
        if (tipo is TipoObjetivo.Imagem or TipoObjetivo.Video)
        {
            return await ChamarOpenRouterComModelo(
                modelo: MODELO_GERACAO, temperature: config.Temperature,
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
</prompt_gerado>"
            );
        }

        // Outros: XML estruturado
        return await ChamarOpenRouterComModelo(
            modelo: MODELO_GERACAO, temperature: config.Temperature,
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
</prompt_otimizado>"
        );
    }

    // ════════════════════════════════════════════════════════════
    // VALIDAÇÃO ESPECIALIZADA POR TIPO
    // ════════════════════════════════════════════════════════════
    private async Task<string?> ValidarPorTipo(
        string promptGerado, TipoObjetivo tipo, ObjetivoConfig config)
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

        return await ChamarOpenRouter(
            modelo: MODELO_VALIDACAO, temperature: 0.1,
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
{promptGerado}"
        );
    }

    // ════════════════════════════════════════════════════════════
    // DETECÇÃO DE AMBIGUIDADE
    // ════════════════════════════════════════════════════════════
    private async Task<List<PerguntaClarificacao>> DetectarAmbiguidade(
        string ideiaBruta, TipoObjetivo tipo)
    {
        var exemplos = tipo switch
        {
            TipoObjetivo.Imagem => "- 'personagem' → original ou IP existente?\n- 'estilo anime' → qual subgênero?\n- 'fundo' → transparente ou cenário elaborado?",
            TipoObjetivo.Video  => "- 'animação' → 2D, 3D ou stop motion?\n- 'câmera' → movimento específico ou estática?",
            TipoObjetivo.Codigo => "- 'canva' → site Canva.com ou HTML Canvas API?\n- 'mobile' → React Native, Flutter ou nativo?\n- 'banco' → qual SGBD?",
            _ => "- Termos com múltiplos significados técnicos\n- Referências ambíguas a ferramentas"
        };

        var resultado = await ChamarOpenRouter(
            modelo: MODELO_AMBIGUIDADE, temperature: 0.2,
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

    // ════════════════════════════════════════════════════════════
    // TRIAGEM DE COMPLEXIDADE
    // ════════════════════════════════════════════════════════════
    private async Task<(bool isComplexo, string aviso, List<SubTarefaItem> subTarefas, string recomendacao)>
        TriarComplexidade(string ideia)
    {
        var resultado = await ChamarOpenRouter(
            modelo: MODELO_TRIAGEM, temperature: 0.1,
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
</triagem>"
        );

        var classificacao = ExtrairTagXml(resultado ?? "", "classificacao")?.Trim().ToLower();
        if (classificacao != "complexo") return (false, "", new List<SubTarefaItem>(), "");

        var aviso        = ExtrairTagXml(resultado ?? "", "justificativa")?.Trim() ?? "";
        var recomendacao = ExtrairTagXml(resultado ?? "", "recomendacao")?.Trim()  ?? "";
        var rawTarefas   = ExtrairTagXml(resultado ?? "", "sub_tarefas")?.Trim()   ?? "";

        var subTarefas = rawTarefas
            .Split('\n', StringSplitOptions.RemoveEmptyEntries)
            .Select(l => l.Trim().TrimStart('-','*','•',' '))
            .Where(l => !string.IsNullOrWhiteSpace(l))
            .Select(l => { var p = l.Split('|'); return new SubTarefaItem {
                Titulo = p.Length > 0 ? p[0].Trim() : l,
                Descricao = p.Length > 1 ? p[1].Trim() : "",
                Complexidade = p.Length > 2 ? p[2].Trim().ToLower() : "media"
            }; }).Take(8).ToList();

        return (true, aviso, subTarefas, recomendacao);
    }

    // ════════════════════════════════════════════════════════════
    // DETECÇÃO PAPEL + FORMATO
    // ════════════════════════════════════════════════════════════
    private async Task<(string papel, string formato)> DetectarPapelEFormato(
        string ideia, string? papelUsuario, ObjetivoConfig config)
    {
        if (!string.IsNullOrWhiteSpace(papelUsuario))
            return (papelUsuario.Trim(), config.FormatoPadrao);

        var resultado = await ChamarOpenRouter(
            modelo: MODELO_DETECCAO, temperature: 0.2,
            systemPrompt: $@"
Identifique o papel técnico ideal. Padrão: '{config.PapelPadrao}'.
NUNCA seja genérico. SEMPRE inclua stack específica.
SEMPRE responda em XML.",
            userPrompt: $@"
<deteccao>
  <papel>Papel técnico ultra-específico com stack.</papel>
  <formato>{config.FormatoPadrao}</formato>
</deteccao>
Tarefa: '{ideia}'"
        );

        var papel   = ExtrairTagXml(resultado ?? "", "papel")?.Trim()   ?? config.PapelPadrao;
        var formato = ExtrairTagXml(resultado ?? "", "formato")?.Trim() ?? config.FormatoPadrao;
        return (papel, formato);
    }

    // ════════════════════════════════════════════════════════════
    // HELPERS
    // ════════════════════════════════════════════════════════════
    private static string MontarIdeiaEnriquecida(
        string ideia, string contextoImagem, Dictionary<string, string>? respostas,
        string? executor = null)
    {
        var sb = new StringBuilder(ideia);
        if (!string.IsNullOrEmpty(contextoImagem))
            sb.Append($"\n\n[ANÁLISE VISUAL DA IMAGEM DE REFERÊNCIA:\n{contextoImagem}]");
        if (!string.IsNullOrEmpty(executor))
            sb.Append($"\n\n[EXECUTOR DO PROMPT: {executor} — otimize a estrutura, verbosidade e formato do prompt especificamente para este assistente de código.]");
        if (respostas?.Count > 0)
        {
            sb.Append("\n\n[CONTEXTO ADICIONAL DO USUÁRIO:");
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
        req.Headers.Add("Authorization", $"Bearer {_openRouterApiKey}");
        req.Headers.Add("HTTP-Referer",  "https://apiassistente.local");
        req.Headers.Add("X-Title",       "ApiAssistente - Prompt Engineer");
        req.Content = content;

        var res  = await _httpClient.SendAsync(req);
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