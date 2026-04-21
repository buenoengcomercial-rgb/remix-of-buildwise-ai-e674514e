

## Plano: ocultar barra de cabeçalho de colunas e remover botão Duplicar

### Arquivo afetado
- `src/components/TaskList.tsx`

### 1. Ocultar barra de cabeçalho de colunas (linha 736)
A barra cinza `Eq. | Tarefa | Qtd. | Prod./dia | Duração | Gargalo | Depend. | Progresso | Ações` (linhas 736–746) só faz sentido quando o capítulo tem tarefas diretas.

- Envolver o `<div>` da linha 736 em uma condicional: renderizar **apenas se `phase.tasks.length > 0`**.
- Quando o capítulo só contém subcapítulos (sem tarefas diretas), a barra fica oculta — os subcapítulos filhos terão suas próprias barras, se tiverem tarefas.

### 2. Remover botão Duplicar (linhas 967–969)
- Apagar o `<button>` com ícone `<Copy>` que aparece no hover.
- Remover `Copy` do import de `lucide-react` se não for usado em mais nenhum lugar do arquivo.
- Função `duplicateTask` — manter por ora (pode ser usada por outros fluxos); se for órfã, remover também.

### Resultado esperado
- Cabeçalho de colunas só aparece em capítulos/subcapítulos que de fato listam tarefas.
- Capítulos puramente "container" (só subcapítulos) ficam mais limpos.
- Botão Duplicar some da linha de ações no hover.

