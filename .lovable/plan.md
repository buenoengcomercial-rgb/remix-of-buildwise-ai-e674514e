
## Contexto

A linha pontilhada de "dias trabalhados" já foi removida na rodada anterior. Restam então 2 ajustes do plano original ainda pendentes + legenda:

1. **Bug de fuso horário**: a barra cheia usa `new Date(task.baseline.startDate)` (linha 1483), que interpreta `'2026-05-14'` como UTC e desloca 1 dia no Brasil. Mesmo problema nos marcadores diários (linha 1454: `new Date(log.date)`).
2. **Barra fininha (14px)**: pouco visível.
3. **Sem legenda**: usuários não sabem o que cada elemento representa.

## Mudanças (apenas em `src/components/GanttChart.tsx`)

### A) Corrigir vínculo de datas (timezone-safe)
- Linha 1454: `new Date(log.date)` → `parseISODateLocal(log.date)`
- Linha 1483: `new Date(task.baseline.startDate)` → `parseISODateLocal(task.baseline.startDate)`
- Verificar se `parseISODateLocal` já está importado de `./gantt/utils`; se não, adicionar ao import.

Resultado: a barra cheia da tarefa "Suporte de Fixação" começa exatamente sob a coluna **14/05** e termina em **19/05**, sem deslocamento de 1 dia.

### B) Deixar a barra mais robusta
- Linha 1497: `height: 14` → `height: 20`
- Linha 1496: `top: 12` → `top: 9` (mantém centralização vertical num row de 32px: 9 + 20 = 29, sobra 3 acima e 3 abaixo)
- Linha 1513: `opacity: isDragPropagated ? 0.75 : 0.85` → `opacity: isDragPropagated ? 0.85 : 0.95`
- Linha 1471: marcadores diários `top: 28` → `top: 30` (para não colidir com a barra mais alta)

### C) Adicionar legenda visual
Localizar o cabeçalho/legenda existente do Gantt (acima da grid) e acrescentar dois itens explicativos:
- **▬** Barra cheia (cor da equipe) = planejado (baseline)
- **■** Marcadores coloridos abaixo = meta vs realizado por dia (verde = ok, âmbar = leve atraso, vermelho = atraso significativo)

Se houver hoje uma legenda só de equipes, adicionar uma seção compacta "Elementos do Gantt" ao lado.

## Resultado esperado em "Suporte de Fixação"
- Barra cheia azul-Charlie alinhada exatamente em **14/05 → 19/05**
- Altura visivelmente maior (20px) e mais opaca (0.95)
- Marcadores diários (verde/âmbar/vermelho) logo abaixo, sem sobreposição
- Legenda explicando o significado de cada elemento

## Arquivo
`src/components/GanttChart.tsx` (apenas)
