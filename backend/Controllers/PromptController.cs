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

    private const string MODELO_TRIAGEM   = "arcee-ai/trinity-large-preview:free";
    private const string MODELO_DETECCAO  = "arcee-ai/trinity-large-preview:free";
    private const string MODELO_ANALISE   = "arcee-ai/trinity-large-preview:free";
    private const string MODELO_GERACAO   = "openrouter/free";
    private const string MODELO_VALIDACAO = "arcee-ai/trinity-large-preview:free";

    private const string OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

    public PromptController(HttpClient httpClient, IConfiguration configuration)
    {
        _httpClient = httpClient;
        _openRouterApiKey = configuration["OpenRouterApiKey"]?.Trim()
            ?? throw new ArgumentNullException("OpenRouterApiKey não encontrada");
    }

    // ============================================================
    // POST /api/prompt/gerar
    // forcarSimples=true → pula triagem (vem de clique em sub-tarefa)
    // ============================================================
    [HttpPost("gerar")]
    public async Task<IActionResult> GerarPrompt([FromBody] PromptRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.IdeiaBruta))
            return BadRequest(new { erro = "ideiaBruta é obrigatório." });

        string modeloGeracaoUsado = MODELO_GERACAO;

        try
        {
            // ── ETAPA -1: TRIAGEM ─────────────────────────────────────────────
            // Pulada quando forcarSimples=true (sub-tarefa já é atômica)
            if (!request.ForcarSimples)
            {
                var triagem = await TriarComplexidade(request.IdeiaBruta);
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
            var deteccao = await DetectarPapelEFormato(request.IdeiaBruta, request.Papel);

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
Tarefa: {request.IdeiaBruta}
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
- Tarefa: {request.IdeiaBruta}
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
            // Critérios ajustados: prompts técnicos detalhados são corretos por design
            var validacao = await ChamarOpenRouter(
                modelo: MODELO_VALIDACAO,
                temperature: 0.1,
                systemPrompt: @"
Você é um validador de prompts técnicos para desenvolvimento de software.
IMPORTANTE: prompts técnicos detalhados com múltiplos critérios são CORRETOS — não penalize detalhamento.
Penalize apenas: papel genérico, restrições vagas, critérios não mensuráveis, ausência de exemplo técnico.
SEMPRE responda dentro das tags XML.",
                userPrompt: $@"
Valide este prompt técnico. Responda SOMENTE neste XML:

<validacao>
  <checklist>
    Papel técnico ultra-específico com stack: sim/não
    Mínimo 4 restrições técnicas não-genéricas: sim/não
    Instrução tem critério de sucesso mensurável: sim/não
    Critérios de aceitação são testáveis (não subjetivos): sim/não
    Exemplo few-shot é código/técnico realista: sim/não
    Formato de saída está detalhado: sim/não
    Loop de validação inclui testes técnicos: sim/não
    Ausência de linguagem vaga ('bom', 'adequado', 'profissional'): sim/não
  </checklist>
  <problemas_encontrados>
    Apenas problemas reais de qualidade técnica. Se nenhum: Nenhum problema crítico encontrado.
  </problemas_encontrados>
  <prompt_final>
    Corrija apenas seções com problema real. Se tudo ok: copie sem alterações.
  </prompt_final>
  <score>
    0-100. Prompts técnicos detalhados e específicos devem pontuar 85+.
    Penalize apenas genericidade e falta de mensuralidade.
  </score>
</validacao>

Prompt a validar:
{promptGerado}"
            );

            if (validacao == null)
                return StatusCode(500, new { erro = "Etapa 3 falhou.", etapa = "validacao" });

            // Parser robusto: LastIndexOf no fechamento suporta XML aninhado
            string? promptFinal = ExtrairTagXmlRobusto(validacao, "prompt_final");

            // Valida que é um prompt real (>100 chars e contém marcadores de prompt)
            bool promptFinalValido = promptFinal != null
                && promptFinal.Length > 100
                && (promptFinal.Contains('<') || promptFinal.Contains('#')
                    || promptFinal.Contains("NUNCA") || promptFinal.Contains("SEMPRE"));

            string resultadoFinal = promptFinalValido
                ? promptFinal!
                : ExtrairTagXmlRobusto(promptGerado, "prompt_otimizado") ?? promptGerado;

            // Score: extrai apenas dígitos para evitar texto de instrução
            string scoreRaw = ExtrairTagXmlRobusto(validacao, "score") ?? "N/A";
            var scoreMatch = System.Text.RegularExpressions.Regex.Match(scoreRaw, @"\d+");
            string score = scoreMatch.Success ? scoreMatch.Value : "N/A";

            return Ok(new
            {
                tipo_resposta    = "prompt_gerado",
                prompt_otimizado = resultadoFinal.Trim(),
                deteccao = new
                {
                    papel_detectado    = deteccao.papel,
                    formato_detectado  = deteccao.formato,
                    papel_foi_editado  = !string.IsNullOrWhiteSpace(request.Papel)
                },
                pipeline = new
                {
                    etapa_triagem = new { modelo = MODELO_TRIAGEM,        funcao = "Triagem",   resultado = "simples" },
                    etapa_0       = new { modelo = MODELO_DETECCAO,       funcao = "Detecção"  },
                    etapa_1       = new { modelo = MODELO_ANALISE,        funcao = "Análise"   },
                    etapa_2       = new { modelo = modeloGeracaoUsado,    funcao = "Geração"   },
                    etapa_3       = new { modelo = MODELO_VALIDACAO,      funcao = "Validação" },
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

    // ============================================================
    // TRIAGEM — granularidade inteligente por complexidade
    // ============================================================
    private async Task<(bool isComplexo, string aviso, List<SubTarefaItem> subTarefas, string recomendacao)>
        TriarComplexidade(string ideiaBruta)
    {
        var resultado = await ChamarOpenRouter(
            modelo: MODELO_TRIAGEM,
            temperature: 0.2,
            systemPrompt: @"
Você é um especialista em decomposição de tarefas de software.
Classifique se uma ideia tem múltiplas funcionalidades independentes ou é uma tarefa única.

Regras de granularidade:
- Funcionalidades SIMPLES (CRUD, validação, estilo): agrupe até 5 relacionadas
- Funcionalidades MÉDIAS (componente com estado, hook): agrupe 2-3 relacionadas  
- Funcionalidades COMPLEXAS (algoritmo, sistema completo): 1 por sub-tarefa

NUNCA classifique como complexo quando for apenas uma tarefa com detalhes técnicos.
SEMPRE ordene sub-tarefas por dependência técnica (o que deve ser implementado primeiro).
SEMPRE responda dentro das tags XML.",
            userPrompt: $@"
Classifique e responda SOMENTE neste XML:

<triagem>
  <classificacao>simples/complexo</classificacao>
  <justificativa>Por que é simples ou complexo em uma frase.</justificativa>
  <sub_tarefas>
    Lista de sub-tarefas. Cada linha no formato:
    TITULO | DESCRICAO_CURTA | COMPLEXIDADE(baixa/media/alta)
    Deixe vazio se simples.
  </sub_tarefas>
  <recomendacao>Qual sub-tarefa implementar primeiro e por quê. Vazio se simples.</recomendacao>
</triagem>

Ideia: '{ideiaBruta}'"
        );

        var classificacao = ExtrairTagXml(resultado ?? "", "classificacao")?.Trim().ToLower();
        if (classificacao != "complexo")
            return (false, "", new List<SubTarefaItem>(), "");

        var aviso        = ExtrairTagXml(resultado ?? "", "justificativa")?.Trim() ?? "";
        var recomendacao = ExtrairTagXml(resultado ?? "", "recomendacao")?.Trim()  ?? "";
        var rawTarefas   = ExtrairTagXml(resultado ?? "", "sub_tarefas")?.Trim()   ?? "";

        // Parse: "TITULO | DESCRICAO | COMPLEXIDADE"
        var subTarefas = rawTarefas
            .Split('\n', StringSplitOptions.RemoveEmptyEntries)
            .Select(l => l.Trim().TrimStart('-', '*', '•', ' '))
            .Where(l => !string.IsNullOrWhiteSpace(l))
            .Select(l => {
                var partes = l.Split('|');
                return new SubTarefaItem
                {
                    Titulo      = partes.Length > 0 ? partes[0].Trim() : l,
                    Descricao   = partes.Length > 1 ? partes[1].Trim() : "",
                    Complexidade = partes.Length > 2 ? partes[2].Trim().ToLower() : "media"
                };
            })
            .Take(8)
            .ToList();

        return (true, aviso, subTarefas, recomendacao);
    }

    // ============================================================
    // DETECÇÃO PAPEL + FORMATO — ultra-específico para código
    // ============================================================
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
SEMPRE inclua stack técnica no papel (ex: 'React 18 + TypeScript + Zustand').
SEMPRE responda dentro das tags XML.",
            userPrompt: $@"
Detecte papel e formato para esta tarefa. Responda SOMENTE neste XML:

<deteccao>
  <papel>Papel técnico com stack específica. Ex: Engenheiro Frontend Sênior especializado em React 18, Canvas API e WebGL</papel>
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
            "Infira o melhor formato de saída para a tarefa. Responda SOMENTE dentro de <formato>.",
            $"<formato>Markdown com seções e blocos de código</formato>\nTarefa: '{ideia}'");
        return ExtrairTagXml(r ?? "", "formato")?.Trim() ?? "Markdown com seções e blocos de código";
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
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

    // Parser simples (para tags sem conteúdo XML interno)
    private static string? ExtrairTagXml(string texto, string tag)
    {
        var a = $"<{tag}>"; var f = $"</{tag}>";
        int i = texto.IndexOf(a), j = texto.IndexOf(f);
        if (i < 0 || j < 0) return null;
        return texto[(i + a.Length)..j].Trim();
    }

    // Parser robusto: usa LastIndexOf no fechamento para suportar XML aninhado
    // Ex: <prompt_final> pode conter </system_instruction> internamente
    private static string? ExtrairTagXmlRobusto(string texto, string tag)
    {
        var abertura   = $"<{tag}>";
        var fechamento = $"</{tag}>";
        int inicio = texto.IndexOf(abertura);
        int fim    = texto.LastIndexOf(fechamento); // LastIndexOf — pega o fechamento mais externo
        if (inicio < 0 || fim < 0 || fim <= inicio) return null;
        return texto[(inicio + abertura.Length)..fim].Trim();
    }
}