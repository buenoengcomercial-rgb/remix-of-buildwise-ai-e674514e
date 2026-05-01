import { useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Copy, Trash2, AlertTriangle } from 'lucide-react';
import type {
  AdditiveComposition,
  AdditiveCalculationMemoryRow,
  AdditiveCalculationMemoryColumns,
} from '@/types/project';
import {
  evalMemoryFormula,
  isMemoryRowFilled,
  makeMemoryRow,
  recalcMemoryRow,
  resolveMemoryColumnLabels,
  validMemoryRows,
} from '@/lib/calculationMemory';
import { fmtNum } from './types';

interface Props {
  c: AdditiveComposition;
  isLocked: boolean;
  /** Recebe SOMENTE linhas preenchidas (a linha vazia visual é estado local). */
  onChange: (rows: AdditiveCalculationMemoryRow[]) => void;
  onChangeColumns?: (cols: AdditiveCalculationMemoryColumns) => void;
}

const numOrUndef = (v: string): number | undefined => {
  if (v === '' || v == null) return undefined;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
};

/** Campos editáveis e ordem de navegação. */
const EDIT_FIELDS = ['type', 'comment', 'formula', 'a', 'b', 'c', 'd'] as const;
type EditField = typeof EDIT_FIELDS[number];

/** Cabeçalho editável por duplo clique. */
function EditableHeader({
  value, defaultValue, disabled, onCommit,
}: {
  value: string; defaultValue: string; disabled?: boolean;
  onCommit: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(value);
      requestAnimationFrame(() => { ref.current?.focus(); ref.current?.select(); });
    }
  }, [editing, value]);

  if (editing && !disabled) {
    return (
      <input
        ref={ref}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => { setEditing(false); onCommit(draft.trim() || defaultValue); }}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); setEditing(false); onCommit(draft.trim() || defaultValue); }
          else if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
        }}
        className="h-6 w-full text-[11px] px-1 border border-input rounded bg-background"
      />
    );
  }
  return (
    <span
      onDoubleClick={() => !disabled && setEditing(true)}
      title={disabled ? value : 'Duplo clique para renomear'}
      className={`block w-full select-none ${disabled ? '' : 'cursor-text hover:underline decoration-dotted'}`}
    >
      {value}
    </span>
  );
}

export default function AdditiveCalculationMemory({
  c, isLocked, onChange, onChangeColumns,
}: Props) {
  const labels = resolveMemoryColumnLabels(c.calculationMemoryColumns);
  const placeholder = `${labels.a}*${labels.b}*${labels.c}*${labels.d}`;

  /** Linhas persistidas (apenas preenchidas, vindas do projeto). */
  const persistedFilled = useMemo(
    () => validMemoryRows(c.calculationMemory),
    [c.calculationMemory],
  );

  /** Estado local: linhas filled + 1 draft (vazia) no fim. Draft NUNCA é salvo. */
  const initialDraft = () => makeMemoryRow('acrescida');
  const [draft, setDraft] = useState<AdditiveCalculationMemoryRow>(initialDraft);

  // Quando o aditivo/composição muda externamente (ex.: troca de aba), recria draft com tipo herdado.
  const lastCompIdRef = useRef<string>(c.id);
  useEffect(() => {
    if (lastCompIdRef.current !== c.id) {
      lastCompIdRef.current = c.id;
      const lastType = persistedFilled.length > 0
        ? persistedFilled[persistedFilled.length - 1].type
        : 'acrescida';
      setDraft(makeMemoryRow(lastType));
    }
  }, [c.id, persistedFilled]);

  // Linhas exibidas: persistidas + draft (no final, sempre).
  const displayed: AdditiveCalculationMemoryRow[] = isLocked
    ? persistedFilled
    : [...persistedFilled, draft];

  /** Refs por célula para navegação. */
  const cellRefs = useRef<Map<string, HTMLElement>>(new Map());
  const setCellRef = (rowId: string, field: EditField) => (el: HTMLElement | null) => {
    const k = `${rowId}:${field}`;
    if (el) cellRefs.current.set(k, el); else cellRefs.current.delete(k);
  };
  const focusCell = (rowId: string, field: EditField) => {
    requestAnimationFrame(() => {
      const el = cellRefs.current.get(`${rowId}:${field}`);
      if (el) {
        (el as HTMLInputElement).focus();
        if ('select' in el) try { (el as HTMLInputElement).select(); } catch { /* noop */ }
      }
    });
  };

  /** Próxima linha "a focar" depois de promover draft (preenchida) — guardamos para focar após render. */
  const pendingFocusRef = useRef<{ rowId: string; field: EditField } | null>(null);
  useEffect(() => {
    if (pendingFocusRef.current) {
      const { rowId, field } = pendingFocusRef.current;
      pendingFocusRef.current = null;
      focusCell(rowId, field);
    }
  });

  /** Persiste alterações em uma linha já preenchida. */
  const updatePersisted = (id: string, patch: Partial<AdditiveCalculationMemoryRow>) => {
    const next = persistedFilled.map(r => (r.id === id ? recalcMemoryRow({ ...r, ...patch }) : r));
    // Mantém somente preenchidas (se a edição esvaziar a linha, ela some).
    onChange(validMemoryRows(next));
  };

  /** Edita o draft local. Se ficar preenchido, promove para persistidas e cria novo draft. */
  const updateDraft = (patch: Partial<AdditiveCalculationMemoryRow>, focusField?: EditField) => {
    const candidate = recalcMemoryRow({ ...draft, ...patch });
    if (isMemoryRowFilled(candidate)) {
      // Promove o draft para persistido. Cria novo draft com tipo herdado da linha promovida.
      const nextPersisted = [...persistedFilled, candidate];
      const newDraft = makeMemoryRow(candidate.type);
      setDraft(newDraft);
      onChange(nextPersisted);
      // Após render, foca o mesmo campo na nova linha vazia.
      if (focusField) pendingFocusRef.current = { rowId: newDraft.id, field: focusField };
    } else {
      // Continua sendo draft (apenas tipo trocado, ou esvaziado).
      setDraft(candidate);
    }
  };

  const onCellChange = (
    row: AdditiveCalculationMemoryRow,
    field: EditField,
    rawValue: string,
  ) => {
    const isDraft = row.id === draft.id && !persistedFilled.some(r => r.id === row.id);
    let patch: Partial<AdditiveCalculationMemoryRow>;
    if (field === 'type') patch = { type: rawValue as 'acrescida' | 'suprimida' };
    else if (field === 'comment') patch = { comment: rawValue };
    else if (field === 'formula') patch = { formula: rawValue };
    else patch = { [field]: numOrUndef(rawValue) } as Partial<AdditiveCalculationMemoryRow>;

    if (isDraft) updateDraft(patch, field);
    else updatePersisted(row.id, patch);
  };

  /** Adiciona linha preenchível (botão manual). É inserida ANTES do draft. */
  const addManual = (type: 'acrescida' | 'suprimida') => {
    // Linha "preenchível" mas vazia precisa virar persistida — usamos comentário em branco mas tipo definido.
    // Para respeitar regra (somente promover quando preenchida), focamos o usuário no comentário do draft com tipo trocado.
    setDraft(prev => makeMemoryRow(type));
    requestAnimationFrame(() => {
      // foca no comentário do draft atualizado
      const el = cellRefs.current.get(`${draft.id}:comment`);
      if (el) (el as HTMLInputElement).focus();
    });
    // Nota: se quiser inserir uma linha "vazia" persistida, basta usar onChange abaixo:
    const empty = recalcMemoryRow({ ...makeMemoryRow(type), comment: '' });
    // Não persistimos linha vazia — comportamento solicitado.
    void empty;
  };

  const dupPersisted = (id: string) => {
    const idx = persistedFilled.findIndex(r => r.id === id);
    if (idx < 0) return;
    const orig = persistedFilled[idx];
    const copy = recalcMemoryRow({ ...orig, id: makeMemoryRow().id });
    const next = [...persistedFilled.slice(0, idx + 1), copy, ...persistedFilled.slice(idx + 1)];
    onChange(next);
  };
  const delPersisted = (id: string) => onChange(persistedFilled.filter(r => r.id !== id));

  const setColLabel = (k: 'a' | 'b' | 'c' | 'd', value: string) => {
    if (!onChangeColumns) return;
    onChangeColumns({ ...(c.calculationMemoryColumns ?? {}), [k]: value });
  };

  /** Navegação por teclado entre células. */
  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLElement>,
    rowIndex: number,
    fieldIndex: number,
  ) => {
    const isEnter = e.key === 'Enter';
    const isTab = e.key === 'Tab';
    if (!isEnter && !isTab) return;
    // Para Enter: sempre interceptamos. Para Tab: deixamos default a menos que seja último campo da última linha.
    const back = e.shiftKey;
    let nextRow = rowIndex;
    let nextField = fieldIndex + (back ? -1 : 1);
    if (nextField < 0) {
      nextRow = rowIndex - 1;
      nextField = EDIT_FIELDS.length - 1;
    } else if (nextField >= EDIT_FIELDS.length) {
      nextRow = rowIndex + 1;
      nextField = 0;
    }
    if (nextRow < 0) return;
    if (nextRow >= displayed.length) {
      // Fim: só age se for Enter, e se houver draft (sem isLocked).
      if (!isEnter || isLocked) return;
      e.preventDefault();
      // Foca primeira coluna editável do draft (que já existe no fim).
      const draftId = displayed[displayed.length - 1].id;
      focusCell(draftId, EDIT_FIELDS[0]);
      return;
    }
    if (isEnter) e.preventDefault();
    const targetRow = displayed[nextRow];
    focusCell(targetRow.id, EDIT_FIELDS[nextField]);
  };

  // Totais visuais ignoram o draft.
  const totalAcrescida = persistedFilled
    .filter(r => r.type !== 'suprimida')
    .reduce((acc, r) => acc + (Number.isFinite(r.partial) ? r.partial : 0), 0);
  const totalSuprimida = persistedFilled
    .filter(r => r.type === 'suprimida')
    .reduce((acc, r) => acc + (Number.isFinite(r.partial) ? r.partial : 0), 0);

  // Foco inicial ao abrir sem nenhuma linha preenchida: foca o comentário do draft.
  const didInitialFocusRef = useRef(false);
  useEffect(() => {
    if (didInitialFocusRef.current) return;
    if (isLocked) return;
    if (persistedFilled.length === 0) {
      didInitialFocusRef.current = true;
      focusCell(draft.id, 'comment');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="border rounded-md bg-background p-2 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold text-muted-foreground">
          Memória de cálculo — {c.itemNumber || c.item} {c.description}
        </div>
        {!isLocked && (
          <div className="flex gap-1">
            <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => addManual('acrescida')}>
              <Plus className="w-3 h-3 mr-1" /> Acrescida
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => addManual('suprimida')}>
              <Plus className="w-3 h-3 mr-1" /> Suprimida
            </Button>
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[11px] table-fixed">
          <colgroup>
            <col style={{ width: 36 }} />
            <col style={{ width: 88 }} />
            <col />
            <col style={{ width: 110 }} />
            <col style={{ width: 64 }} />
            <col style={{ width: 64 }} />
            <col style={{ width: 64 }} />
            <col style={{ width: 64 }} />
            <col style={{ width: 78 }} />
            <col style={{ width: 56 }} />
          </colgroup>
          <thead className="text-muted-foreground">
            <tr className="border-b">
              <th className="px-1 py-1 text-center font-medium">Loc</th>
              <th className="px-1.5 py-1 text-left font-medium">Tipo</th>
              <th className="px-1.5 py-1 text-left font-medium">Comentário</th>
              <th className="px-1.5 py-1 text-left font-medium">Fórmula</th>
              <th className="px-1.5 py-1 text-right font-medium">
                <EditableHeader value={labels.a} defaultValue="UND" disabled={isLocked || !onChangeColumns} onCommit={v => setColLabel('a', v)} />
              </th>
              <th className="px-1.5 py-1 text-right font-medium">
                <EditableHeader value={labels.b} defaultValue="Comprim." disabled={isLocked || !onChangeColumns} onCommit={v => setColLabel('b', v)} />
              </th>
              <th className="px-1.5 py-1 text-right font-medium">
                <EditableHeader value={labels.c} defaultValue="Largura" disabled={isLocked || !onChangeColumns} onCommit={v => setColLabel('c', v)} />
              </th>
              <th className="px-1.5 py-1 text-right font-medium">
                <EditableHeader value={labels.d} defaultValue="Altura" disabled={isLocked || !onChangeColumns} onCommit={v => setColLabel('d', v)} />
              </th>
              <th className="px-1.5 py-1 text-right font-medium">Parcial</th>
              <th className="px-1.5 py-1 text-center font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((r, rowIndex) => {
              const isDraftRow = !isLocked && rowIndex === displayed.length - 1 && r.id === draft.id && !persistedFilled.some(p => p.id === r.id);
              const ev = evalMemoryFormula(r.formula ?? '', { a: r.a, b: r.b, c: r.c, d: r.d });
              const filled = isMemoryRowFilled(r);
              const isInvalid = filled && !ev.ok;
              const isNegative = filled && ev.ok && ev.value < 0;
              const rowBg = isDraftRow
                ? 'bg-muted/10'
                : isInvalid
                  ? 'bg-rose-50/50'
                  : r.type === 'suprimida' ? 'bg-rose-50/20' : 'bg-emerald-50/20';
              return (
                <tr key={r.id} className={`border-b align-top ${rowBg}`}>
                  <td className="px-1 py-1 text-center font-mono text-muted-foreground">
                    {rowIndex + 1}
                  </td>
                  <td className="px-1.5 py-1">
                    <select
                      ref={setCellRef(r.id, 'type') as any}
                      value={r.type}
                      disabled={isLocked}
                      onChange={e => onCellChange(r, 'type', e.target.value)}
                      onKeyDown={e => handleKeyDown(e, rowIndex, 0)}
                      className="h-7 w-full text-[11px] border border-input rounded-md bg-background px-1"
                    >
                      <option value="acrescida">Acrescida</option>
                      <option value="suprimida">Suprimida</option>
                    </select>
                  </td>
                  <td className="px-1.5 py-1">
                    <Input
                      ref={setCellRef(r.id, 'comment') as any}
                      value={r.comment ?? ''}
                      disabled={isLocked}
                      onChange={e => onCellChange(r, 'comment', e.target.value)}
                      onKeyDown={e => handleKeyDown(e, rowIndex, 1)}
                      className="h-7 text-[11px]"
                      placeholder={isDraftRow ? 'Justificativa (digite para iniciar)' : 'Justificativa'}
                    />
                  </td>
                  <td className="px-1.5 py-1">
                    <Input
                      ref={setCellRef(r.id, 'formula') as any}
                      value={r.formula ?? ''}
                      disabled={isLocked}
                      onChange={e => onCellChange(r, 'formula', e.target.value)}
                      onKeyDown={e => handleKeyDown(e, rowIndex, 2)}
                      className={`h-7 text-[11px] font-mono ${isInvalid ? 'border-rose-400' : ''}`}
                      placeholder={placeholder}
                      title={isInvalid ? ev.error : `Fórmula opcional. Use A, B, C, D, +, -, *, /, ( ). Padrão: ${placeholder}`}
                    />
                  </td>
                  {(['a', 'b', 'c', 'd'] as const).map((k, kIdx) => (
                    <td key={k} className="px-1.5 py-1">
                      <Input
                        ref={setCellRef(r.id, k) as any}
                        type="number"
                        step="0.0001"
                        value={r[k] ?? ''}
                        disabled={isLocked}
                        onChange={e => onCellChange(r, k, e.target.value)}
                        onKeyDown={e => handleKeyDown(e, rowIndex, 3 + kIdx)}
                        className="h-7 text-[11px] text-right px-1"
                      />
                    </td>
                  ))}
                  <td className={`px-1.5 py-1 text-right font-medium ${isNegative ? 'text-amber-700' : ''}`}>
                    <div className="inline-flex items-center gap-1">
                      {(isInvalid || isNegative) && (
                        <AlertTriangle className={`w-3 h-3 ${isInvalid ? 'text-rose-600' : 'text-amber-600'}`} />
                      )}
                      {filled ? fmtNum(r.partial) : ''}
                    </div>
                  </td>
                  <td className="px-1.5 py-1 text-center">
                    {!isLocked && !isDraftRow && (
                      <div className="inline-flex gap-0.5">
                        <button onClick={() => dupPersisted(r.id)} className="p-1 hover:bg-muted rounded" title="Duplicar">
                          <Copy className="w-3 h-3" />
                        </button>
                        <button onClick={() => delPersisted(r.id)} className="p-1 hover:bg-muted rounded text-rose-600" title="Excluir">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {persistedFilled.length > 0 && (
            <tfoot>
              <tr className="border-t font-medium">
                <td colSpan={8} className="px-1.5 py-1 text-right">Total Acrescida:</td>
                <td className="px-1.5 py-1 text-right text-emerald-700">{fmtNum(totalAcrescida)}</td>
                <td />
              </tr>
              <tr className="font-medium">
                <td colSpan={8} className="px-1.5 py-1 text-right">Total Suprimida:</td>
                <td className="px-1.5 py-1 text-right text-rose-700">{fmtNum(totalSuprimida)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
