

## Plano: data fim e largura da barra respeitando calendário (sábado meio dia)

### Diagnóstico
- `addWorkDays(start, days, trabalhaSabado)` em `src/components/gantt/utils.ts` **já existe** e implementa a regra (domingo pula, sábado = 0.5 dia).
- `calculateRupDuration` em `src/lib/calculations.ts` já calcula `horasPorDia = horasSemana / diasUteisSemana` com sábado = ½ jornada — mantém (mais flexível que "4h fixos" e alinhado com a memória `mem://logic/calendario-e-feriados`).
- O que **não** respeita calendário hoje:
  1. `getEndDate(startDate, duration)` em `utils.ts` — soma `duration − 1` em dias corridos.
  2. `GanttChart.tsx` (sidebar coluna FIM e tooltip) chama `getEndDate` sem `trabalhaSabado`.
  3. Largura da barra (`getBarStyle`) usa `task.duration * dayWidth` direto — bate por coincidência só quando não há fim de semana no meio.

### Mudanças

**A. `src/components/gantt/utils.ts`**
1. Adicionar `getWorkEndDate(startISO, duration, trabalhaSabado)`:
   - `addWorkDays(start, duration − 1, trabalhaSabado)`.
   - Defensivo: se cair em domingo, avança para a próxima segunda.
   - Retorna ISO via `toISODateLocal`.
2. Adicionar `countWorkDays(start, end, trabalhaSabado)` para uso futuro (debug / Curva-S).
3. Substituir `getEndDate` por wrapper que delega para `getWorkEndDate`, mantendo a assinatura de 2 args como compatibilidade (default `trabalhaSabado = false` → comportamento legado), aceitando 3º arg opcional.

**B. `src/components/GanttChart.tsx`**
1. Importar `getWorkEndDate`.
2. **Sidebar coluna FIM (~linha 932)**: trocar `getEndDate(task.startDate, task.duration)` por `getWorkEndDate(task.startDate, task.duration, obraConfig.trabalhaSabado)`.
3. **Tooltip da barra (~linha 1472)**: idem.
4. **`getBarStyle`** — recalcular `width` pela data fim real:
   ```ts
   const endISO = getWorkEndDate(task.startDate, task.duration, obraConfig.trabalhaSabado);
   const endOffset = diffDays(projectStart, parseISODateLocal(endISO));
   const width = (endOffset - start + 1) * dayWidth;
   ```
   Barra cobre o intervalo calendário até o último dia útil, passando por cima dos domingos pintados em cinza.
5. Onde mais `endDate` for derivado de `task.duration` na renderização da linha, usar `getWorkEndDate` com `obraConfig.trabalhaSabado`.

**C. `src/lib/calculations.ts`** — sem mudanças (fórmula atual já correta e flexível).

### Não incluído (follow-up)
- Atualizar `captureBaseline`/`syncBaselineWithRup`/`buildCurrent` para usar `addWorkDays` — invalidaria baselines já capturadas.
- `propagateAllDependencies` (usa dias corridos via `addDaysCalc`) — mesmo motivo.

### Resultado esperado
- Coluna FIM e tooltip mostram a data correta (ex.: tarefa de 5 dias começando sexta termina na sexta seguinte, não na terça).
- Largura da barra cobre o intervalo calendário real (start até último dia útil).
- Comportamento controlado pelo toggle "Trabalha sábado?" da `ConfiguracaoObra`.

### Arquivos afetados
- `src/components/gantt/utils.ts`
- `src/components/GanttChart.tsx`

