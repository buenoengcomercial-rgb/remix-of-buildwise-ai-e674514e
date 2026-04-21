

## Plano: hierarquia de colapso, estilo de níveis e indicadores de produção no Gantt

### Arquivo afetado
- `src/components/GanttChart.tsx`

### 1. Colapso hierárquico de capítulos (linhas 27, 104, 131)
- Renomear o `displayPhases` atual para `allPhases` e criar um novo `displayPhases` que filtra subcapítulos cujo pai está colapsado:
  ```ts
  const allPhases = useMemo(() => flattenPhasesByChapter(project), [project]);
  const displayPhases = useMemo(
    () => allPhases.filter(p => !p.parentId || !collapsedPhases.has(p.parentId)),
    [allPhases, collapsedPhases]
  );
  ```
- Atualizar `togglePhase` para colapsar/expandir junto todos os subcapítulos filhos (usando `allPhases`):
  ```ts
  const togglePhase = (id: string) => {
    setCollapsedPhases(prev => {
      const n = new Set(prev);
      const isCollapsing = !n.has(id);
      const children = allPhases.filter(p => p.parentId === id).map(p => p.id);
      if (isCollapsing) { n.add(id); children.forEach(c => n.add(c)); }
      else { n.delete(id); children.forEach(c => n.delete(c)); }
      return n;
    });
  };
  ```

### 2. Diferenciação visual capítulo × subcapítulo (linhas 870–880)
Reforçar o contraste entre níveis no header da fase:
- Capítulo principal: `bg-muted/70`, texto `text-[11px] font-bold`.
- Subcapítulo: `bg-muted/30 pl-6`, texto `text-[10px] font-semibold text-foreground/80`, indentação maior (`paddingLeft: 24`).

### 3. Nova coluna "Prod./Dia" na sidebar (linha 656)
- Atualizar `sidebarCols` para 11 colunas inserindo a nova coluna **entre `% Concl.` e `Dep`**:
  ```
  '24px 1fr 88px 88px 44px 22px 60px 60px 52px 48px 56px'
  ```
  *(ajustar `sidebarWidth` em ~+60px para `~646`)*
- Adicionar no cabeçalho (após `% Concl.`, antes de `Dep`):
  ```tsx
  <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider text-center"
        title="Produção diária planejada vs realizada">Prod/Dia</span>
  ```
- Adicionar a célula na linha de cada tarefa (após o bloco de `% Concluído`, antes de `Dep`), exibindo:
  - Linha 1: `plannedDaily = task.quantity / task.duration` em cinza.
  - Linha 2: média real dos `dailyLogs` com `actualQuantity > 0`, em verde se ≥ planejado, vermelho se abaixo.
  - Mostra `—` quando não há `quantity`.

### 4. Badge de previsão de atraso na coluna "% Concl." (linhas 1130–1152)
Criar helper `calcForecastDelay(task)`:
```ts
const logs = (task.dailyLogs||[]).filter(l => (l.actualQuantity ?? 0) > 0);
const executed = logs.reduce((s,l)=>s+l.actualQuantity,0);
const remaining = (task.quantity||0) - executed;
const avgDaily = logs.length ? executed/logs.length : 0;
const daysNeeded = avgDaily>0 ? Math.ceil(remaining/avgDaily) : null;
return daysNeeded!=null ? daysNeeded - (task.duration - logs.length) : null;
```
Renderizar abaixo do `pct` um pequeno badge `+Xd` (vermelho) ou `-Xd` (verde) quando `delay !== 0`.

### 5. Indicador de ritmo na barra do Gantt (linha 1523, dentro do `<div>` da barra)
Adicionar uma faixa vertical de 4px no canto direito da barra quando houver apontamentos:
```tsx
{(() => {
  const logs = (task.dailyLogs||[]).filter(l => (l.actualQuantity ?? 0) > 0);
  if (!logs.length || !task.quantity || !task.duration) return null;
  const planned = task.quantity / task.duration;
  const real = logs.reduce((s,l)=>s+l.actualQuantity,0)/logs.length;
  const onPace = real >= planned;
  return (
    <div className="absolute top-0 right-0 h-full"
         style={{ width:4, background: onPace?'#166534':'#991b1b', opacity:0.85, borderRadius:'0 6px 6px 0' }}
         title={onPace?'Ritmo no prazo':`Ritmo: ${((real/planned)*100).toFixed(0)}% do planejado`} />
  );
})()}
```

### 6. Verificação
- Colapsar capítulo principal → subcapítulos somem junto com suas tarefas.
- Subcapítulos visualmente recuados e mais claros.
- Coluna `Prod/Dia` aparece com valores planejado/real e cor por desempenho.
- Tarefas com apontamento mostram badge `+Xd` na % concl. e faixa colorida no fim da barra.

### Resultado esperado
Gantt mais hierárquico, com colapso correto, leitura visual clara dos níveis e novas métricas de produção diária e desvio de prazo diretamente na linha da tarefa.

