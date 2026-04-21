

## Plano: corrigir setas de dependência e drag em barras pequenas

### Arquivos
- `src/components/GanttChart.tsx`
- `src/components/gantt/DependencyArrows.tsx`

### 1. `taskYPositions` — somar altura do header do capítulo (GanttChart.tsx, linhas 152–167)

Hoje o `useMemo` declara `PHASE_HEADER_HEIGHT` mas **nunca incrementa `y` por ele**, então as setas saem deslocadas para cima a cada capítulo. Corrigir para acumular `y += PHASE_HEADER_HEIGHT` no início de cada `phase` (independente de estar colapsada — o header sempre é renderizado).

```ts
const PHASE_HEADER_HEIGHT = ROW_HEIGHT + 20;
let y = 0;
displayPhases.forEach(phase => {
  y += PHASE_HEADER_HEIGHT;
  if (!collapsedPhases.has(phase.id)) {
    phase.tasks.filter(...).forEach(task => {
      map.set(task.id, y + ROW_HEIGHT / 2);
      y += ROW_HEIGHT;
    });
  }
});
```

### 2. `DependencyArrows.tsx` — fórmula de X explícita por tipo

O arquivo atual já cobre os 4 tipos (TI/II/TT/IT) e usa `diffDays`/`dayWidth` corretos, mas vamos padronizar com nomes claros (`xPredLeft/xPredRight/xSuccLeft/xSuccRight`) e remover o import não usado de `addDays`. Garante que origem/destino seguem exatamente a lateral correta da barra (mesma fórmula que o `barLeft`/`barWidth` usa em `GanttChart.tsx`).

### 3. Drag em barras de 1 dia (GanttChart.tsx, `onMouseDown` linha 1493)

Atualmente, com barra de largura `dayWidth` (~24px no modo dias), as duas zonas de resize de 8px ocupam quase tudo e o drag só dispara num pixel central — frequentemente falha. Mudar para zona de resize **adaptativa**:

- Se `barW <= 24px`: zona de resize = 0 (toda a barra é drag).
- Caso contrário: 8px de cada lado, mas o resize esquerdo só dispara se `barW > dayWidth`.

### 4. Cursor coerente (`onMouseMove` linha 1505)

Aplicar a mesma regra: barras pequenas mostram sempre `grab`; barras maiores mostram `col-resize` apenas nas zonas de 8px.

### 5. Tooltip nativo na barra

Adicionar `title={"<inicio> → <fim> | <duracao>d — Arraste para mover"}` no `<div>` da barra (linha ~1469), usando `formatDateFull` + `getEndDate`. Útil principalmente em barras estreitas onde o label não cabe.

### Resultado esperado
- Setas de dependência partem e chegam exatamente no meio vertical das barras corretas, mesmo com vários capítulos abertos/fechados.
- Origem/destino horizontal das setas alinham com as bordas reais das barras conforme o tipo (TI/II/TT/IT).
- Em barras de 1 dia o usuário consegue arrastar normalmente e vê tooltip com datas.
- Resize continua funcionando intacto em barras maiores.

