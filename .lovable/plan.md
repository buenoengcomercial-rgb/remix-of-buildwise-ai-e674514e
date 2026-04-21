

## Plano: sistema de múltiplos projetos (obras) no ObraPlanner

### Objetivo
Permitir que o usuário gerencie várias obras independentes no mesmo navegador, alternando entre elas pelo sidebar e criando novas a qualquer momento. Cada projeto tem seu próprio armazenamento isolado no `localStorage`.

### Arquivos afetados
- **NOVO** `src/lib/projectStorage.ts` — camada de persistência multi-projeto.
- `src/pages/Index.tsx` — substituir `loadProject`/`STORAGE_KEY` pelo novo storage.
- `src/components/AppSidebar.tsx` — adicionar seletor de projetos com criar/trocar.

---

### 1. `src/lib/projectStorage.ts` (novo)

API exportada:
- `ProjectMeta` — `{ id, name, createdAt, updatedAt }`.
- `listProjects()` — lê o índice (`obraplanner-projects-index`).
- `loadProject(id)` — lê `obraplanner-project-<id>`.
- `saveProject(project)` — grava o projeto e atualiza o índice (insere ou atualiza meta + `updatedAt`).
- `deleteProject(id)` — remove projeto e seu meta.
- `getActiveProjectId()` / `setActiveProjectId(id)` — chave `obraplanner-active-project`.
- `createNewProject(name)` — cria projeto vazio (`phases: []`, `totalBudget: 0`, `startDate`/`endDate` = hoje), salva e devolve.
- `initProjects()` — inicializa:
  - Se índice vazio: migra a chave antiga `obra-project-data` (do `Index.tsx` atual). Se não houver, usa `sampleProject`. Garante `id`.
  - Carrega projeto ativo; fallback para o primeiro do índice.

Migração: na primeira execução pós-deploy, o projeto que já está em `obra-project-data` é convertido em entrada do novo índice — nenhum dado é perdido.

### 2. `src/pages/Index.tsx`

- Remover `STORAGE_KEY` e a função `loadProject` local.
- `useState<Project>(() => initProjects())`.
- `useEffect` passa a chamar `saveProject(rawProject)` (que também atualiza o meta).
- Adicionar handlers:
  - `handleSwitchProject(id)` — `loadProject` + `setActiveProjectId` + `setRawProject`.
  - `handleCreateProject(name)` — `createNewProject` + ativar + setar como atual.
- Passar `onSwitchProject`, `onCreateProject`, `activeProjectId={rawProject.id}` ao `AppSidebar`.

### 3. `src/components/AppSidebar.tsx`

- Estender props: `onSwitchProject`, `onCreateProject`, `activeProjectId`.
- Adicionar bloco "Seletor de projetos" logo abaixo do header do logo:
  - Botão expandível (ícone `FolderOpen` + nome do projeto atual + chevron). Quando colapsado (sidebar mini), mostra só o ícone com `title`.
  - Lista de obras (`listProjects()`): item ativo destacado em `bg-primary text-primary-foreground`; demais com hover. Clique troca de projeto e fecha o painel.
  - Linha "Nova obra" (`Plus`) → entra em modo edição inline com `<input>` + botão OK. `Enter` confirma, `Esc` cancela.
- Atualizar a lista local após criar (`setProjects(listProjects())`) e ao abrir o painel.

### Comportamento esperado
- Ao trocar de obra, todas as views (Dashboard, Gantt, EAP, Compras) re-renderizam com os dados da obra selecionada — `useMemo` em `Index.tsx` recalcula CPM/RUP/baseline automaticamente porque `rawProject` muda.
- Persistência total no `localStorage`: refresh da página mantém a obra ativa e os dados intactos.
- Memória existente (`Persistência automática no localStorage`) continua válida — agora multi-projeto.

### Não incluído nesta entrega
- Exclusão de projeto pela UI (a função existe no storage, mas não há botão — pode ser próxima iteração).
- Renomear obra a partir do sidebar (continua editável dentro de `ConfiguracaoObra`).
- Sincronização entre abas do navegador (`storage` event listener).

