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

    private const string MODELO_AMBIGUIDADE = "arcee-ai/trinity-large-preview:free"; // Etapa -2
    private const string MODELO_TRIAGEM     = "arcee-ai/trinity-large-preview:free"; // Etapa -1
    private const string MODELO_DETECCAO    = "arcee-ai/trinity-large-preview:free"; // Etapa  0
    private const string MODELO_ANALISE     = "arcee-ai/trinity-large-preview:free"; // Etapa  1
    private const string MODELO_GERACAO     = "openrouter/free";                     // Etapa  2
    private const string MODELO_VALIDACAO   = "arcee-ai/trinity-large-preview:free"; // Etapa  3

    private const string OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

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
            // ── ETAPA -2: DETECÇÃO DE AMBIGUIDADE ────────────────────────────
            // Pulada se: forcarSimples=true OU se já há respostas de clarificação
            bool jaTemRespostas = request.RespostasClarificacao?.Count > 0;
            if (!request.ForcarSimples && !jaTemRespostas)
            {
                var perguntas = await DetectarAmbiguidade(request.IdeiaBruta);
                if (perguntas.Count > 0)
                {
                    return Ok(new
                    {
                        tipo_resposta = "clarificacao_necessaria",
                        perguntas     = perguntas,
                        pipeline = new { etapa_ambiguidade = new { modelo = MODELO_AMBIGUIDADE, resultado = "ambiguo" } }
                    });
                }
            }

            // ── Enriquece a ideia com as respostas de clarificação ────────────
            string ideiaEnriquecida = request.IdeiaBruta;
            if (jaTemRespostas)
            {
                var sb = new StringBuilder(request.IdeiaBruta);
                sb.Append("\n\n[CONTEXTO ADICIONAL FORNECIDO PELO USUÁRIO:");
                foreach (var (id, resp) in request.RespostasClarificacao!)
                    sb.Append($"\n- {id}: {resp}");
                sb.Append("]");
                ideiaEnriquecida = sb.ToString();
            }

            // ── ETAPA -1: TRIAGEM DE COMPLEXIDADE ────────────────────────────
            if (!request.ForcarSimples)
            {
                var triagem = await TriarComplexidade(ideiaEnriquecida);
                if (triagem.isComplexo)
                {
                    return Ok(new
                    {
                        tipo_resposta = "plano_de_divisao",
                        aviso         = triagem.aviso,
                        sub_tarefas   = triagem.subTarefas,
                        recomendacao  = triagem.recomendacao,
                        pipeline = new { etapa_triagem = new { modelo = MODELO_TRIAGEM, resultado = "complexo" } }
                    });
                }
            }

            // ── ETAPA 0: DETECÇÃO PAPEL + FORMATO ────────────────────────────
            var deteccao = await DetectarPapelEFormato(ideiaEnriquecida, request.Papel);

            // ── ETAPA 1: ANÁLISE ──────────────────────────────────────────────
            var analise = await ChamarOpenRouter(
                modelo: MODELO_ANALISE,
                temperature: 0.3,
                systemPrompt: @"
Você é um analista especialista em engenharia de prompts para tarefas técnicas de software.
NUNCA gere o prompt final. Apenas analise.
NUNCA escreva frases com mais de 20 palavras.
SEMPRE responda dentro das tags XML abaixo.",
                userPrompt: $@"
Analise este pedido técnico e responda SOMENTE neste XML:

<analise>
  <objetivo_real>O que o desenvolvedor precisa implementar, em 1-2 frases.</objetivo_real>
  <armadilhas>3 erros técnicos que uma implementação ruim cometeria.</armadilhas>
  <contexto_minimo>Stack, padrões e requisitos mínimos para a implementação.</contexto_minimo>
  <restricoes_sugeridas>5 restrições NUNCA/SEMPRE técnicas e específicas para este domínio.</restricoes_sugeridas>
  <temperatura_ideal>Valor 0.1-0.5 para código. Justificativa em uma frase.</temperatura_ideal>
</analise>

Papel: {deteccao.papel}
Tarefa: {ideiaEnriquecida}
Formato: {deteccao.formato}"
            );

            if (analise == null)
                return StatusCode(500, new { erro = "Etapa 1 falhou.", etapa = "analise" });

            // ── ETAPA 2: GERAÇÃO ──────────────────────────────────────────────
            var (promptGerado, modeloReal) = await ChamarOpenRouterComModelo(
                modelo: MODELO_GERACAO,
                temperature: 0.35,
                systemPrompt: @"
Você é um Arquiteto de Prompts Sênior para engenharia de software.
NUNCA adicione texto fora das tags XML.
NUNCA use frases vagas ou genéricas.
SEMPRE inclua critérios de aceitação mensuráveis.
SEMPRE especifique a stack técnica no system_instruction.",
                userPrompt: $@"
Com base nesta análise:
{analise}

Gere o prompt para:
- Papel: {deteccao.papel}
- Tarefa: {ideiaEnriquecida}
- Formato: {deteccao.formato}

Retorne SOMENTE neste XML:

<prompt_otimizado>
  <system_instruction>
    Papel técnico ultra-específico com stack e especialidade. Máximo 3 frases.
  </system_instruction>
  <restricoes_constitucionais>
    6 restrições NUNCA/SEMPRE técnicas. Zero genericidade.
  </restricoes_constitucionais>
  <instrucao_principal>
    Tarefa única e clara. Com critério de sucesso mensurável.
  </instrucao_principal>
  <criterios_de_aceitacao>
    4-6 critérios técnicos objetivos e testáveis.
  </criterios_de_aceitacao>
  <few_shot_exemplo>
    INPUT: entrada técnica realista
    REASONING: raciocínio de engenharia passo a passo
    OUTPUT: código ou resultado no formato correto
  </few_shot_exemplo>
  <formato_resposta>
    {deteccao.formato} — estrutura detalhada sem ambiguidade.
  </formato_resposta>
  <loop_validacao>
    Antes de entregar, verifique:
    1. Todos os critérios de aceitação foram atendidos?
    2. O código compila e passa nos testes?
    3. Performance e acessibilidade estão dentro do esperado?
    4. O formato está exatamente como especificado?
    5. Se qualquer item falhar: revise antes de responder.
  </loop_validacao>
</prompt_otimizado>"
            );

            modeloGeracaoUsado = modeloReal ?? MODELO_GERACAO;
            if (promptGerado == null)
                return StatusCode(500, new { erro = "Etapa 2 falhou.", etapa = "geracao" });

            // ── ETAPA 3: VALIDAÇÃO ────────────────────────────────────────────
            var validacao = await ChamarOpenRouter(
                modelo: MODELO_VALIDACAO,
                temperature: 0.1,
                systemPrompt: @"
Você é um validador de prompts técnicos para desenvolvimento de software.
IMPORTANTE: prompts técnicos detalhados são CORRETOS — não penalize detalhamento.
Penalize apenas: papel genérico, restrições vagas, critérios não mensuráveis, ausência de exemplo técnico.
SEMPRE responda dentro das tags XML.",
                userPrompt: $@"
Valide este prompt técnico. Responda SOMENTE neste XML:

<validacao>
  <checklist>
    Papel técnico ultra-específico com stack: sim/não
    Mínimo 4 restrições técnicas não-genéricas: sim/não
    Instrução tem critério de sucesso mensurável: sim/não
    Critérios de aceitação são testáveis: sim/não
    Exemplo few-shot técnico e realista: sim/não
    Formato de saída detalhado: sim/não
    Loop de validação com testes técnicos: sim/não
    Ausência de linguagem vaga: sim/não
  </checklist>
  <problemas_encontrados>
    Problemas reais apenas. Se nenhum: Nenhum problema crítico encontrado.
  </problemas_encontrados>
  <prompt_final>
    Corrija apenas seções com problema real. Se tudo ok: copie sem alterações.
  </prompt_final>
  <score>
    0-100. Prompts técnicos detalhados e específicos devem pontuar 85+.
  </score>
</validacao>

Prompt a validar:
{promptGerado}"
            );

            if (validacao == null)
                return StatusCode(500, new { erro = "Etapa 3 falhou.", etapa = "validacao" });

            string? promptFinal = ExtrairTagXmlRobusto(validacao, "prompt_final");
            bool promptFinalValido = promptFinal != null && promptFinal.Length > 100
                && (promptFinal.Contains('<') || promptFinal.Contains('#')
                    || promptFinal.Contains("NUNCA") || promptFinal.Contains("SEMPRE"));

            string resultadoFinal = promptFinalValido
                ? promptFinal!
                : ExtrairTagXmlRobusto(promptGerado, "prompt_otimizado") ?? promptGerado;

            string scoreRaw = ExtrairTagXmlRobusto(validacao, "score") ?? "N/A";
            var scoreMatch  = System.Text.RegularExpressions.Regex.Match(scoreRaw, @"\d+");
            string score    = scoreMatch.Success ? scoreMatch.Value : "N/A";

            return Ok(new
            {
                tipo_resposta    = "prompt_gerado",
                prompt_otimizado = resultadoFinal.Trim(),
                deteccao = new
                {
                    papel_detectado   = deteccao.papel,
                    formato_detectado = deteccao.formato,
                    papel_foi_editado = !string.IsNullOrWhiteSpace(request.Papel)
                },
                pipeline = new
                {
                    etapa_triagem = new { modelo = MODELO_TRIAGEM,     funcao = "Triagem",   resultado = "simples" },
                    etapa_0       = new { modelo = MODELO_DETECCAO,    funcao = "Detecção"  },
                    etapa_1       = new { modelo = MODELO_ANALISE,     funcao = "Análise"   },
                    etapa_2       = new { modelo = modeloGeracaoUsado, funcao = "Geração"   },
                    etapa_3       = new { modelo = MODELO_VALIDACAO,   funcao = "Validação" },
                    score_qualidade = score.Trim()
                }
            });
        }
        catch (HttpRequestException ex)
        {
            return StatusCode((int)(ex.StatusCode ?? System.Net.HttpStatusCode.InternalServerError),
                new { erro = "Erro OpenRouter", detalhes = ex.Message });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { erro = "Erro interno", detalhes = ex.Message });
        }
    }

    // ════════════════════════════════════════════════════════════
    // POST /api/prompt/regerar
    // Recebe prompt existente + instrução de melhora → novo prompt
    // ════════════════════════════════════════════════════════════
    [HttpPost("regerar")]
    public async Task<IActionResult> RegerarPrompt([FromBody] RegerarRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.PromptAtual))
            return BadRequest(new { erro = "promptAtual é obrigatório." });
        if (string.IsNullOrWhiteSpace(request.InstrucaoMelhora))
            return BadRequest(new { erro = "instrucaoMelhora é obrigatório." });

        try
        {
            // Geração do prompt melhorado
            var (promptMelhorado, modeloUsado) = await ChamarOpenRouterComModelo(
                modelo: MODELO_GERACAO,
                temperature: 0.35,
                systemPrompt: @"
Você é um Arquiteto de Prompts Sênior. Você recebe um prompt existente e uma instrução de melhora.
NUNCA descarte a estrutura XML existente.
NUNCA remova critérios de aceitação sem substituir por algo melhor.
SEMPRE aplique a instrução de melhora de forma cirúrgica — mude apenas o necessário.
SEMPRE mantenha o nível técnico igual ou superior ao original.",
                userPrompt: $@"
Prompt atual:
{request.PromptAtual}

Instrução de melhora do usuário:
{request.InstrucaoMelhora}

Papel para manter: {request.Papel ?? "mesmo do original"}
Formato para manter: {request.Formato ?? "mesmo do original"}

Aplique a instrução de melhora e retorne SOMENTE o prompt melhorado dentro das tags:
<prompt_melhorado>
  [prompt completo melhorado aqui]
</prompt_melhorado>"
            );

            if (promptMelhorado == null)
                return StatusCode(500, new { erro = "Geração do prompt melhorado falhou." });

            // Validação do prompt melhorado
            var validacao = await ChamarOpenRouter(
                modelo: MODELO_VALIDACAO,
                temperature: 0.1,
                systemPrompt: @"
Você é um validador de prompts técnicos. Verifique se a melhora foi aplicada corretamente.
SEMPRE responda dentro das tags XML.",
                userPrompt: $@"
Valide se este prompt melhorou em relação à instrução: '{request.InstrucaoMelhora}'

Responda SOMENTE neste XML:
<validacao>
  <melhora_aplicada>sim/não — a instrução foi aplicada corretamente?</melhora_aplicada>
  <prompt_final>
    Se melhora aplicada corretamente: copie sem alterações.
    Se não: aplique você mesmo a melhora e retorne o prompt corrigido.
  </prompt_final>
  <score>0-100</score>
</validacao>

Prompt a validar:
{promptMelhorado}"
            );

            string? final = null;
            if (validacao != null)
                final = ExtrairTagXmlRobusto(validacao, "prompt_final");

            bool finalValido = final != null && final.Length > 100
                && (final.Contains('<') || final.Contains("NUNCA") || final.Contains("SEMPRE"));

            if (!finalValido)
                final = ExtrairTagXmlRobusto(promptMelhorado, "prompt_melhorado") ?? promptMelhorado;

            string scoreRaw = ExtrairTagXmlRobusto(validacao ?? "", "score") ?? "N/A";
            var sm = System.Text.RegularExpressions.Regex.Match(scoreRaw, @"\d+");

            return Ok(new
            {
                tipo_resposta    = "prompt_melhorado",
                prompt_otimizado = final!.Trim(),
                pipeline = new
                {
                    etapa_2 = new { modelo = modeloUsado ?? MODELO_GERACAO, funcao = "Geração" },
                    etapa_3 = new { modelo = MODELO_VALIDACAO, funcao = "Validação" },
                    score_qualidade = sm.Success ? sm.Value : "N/A"
                }
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { erro = "Erro ao regerar", detalhes = ex.Message });
        }
    }

    // ════════════════════════════════════════════════════════════
    // ETAPA -2: DETECÇÃO DE AMBIGUIDADE
    // Retorna perguntas apenas quando há risco real de erro de interpretação
    // ════════════════════════════════════════════════════════════
    private async Task<List<PerguntaClarificacao>> DetectarAmbiguidade(string ideiaBruta)
    {
        var resultado = await ChamarOpenRouter(
            modelo: MODELO_AMBIGUIDADE,
            temperature: 0.2,
            systemPrompt: @"
Você detecta ambiguidades reais em pedidos técnicos que causariam erro de implementação.

Exemplos de ambiguidades reais que EXIGEM clarificação:
- 'canva' → pode ser o site Canva.com (ferramenta de design) ou HTML Canvas API (elemento gráfico)
- 'seleção de objetos' em app de edição → pode ser objetos na tela (elementos de design) ou objetos 3D (Three.js)
- 'banco' → pode ser banco de dados ou banco (instituição financeira)
- 'api' sem contexto → REST, GraphQL, SDK?
- 'mobile' → React Native, Flutter, iOS nativo, Android nativo?

Exemplos que NÃO precisam de clarificação (são específicos o suficiente):
- 'criar componente React com TypeScript' → claro
- 'validar CPF em Python' → claro
- 'endpoint REST em .NET' → claro

NUNCA gere mais de 2 perguntas por vez — escolha apenas as mais críticas.
NUNCA pergunte sobre preferências de estilo ou design.
SEMPRE gere opções clicáveis realistas e relevantes.
SEMPRE responda em XML.",
            userPrompt: $@"
Analise este pedido e identifique ambiguidades críticas que causariam erro de implementação.

Pedido: '{ideiaBruta}'

Responda SOMENTE neste XML:
<resultado>
  <tem_ambiguidade>sim/não</tem_ambiguidade>
  <perguntas>
    Para cada pergunta necessária, use este formato (máximo 2 perguntas):
    <pergunta>
      <id>identificador_unico_sem_espacos</id>
      <texto>Pergunta clara e direta ao usuário</texto>
      <opcoes>Opção 1 | Opção 2 | Opção 3</opcoes>
      <livre>sim/não</livre>
    </pergunta>
  </perguntas>
</resultado>"
        );

        var temAmbiguidade = ExtrairTagXml(resultado ?? "", "tem_ambiguidade")?.Trim().ToLower();
        if (temAmbiguidade != "sim") return new List<PerguntaClarificacao>();

        var perguntas = new List<PerguntaClarificacao>();
        var texto = resultado ?? "";

        // Extrai cada bloco <pergunta>...</pergunta>
        int pos = 0;
        while (true)
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
            {
                perguntas.Add(new PerguntaClarificacao
                {
                    Id     = id,
                    Texto  = txt,
                    Opcoes = opts.Split('|', StringSplitOptions.RemoveEmptyEntries)
                                 .Select(o => o.Trim())
                                 .Where(o => !string.IsNullOrEmpty(o))
                                 .ToList(),
                    Livre  = livre
                });
            }

            pos = fim + "</pergunta>".Length;
        }

        return perguntas;
    }

    // ════════════════════════════════════════════════════════════
    // ETAPA -1: TRIAGEM DE COMPLEXIDADE
    // ════════════════════════════════════════════════════════════
    private async Task<(bool isComplexo, string aviso, List<SubTarefaItem> subTarefas, string recomendacao)>
        TriarComplexidade(string ideiaBruta)
    {
        var resultado = await ChamarOpenRouter(
            modelo: MODELO_TRIAGEM,
            temperature: 0.2,
            systemPrompt: @"
Você é especialista em decomposição de tarefas de software.

Regras de granularidade:
- Funcionalidades SIMPLES (CRUD, validação, estilo): agrupe até 5 relacionadas
- Funcionalidades MÉDIAS (componente com estado, hook): agrupe 2-3 relacionadas
- Funcionalidades COMPLEXAS (algoritmo, sistema completo): 1 por sub-tarefa

NUNCA classifique como complexo quando for apenas uma tarefa com detalhes técnicos.
SEMPRE ordene sub-tarefas por dependência técnica.
SEMPRE responda dentro das tags XML.",
            userPrompt: $@"
Classifique e responda SOMENTE neste XML:

<triagem>
  <classificacao>simples/complexo</classificacao>
  <justificativa>Por que é simples ou complexo em uma frase.</justificativa>
  <sub_tarefas>
    Lista de sub-tarefas. Cada linha: TITULO | DESCRICAO_CURTA | COMPLEXIDADE(baixa/media/alta)
    Vazio se simples.
  </sub_tarefas>
  <recomendacao>Qual implementar primeiro e por quê. Vazio se simples.</recomendacao>
</triagem>

Ideia: '{ideiaBruta}'"
        );

        var classificacao = ExtrairTagXml(resultado ?? "", "classificacao")?.Trim().ToLower();
        if (classificacao != "complexo") return (false, "", new List<SubTarefaItem>(), "");

        var aviso        = ExtrairTagXml(resultado ?? "", "justificativa")?.Trim() ?? "";
        var recomendacao = ExtrairTagXml(resultado ?? "", "recomendacao")?.Trim()  ?? "";
        var rawTarefas   = ExtrairTagXml(resultado ?? "", "sub_tarefas")?.Trim()   ?? "";

        var subTarefas = rawTarefas
            .Split('\n', StringSplitOptions.RemoveEmptyEntries)
            .Select(l => l.Trim().TrimStart('-', '*', '•', ' '))
            .Where(l => !string.IsNullOrWhiteSpace(l))
            .Select(l => {
                var p = l.Split('|');
                return new SubTarefaItem
                {
                    Titulo       = p.Length > 0 ? p[0].Trim() : l,
                    Descricao    = p.Length > 1 ? p[1].Trim() : "",
                    Complexidade = p.Length > 2 ? p[2].Trim().ToLower() : "media"
                };
            })
            .Take(8).ToList();

        return (true, aviso, subTarefas, recomendacao);
    }

    // ════════════════════════════════════════════════════════════
    // ETAPA 0: DETECÇÃO PAPEL + FORMATO
    // ════════════════════════════════════════════════════════════
    private async Task<(string papel, string formato)> DetectarPapelEFormato(
        string ideiaBruta, string? papelUsuario)
    {
        if (!string.IsNullOrWhiteSpace(papelUsuario))
        {
            var fmt = await InferirFormato(ideiaBruta);
            return (papelUsuario.Trim(), fmt);
        }

        var resultado = await ChamarOpenRouter(
            modelo: MODELO_DETECCAO,
            temperature: 0.2,
            systemPrompt: @"
Você identifica perfis técnicos ultra-específicos para tarefas de desenvolvimento.
NUNCA use papéis genéricos como 'Desenvolvedor' ou 'Especialista em TI'.
SEMPRE inclua a stack técnica exata no papel (ex: 'React 18 + TypeScript + Canvas API').
SEMPRE use o contexto adicional fornecido entre colchetes para refinar o papel.
SEMPRE responda dentro das tags XML.",
            userPrompt: $@"
Detecte papel e formato. Responda SOMENTE neste XML:

<deteccao>
  <papel>Papel técnico com stack específica.</papel>
  <formato>Um destes exatos: 'Markdown com seções e blocos de código' | 'XML estruturado' | 'JSON com schema' | 'Texto em tópicos' | 'Texto corrido'</formato>
</deteccao>

Tarefa: '{ideiaBruta}'"
        );

        var papel   = ExtrairTagXml(resultado ?? "", "papel")?.Trim()   ?? "Engenheiro de Software Sênior";
        var formato = ExtrairTagXml(resultado ?? "", "formato")?.Trim() ?? "Markdown com seções e blocos de código";
        return (papel, formato);
    }

    private async Task<string> InferirFormato(string ideia)
    {
        var r = await ChamarOpenRouter(MODELO_DETECCAO, 0.1,
            "Infira o melhor formato. Responda SOMENTE dentro de <formato>.",
            $"Tarefa: '{ideia}'\n<formato>Markdown com seções e blocos de código</formato>");
        return ExtrairTagXml(r ?? "", "formato")?.Trim() ?? "Markdown com seções e blocos de código";
    }

    // ════════════════════════════════════════════════════════════
    // HELPERS
    // ════════════════════════════════════════════════════════════
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

        return (node?["choices"]?[0]?["message"]?["content"]?.ToString(),
                node?["model"]?.ToString());
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
        var abertura   = $"<{tag}>";
        var fechamento = $"</{tag}>";
        int inicio = texto.IndexOf(abertura);
        int fim    = texto.LastIndexOf(fechamento);
        if (inicio < 0 || fim < 0 || fim <= inicio) return null;
        return texto[(inicio + abertura.Length)..fim].Trim();
    }
}