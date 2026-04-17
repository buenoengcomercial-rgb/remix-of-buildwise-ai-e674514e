

## Plano: Sufixo "d", padronização de datas, coluna % Concluído e badge no Gantt

### 1. Coluna DURAÇÃO — sufixo "d"
Em `src/components/GanttChart.tsx`, envolver o `<input type="number">` da duração num wrapper `relative` e adicionar um `<span>d</span>` absoluto à direita (`text-[8px] opacity-60 pointer-events-none`), preservando edição numérica.

### 2. Datas REAL / PREV — mesma fonte/tamanho da data principal
Padronizar as labels Real e Prev para `text-[9px] font-medium` (igual à data principal), mantendo as cores semânticas já aplicadas:
- Real → `#1e40af` (azul escuro)
- Prev → `#166534` (verde escuro) no prazo / `#991b1b` (vermelho escuro) se atrasado

### 3. Nova coluna "% Concluído"
- `sidebarCols`: adicionar coluna de ~42px após "Fim" → `'24px 1fr 28px 20px 78px 78px 42px 44px 44px 56px'`
- `sidebarWidth`: aumentar para `578`
- Header novo `% Concl.` entre "Fim" e "Dep"
- **Tarefa**: exibir `task.physicalProgress ?? task.percentComplete` como `XX%`
- **Capítulo/Fase**: média ponderada por duração das tarefas filhas
- **Cor dinâmica**: verde se ≥ esperado-no-tempo, vermelho se atrasado, cinza se sem dado

### 4. Badge de % na linha tracejada do Gantt
No grid (linha tracejada Real→Previsto), sobrepor um badge pequeno (`text-[9px] font-bold px-1 rounded`) no centro da linha exibindo o mesmo `XX%` da coluna, herdando a cor da linha (azul = no prazo, vermelho = atrasado), com `drop-shadow` branco para legibilidade.

### Arquivo afetado
- `src/components/GanttChart.tsx` (todas as alterações inline; helper de % ponderado calculado inline no render dos capítulos)

---

## Sugestões para melhorar o fluxo de gestão (não implementadas agora)

1. **Painel "Hoje"** — tela inicial com tarefas do dia, atrasos críticos, apontamentos pendentes e materiais a chegar.
2. **Indicadores SPI/CPI** — Schedule/Cost Performance Index calculados do baseline + apontamentos (padrão PMI).
3. **Notificações inteligentes** — alertas automáticos para atrasos críticos, dependências bloqueadas e equipes ociosas.
4. **Versionamento de baseline** — snapshots semanais/mensais para análise de desvios temporais.
5. **RDO automático** — Relatório Diário de Obra em PDF a partir dos apontamentos + clima + efetivo.
6. **Curva S real vs planejado** — sobreposição das duas curvas para comparação imediata.
7. **Gestão de equipes** — visualização de carga/ociosidade por equipe com realocação por drag-and-drop.
8. **Modo offline (PWA)** — apontamento em campo sem internet, com sincronização posterior.
9. **Multi-projeto/Portfólio** — KPIs comparativos entre várias obras.
10. **Fotos georreferenciadas** — anexar fotos diárias por tarefa, criando memória visual da execução.

### Resultado esperado
- Coluna DURAÇÃO mostra `5d`, `12d`, etc.
- Datas Real/Prev com mesma tipografia da data principal.
- Nova coluna "% Concl." visível por tarefa e por capítulo.
- Badge percentual sobreposto à linha tracejada, sincronizado com a coluna.

