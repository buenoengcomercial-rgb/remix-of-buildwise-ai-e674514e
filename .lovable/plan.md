
## Objetivo
Compactar e profissionalizar a visualização do Gantt, deixando explícitos **planejado vs real vs execução diária**, e enriquecer a tabela lateral com colunas Plan/Real/Desvio.

## Arquivos alterados

### 1. `src/components/GanttChart.tsx` — barras + marcadores
Reorganizar as 3 camadas dentro de cada linha (`ROW_HEIGHT = 32`):

- **Baseline (secundária, fina, no topo)**
  - `top: 4`, `height: 4`
  - `border-dashed border` cinza (`border-muted-foreground/40`), fundo `bg-muted/30`
  - `left/width` calculados a partir de `task.baseline.startDate` e `baseline.duration`
  - `zIndex: 5`, sem pointer-events
- **Barra real (principal, grossa, central)**
  - `top: 12`, `height: 14` (mais grossa que hoje)
  - cor da equipe (mantém lógica atual de `teamColor`)
  - usa `task.startDate` / `task.duration` (= cronograma variável)
  - mantém drag/resize/handles atuais — apenas ajustar `top`/`height`
  - se `current.duration > baseline.duration` → adicionar `ring-1 ring-red-500/60` (atraso)
  - crítico: mantém ring atual
- **Marcadores diários (abaixo da barra real)**
  - `top: 28`, `height: 3`
  - já existem; reposicionar e afinar (eram 4px → 3px)
  - mantém cores verde/amarelo/vermelho por delta

Resultado: linha compacta com 3 camadas legíveis dentro dos 32px.

### 2. Tabela lateral (mesmo arquivo)
Hoje a sidebar do Gantt mostra colunas básicas. Adicionar/reorganizar:
- **Início**: duas sublinhas pequenas — `Plan: dd/mm` (cinza) e `Real: dd/mm` (cor normal)
- **Fim**: `Plan: dd/mm` e `Prev: dd/mm`
- **Desvio**: nova coluna com badge:
  - `Δ +Nd` vermelho se `current.duration − baseline.duration > 0`
  - `Δ -Nd` verde se `< 0`
  - `0d` cinza se igual
- Largura: comprimir colunas existentes para acomodar; usar `text-[10px]` para os rótulos Plan/Real.

Localizar a render da sidebar (header + linhas de tarefa) e expandir o grid de colunas. Verificar se a sidebar é parte do `GanttChart.tsx` ou componente separado — provavelmente inline no mesmo arquivo.

### 3. Tooltip enriquecido
Já cobrimos parcialmente. Garantir formato final multi-linha:
```
{nome}
Equipe: {team}
Planejado: dd/mm/aaaa → dd/mm/aaaa
Real/Previsto: dd/mm/aaaa → dd/mm/aaaa
Desvio: ±Nd
Executado: X un
Restante: Y un
Dias trabalhados: dd/mm, dd/mm, …
```
Usar `whitespace-pre-line` (já implementado).

## Garantias
- Drag/resize continuam ancorados na barra real (top:12, height:14) — handles permanecem acessíveis.
- Baseline e marcadores são camadas visuais sem pointer-events que afetem interação.
- CPM, RUP, dependências, cores de equipe, setas: intactos.
- `task.baseline` e `task.current` já existem na modelagem — sem mudança em types/calculations.

## Resultado
Cada linha do Gantt: faixa fina tracejada (base) ▸ barra grossa colorida (real) ▸ ticks finos coloridos (execução diária). Sidebar mostra Plan/Real/Prev e Δ desvio. Tooltip consolidado.
