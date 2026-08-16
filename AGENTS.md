# AGENTS.md

Instruções para agentes de código que trabalham neste repositório.

---

## Regra: documentos de trabalho ficam locais

**Auditorias, relatórios, análises e anotações de trabalho NÃO são versionados.**
Eles descrevem um momento — ficam obsoletos rápido, poluem o diff e o histórico,
e frequentemente carregam contexto interno que não deve ir para o GitHub.

### O que fica **local** (ignorado pelo git)

| Padrão | Exemplos |
| --- | --- |
| `docs/audit/` | relatórios de auditoria de código, segurança, performance |
| `docs/notes/`, `.notes/` | anotações de investigação, rascunhos |
| `*.local.md` | `plano.local.md`, `analise.local.md` |
| `AUDITORIA*.md`, `AUDIT*.md` | relatórios na raiz |
| `RELATORIO*.md`, `ANALISE*.md` | relatórios e análises |
| `NOTES.md`, `TODO.local.md`, `SCRATCH.md` | anotações soltas |
| `scratch/`, `tmp/` | arquivos de trabalho |

### O que **continua versionado**

Documentação que é contrato do projeto, não registro de um momento:

- `README.md` — como rodar e configurar
- `docs/architecture/` — ADRs, current state, target state
- `AGENTS.md`, `CONTRIBUTING.md`, `LICENSE`
- Documentação de API e de schema

### Como aplicar

1. Ao produzir uma auditoria, relatório ou análise, grave em `docs/audit/` ou
   com sufixo `.local.md`. **Não faça `git add` desses arquivos.**
2. Se um documento desse tipo já estiver versionado, remova do índice
   preservando o arquivo em disco:

   ```bash
   git rm --cached -r docs/audit/
   ```

3. Achados que precisam sobreviver ao relatório viram **issue, ADR ou comentário
   no código** — não um markdown solto no repositório.
4. Ao citar um relatório local numa mensagem de commit ou PR, resuma o conteúdo
   relevante ali mesmo. Nunca linke um caminho que o leitor não tem.

### Por quê

O relatório é o andaime, não a obra. O que importa dele — a correção, a decisão,
o teste de regressão — precisa estar no código ou num ADR. O documento em si é
descartável, e versioná-lo cria a ilusão de que está sempre atualizado.

---

## Verificações antes de entregar

```bash
# Frontend: tipos, lint, testes e build
cd frontend && npm run check

# Backend: build e testes
dotnet build backend/ApiAssistente.csproj
dotnet test  backend/tests/ApiAssistente.Tests/ApiAssistente.Tests.csproj
```

Nunca reporte uma mudança como pronta sem rodar o que dá para rodar no ambiente,
e diga explicitamente o que **não** foi possível verificar.

---

## Convenções do projeto

- **Encoding: UTF-8, sempre.** Os arquivos do backend já foram corrompidos uma
  vez por um editor gravando em code page local — acentos viraram `?` e `U+FFFD`
  dentro dos prompts enviados ao LLM, degradando o produto sem nenhum erro
  visível. O `.editorconfig` fixa `charset = utf-8`; não o contrarie.
- **Segredos nunca em arquivo rastreado.** `OpenRouterApiKey` vem de variável de
  ambiente, `dotnet user-secrets` ou `appsettings.Development.json` local.
- **Refatoração em fatias.** O [ADR-001](docs/architecture/adr-001-modular-monolith-first.md)
  pede mudanças do tamanho de uma issue, não rewrites. Respeite isso mesmo
  quando o arquivo estiver grande.
- **Contrato da API é estável.** Os nomes de campo em snake_case
  (`tipo_resposta`, `prompt_otimizado`, `score_qualidade`) são consumidos pelo
  frontend; mudanças exigem atualizar os dois lados no mesmo commit.
- **Helpers puros ficam testáveis.** Parsing, normalização e formatação vivem em
  métodos `internal static` (backend) ou em `src/lib/` (frontend), fora dos
  componentes e do controller.
