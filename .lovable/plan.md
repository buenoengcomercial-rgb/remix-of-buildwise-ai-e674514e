

## Plano: Melhorar contraste visual no Gantt e cores de equipes

### 1. `src/lib/teams.ts` — já está conforme
As cores em `teams.ts` já seguem o padrão solicitado (bgColor 94% L, textColor 18-22% L, borderColor/barColor médios). Nenhuma alteração necessária aqui — já validado no arquivo atual.

### 2. `src/components/GanttChart.tsx` — ajustes de contraste

**a) Separar fundo da linha vs cor da barra**
- Linhas da sidebar continuam com `rowTeamDef.bgColor` (claro).
- Barras do Gantt passam a usar `teamDef.barColor` (médio/saturado), com fallback para `bgColor`.
- Aplicar em `getBarStyle` e em qualquer renderização de barra principal/baseline.

**b) Datas REAL / PREV com cores fixas de alto contraste**
- `Real:` → `color: '#1e40af'` (azul escuro), `text-[9px] font-semibold`.
- `Prev:` → `color: '#166534'` (verde escuro) no prazo, `'#991b1b'` (vermelho escuro) se atrasado.
- Substitui a herança de cor da equipe nessas labels específicas para garantir leitura.

**c) Linha tracejada Real→Previsto mais visível**
- `borderTop: '3px dashed #1e3a8a'` (azul-marinho forte).
- Adicionar `filter: 'drop-shadow(0 1px 0 white)'` para destacar sobre qualquer fundo.

**d) Ícone AlertTriangle com contorno**
- `color: '#b45309'` (âmbar escuro) + `filter: 'drop-shadow(0 0 1px white)'`.
- Aplicar em todas as instâncias do `<AlertTriangle>` no Gantt.

**e) Texto das colunas usa `textColor` da equipe**
- Substituir todos os `style={rowTeamDef ? { color: 'inherit' } : undefined}` por `style={rowTeamDef ? { color: rowTeamDef.textColor } : undefined}`.
- Garante texto escuro legível sobre fundo claro da linha.

### Arquivo afetado
- `src/components/GanttChart.tsx` (todas as alterações).
- `src/lib/teams.ts` validado — sem mudanças.

### Resultado esperado
- Linhas com fundo claro suave + texto escuro legível.
- Barras do Gantt com cor saturada destacando da linha.
- Datas Real/Prev sempre legíveis com semântica de cor (azul/verde/vermelho).
- Linha tracejada e ícone de alerta visíveis sobre qualquer fundo.

