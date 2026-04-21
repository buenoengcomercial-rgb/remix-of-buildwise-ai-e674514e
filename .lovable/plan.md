

## Plano: silenciar warnings de ref e melhorar UX dos inputs numéricos

### Arquivos afetados
- `src/components/ui/tooltip.tsx`
- `src/components/TaskList.tsx`

### 1. Corrigir warning de `forwardRef` no Tooltip
No `src/components/ui/tooltip.tsx`, criar um `TooltipTrigger` customizado que encaminha refs corretamente, evitando o warning `Function components cannot be given refs` quando o gatilho é um componente funcional sem `forwardRef`.

- Substituir `const TooltipTrigger = TooltipPrimitive.Trigger;` por um wrapper com `React.forwardRef` que passa `asChild` e força um elemento DOM nativo (`<span>`) como fallback quando o filho não aceita ref.

### 2. Auto-selecionar conteúdo de inputs numéricos no foco
No `src/components/TaskList.tsx`, adicionar `onFocus={(e) => e.currentTarget.select()}` aos inputs numéricos relevantes:
- Quantidade da tarefa
- Produtividade / RUP
- Duração manual
- Progresso (%)
- Quantidade de trabalhadores na composição RUP

Assim, ao clicar no campo, o valor existente fica selecionado e a próxima digitação **substitui** em vez de **concatenar** — eliminando o bug de "30 + 50 = 100" causado pelo clamp.

### 3. Verificação
- Abrir o console após as mudanças e confirmar que os avisos de `forwardRef` do Tooltip somem.
- Testar entrada de valores nos campos numéricos: clicar no campo deve selecionar tudo; digitar substitui o valor anterior.

### Resultado esperado
- Console limpo, sem ruído de warnings do Radix Tooltip.
- Edição de números mais natural e previsível em toda a EAP e painel RUP.

