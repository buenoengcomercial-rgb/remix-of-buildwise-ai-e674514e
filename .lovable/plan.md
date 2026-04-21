

## Plano: enxugar EAP — remover colunas, compactar linhas e mover info técnica para o painel RUP

### Arquivo afetado
- `src/components/TaskList.tsx`

### 1. Cabeçalho da tabela (linha 741) e linha de tarefa (linha 783)
Substituir o `gridTemplateColumns` atual (13 colunas) por **9 colunas**:
```
'36px 2.5fr 90px 100px 80px 90px 80px 120px 80px'
```
Ordem: `EQ. | TAREFA | QTD. | PROD./DIA | DURAÇÃO | GARGALO | DEPEND. | PROGRESSO | AÇÕES`.

Remover do header (linhas 742–754) os `<div>` de **Responsável**, **Horas**, **Folga** e **Status**.

Na linha de tarefa (linhas 785–1011) remover os blocos `Responsável` (854–868), `Horas` (904–907), `Folga` (921–926) e `Status` (982–985).

### 2. Coluna TAREFA (linhas 803–825)
Remover o `<GripVertical>` (linha 805). Drag continua funcionando — o `draggable` está no `<div>` da linha (linha 769).

### 3. Coluna DURAÇÃO (linhas 870–902)
Simplificar:
- Mostrar `{task.duration}d` sempre.
- Renderizar o `<AlertTriangle>` apenas quando `task.baseline` existe e `Math.abs(task.duration - task.baseline.duration) > 2`.
- Remover o badge `Δ +Xd` da visualização. O conteúdo do tooltip (Base / Previsto / Desvio / Saldo / Executado) é movido para um `Tooltip` envolvendo o próprio `{task.duration}d`.

### 4. Linha da tarefa (linha 779)
- Adicionar classe `group` à `className`.
- Reduzir padding vertical: `py-2.5` → `py-1.5`.

### 5. Coluna AÇÕES (linhas 987–1011)
Reorganizar para sempre exibir **Apontamento** e **Excluir**, e mostrar **Editar** e **Duplicar** apenas no hover via `hidden group-hover:flex`. Manter o estado "salvar" (Check) quando `isEditing`.

### 6. Cabeçalho do capítulo (linhas 646–734)
- `py-4` → `py-2.5` (linha 659).
- Remover a barra de progresso duplicada (linhas 716–718) — manter só o `{phaseProgress}%`.
- Mover o dropdown "Mover para capítulo" (linhas 573–593, dentro de `renderActionButtons`) para dentro do bloco de edição: passa a aparecer **somente quando `editingPhase === phase.id`**, ao lado do input de renomear (linhas 699–712). Quando não estiver editando, o dropdown fica oculto.
- Manter número, nome, contagem de tarefas, percentual e botão de colapsar.

### 7. Painel RUP expandido (linha 1025) — adicionar resumo técnico
Inserir, no início de `<div className="px-8 py-3 space-y-3">`, um grid 4 colunas com Responsável, Horas, Folga e Desvio (calculado de `task.baseline`):
```tsx
<div className="grid grid-cols-4 gap-2 mb-3 p-2 bg-muted/30 rounded text-[10px]">
  <div><span className="text-muted-foreground">Responsável:</span> {task.responsible || '—'}</div>
  <div><span className="text-muted-foreground">Horas:</span> {Math.round(task.totalHours || task.duration * DAILY_HOURS)}h</div>
  <div><span className="text-muted-foreground">Folga:</span> {task.float !== undefined ? `${task.float}d` : '—'}</div>
  <div><span className="text-muted-foreground">Desvio:</span> {task.baseline ? `${task.duration - task.baseline.duration > 0 ? '+' : ''}${task.duration - task.baseline.duration}d` : '—'}</div>
</div>
```

### 8. Limpeza de imports
Remover `User` do import de `lucide-react` (linha 4) — fica órfão após sair a coluna Responsável. `GripVertical` continua sendo usado no cabeçalho do capítulo (linha 662).

### Resultado esperado
- Tabela com 9 colunas em vez de 13, dando muito mais espaço para o nome da tarefa.
- Linhas mais compactas (`py-1.5`) → mais tarefas visíveis sem scroll.
- Editar/Duplicar aparecem só no hover; Apontamento e Excluir sempre visíveis.
- Cabeçalho do capítulo enxuto, sem barra duplicada; dropdown de capítulo-pai só no modo edição.
- Informações técnicas (responsável, horas, folga, desvio detalhado) ficam no painel RUP expandido — ainda acessíveis ao clicar na tarefa.

