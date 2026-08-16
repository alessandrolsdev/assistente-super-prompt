namespace ApiAssistente.Models;

/// <summary>
/// Perfil de um assistente que vai EXECUTAR o prompt gerado.
///
/// Um prompt ótimo para o Claude Code (agente de terminal, que lê e edita
/// arquivos e roda comandos) é diferente de um prompt ótimo para o Cursor
/// (edição pontual no arquivo aberto) ou para o Jules (execução assíncrona sem
/// ida e volta). Antes o executor entrava como uma nota solta no fim da ideia
/// bruta; aqui ele vira diretriz estruturada para a etapa de geração.
/// </summary>
public sealed record ExecutorPerfil(
    string Id,
    string Nome,
    string Resumo,
    string[] Diretrizes,
    string FormatoPreferido)
{
    /// <summary>Bloco pronto para ser injetado no prompt da etapa de geração.</summary>
    public string ParaPrompt()
    {
        var linhas = string.Join("\n", Diretrizes.Select(d => $"- {d}"));
        return $@"O prompt será executado por: {Nome}.
{Resumo}

Molde o prompt para este executor:
{linhas}
- Formato preferido: {FormatoPreferido}";
    }
}

public static class ExecutorPerfis
{
    public static readonly ExecutorPerfil Generico = new(
        Id: "",
        Nome: "Qualquer IA",
        Resumo: "Destino desconhecido: o prompt precisa se sustentar sozinho, sem supor acesso a arquivos, terminal ou repositório.",
        Diretrizes: new[]
        {
            "Não suponha que o executor consegue ler arquivos, rodar comandos ou navegar em um repositório.",
            "Todo contexto necessário deve estar dentro do próprio prompt.",
            "Descreva as entradas de forma autocontida, incluindo trechos de código ou dados relevantes.",
            "Peça a resposta completa de uma vez, sem depender de rodadas de conversa."
        },
        FormatoPreferido: "Markdown autocontido com seções claras");

    private static readonly ExecutorPerfil[] Perfis =
    {
        new(
            Id: "Claude Code",
            Nome: "Claude Code",
            Resumo: "Agente de terminal com acesso ao repositório: lê e edita arquivos, roda comandos, testes e linters, e itera sozinho até fechar a tarefa.",
            Diretrizes: new[]
            {
                "Declare o objetivo e as restrições; não escreva o passo a passo — o agente descobre o caminho explorando o código.",
                "Aponte diretórios, arquivos ou símbolos como ponto de partida em vez de colar o código inteiro no prompt.",
                "Escreva os critérios de aceitação como verificações executáveis (comando de teste, lint, build) que o agente possa rodar.",
                "Diga explicitamente o que está fora do escopo e o que não deve ser alterado.",
                "Não peça para o agente 'mostrar o código' — ele aplica as mudanças; peça o resultado verificado."
            },
            FormatoPreferido: "Markdown direto, sem XML, com uma seção de critérios de aceitação verificáveis"),

        new(
            Id: "Cursor",
            Nome: "Cursor",
            Resumo: "Assistente dentro do editor, focado no arquivo aberto e na seleção atual, com contexto trazido por referências explícitas.",
            Diretrizes: new[]
            {
                "Mantenha o prompt curto e cirúrgico: escopo de poucos arquivos por vez.",
                "Nomeie arquivos, funções e símbolos explicitamente, no formato que o editor referencia.",
                "Peça a alteração como diff sobre o código existente, preservando o estilo do arquivo.",
                "Evite pedir refatorações amplas em um único prompt — quebre em passos pequenos.",
                "Declare o comportamento que deve permanecer inalterado."
            },
            FormatoPreferido: "Instrução curta em Markdown, com alvo e diff esperado"),

        new(
            Id: "Google Jules",
            Nome: "Google Jules",
            Resumo: "Agente assíncrono: clona o repositório, trabalha isolado e entrega o resultado como pull request, sem conversa durante a execução.",
            Diretrizes: new[]
            {
                "O prompt precisa ser uma especificação completa: não haverá oportunidade de esclarecer nada durante a execução.",
                "Defina limites de escopo explícitos, já que o agente tem o repositório inteiro à disposição.",
                "Diga o que fazer diante de ambiguidade: assumir um padrão e documentar a decisão na descrição do PR.",
                "Inclua critérios de aceitação e como validá-los antes de abrir o PR.",
                "Descreva o resultado esperado em termos de diff e mensagem de commit."
            },
            FormatoPreferido: "Especificação em Markdown com escopo, critérios de aceitação e definição de pronto"),

        new(
            Id: "OpenHands",
            Nome: "OpenHands",
            Resumo: "Agente autônomo em sandbox com shell e navegador; continua iterando até considerar a tarefa concluída.",
            Diretrizes: new[]
            {
                "Inclua o preparo de ambiente necessário (instalação de dependências, variáveis, serviços).",
                "Defina uma condição de parada inequívoca — sem ela o agente segue iterando.",
                "Liste os comandos exatos de verificação que provam que a tarefa terminou.",
                "Limite o raio de ação: quais diretórios pode alterar e quais são somente leitura.",
                "Peça um relato final do que foi alterado e do resultado de cada verificação."
            },
            FormatoPreferido: "Markdown com etapas de setup, execução, verificação e condição de parada"),

        new(
            Id: "Windsurf",
            Nome: "Windsurf",
            Resumo: "Agente de editor com indexação do repositório e edição em múltiplos arquivos numa mesma execução.",
            Diretrizes: new[]
            {
                "Declare a intenção e as restrições; para tarefas maiores, peça um plano antes das edições.",
                "Nomeie os arquivos que entram no escopo, aproveitando que o agente indexa o repositório.",
                "Especifique convenções do projeto a respeitar (estilo, camadas, nomenclatura).",
                "Peça verificação após as edições (build ou testes) em vez de confiar no diff.",
                "Separe claramente o que é obrigatório do que é desejável."
            },
            FormatoPreferido: "Markdown com plano, escopo de arquivos e verificação final"),
    };

    /// <summary>
    /// Resolve o perfil pelo id enviado pelo frontend. Vazio ou desconhecido cai
    /// no perfil genérico, mas um executor desconhecido ainda é citado pelo nome
    /// para não descartar a intenção do usuário.
    /// </summary>
    public static ExecutorPerfil Get(string? executorAlvo)
    {
        if (string.IsNullOrWhiteSpace(executorAlvo)) return Generico;

        var alvo = executorAlvo.Trim();
        var perfil = Perfis.FirstOrDefault(p => string.Equals(p.Id, alvo, StringComparison.OrdinalIgnoreCase));
        if (perfil is not null) return perfil;

        return Generico with
        {
            Id = alvo,
            Nome = alvo,
            Resumo = $"Executor informado pelo usuário: {alvo}. Sem perfil conhecido, então trate o prompt como autocontido."
        };
    }
}
