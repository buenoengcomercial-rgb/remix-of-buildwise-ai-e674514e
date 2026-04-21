

## Plano: numeração editável reordena hierarquia + drag de capítulo realmente funcional

### Problemas atuais

1. **Numeração editada não reordena**: ao mudar o número do capítulo de "3" para "2", ele apenas grava `customNumber="2"` mas não muda a posição na lista — o capítulo continua exibido na sua ordem anterior, ficando "2" acima de "1".
2. **Drag com mouse não funciona**: o `draggable` está no header da linha do capítulo, mas todo o conteúdo (incluindo nome, botão de número, ações) tem `onMouseDown={e.stopPropagation()}` ou está ocupando a área. Em alguns navegadores o `cursor-grab` aparece, mas o HTML5 DnD não inicia se o ponteiro estiver sobre filhos com `stopPropagation` ou inputs. Além disso, falta `preventDefault` no `onDragOver` da janela, então o cursor vira "proibido".
3. **Reordenar via drag não atualiza numeração**: hoje o `reorderChapter` muda o `order`, mas se o capítulo tem `customNumber` definido, a numeração exibida continua a antiga (porque `getChapterNumbering` prioriza `customNumber` sobre a ordem). Resultado: arrastar não muda o número visível.

---

### Correções (em `src/components/TaskList.tsx` e `src/lib/chapters.ts`)

**1. Numeração editável reordena automaticamente** (`saveChapterNumber` em `TaskList.tsx`)

Reescrever para que, ao salvar um número:
- Se o valor for um inteiro simples (ex.: "2", "3") em capítulo principal: recalcular `order` de todos os capítulos do mesmo nível, inserindo o capítulo editado na posição `(número − 1)` e reindexando os demais sequencialmente.
- Se o valor for hierárquico (ex.: "1.2") em subcapítulo: extrair o segundo segmento como índice e reordenar entre os irmãos do mesmo `parentId`.
- Se o valor for hierárquico em capítulo principal (ex.: "1.3" digitado num root): converter automaticamente em subcapítulo do capítulo "1" via `safeMoveChapter` + reposicionar.
- Limpar `customNumber` (deixar `undefined`) após reordenar — assim a numeração automática reflete a nova posição imediatamente, sem conflito.
- Manter `customNumber` apenas quando o usuário digitar algo não-numérico (ex.: "1A", "Anexo") — nesses casos só preserva o rótulo customizado.

Adicionar helper em `src/lib/chapters.ts`:
```ts
export function reorderChapterByNumber(
  project: Project,
  chapterId: string,
  desiredNumber: string,
): Project
```
Que aplica a lógica acima e devolve um novo `Project` com `order` recalculado e `customNumber` limpo quando aplicável.

**2. Drag-and-drop com mouse realmente funcional**

- Trocar o handler do header: o `draggable` continua no container do header, mas remover `onClick={togglePhase}` desse mesmo div (mover o toggle para o ícone `Chevron` apenas) — clicar e arrastar conflitavam.
- Adicionar listener global `onDragOver={e => e.preventDefault()}` no container raiz do `TaskList` para que o cursor permaneça "grab" durante o arrasto sobre áreas neutras.
- Garantir `e.dataTransfer.setData('text/plain', chapterId)` (alguns browsers exigem `text/plain` para iniciar o drag) além do tipo customizado.
- Remover `onMouseDown={stopPropagation}` desnecessários do botão de numeração e nome — manter `stopPropagation` apenas no modo de edição (input ativo).
- Aumentar a área de drop: o `onDragOver`/`onDrop` deve estar no card inteiro (não só no header), para facilitar soltar entre capítulos.
- Adicionar uma "drop zone" no FINAL da lista de capítulos (linha tracejada) para permitir mover um capítulo para a última posição.

**3. Drag de reposicionamento atualiza numeração visível**

Modificar `handleChapterDrop` em `TaskList.tsx`:
- Ao chamar `reorderChapter`, também limpar o `customNumber` do capítulo arrastado (e dos irmãos do mesmo nível) para que `getChapterNumbering` use a nova ordem automaticamente.
- Resultado: arrastar o capítulo "3" para o topo o renumera visualmente para "1", e os demais descem para "2", "3", etc.

**4. Feedback visual durante o drag**

- Manter as linhas indicadoras (`before:`/`after:`) já existentes.
- Adicionar destaque azul mais forte (`ring-2 ring-primary`) no card alvo quando `dropPosition === 'inside'` para deixar claro que será nested.
- Mudar o cursor do header para `cursor-move` (mais universal que `grab`).

---

### Arquivos afetados
- `src/lib/chapters.ts` — adicionar `reorderChapterByNumber`.
- `src/components/TaskList.tsx` — reescrever `saveChapterNumber`, ajustar handlers de drag, mover `onClick` do toggle para o ícone Chevron, adicionar drop zone final.

### Resultado esperado
- Editar a numeração de um capítulo o move instantaneamente para a posição correta, e os demais são renumerados.
- Segurar com botão esquerdo no header de qualquer capítulo e arrastar para cima/baixo funciona em todos os navegadores.
- Ao soltar, a numeração visível reflete a nova ordem (sem precisar editar manualmente).
- Editar nome, número ou clicar em ações continua funcionando sem disparar drag acidental.

