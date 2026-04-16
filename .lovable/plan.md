
## Diagnóstico
O elemento selecionado (linha 973 de `GanttChart.tsx`, coluna "Fim") exibe hoje:
- **P:** `task.baseline.endDate` (data planejada — fixa) ✓ correto
- **Linha principal:** `formatDateFull(endDate)` onde `endDate = task.startDate + task.duration` — isso reflete o cronograma variável **mas não a previsão recalculada pelo apontamento diário** quando ela existe.

Quando o usuário lança produção real no painel de Apontamento Diário, `applyDailyLogsToProject` (em `calculations.ts`) calcula `task.current.forecastEndDate` baseado no realizado acumulado vs meta. Esse valor já existe — só não está sendo exibido na coluna Fim do Gantt.

O rótulo também está confuso: usa `'P: '` para a linha de baixo, igual ao rótulo da baseline. Deve ser `'Prev: '` (Previsto) para deixar claro que é a previsão recalculada.

## Mudança (arquivo único)

**`src/components/GanttChart.tsx`** — linhas ~967-984 (coluna "Fim", segundo Popover):

1. Trocar a fonte da data principal por:
   ```ts
   const forecastEnd = task.current?.forecastEndDate 
                    ?? task.current?.endDate 
                    ?? endDate;
   ```
2. Renderizar `formatDateFull(forecastEnd)` em vez de `formatDateFull(endDate)`.
3. Trocar o rótulo `'P: '` por `'Prev: '` (mantém `'P: '` apenas na sublinha da baseline).
4. Tornar a cor sensível ao desvio: se `forecastEnd > baseline.endDate` → `text-destructive`, se `<` → `text-success`, senão neutro.
5. Ajustar o `Calendar` selecionado e o `handleDateChange` continuam usando `endDate` (manipulação manual da duração da tarefa), pois o forecast é derivado e não editável diretamente — o calendário ajusta o cronograma variável base, e o apontamento diário recalcula o forecast em cima dele.
6. Adicionar `title` no botão: `"Previsão atualizada pelo apontamento diário"` quando `task.current?.forecastEndDate` existir, para o usuário entender o vínculo.

## Garantias
- Sem mudança em types, calculations, ou painel de apontamento — o vínculo de dados já existia, só faltava conectar à UI.
- Drag/resize, CPM, dependências, baseline: intactos.
- Coluna "Início" continua como está (não é afetada por apontamento).
- Coluna "Desvio" (Δ) continua usando `task.duration - task.baseline.duration`, que já reflete a recalibração via apontamento (porque `applyDailyLogsToProject` ajusta `task.duration`).

## Resultado
Ao lançar produção diária no painel da tarefa, a data **Prev: dd/mm/aaaa** na coluna Fim do Gantt atualiza automaticamente — verde se adiantou, vermelha se atrasou — permitindo validar visualmente compatibilidade entre planejado e executado direto no cronograma.
