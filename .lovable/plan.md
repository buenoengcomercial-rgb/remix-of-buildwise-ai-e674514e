

## Plano: limpar cabeçalho do painel RUP e mover "+ Profissional" para a coluna

### Arquivo afetado
- `src/components/TaskList.tsx`

### 1. Remover botões do cabeçalho do painel RUP (linhas 997–1016)
Apagar todo o `<div className="flex items-center gap-2">` que contém os três botões:
- `+ Profissional` (linhas 998–1003)
- `⚡ Dobrar equipe` (linhas 1004–1009)
- `📊 Simular` (linhas 1010–1015)

O cabeçalho passa a mostrar apenas o título `Composição RUP — {quantity} {unit}` (linhas 993–996), sem a barra de ações à direita.

### 2. Mover "+ Profissional" para a coluna "Profissional" (linha 1020)
Substituir o texto estático `<div>Profissional</div>` na linha de cabeçalho da tabela de composições por um botão compacto que dispara `addLabor(phase.id, task.id)`:

```tsx
<div>
  <button
    onClick={() => addLabor(phase.id, task.id)}
    className="text-[10px] font-semibold uppercase text-primary hover:text-primary/80 flex items-center gap-1 transition-colors"
    title="Adicionar profissional"
  >
    <Plus className="w-3 h-3" /> Profissional
  </button>
</div>
```

O botão fica integrado ao cabeçalho de colunas (`Profissional | RUP | Qtd. Trab. | Tempo total | Tempo efetivo | Ação`), sem aumentar a altura da seção.

### 3. Limpeza colateral
- Remover do estado / handlers o uso de `simulating` (state setter `setSimulating`) e a renderização `{sim && (...)}` (linhas 1087–1096) — sem o botão de gatilho a simulação fica órfã.
- Manter as funções `addLabor`, `doubleTeam` e `removeLabor` no código (podem ser usadas em outros fluxos / atalhos), mas se `doubleTeam` ficar órfão, remover também.

### Resultado esperado
- Painel RUP expandido tem cabeçalho enxuto, só com o título.
- O ato de adicionar um novo profissional acontece direto no topo da coluna "Profissional", contextualizado com a tabela.
- Botões "Dobrar equipe" e "Simular" (+ bloco de simulação) somem da interface.

