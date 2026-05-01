import { useEffect, useRef, useState } from 'react';
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
  makeMemoryRow,
  recalcMemoryRow,
  resolveMemoryColumnLabels,
} from '@/lib/calculationMemory';
import { fmtNum } from './types';

interface Props {
  c: AdditiveComposition;
  isLocked: boolean;
  onChange: (rows: AdditiveCalculationMemoryRow[]) => void;
  onChangeColumns?: (cols: AdditiveCalculationMemoryColumns) => void;
}

const numOrUndef = (v: string): number | undefined => {
  if (v === '' || v == null) return undefined;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
};

/** Cabeçalho editável por duplo clique. */
function EditableHeader({
  value,
  defaultValue,
  disabled,
  onCommit,
}: {
  value: string;
  defaultValue: string;
  disabled?: boolean;
  onCommit: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(value);
      requestAnimationFrame(() => {
        ref.current?.focus();
        ref.current?.select();
      });
    }
  }, [editing, value]);

  if (editing && !disabled) {
    return (
      <input
        ref={ref}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          const v = draft.trim();
          onCommit(v || defaultValue);
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            setEditing(false);
            const v = draft.trim();
            onCommit(v || defaultValue);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setEditing(false);
          }
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
  const rows = c.calculationMemory ?? [];
  const labels = resolveMemoryColumnLabels(c.calculationMemoryColumns);

  /** Mantém Loc sequencial 1..N, ignorando o que vier salvo. */
  const renumber = (list: AdditiveCalculationMemoryRow[]): AdditiveCalculationMemoryRow[] =>
    list.map((r, idx) => ({ ...r, loc: String(idx + 1) }));

  const update = (id: string, patch: Partial<AdditiveCalculationMemoryRow>) => {
    const next = rows.map(r => (r.id === id ? recalcMemoryRow({ ...r, ...patch }) : r));
    onChange(renumber(next));
  };
  const add = (type: 'acrescida' | 'suprimida' = 'acrescida') => {
    onChange(renumber([...rows, makeMemoryRow(type)]));
  };
  const dup = (id: string) => {
    const idx = rows.findIndex(r => r.id === id);
    if (idx < 0) return;
    const orig = rows[idx];
    const copy = recalcMemoryRow({ ...orig, id: makeMemoryRow().id });
    const next = [...rows.slice(0, idx + 1), copy, ...rows.slice(idx + 1)];
    onChange(renumber(next));
  };
  const del = (id: string) => onChange(renumber(rows.filter(r => r.id !== id)));

  const setColLabel = (k: 'a' | 'b' | 'c' | 'd', value: string) => {
    if (!onChangeColumns) return;
    onChangeColumns({ ...(c.calculationMemoryColumns ?? {}), [k]: value });
  };

  const totalAcrescida = rows
    .filter(r => r.type !== 'suprimida')
    .reduce((acc, r) => acc + (Number.isFinite(r.partial) ? r.partial : 0), 0);
  const totalSuprimida = rows
    .filter(r => r.type === 'suprimida')
    .reduce((acc, r) => acc + (Number.isFinite(r.partial) ? r.partial : 0), 0);

  const placeholder = `${labels.a}*${labels.b}*${labels.c}*${labels.d}`;

  return (
    <div className="border rounded-md bg-background p-2 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold text-muted-foreground">
          Memória de cálculo — {c.itemNumber || c.item} {c.description}
        </div>
        {!isLocked && (
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              onClick={() => add('acrescida')}
            >
              <Plus className="w-3 h-3 mr-1" /> Acrescida
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              onClick={() => add('suprimida')}
            >
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
                <EditableHeader
                  value={labels.a}
                  defaultValue="UND"
                  disabled={isLocked || !onChangeColumns}
                  onCommit={v => setColLabel('a', v)}
                />
              </th>
              <th className="px-1.5 py-1 text-right font-medium">
                <EditableHeader
                  value={labels.b}
                  defaultValue="Comprim."
                  disabled={isLocked || !onChangeColumns}
                  onCommit={v => setColLabel('b', v)}
                />
              </th>
              <th className="px-1.5 py-1 text-right font-medium">
                <EditableHeader
                  value={labels.c}
                  defaultValue="Largura"
                  disabled={isLocked || !onChangeColumns}
                  onCommit={v => setColLabel('c', v)}
                />
              </th>
              <th className="px-1.5 py-1 text-right font-medium">
                <EditableHeader
                  value={labels.d}
                  defaultValue="Altura"
                  disabled={isLocked || !onChangeColumns}
                  onCommit={v => setColLabel('d', v)}
                />
              </th>
              <th className="px-1.5 py-1 text-right font-medium">Parcial</th>
              <th className="px-1.5 py-1 text-center font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="text-center text-muted-foreground py-3">
                  Nenhuma linha de memória. Use os botões para adicionar.
                </td>
              </tr>
            )}
            {rows.map((r, idx) => {
              const ev = evalMemoryFormula(r.formula ?? '', {
                a: r.a, b: r.b, c: r.c, d: r.d,
              });
              const isInvalid = !ev.ok;
              const isNegative = ev.ok && ev.value < 0;
              return (
                <tr
                  key={r.id}
                  className={`border-b align-top ${isInvalid ? 'bg-rose-50/50' : r.type === 'suprimida' ? 'bg-rose-50/20' : 'bg-emerald-50/20'}`}
                >
                  <td className="px-1 py-1 text-center font-mono text-muted-foreground">
                    {idx + 1}
                  </td>
                  <td className="px-1.5 py-1">
                    <select
                      value={r.type}
                      disabled={isLocked}
                      onChange={e => update(r.id, { type: e.target.value as 'acrescida' | 'suprimida' })}
                      className="h-7 w-full text-[11px] border border-input rounded-md bg-background px-1"
                    >
                      <option value="acrescida">Acrescida</option>
                      <option value="suprimida">Suprimida</option>
                    </select>
                  </td>
                  <td className="px-1.5 py-1">
                    <Input
                      value={r.comment ?? ''}
                      disabled={isLocked}
                      onChange={e => update(r.id, { comment: e.target.value })}
                      className="h-7 text-[11px]"
                      placeholder="Justificativa"
                    />
                  </td>
                  <td className="px-1.5 py-1">
                    <Input
                      value={r.formula ?? ''}
                      disabled={isLocked}
                      onChange={e => update(r.id, { formula: e.target.value })}
                      className={`h-7 text-[11px] font-mono ${isInvalid ? 'border-rose-400' : ''}`}
                      placeholder={placeholder}
                      title={isInvalid
                        ? ev.error
                        : `Fórmula opcional. Use A, B, C, D, +, -, *, /, ( ). Padrão: ${placeholder}`}
                    />
                  </td>
                  {(['a', 'b', 'c', 'd'] as const).map(k => (
                    <td key={k} className="px-1.5 py-1">
                      <Input
                        type="number"
                        step="0.0001"
                        value={r[k] ?? ''}
                        disabled={isLocked}
                        onChange={e => update(r.id, { [k]: numOrUndef(e.target.value) } as Partial<AdditiveCalculationMemoryRow>)}
                        className="h-7 text-[11px] text-right px-1"
                      />
                    </td>
                  ))}
                  <td className={`px-1.5 py-1 text-right font-medium ${isNegative ? 'text-amber-700' : ''}`}>
                    <div className="inline-flex items-center gap-1">
                      {(isInvalid || isNegative) && (
                        <AlertTriangle
                          className={`w-3 h-3 ${isInvalid ? 'text-rose-600' : 'text-amber-600'}`}
                        />
                      )}
                      {fmtNum(r.partial)}
                    </div>
                  </td>
                  <td className="px-1.5 py-1 text-center">
                    {!isLocked && (
                      <div className="inline-flex gap-0.5">
                        <button
                          onClick={() => dup(r.id)}
                          className="p-1 hover:bg-muted rounded"
                          title="Duplicar"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => del(r.id)}
                          className="p-1 hover:bg-muted rounded text-rose-600"
                          title="Excluir"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t font-medium">
                <td colSpan={8} className="px-1.5 py-1 text-right">
                  Total Acrescida:
                </td>
                <td className="px-1.5 py-1 text-right text-emerald-700">{fmtNum(totalAcrescida)}</td>
                <td />
              </tr>
              <tr className="font-medium">
                <td colSpan={8} className="px-1.5 py-1 text-right">
                  Total Suprimida:
                </td>
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
