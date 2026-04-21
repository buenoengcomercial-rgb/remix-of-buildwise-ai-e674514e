

## Plano: validações de mover capítulos + correção do bug de lentidão e drag travado

### Parte 1 — Corrigir lentidão e drag travado

**Sintomas reportados**
- Cliques (expandir/recolher tarefas, subcapítulos, capítulos) ficaram lentos.
- Não é mais possível mover tarefas/subcapítulos com o cursor — tudo fica estático.

**Causas prováveis identificadas**
1. Em `GanttChart.tsx`, o `useMemo` de `tasks` (`getAllTasks`) e os derivados (`projectStart`, `taskYPositions`, `flatTasks`, `taskNumbering`, `chapterNumbering`, `violationMap`) recomputam a cada render porque `tasks` é recriado fora de `useMemo`. Em projetos grandes isso degrada cada toggle.
2. Os handlers de drag de capítulo adicionados em `TaskList.tsx` (`handleChapterDragOver`, `handleChapterDragStart`) usam `e.stopPropagation()` e estão atachados em containers que envolvem também as linhas de tarefa — bloqueando o drag das tarefas filhas (HTML5 DnD não convive com mouse-drag manual quando o pai captura `dragstart`).
3. `flattenPhasesByChapter` e `getChapterNumbering` são chamados sem memo em locais quentes (cards do Dashboard/Purchases/TaskList) → cada toggle dispara revarredura.

**Correções**

A. `src/components/GanttChart.tsx`
- Envolver `tasks = getAllTasks(project)` em `useMemo([project])`.
- Envolver `projectStart`, `projectEnd`, `totalDays`, `chartWidth` em `useMemo` dependendo de `tasks`.
- Garantir que `displayPhases` (já memoizado) seja a única fonte usada em loops de render.
- Confirmar que `handleMouseDown` da barra Gantt não está dentro de elemento com `draggable` (o handler chapter-drag não deve existir no Gantt; checar e remover se houver).

B. `src/components/TaskList.tsx`
- Restringir `draggable` e os handlers `onDragStart/onDragOver/onDrop` de capítulo APENAS ao "header" da linha do capítulo (ícone `GripVertical` + nome), não ao container que envolve as tarefas filhas.
- Remover `e.stopPropagation()` dos handlers de capítulo que envolvem áreas com tarefas; usar `e.dataTransfer.types` para diferenciar payload "chapter" vs "task" via `e.dataTransfer.setData('application/x-chapter-id', id)`.
- Memoizar `getChapterTree(project)` e `getChapterNumbering(project)` com `useMemo([project.phases])`.
- Garantir que toggles (`togglePhase`, `setExpandedRup`, `setExpandedDaily`) não disparem `onProjectChange` (apenas estado local).

C. `src/components/Dashboard.tsx` e `src/components/Purchases.tsx`
- Memoizar chamadas a `getChapterTree`/`getChapterNumbering` para evitar recomputação a cada render.

### Parte 2 — Validação automática ao mover capítulos/subcapítulos

**Regra**
Antes de aplicar `moveChapter` (dropdown ou drag-and-drop), executar verificação:

1. Coletar todas as tarefas do capítulo movido (`getChapterTasks`).
2. Para cada tarefa do capítulo movido E para cada tarefa que depende dela, rodar `checkDependencyViolation` simulando o novo agrupamento.
3. Considerar violação também quando:
   - Um subcapítulo movido para outro pai mantém dependências cruzadas com tarefas do pai antigo cujo período agora ficaria invertido.
   - Mover quebra a ordem visual da numeração se houver dependência apontando para tarefa de número maior dentro do mesmo capítulo de destino (somente alerta, não bloqueia).

**UX**
- Se houver violação dura (datas que ficariam inválidas): bloquear o drop e exibir `toast.error("Movimentação bloqueada: tarefa X depende de Y (TI)")` com ação "Forçar mesmo assim" que remove a dependência conflitante e aplica a movimentação (mesmo padrão já usado no drag de barra do Gantt).
- Se houver apenas alerta (dependências cruzadas válidas mas suspeitas): exibir `toast.warning(...)` informativo e aplicar normalmente.
- Em ambos os casos, atualizar `parentId`/`order` somente após confirmação.

**Implementação**
- Novo helper em `src/lib/chapters.ts`:
  ```ts
  export function validateChapterMove(
    project: Project,
    chapterId: string,
    newParentId: string | null,
  ): { blocked: boolean; warnings: string[]; violations: Array<{ taskId: string; predId: string; type: DependencyType }> }
  ```
  Usa `checkDependencyViolation` de `calculations.ts`.
- Novo wrapper `safeMoveChapter(project, chapterId, newParentId, { force?: boolean })` que chama `validateChapterMove` e retorna `{ project, blocked, warnings }`.
- Em `TaskList.tsx`, `handleMoveChapter` passa a usar `safeMoveChapter` e dispara o toast com botão "Forçar".

### Arquivos afetados
- `src/lib/chapters.ts` (adicionar `validateChapterMove` + `safeMoveChapter`)
- `src/components/TaskList.tsx` (drag handlers restritos, memoização, integração com validação)
- `src/components/GanttChart.tsx` (memoização de `tasks` e derivados)
- `src/components/Dashboard.tsx` (memoização)
- `src/components/Purchases.tsx` (memoização)

### Resultado esperado
- Cliques em capítulos/subcapítulos/tarefas voltam a ser instantâneos.
- Drag de tarefas com o mouse no Gantt e drag de capítulos no TaskList voltam a funcionar — sem se atrapalharem.
- Mover capítulo/subcapítulo que quebraria dependências exibe toast bloqueante com opção de forçar; movimentos seguros aplicam direto.

