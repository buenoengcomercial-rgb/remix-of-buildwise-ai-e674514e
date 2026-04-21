

## Plano: hierarquia real por arrastar e soltar entre capítulos

### O que existe hoje
- O drag-and-drop de capítulo já permite "before/after/inside" no header — soltar com `inside` chama `handleMoveChapter` e converte em subcapítulo.
- Porém: (a) o drop só funciona em cima do **header** (não no corpo aberto do capítulo); (b) não existe drop zone explícita para "tirar" um subcapítulo de volta para raiz; (c) o feedback visual é discreto e não diferencia "vai virar subcapítulo" de "vai reordenar"; (d) a inserção como filho não garante que vá para o **final** com `order` correto.

### Mudanças em `src/lib/chapters.ts`

1. **`moveChapter` — anexar como último filho com `order` correto**
   - Quando `newParentId` é definido, calcular `order = max(orderDosFilhosExistentes) + 1` para o capítulo movido (em vez de manter o `order` antigo).
   - Quando `newParentId` é `null` (promoção a raiz), idem: `order = max(rootOrders) + 1` (vira o último capítulo principal).
   - Garante a regra "anexar como último filho do destino" e numeração correta (ex.: vira `[4.2]` se o pai 4 já tem `[4.1]`).

2. **Helper `promoteChapterToRoot(project, chapterId)`** — wrapper de `safeMoveChapter(project, id, null)` para clareza.

### Mudanças em `src/components/TaskList.tsx`

1. **Drop no corpo do capítulo (não só no header)**
   - Envolver o `motion.div` inteiro do cartão (header + AnimatePresence) com `onDragOver`/`onDrop` apontando para `phase.id`.
   - Lógica em `handleChapterDragOver`: se o evento vem do header, calcular `before/inside/after` por terços (como já faz). Se vem do corpo expandido, **forçar `dropPosition = 'inside'`** — soltar em qualquer parte do corpo aberto vira subcapítulo.
   - Para diferenciar, marcar o container do corpo com `data-chapter-body` e checar `e.target.closest('[data-chapter-body]')` no handler.

2. **Drop zone "Promover a capítulo principal"**
   - Quando `dragChapterId` aponta para um **subcapítulo** (tem `parentId`), renderizar no topo da lista uma faixa tracejada `"⬆ Soltar aqui para promover a capítulo principal"` com `onDrop={() => handleMoveChapter(dragChapterId, null)}`.
   - Faixa só aparece durante o drag, animada (fade-in).

3. **Feedback visual aprimorado**
   - `inside` (vai virar subcapítulo): `ring-4 ring-primary` + overlay azul translúcido com texto absoluto `"➜ Virará subcapítulo de [N] Nome"` no canto superior direito do cartão alvo.
   - `before`/`after` (reordenar mesmo nível): linha azul de 2px (já existe) + tooltip pequeno `"Reordenar"` no cursor.
   - Cursor durante drag: `cursor-grabbing` global via classe no `<body>` aplicada em `dragstart` e removida em `dragend`.
   - Capítulo arrastado: `opacity-40` + `scale-[0.98]` (já tem `opacity-50`, refinar).

4. **Auto-expandir destino ao soltar como subcapítulo**
   - Já existe (`setExpandedPhases(prev => new Set([...prev, newParentId]))`). Garantir que também acontece quando a soltura é feita pelo corpo do capítulo aberto.

5. **Persistência**
   - Já é automática via `onProjectChange` → `localStorage` (memória core do projeto). Nenhuma mudança extra necessária.

6. **Suporte a múltiplos níveis (>2)**
   - `getChapterTree` hoje só monta 2 níveis (root + filhos diretos). Estender para recursão real:
     - `ChapterNode` ganha `children: ChapterNode[]` (em vez de `Phase[]`).
     - Renderização em `TaskList.tsx` vira recursiva: `renderChapterNode(node, depth)` — indenta `ml-6 * depth`.
     - `getChapterNumbering` recursivo: `1`, `1.1`, `1.1.1`, etc.
     - `flattenPhasesByChapter` adaptado (DFS).
   - Mantém compatibilidade: phases sem `parentId` continuam raízes.

7. **Não-ciclo**
   - `isDescendant` já protege. Reforçar no `handleChapterDragOver`: se `targetId` é descendente de `dragChapterId`, ignorar (não setar `dropChapterTargetId`, não mostrar highlight).

### Critérios de aceite cobertos
1. ✅ Arrastar com botão esquerdo no handle do cartão.
2. ✅ Soltar no header de outro capítulo → vira subcapítulo (`inside`).
3. ✅ Soltar dentro do corpo aberto de outro capítulo → vira subcapítulo (novo).
4. ✅ Numeração recalculada via `getChapterNumbering` (já usa `order`).
5. ✅ Persistência via localStorage.
6. ✅ Conversão real (atualiza `parentId` + `order`).
7. ✅ Drop zone no topo para promover subcapítulo a raiz.

### Arquivos afetados
- `src/lib/chapters.ts` — `moveChapter` ajusta `order`; `getChapterTree`/`getChapterNumbering`/`flattenPhasesByChapter` recursivos para suportar N níveis.
- `src/components/TaskList.tsx` — drop no corpo do cartão, drop zone de promoção, feedback visual reforçado, render recursivo de subcapítulos.

