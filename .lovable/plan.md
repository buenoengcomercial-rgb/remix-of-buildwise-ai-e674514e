

## Plano: Remover coluna Duração, redistribuir espaços e reposicionar badge

### 1. Remover coluna DURAÇÃO e redistribuir larguras
Em `src/components/GanttChart.tsx`:

| Coluna | Antes | Depois |
|---|---|---|
| Drag handle | 24px | 24px |
| Nome (EAP) | 1fr | 1fr |
| Equipe | 58px | 36px |
| Crítica (!) | 20px | 22px |
| Início | 88px | 92px |
| Fim | 88px | 92px |
| ~~Duração~~ | ~~58px~~ | **removida** |
| % Concl. | 48px | 56px |
| Dep | 48px | 52px |
| Ações | 56px | 60px |

- `sidebarCols`: `'24px 1fr 36px 22px 92px 92px 56px 52px 60px'` (9 colunas)
- `sidebarWidth`: `562` (era 620 — libera 58px da Duração e redistribui)
- Remover header "Duração", célula do input de duração + sufixo "d" das linhas de tarefa, e célula equivalente das linhas de fase
- Duração continua calculada internamente (CPM/datas) — apenas sai da UI

### 2. Reposicionar badge de % no Gantt
- Posição X: `left = (offsetDays * dayWidth) + 8px` (afasta horizontalmente do ponto do último apontamento)
- Posição Y: `top: -16px` (eleva acima da linha tracejada e da barra)
- Remover `transform: translateX(-50%)` — ancora pela borda esquerda
- Manter cores semânticas (azul/verde no prazo, vermelho atrasado) e `drop-shadow` branco
- Esconder badge se não houver apontamentos diários

### 3. Espaçamento vertical das linhas
- Manter altura atual das linhas (sem alteração) — o problema relatado é horizontal
- Garantir que header, linhas de fase e linhas de tarefa usem o **mesmo** novo `sidebarCols` para alinhamento perfeito

### Arquivo afetado
- `src/components/GanttChart.tsx` (somente)

### Resultado esperado
- Sidebar mais limpa sem coluna Duração e sem o "d" desalinhado
- Colunas Início/Fim/% Concl./Dep/Ações com folga visual extra
- Badge de % afastado e elevado em relação ao último apontamento, sem poluir barra nem linha tracejada

