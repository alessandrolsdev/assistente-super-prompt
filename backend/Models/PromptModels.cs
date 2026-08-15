namespace ApiAssistente.Models;

// ── TIPOS DE OBJETIVO ────────────────────────────────────────────────────────
public enum TipoObjetivo
{
    Imagem,        // Midjourney, DALL-E, Stable Diffusion
    Video,         // Sora, Runway, Kling
    Codigo,        // implementar do zero
    Refatoracao,   // refatorar código existente
    Copywriting,   // texto persuasivo, marketing
    DesignUI,      // UI/UX, wireframes, sistemas de design
    Outro          // IA detecta e especializa
}

// ── NÍVEL DE DETALHE ─────────────────────────────────────────────────────────
/// <summary>
/// Quanto o prompt gerado deve se estender. Controla tanto a diretriz passada ao
/// modelo quanto o orçamento de tokens da etapa de geração.
/// </summary>
public enum NivelDetalhe
{
    Conciso,      // o essencial, sem redundância
    Equilibrado,  // padrão
    Exaustivo     // cobre casos de borda e contexto amplo
}

public static class NiveisDetalhe
{
    public static string Diretriz(NivelDetalhe nivel) => nivel switch
    {
        NivelDetalhe.Conciso => """
            NÍVEL DE DETALHE: conciso.
            Entregue o menor prompt que ainda cumpre todos os critérios.
            Corte contexto explicativo, repetição e seções que não mudam o resultado.
            Prefira uma linha densa a três linhas vagas.
            """,

        NivelDetalhe.Exaustivo => """
            NÍVEL DE DETALHE: exaustivo.
            Cubra casos de borda, entradas inválidas e cenários de falha.
            Inclua exemplos concretos e contexto suficiente para alguém sem
            familiaridade com o domínio executar sem perguntar nada.
            Detalhamento é bem-vindo, desde que cada linha acrescente informação.
            """,

        _ => """
            NÍVEL DE DETALHE: equilibrado.
            Cubra o caminho principal e os riscos mais prováveis.
            Detalhe o que muda o resultado e corte o resto.
            """
    };

    /// <summary>Orçamento de tokens da geração, proporcional ao nível pedido.</summary>
    public static int MaxTokens(NivelDetalhe nivel, int baseMaxTokens) => nivel switch
    {
        NivelDetalhe.Conciso   => Math.Max(1024, baseMaxTokens / 2),
        NivelDetalhe.Exaustivo => baseMaxTokens * 2,
        _                      => baseMaxTokens
    };
}

// ── IDIOMA DE SAÍDA ──────────────────────────────────────────────────────────
public static class IdiomasSaida
{
    public const string Automatico = "auto";

    private static readonly Dictionary<string, string> Nomes =
        new(StringComparer.OrdinalIgnoreCase)
        {
            ["pt-BR"] = "português do Brasil",
            ["en"]    = "inglês",
            ["es"]    = "espanhol",
        };

    /// <summary>
    /// Diretriz de idioma. "auto" (padrão) deixa o modelo seguir o idioma da
    /// ideia — importante porque o executor final costuma ser anglófono, mas o
    /// usuário escreve em português.
    /// </summary>
    public static string Diretriz(string? idioma)
    {
        if (string.IsNullOrWhiteSpace(idioma) || string.Equals(idioma, Automatico, StringComparison.OrdinalIgnoreCase))
            return "IDIOMA: escreva o prompt no mesmo idioma da ideia do usuário.";

        return Nomes.TryGetValue(idioma.Trim(), out var nome)
            ? $"IDIOMA: escreva TODO o prompt gerado em {nome}, independentemente do idioma da ideia do usuário."
            : $"IDIOMA: escreva TODO o prompt gerado em {idioma.Trim()}, independentemente do idioma da ideia do usuário.";
    }
}

// ── REQUESTS ─────────────────────────────────────────────────────────────────
/// <summary>Preferências de saída compartilhadas entre gerar e regerar.</summary>
public class PreferenciasSaida
{
    /// <summary>Quanto o prompt deve se estender. Null = Equilibrado.</summary>
    public NivelDetalhe? NivelDetalhe { get; set; }

    /// <summary>"auto" (padrão), "pt-BR", "en", "es" ou qualquer rótulo livre.</summary>
    public string? IdiomaSaida { get; set; }

    /// <summary>
    /// Executor do prompt: "Claude Code", "Google Jules", "OpenHands", "Cursor"...
    /// Resolvido em <see cref="ExecutorPerfis"/> para diretrizes concretas.
    /// </summary>
    public string? ExecutorAlvo { get; set; }

    // O nome da propriedade colide com o nome do tipo, então o default vai
    // qualificado para não depender de resolução ambígua.
    public NivelDetalhe NivelOuPadrao => NivelDetalhe ?? ApiAssistente.Models.NivelDetalhe.Equilibrado;
}

public class PromptRequest : PreferenciasSaida
{
    public string     IdeiaBruta              { get; set; } = string.Empty;
    public string?    Papel                   { get; set; }
    public bool       ForcarSimples           { get; set; } = false;
    public Dictionary<string, string>? RespostasClarificacao { get; set; }

    // Tipo sugerido pelo usuário (null = IA detecta)
    public TipoObjetivo? TipoSugerido         { get; set; }

    /// <summary>
    /// Contexto compartilhado do projeto (stack, convenções, restrições), aplicado
    /// a todas as sub-tarefas. Sem isso, cada sub-tarefa do plano de divisão era
    /// gerada isolada e perdia o contexto do projeto que a originou.
    /// </summary>
    public string?    ContextoProjeto         { get; set; }
}

public class RegerarRequest : PreferenciasSaida
{
    public string        PromptAtual          { get; set; } = string.Empty;
    public string        InstrucaoMelhora     { get; set; } = string.Empty;
    public string?       Papel               { get; set; }
    public string?       Formato             { get; set; }
    public TipoObjetivo? TipoObjetivo        { get; set; }
    public List<string>? OutrasTarefas       { get; set; }
}

// ── MODELS ───────────────────────────────────────────────────────────────────
public class SubTarefaItem
{
    public string Titulo       { get; set; } = string.Empty;
    public string Descricao    { get; set; } = string.Empty;
    public string Complexidade { get; set; } = "media";
}

public class PerguntaClarificacao
{
    public string       Id     { get; set; } = string.Empty;
    public string       Texto  { get; set; } = string.Empty;
    public List<string> Opcoes { get; set; } = new();
    public bool         Livre  { get; set; } = false;
}

// ── CONFIGURAÇÕES POR TIPO DE OBJETIVO ──────────────────────────────────────
// Cada tipo tem: temperatura ideal, formato padrão, papel padrão, ferramentas alvo
public record ObjetivoConfig(
    double   Temperature,
    string   FormatoPadrao,
    string   PapelPadrao,
    string   FerramentasAlvo,   // ex: "Midjourney v6, DALL-E 3, Stable Diffusion XL"
    string[] CriteriosBase      // critérios de aceitação específicos do tipo
);

public static class ObjetivoConfigs
{
    public static readonly Dictionary<TipoObjetivo, ObjetivoConfig> Map = new()
    {
        [TipoObjetivo.Imagem] = new(
            Temperature:    0.7,
            FormatoPadrao:  "Prompt de imagem direto (sem XML, sem explicações, só o prompt)",
            PapelPadrao:    "Especialista em prompt engineering para geração de imagens com IA (Midjourney, DALL-E 3, Stable Diffusion)",
            FerramentasAlvo: "Midjourney v6, DALL-E 3, Stable Diffusion XL, Flux",
            CriteriosBase:  new[] {
                "Sujeito principal descrito com precisão visual (materiais, texturas, cores)",
                "Estilo artístico e referências visuais claramente especificados",
                "Iluminação, câmera e composição incluídos",
                "Parâmetros técnicos da ferramenta alvo presentes (--ar, --v, --style)",
                "Elementos negativos ou indesejados especificados se necessário"
            }
        ),
        [TipoObjetivo.Video] = new(
            Temperature:    0.7,
            FormatoPadrao:  "Prompt de vídeo direto com descrição de movimento e cena",
            PapelPadrao:    "Especialista em prompt engineering para geração de vídeo com IA (Sora, Runway, Kling, Pika)",
            FerramentasAlvo: "Sora, Runway Gen-3, Kling, Pika 2.0",
            CriteriosBase:  new[] {
                "Movimento da câmera especificado (pan, zoom, orbit, static)",
                "Duração e ritmo da cena descritos",
                "Transições e efeitos visuais incluídos",
                "Sujeito principal com comportamento/ação clara",
                "Atmosfera e iluminação dinâmica especificadas"
            }
        ),
        [TipoObjetivo.Codigo] = new(
            Temperature:    0.2,
            FormatoPadrao:  "Markdown com seções e blocos de código",
            PapelPadrao:    "Engenheiro de Software Sênior especializado na stack solicitada",
            FerramentasAlvo: "Claude, GPT-4, Gemini (assistentes de código)",
            CriteriosBase:  new[] {
                "Stack técnica específica com versões",
                "Critérios de aceitação testáveis e mensuráveis",
                "Tratamento de erros incluído",
                "Performance e acessibilidade consideradas",
                "Exemplo de entrada/saída técnico e realista"
            }
        ),
        [TipoObjetivo.Refatoracao] = new(
            Temperature:    0.2,
            FormatoPadrao:  "Markdown com código original, problemas identificados e código refatorado",
            PapelPadrao:    "Engenheiro Sênior especializado em refatoração, clean code e padrões de design",
            FerramentasAlvo: "Claude, GPT-4, Gemini (assistentes de código)",
            CriteriosBase:  new[] {
                "Problemas do código atual claramente identificados",
                "Padrões alvo especificados (SOLID, DRY, KISS)",
                "Comportamento externo preservado após refatoração",
                "Testes de regressão incluídos",
                "Métricas de melhoria definidas (complexidade, cobertura)"
            }
        ),
        [TipoObjetivo.Copywriting] = new(
            Temperature:    0.8,
            FormatoPadrao:  "Texto estruturado com headline, corpo e CTA",
            PapelPadrao:    "Copywriter especializado em marketing de conversão e psicologia do consumidor",
            FerramentasAlvo: "Claude, GPT-4, Gemini (geração de copy)",
            CriteriosBase:  new[] {
                "Público-alvo e persona bem definidos",
                "Proposta de valor única (UVP) destacada",
                "Gatilhos psicológicos específicos ao contexto",
                "CTA claro e orientado à ação",
                "Tom de voz e restrições de marca respeitados"
            }
        ),
        [TipoObjetivo.DesignUI] = new(
            Temperature:    0.5,
            FormatoPadrao:  "Especificação técnica de design com componentes, tokens e interações",
            PapelPadrao:    "Designer de UI/UX Sênior especializado em sistemas de design e experiência do usuário",
            FerramentasAlvo: "Claude, GPT-4, Gemini (assistentes de design)",
            CriteriosBase:  new[] {
                "Componentes e hierarquia visual especificados",
                "Tokens de design (cores, tipografia, espaçamento) incluídos",
                "Estados de interação descritos (hover, focus, disabled)",
                "Acessibilidade WCAG 2.1 AA contemplada",
                "Responsividade e breakpoints definidos"
            }
        ),
        [TipoObjetivo.Outro] = new(
            Temperature:    0.4,
            FormatoPadrao:  "Formato mais adequado ao objetivo detectado",
            PapelPadrao:    "Especialista no domínio detectado",
            FerramentasAlvo: "Claude, GPT-4, Gemini",
            CriteriosBase:  new[] {
                "Objetivo claramente definido",
                "Contexto suficiente fornecido",
                "Critérios de sucesso mensuráveis",
                "Formato de saída especificado"
            }
        ),
    };

    public static ObjetivoConfig Get(TipoObjetivo tipo) =>
        Map.TryGetValue(tipo, out var cfg) ? cfg : Map[TipoObjetivo.Outro];
}