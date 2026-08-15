# Auditoria de Código — Agosto/2026

Auditoria completa do monorepo `assistente-super-prompt`: backend .NET 8, frontend Next.js 16 e documentação.

## Metodologia e limitações

O que foi feito:

- leitura integral dos 4 arquivos de código do projeto (`Program.cs`, `PromptController.cs`, `PromptModels.cs`, `page.tsx`) e de toda a configuração;
- verificação de encoding byte a byte em todos os arquivos rastreados;
- execução de `tsc --noEmit`, `eslint` e `next build` no frontend, antes e depois das correções;
- inspeção da aplicação rodando em navegador (Chromium via Playwright), que revelou o defeito de layout Q-9.

Limitação importante: **o SDK do .NET não está disponível neste ambiente** (o proxy bloqueia o instalador), então **as mudanças no backend não foram compiladas**. Elas foram revisadas manualmente — balanceamento de delimitadores, escapes de strings verbatim interpoladas, atribuição definida nos blocos `try`/`catch`, resolução de `using` — mas **`dotnet build` precisa ser rodado antes do merge**. O frontend, esse sim, está verificado: typecheck, lint e build passam limpos.

Severidades: **P0** quebra ou degrada o produto agora · **P1** falha em condição comum · **P2** manutenção, risco futuro, higiene · **Q** qualidade do produto e usabilidade.

---

## Resumo

Duas rodadas: a primeira corrigiu defeitos, a segunda melhorou qualidade dos prompts e usabilidade.

| Severidade | Achados | Corrigidos | Pendentes |
| --- | --- | --- | --- |
| P0 — crítico | 5 | 5 | 0 |
| P1 — alto | 11 | 11 | 0 |
| P2 — manutenção | 14 | 8 | 6 |
| Q — qualidade e usabilidade (rodada 2) | 9 | 9 | 0 |

Os 6 pendentes são trabalho que o [ADR-001](../architecture/adr-001-modular-monolith-first.md) já mapeou para o backlog de refatoração incremental (#3 a #8) — não foram feitos aqui porque o ADR pede fatias do tamanho de uma issue, e não um rewrite.

---

## P0 — Crítico

### P0-1. Encoding destruído dentro dos prompts enviados ao LLM

**Este era o bug mais caro do projeto, e ele era invisível na UI.**

`backend/Controllers/PromptController.cs` continha **125 caracteres U+FFFD** (`�`) e `backend/Program.cs` havia sido salvo como **ASCII puro**, com todo acento virando `?` literal. Não era só comentário: a corrupção estava dentro do texto que vai para o modelo.

```
Você é um Arquiteto de Prompts Sênior   →   Voc� � um Arquiteto de Prompts S�nior
NUNCA adicione explicações                →   NUNCA adicione explica��es
```

Todo prompt de sistema e de usuário das 7 etapas do pipeline seguia assim. O produto inteiro é "gerar prompts de alta qualidade", e ele estava alimentando os modelos com português corrompido — degradando a saída de forma difusa, sem nenhum erro visível.

O mesmo valia para as mensagens devolvidas ao usuário (`"ideiaBruta � obrigat�rio."`) e para dados de resposta em `Program.cs` (`nome = "An?lise"`, `"Gera??o"`, `"Valida??o"`).

**Corrigido:** português restaurado em todos os arquivos; `.gitignore` e `docs/architecture/current-state.md` também estavam corrompidos e foram limpos.
**Prevenção:** adicionado `.editorconfig` com `charset = utf-8`, para o editor não regravar em code page local.

### P0-2. Toda falha do OpenRouter virava "resposta vazia"

`ChamarOpenRouterComModelo` engolia **toda** exceção no laço de fallback e retornava `null`. Como `ChamarOpenRouter` delegava para ele, o `catch (HttpRequestException)` em `GerarPrompt` era **código morto — inalcançável**.

Consequência: chave inválida (401), rate limit (429), modelo removido (404) e timeout produziam todos exatamente a mesma resposta — `500 "Etapa 1 (Análise) falhou — resposta vazia."` — sem nenhuma pista da causa real.

**Corrigido:** as chamadas agora retornam um `RespostaModelo` que carrega o último erro e o status HTTP upstream. O controller devolve `429` em rate limit e `502` no resto, com a mensagem real do OpenRouter no campo `detalhes`.

### P0-3. `ExtrairTagXml` derrubava a requisição

```csharp
int i = texto.IndexOf(a), j = texto.IndexOf(f);
if (i < 0 || j < 0) return null;
return texto[(i + a.Length)..j];   // ArgumentOutOfRangeException se j < i
```

Os dois índices eram buscados do início do texto de forma independente. Quando o modelo ecoava a tag de fechamento antes da de abertura — comum quando modelos pequenos repetem o template do prompt —, o intervalo saía invertido e a requisição morria com 500. `ExtrairTagXmlRobusto` tinha a guarda; `ExtrairTagXml`, que é o usado em 8 pontos do pipeline, não tinha.

**Corrigido:** o fechamento é procurado **a partir da abertura**. Mesma correção aplicada em `ExtrairTagXmlRobusto`.

### P0-4. Tarefas presas em "gerando" para sempre

`PaginaProjeto.gerarTarefa` e `regerarTarefa` chamavam `await res.json()` **sem verificar `res.ok`**:

```ts
const data = await res.json();
if (data.tipo_resposta === "prompt_gerado") { /* ... */ }
// erro 500/503: nenhum branch roda, nenhum catch dispara
```

Em qualquer erro do backend, a tarefa ficava com `status: "gerando"` permanentemente — spinner girando, nenhuma mensagem de erro, e o estado ainda era persistido no `localStorage`, então o travamento sobrevivia ao reload. A página de projeto não tinha nenhuma superfície de erro.

**Corrigido:** cliente de API centralizado (`postApi`/`lerRespostaApi`) que trata status de erro, corpo vazio e corpo não-JSON; a tarefa volta para `aguardando`, e o erro aparece num banner e no log de atividade.

### P0-5. `dynamic` sobre tipos anônimos no endpoint de diagnóstico

```csharp
var todosOnline = resultados.All(r => r.ToString()!.Contains("online"));  // nunca usado
pipeline_pronto = resultados.Cast<dynamic>().All(r => ((string)r.status).Contains("online")),
resumo = $"{resultados.Count(r => r.ToString()!.Contains("online"))}/3 modelos dispon?veis",
```

Três problemas na mesma expressão: `todosOnline` era variável morta; a contagem do `resumo` fazia `ToString()` do objeto anônimo inteiro e procurava a substring `"online"` — então qualquer modelo cuja mensagem de erro contivesse a palavra era contado como disponível; e o `/3` era hardcoded.

**Corrigido:** `record ResultadoDiagnostico` tipado com um `bool Disponivel` explícito, contagem real e total dinâmico.

---

## P1 — Alto

### P1-1. Endpoint de diagnóstico testava os modelos errados

`/api/modelos/testar` tinha sua própria lista de 3 modelos, independente da que o `PromptController` usava. Elas já haviam divergido: o diagnóstico testava `arcee-ai/trinity-large-preview`, `llama-3.3-70b` e `mistral-small`, enquanto a etapa de geração real usava `google/gemini-2.0-flash-exp`. O endpoint podia dizer "pipeline pronto" com o modelo de geração fora do ar.

**Corrigido:** modelos centralizados em `OpenRouterOptions.Models`; o diagnóstico testa `Models.Distintos()`, que é exatamente o conjunto que o pipeline aciona.

### P1-2. Cadeia de fallback ligada por comparação de string

```csharp
var modelos = modelo == MODELOS_GERACAO_FALLBACK[0] ? MODELOS_GERACAO_FALLBACK : new[] { modelo };
```

Como triagem, detecção e análise usavam o **mesmo id** do primeiro modelo de geração, as três herdavam a cadeia de fallback por acidente. Pior: mudar o modelo preferido de geração desligaria silenciosamente o fallback dessas três etapas.

**Corrigido:** `ChamarModelo` (um modelo) e `ChamarCadeiaGeracao` (com fallback) são métodos distintos. A intenção fica no call site, não numa comparação de string.

### P1-3. `max_tokens = 2048` truncava o prompt gerado

O prompt XML da etapa de geração tem 7 seções, incluindo few-shot e critérios de aceitação. Com teto de 2048 tokens, respostas longas eram cortadas no meio — a tag `</prompt_otimizado>` sumia, `ExtrairTagXmlRobusto` retornava `null` e o sistema caía no texto bruto truncado, sem avisar ninguém.

**Corrigido:** padrão para 4096 e configurável via `OpenRouter:MaxTokens`.

### P1-4. Cancelamento do cliente era ignorado

Nenhum `CancellationToken` era propagado. Se o usuário fechasse a aba, o backend seguia executando as 7 chamadas ao OpenRouter até o fim, gastando quota por um resultado que ninguém receberia.

**Corrigido:** o token da requisição é encadeado ao timeout individual de cada chamada via `CreateLinkedTokenSource`; o cliente desistir aborta a cadeia.

### P1-5. Mensagens de exceção vazando para o cliente

`return StatusCode(500, new { erro = "Erro interno", detalhes = ex.Message })` devolvia a mensagem crua de qualquer exceção. Isso é vetor de vazamento de detalhes internos e já estava listado como risco em `current-state.md`.

**Corrigido:** exceções inesperadas são logadas com o `TraceIdentifier` e o cliente recebe apenas mensagem genérica + `trace_id` para correlacionar com o log. Erros do provedor externo continuam visíveis, porque são acionáveis.

### P1-6. Classificação de tipo sensível a caixa e acento

```csharp
return tipoStr switch { "Imagem" => ..., "Codigo" => ..., _ => tipoSugerido ?? TipoObjetivo.Outro };
```

Comparação exata de string contra a saída de modelos gratuitos. `"codigo"`, `"CODIGO"` ou `"Código"` caíam todos em `Outro`, e o pipeline seguia com temperatura, papel e critérios errados — sem erro visível, só resultado pior.

**Corrigido:** lookup case-insensitive com remoção de acentos e sinônimos comuns (`code`, `copy`, `ui`, `design`).

### P1-7. "Plano de divisão" podia abrir uma tela vazia

Se a triagem classificasse como `complexo` mas o bloco `<sub_tarefas>` viesse vazio ou malformado, o backend devolvia `plano_de_divisao` com lista vazia. O frontend trocava para a tela de projeto com zero tarefas — um beco sem saída, sem botão de volta óbvio.

**Corrigido:** sem sub-tarefas utilizáveis, o pipeline segue o fluxo simples. Complexidade fora de `baixa|media|alta` é normalizada para `media`, já que o frontend só sabe renderizar essas três.

### P1-8. Laço de parsing de perguntas com o mesmo defeito do P0-3

```csharp
int inicio = texto.IndexOf("<pergunta>", pos);
int fim    = texto.IndexOf("</pergunta>", pos);   // busca da mesma origem
```

**Corrigido:** extraído para `ExtrairPerguntas`, com o fechamento buscado a partir da abertura correspondente.

### P1-9. URL da API hardcoded no frontend

`const API = "http://localhost:5117/api/prompt"` — impossível fazer deploy sem editar o código, e conteúdo misto garantido se a página fosse servida por HTTPS.

**Corrigido:** `NEXT_PUBLIC_API_BASE_URL`, com `frontend/.env.example` e o localhost apenas como padrão de desenvolvimento.

### P1-10. `localStorage` nunca era limpo

```ts
useEffect(() => { if (queue.length > 0) localStorage.setItem(LS_KEY_QUEUE, ...); }, [queue]);
```

Apagar todas as tarefas não escrevia nada — a chave antiga permanecia e **as tarefas deletadas voltavam no reload**. Sem tratamento de `QuotaExceededError` também: prompts são longos e uma fila com histórico chega no limite de 5 MB, e a exceção subia de dentro de um `useEffect`.

**Corrigido:** helpers `salvarLocal`/`lerLocal` — valor vazio remove a chave, tudo dentro de `try/catch`, e a escrita só começa depois da hidratação, para não sobrescrever o estado salvo com os valores iniciais vazios.

### P1-11. Score "N/A" gerava SVG inválido

`parseInt("N/A")` → `NaN` → `strokeDasharray: "NaN"` no anel de score. O backend devolve `"N/A"` sempre que a validação não retorna score, então isso acontece de verdade.

**Corrigido:** `lerScore` devolve `number | null`; o anel usa offset neutro e cor cinza quando não há score. O backend também passou a limitar o score a 0–100.

---

## P2 — Corrigidos

### P2-1. Erros de lint bloqueando o gate

`npx eslint .` falhava com 2 erros (`no-explicit-any`) e 7 warnings (imports e tipos não usados). Um projeto que ainda não tem CI não pode nem ligar o gate mais barato que existe enquanto o lint está vermelho.

**Corrigido:** zero erros, zero warnings. Adicionados os scripts `typecheck` e `check` ao `package.json`.

### P2-2. Fontes carregadas por `@import` em runtime, duplicadas

`page.tsx` tinha **duas** tags `<style>` — uma em cada componente de página — cada uma com `@import url('https://fonts.googleapis.com/...')`. Um `@import` dentro de `<style>` no corpo do documento é bloqueante e não passa por nenhuma otimização do Next.

Pior: `layout.tsx` carregava Inter via `next/font` com o comentário *"Kept local to avoid external fetch delays or CORS issues on deployment"* — e a regra `*{font-family:'Syne'}` do `page.tsx` sobrescrevia Inter em tudo. O comentário descrevia o oposto do que o código fazia, e a fonte carregada nunca era usada.

**Corrigido:** Syne e JetBrains Mono passam por `next/font/google` em `layout.tsx`, expostas como variáveis CSS; o CSS global duplicado foi consolidado em `globals.css`. Inter, que era código morto, saiu.

### P2-3. CORS com origem fixa

Origem `http://localhost:3000` hardcoded. **Corrigido:** `Cors:AllowedOrigins` na configuração.

### P2-4. `UseAuthorization()` sem autenticação e `record WeatherForecast`

Middleware de autorização sem nenhum `[Authorize]` nem autenticação registrada (no-op que sugere proteção inexistente) e o `record WeatherForecast` do template `dotnet new webapi`, nunca usado. **Ambos removidos.**

### P2-5. `Console.WriteLine` como log

Nenhum nível, nenhuma estrutura, nada correlacionável. **Corrigido:** `ILogger<PromptController>` com log estruturado.

### P2-6. Nome de arquivo do download e clipboard sem fallback

Títulos vêm do LLM e podem conter `/` e `:`, inválidos em nome de arquivo. E `navigator.clipboard.writeText` lança fora de contexto seguro (testar em `http://<ip-da-lan>:3000` falhava sem qualquer aviso). **Corrigidos:** sanitização do nome e feedback explícito quando a cópia é bloqueada.

---

## Rodada 2 — Qualidade dos prompts e usabilidade

Segunda passada, focada em melhorar o produto em si e não só em consertar defeitos.

### Q-1. O gabarito XML voltava sem ser preenchido

A etapa de geração mandava um esqueleto onde cada campo continha a *instrução* do que escrever:

```xml
<restricoes_constitucionais>6 restrições NUNCA/SEMPRE específicas para Codigo.</restricoes_constitucionais>
```

Modelos pequenos ecoam esse texto em vez de substituí-lo — e o resultado, um gabarito vazio disfarçado de prompt, saía direto para o usuário. É o modo de falha mais comum de prompt-como-gabarito.

**Feito:** os campos agora usam `[colchetes]` marcados explicitamente como instrução, com uma regra crítica no system prompt e um exemplo do erro a evitar (errado × certo lado a lado). A etapa de auditoria também passou a tratar gabarito não preenchido como problema grave.

### Q-2. A validação pedia o prompt inteiro de volta

`<prompt_final>Corrija problemas reais. Se tudo ok: copie sem alterações.</prompt_final>` obrigava o modelo a reemitir todo o prompt mesmo quando não havia nada a corrigir: custo dobrado na etapa mais pesada e a maior superfície de truncamento do pipeline.

**Feito:** auditoria com diagnóstico primeiro. O validador responde `<precisa_correcao>` e só preenche `<prompt_final>` quando aponta problema real; caso contrário o prompt da geração passa intacto. No caminho feliz — a maioria — a etapa ficou muito mais barata e não há mais como perder conteúdo na cópia.

### Q-3. O executor era uma nota solta no fim da ideia

`ExecutorAlvo` virava `[EXECUTOR DO PROMPT: Claude Code — otimize a estrutura...]` colado no fim da ideia bruta. Genérico o bastante para não mudar nada: a mesma frase para Cursor, Jules e OpenHands.

**Feito:** `backend/Models/ExecutorPerfis.cs` com perfis reais. Um prompt para o Claude Code (agente de terminal que explora o repositório) declara objetivo e critérios verificáveis em vez de passo a passo; para o Cursor é curto e nomeia arquivos, pedindo diff; para o Jules é especificação completa, porque não há como perguntar durante a execução; para o OpenHands inclui setup, verificação e condição de parada. Executor desconhecido cai no perfil autocontido, mas ainda é citado pelo nome.

### Q-4. Nenhum controle sobre extensão e idioma

O usuário não tinha como pedir um prompt mais curto nem fixar o idioma de saída — relevante porque o executor final costuma ser anglófono enquanto a ideia é escrita em português.

**Feito:** **nível de detalhe** (Conciso · Equilibrado · Exaustivo), que ajusta a diretriz e o orçamento de tokens da geração, e **idioma de saída** (como escrevi · português · inglês). Ambos valem para gerar e refinar, e ficam persistidos.

### Q-5. O `/regerar` só existia na página de projeto

O endpoint de refino existe desde o início, mas o fluxo principal não o usava: para ajustar um prompt gerado na home, só recomeçando o pipeline do zero.

**Feito:** painel "Refinar este prompt" no resultado, com histórico de versões e restauração. Cada refino guarda a versão anterior com a instrução que a originou.

### Q-6. As três funcionalidades inertes

- **Arrastar para reordenar** agora funciona: `dragControls` ligado à alça, que faltava.
- **O chat falso saiu.** No lugar entrou **Contexto do projeto** — um campo persistido, injetado em toda geração de sub-tarefa via `contextoProjeto`. Resolve um problema real: sub-tarefas do plano de divisão eram geradas isoladas e perdiam a stack e as convenções do projeto que as originou. O log de atividade, que era a parte útil do chat, ficou.
- **Histórico por tarefa** agora aparece na tarefa expandida, com restaurar.

### Q-7. Cancelar geração

O backend passou a honrar `CancellationToken` na rodada 1, mas nada no frontend usava isso. Agora há botão de cancelar durante a geração, via `AbortController` — interrompe também as chamadas ao OpenRouter no backend.

### Q-8. Barra de progresso deixou de mentir

Continua sendo estimativa (o backend não reporta progresso), mas não afirma mais conclusão: sem ✓ e sem riscado nas etapas "passadas", com rótulo "estimativa" e o tempo real decorrido. Progresso medido de verdade exige streaming — segue no backlog.

### Q-9. Defeito de layout na lista de tarefas

Encontrado ao renderizar a página de projeto num navegador: cinco botões `shrink-0` numa coluna de 320px comiam a largura do texto, e o título quebrava letra a letra quando a tarefa era expandida. As ações passaram para dentro da coluna flexível e a barra lateral foi para 384px.

### Também nesta rodada

- Removidas as promessas vazias de "95%+ de força", que não significam nada operacionalmente para um modelo, substituídas por restrições concretas ("descreva o que se vê, não o que se sente"; "prefira números, nomes de arquivo e comandos a adjetivos").
- Contraste elevado nos textos auxiliares: os `text-zinc-700` sobre `#030712` (~2:1) viraram `text-zinc-500`/`400`.
- `⌘/Ctrl + Enter` gera o prompt.

---

## P2 — Pendentes (backlog)

Ordenados por retorno sobre esforço.

### 1. Nenhum teste automatizado, em lugar nenhum

Não há projeto de teste no backend nem test runner no frontend. É o maior risco estrutural do repositório: **cada uma das correções P0 acima teria sido pega por um teste unitário de 5 linhas.**

Os helpers puros já foram deixados `internal static` justamente para serem testáveis sem HTTP: `ExtrairTagXml`, `ExtrairTagXmlRobusto`, `ExtrairPerguntas`, `ExtrairSubTarefas`, `MontarIdeiaEnriquecida`, `TentarConverterTipo`.

→ backlog #3.

### 2. Nenhum CI

Sem `.github/workflows/`. Lint, typecheck e build do frontend passam hoje e não há nada impedindo que voltem a quebrar. Um workflow com `npm run check` + `dotnet build` já seria uma rede real. → backlog #8.

### 3. Rotas que gastam dinheiro estão abertas

`POST /api/prompt/gerar` não tem autenticação, autorização nem rate limiting, e cada chamada dispara até 7 requisições ao OpenRouter. Em localhost é aceitável; em qualquer ambiente exposto, é a chave da conta à disposição de quem alcançar a porta. No mínimo: `AddRateLimiter` e uma chave de API compartilhada antes de qualquer deploy.

### 4. Ids de modelo provavelmente desatualizados

Os defaults incluem `google/gemini-2.0-flash-exp:free` e `arcee-ai/trinity-large-preview:free` — modelos de preview cuja disponibilidade no OpenRouter é volátil. Não alterei os ids, porque não consigo consultar o catálogo do OpenRouter daqui e chutar id de modelo seria pior que manter o atual. Agora são configuráveis, e `GET /api/modelos/testar` confirma quais respondem. **Rodar esse endpoint é o primeiro passo recomendado.**

### 5. Progresso real do pipeline

Resolvido pela metade na rodada 2: o indicador não afirma mais conclusão e mostra o tempo decorrido, mas continua sendo estimativa. Progresso medido exige o backend transmitir cada etapa — SSE em `/api/prompt/gerar` seria a forma natural, e daria de brinde resultados parciais em vez do bloco tudo-ou-nada de hoje.

### 6. Concentração de responsabilidade

`PromptController.cs` (~900 linhas) ainda acumula validação, orquestração, prompts, integração HTTP e formatação de resposta. `page.tsx` (~1000 linhas) acumula duas páginas inteiras, cliente HTTP, persistência e apresentação. Isto é exatamente o que os backlogs #5, #6 e #7 endereçam — e o [ADR-001](../architecture/adr-001-modular-monolith-first.md) pede que seja feito em fatias revisáveis, não num rewrite. Por isso não foi tocado aqui.

### Higiene menor

- Sem `.sln` — abrir o backend no Visual Studio/Rider exige apontar para o `.csproj`.
- Sem `LICENSE`.
- Tailwind 3 num projeto Next 16, cujo template padrão já é Tailwind 4.
- `caniuse-lite` com 6 meses (`npx update-browserslist-db@latest`).
- Contraste: `text-zinc-700` sobre `#030712` fica em torno de 2:1, bem abaixo do mínimo WCAG AA de 4.5:1, e é usado em texto informativo de 9–10px. Irônico num produto que gera prompts exigindo "Acessibilidade WCAG 2.1 AA contemplada". Rótulos ARIA nos botões só de ícone foram adicionados; o contraste ficou pendente por ser decisão de design.

---

## Próximos passos sugeridos

1. **Rodar `dotnet build` no backend** — única parte deste trabalho não verificada.
2. Rodar `GET /api/modelos/testar` e trocar, na configuração, os modelos que estiverem fora.
3. Abrir o backlog #3 (fundação de testes) usando os helpers `internal static` já preparados.
4. Abrir o backlog #8 (CI) com `npm run check` + `dotnet build`.
5. Avaliar streaming (SSE) na rota de geração, que resolve progresso real e resultado parcial de uma vez.
