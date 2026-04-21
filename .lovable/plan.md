

## Plano: corrigir o select "Mover para capítulo" que estoura o layout

### Problema
O `<select>` nativo na linha do capítulo (linha 530 de `TaskList.tsx`) renderiza o texto completo da opção selecionada (ex.: "↳ 3 [2.4] ELETRODUTO, CONEXÕES E ACESSÓRIOS (ILUMINAÇÃO DE EMERGÊNCIA E ACIONADORES DA BOMBA DE INCÊNDIO)"), o que estica a barra do capítulo e empurra os botões de ação para fora da área visível, quebrando o alinhamento da grade.

### Correção (em `src/components/TaskList.tsx`)

1. **Travar a largura do select**
   - Aplicar `w-32 max-w-[8rem]` no `<select>` da linha 530.
   - Adicionar `truncate` + `overflow-hidden text-ellipsis` para não vazar.
   - Remover o texto longo da opção exibida usando uma label curta no `<option>`.

2. **Encurtar o texto das opções**
   - Trocar `↳ {numbering.get(c.id)} {c.name}` por uma versão truncada usando o helper `truncateWords(c.name, 3)` já existente (ex.: "↳ [1.2] Abrigo Tubulações…").
   - Adicionar `title={c.name}` em cada `<option>` para manter o nome completo no tooltip nativo.
   - Limitar a label da opção selecionada via `<option label="...">` para forçar a versão curta no campo fechado.

3. **Garantir que a linha do capítulo não cresça**
   - Envolver o bloco de ações (`renderActionButtons`) num container `flex-shrink-0 min-w-0` com `max-w-[260px]` para que nunca ultrapasse a área reservada.
   - Adicionar `min-w-0 flex-1` no bloco esquerdo (nome + numeração) para permitir que o `truncate` do nome do capítulo realmente recorte.

4. **Manter consistência visual**
   - Padronizar tamanho dos botões de ação (Edit/Delete/Select) em `h-7` para ficar alinhado.
   - Manter o `overflow-x-hidden` já existente no container raiz.

### Resultado esperado
- O dropdown "Mover para capítulo" fica com largura fixa (~128px), exibindo texto truncado com `…`.
- A linha do capítulo mantém altura e largura constantes — botões de editar/excluir não saem mais da página.
- Ao abrir o select, as opções aparecem em sua largura natural (comportamento padrão do browser), com tooltip do nome completo.
- Nenhum scroll horizontal aparece; a grade permanece estável durante todas as interações.

### Arquivo afetado
- `src/components/TaskList.tsx`

