

## Plano: dropdown "Mover para capítulo" — apenas capítulos principais, ordenados

### Problema
O `<select>` em `src/components/TaskList.tsx` (linha ~562) lista capítulos principais na ordem bruta de `project.phases`, então capítulos novos aparecem no fim em vez de respeitarem a numeração 1, 2, 3...

### Solução
Manter o dropdown apenas com **capítulos principais** (sem subcapítulos), mas ordenados pela numeração hierárquica de raiz (campo `order` do nível raiz, refletido no `getChapterNumbering`).

### Mudanças em `src/components/TaskList.tsx`
1. Criar `useMemo` `orderedMainChapters`:
   - Filtrar `project.phases` onde `parentId` é nulo/undefined.
   - Ordenar por `order` ascendente (fallback: índice em `phases`).
2. No `<select>` (linhas 569–577):
   - Trocar a fonte de `mainChapters` por `orderedMainChapters`.
   - Continuar excluindo o próprio `phase.id` da lista.
   - Renderizar `option` como `${numbering.get(c.id)} - ${c.name}` para deixar a ordem 1, 2, 3... explícita ao usuário.

### Resultado esperado
- Dropdown exibe apenas capítulos principais (sem subcapítulos).
- Ordem segue a numeração 1, 2, 3, 4... — capítulos novos aparecem na posição correta segundo `order`, não no fim.
- Cada opção mostra o número do capítulo antes do nome.

### Arquivo afetado
- `src/components/TaskList.tsx`

