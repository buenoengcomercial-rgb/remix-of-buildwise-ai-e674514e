
Objetivo: corrigir a inconsistência entre a data FIM exibida e a geometria da barra no Gantt, sem quebrar CPM/dependências.

Diagnóstico
- O problema principal está em `src/components/GanttChart.tsx`: a barra usa hoje `width = (task.duration + 1) * dayWidth`.
- Isso está errado para a convenção que você aprovou: `fim = startDate + duration - 1`.
- Exemplo: duração `1` dia deve ocupar exatamente `1` célula no Gantt, não `2`.
- Além disso, alguns tooltips/cálculos visuais ainda usam `addDays(..., duration)` e continuam pensando no “dia seguinte”, então a UI fica metade em regra antiga e metade em regra nova.

Plano de correção
1. Corrigir a largura da barra principal
- Em `GanttChart.tsx`, voltar a largura para:
  - `width = task.duration * dayWidth`
- Essa é a largura correta quando a duração já representa a quantidade de dias trabalhados de forma inclusiva.

2. Unificar todos os cálculos visuais de “data fim” no Gantt
- Onde o Gantt mostra ou calcula fim visual, usar a convenção inclusiva:
  - `getEndDate(task.startDate, task.duration)`
  - ou equivalente a `duration - 1`
- Ajustar especialmente:
  - tooltip de drag (`getDragDate`)
  - preview de resize (`getResizeInfo`)
  - faixa/alcance visual de capítulos (`getPhaseRange`, `getChapterBarInfo`, e extensão do gráfico se necessário)

3. Não mexer na lógica de CPM/dependência
- Manter a lógica interna de precedência/CPM como está hoje para relações TI:
  - sucessora começa no dia seguinte ao último dia trabalhado da predecessora
- Ou seja:
  - visual/exibição usa “último dia trabalhado”
  - precedência continua com a semântica operacional atual
- Isso evita quebrar propagação e caminho crítico.

4. Revisar entradas manuais de data fim
- Em `handleDateChange` e edição de baseline, recalcular duração com regra inclusiva:
  - `newDuration = diffDays(start, end) + 1`
- Hoje alguns trechos ainda usam `diffDays(start, end)` puro, o que pode recriar o erro ao editar datas manualmente.

Arquivos a ajustar
- `src/components/GanttChart.tsx`
  - `getBarStyle`
  - `getDragDate`
  - `getResizeInfo`
  - helpers visuais de fase/faixa do gráfico
  - eventuais cálculos de duração ao editar início/fim
- Opcionalmente validar coerência com:
  - `src/components/gantt/utils.ts` (`getEndDate` já está correto)

Resultado esperado
- Tarefa de 1 dia começa e termina no mesmo dia na coluna FIM e também na barra.
- A barra de “Furo mecanizado” passa a terminar exatamente no mesmo dia mostrado na coluna lateral.
- Drag, resize e labels de data deixam de mostrar um dia a mais.
- CPM e dependências continuam funcionando sem regressão.

Detalhe técnico importante
- O erro não é “a data não atualizou”; a data já foi corrigida.
- O que ficou errado foi a geometria do Gantt, porque a barra foi expandida artificialmente em `+1 dayWidth`.
- Então a correção certa é alinhar toda a camada visual ao mesmo conceito de fim inclusivo, sem tocar na semântica de precedência.
