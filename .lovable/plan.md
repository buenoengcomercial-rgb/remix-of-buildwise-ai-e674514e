

## Plano: dropdown não reflete renomeação de capítulo

### Diagnóstico
Em `src/components/TaskList.tsx` linha 587, cada `<option>` é renderizada com o atributo `label`:
```tsx
<option key={c.id} value={c.id} label={shortLabel} title={...}>
  {shortLabel}
</option>
```

O atributo `label` em `<option>` **sobrescreve** o texto de exibição do `<select>` em vários navegadores (Chrome/Edge), e tem comportamento conhecido de não atualizar de forma confiável quando muda em runtime — mesmo que o React aplique o novo valor no DOM. Resultado: ao renomear um capítulo, o memo `orderedMainChapters` recomputa corretamente e o `label` é atualizado no DOM, mas o `<select>` fechado continua exibindo o texto antigo até o componente remontar.

A memoização (`[project.phases]` em `chapterNumbering` e `orderedMainChapters`) está correta — o problema é puramente de renderização do `<option label>`.

### Solução
1. **Remover o atributo `label`** das `<option>` (linha 587). Sem `label`, o navegador usa o `children` da opção como texto exibido, e o React atualiza o text node corretamente quando o nome muda.
2. Manter `title={...}` (atributo HTML padrão do tooltip nativo) e o conteúdo `{shortLabel}` como filho.
3. Aplicar o mesmo ajuste à opção placeholder (linha 582) por consistência: remover `label="— Principal —"`.

### Arquivo afetado
- `src/components/TaskList.tsx` (linhas 582 e 587)

### Resultado esperado
- Renomear um capítulo atualiza imediatamente o texto exibido no dropdown "Mover para capítulo" de todas as linhas, sem necessidade de reload ou de fechar/abrir o componente.

