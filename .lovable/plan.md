
## Objetivo
Adicionar uma camada de **apontamento diário de produção** que registra execução real por dia, calcula defasagem, propaga saldo, recalcula a duração restante e ajusta a previsão de término — refletindo no Gantt sem quebrar RUP, CPM, dependências, drag e resize.

## Modelagem (`src/types/project.ts`)

Nova interface:
```ts
export interface DailyProductionLog {
  id: string;
  date: string;            // ISO yyyy-mm-dd
  plannedQuantity: number; // meta do dia (snapshot da produção diária planejada)
  actualQuantity: number;  // executado no dia
  notes?: string;
}
```

Novos campos opcionais em `Task` (todos derivados, salvo `dailyLogs`):
- `dailyLogs?: DailyProductionLog[]`
- `executedQuantityTotal?: number`
- `remainingQuantity?: number`
- `accumulatedDelayQuantity?: number` (positivo = atraso)
- `recalculatedDuration?: number`
- `forecastEndDate?: string`
- `physicalProgress?: number` (% real = executado/quantidade)

Nada disso quebra estruturas existentes (campos opcionais).

## Cálculos (`src/lib/calculations.ts`)

Nova função `applyDailyLogsToProject(project)`:
- Para cada tarefa com `quantity > 0`:
  - `plannedDailyProduction = quantity / duration`
  - `executedQuantityTotal = Σ actualQuantity`
  - `remainingQuantity = max(0, quantity - executedQuantityTotal)`
  - `accumulatedDelayQuantity = Σ (plannedQuantity − actualQuantity)` dos logs
  - `daysConsumed = nº de logs`
  - `remainingDuration = ceil(remainingQuantity / plannedDailyProduction)`
  - `recalculatedDuration = daysConsumed + remainingDuration`
  - `forecastEndDate = startDate + recalculatedDuration` (em dias úteis usando `calcularDiasUteis`/feriados, consistente com o cronograma)
  - `physicalProgress = min(100, executedQuantityTotal / quantity * 100)`
  - Se `dailyLogs` existir e `!isManual`, **ajustar `duration = recalculatedDuration`** para que CPM e Gantt expandam/encolham automaticamente.
  - Atualizar `percentComplete = physicalProgress` (mantendo behavior legado quando não há logs).

Pipeline em `src/pages/Index.tsx`:
```
calculateCPM(applyDailyLogsToProject(applyRupToProject(rawProject)))
```

Como `duration` é recalculada antes do CPM, dependências TI/II/TT/IT propagarão automaticamente.

## UI — EAP (`src/components/TaskList.tsx`)

1. **Indicadores na linha da tarefa:**
   - Badge de saldo acumulado (verde / amarelo / vermelho conforme `accumulatedDelayQuantity` vs threshold = `plannedDailyProduction`).
   - Mostrar `forecastEndDate` ao lado da data planejada quando divergir.
   - Substituir % planejado por % físico real quando houver logs.

2. **Painel expansível de Apontamento Diário** (novo botão ao lado do RUP, ícone `ClipboardList`):
   - Tabela: Data | Meta | Realizado | Saldo Dia | Saldo Acumulado | Obs.
   - Linhas coloridas (verde/amarelo/vermelho) por `dailyDelta`.
   - Botão **"+ Lançamento"**: abre linha nova preenchendo `date = hoje`, `plannedQuantity = plannedDailyProduction`, `actualQuantity = 0`.
   - Editar/excluir lançamento inline; ao salvar dispara `onProjectChange` que recalcula tudo.

## UI — Gantt (`src/components/GanttChart.tsx`)

- Usar `recalculatedDuration` (já aplicada a `duration`) → barra estende/encolhe sozinha.
- Tooltip da barra: mostrar **Previsão**, **Saldo acumulado**, **% físico real**.
- Marcador visual (linha pontilhada na ponta direita da barra original) indicando `forecastEndDate` quando diferente do planejado original — usaremos `manualDuration`/snapshot armazenado no primeiro log para referência.

## Cores de status diário
- `dailyDelta ≤ 0` → verde
- `0 < dailyDelta ≤ 20% da meta` → amarelo
- `dailyDelta > 20%` → vermelho
- Mesma escala aplicada ao badge de saldo acumulado da tarefa.

## Garantias
- `dailyLogs` opcional → tarefas sem logs comportam-se exatamente como hoje.
- `isManual` continua intocável (apontamento ignora se usuário fixou duração manual).
- RUP roda antes; apontamento sobrescreve `duration` apenas quando há logs.
- CPM recebe a duração recalculada → dependências, datas finais e setas ficam consistentes.
- Drag/resize do Gantt continuam editando `startDate`/`duration`; novos lançamentos disparam recálculo automático no próximo render.
- Persistência automática via `localStorage` já existente cobre `dailyLogs`.

## Resultado esperado
Cada tarefa expõe um diário de produção. Ao registrar a execução do dia, o sistema mostra defasagem, acumula saldo, recalcula duração restante, ajusta a previsão de término e move automaticamente as tarefas dependentes no Gantt.
