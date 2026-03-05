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

// ── REQUESTS ─────────────────────────────────────────────────────────────────
public class PromptRequest
{
    public string     IdeiaBruta              { get; set; } = string.Empty;
    public string?    Papel                   { get; set; }
    public bool       ForcarSimples           { get; set; } = false;
    public Dictionary<string, string>? RespostasClarificacao { get; set; }

    // Tipo sugerido pelo usuário (null = IA detecta)
    public TipoObjetivo? TipoSugerido         { get; set; }

    // Executor do prompt: "Claude Code", "Google Jules", "OpenHands", "Cursor", etc.
    // Usado para otimizar estrutura e verbosidade do prompt gerado
    public string?       ExecutorAlvo         { get; set; }
}

public class RegerarRequest
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