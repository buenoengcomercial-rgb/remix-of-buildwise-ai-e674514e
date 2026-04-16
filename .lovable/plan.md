
## Objetivo
Tornar o nome completo da tarefa visível na EAP, sem truncar, evitando confusão entre tarefas com descrições parecidas (caso típico SINAPI, onde o sufixo distingue a tarefa).

## Situação atual
Linha 534 em `src/components/TaskList.tsx` usa `truncate`, cortando o nome longo (ex.: "FURO MECANIZADO EM CONCRETO ... DIÂMETROS MENORES OU IGUAIS A 40 MM. AF_09/2023") com reticências. O grid usa `2fr` para a coluna Nome, então o conteúdo é forçado a uma única linha.

## Mudança proposta
Permitir quebra de linha (wrap) na coluna "Nome" da EAP, mantendo o resto do layout intacto.

### Alterações em `src/components/TaskList.tsx`

1. **Botão do nome (linha 534)**: trocar `truncate` por `whitespace-normal break-words leading-tight`, para que o texto longo apareça em múltiplas linhas dentro da própria coluna.
2. **Container do nome (linha 524)**: trocar `items-center` por `items-start` (alinhamento topo) e remover/relaxar `min-w-0` se necessário, para acomodar texto multilinha sem empurrar os ícones.
3. **Linha do grid (linha 500)**: trocar `items-center` por `items-start` e adicionar `py-2` extra de respiro, para que as outras colunas (Qtd, Prod, Responsável, etc.) fiquem alinhadas ao topo quando o nome ocupar 2-3 linhas.
4. **Tooltip auxiliar**: adicionar `title={task.name}` no botão para reforço (acessível ao hover), mesmo com o texto já visível.

### Garantias
- Não altera lógica de edição (`InlineInput` continua igual quando `isEditing`).
- Não mexe em colunas de Qtd, Produção Diária, Responsável, Duração, Equipe, CPM ou RUP.
- Não afeta drag-and-drop (o `GripVertical` permanece no início da linha).
- Cores de equipe, estados (crítico, atrasado, concluído) e contraste preservados.

### Resultado esperado
Cada nome de tarefa aparece por completo na EAP, quebrando em até 2-3 linhas conforme necessário, eliminando ambiguidade entre tarefas SINAPI similares.
