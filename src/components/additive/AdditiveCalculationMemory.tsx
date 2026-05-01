import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Copy, Trash2, AlertTriangle } from 'lucide-react';
import type {
  AdditiveComposition,
  AdditiveCalculationMemoryRow,
} from '@/types/project';
import {
  evalMemoryFormula,
  makeMemoryRow,
  recalcMemoryRow,
} from '@/lib/calculationMemory';
import { fmtNum } from './types';

interface Props {
  c: AdditiveComposition;
  isLocked: boolean;
  onChange: (rows: AdditiveCalculationMemoryRow[]) => void;
}

const numOrUndef = (v: string): number | undefined => {
  if (v === '' || v == null) return undefined;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
};

export default function AdditiveCalculationMemory({ c, isLocked, onChange }: Props) {
  const rows = c.calculationMemory ?? [];

  const update = (id: string, patch: Partial<AdditiveCalculationMemoryRow>) => {
    const next = rows.map(r => (r.id === id ? recalcMemoryRow({ ...r, ...patch }) : r));
    onChange(next);
  };
  const add = (type: 'acrescida' | 'suprimida' = 'acrescida') => {
    onChange([...rows, makeMemoryRow(type)]);
  };
  const dup = (id: string) => {
    const idx = rows.findIndex(r => r.id === id);
    if (idx < 0) return;
    const orig = rows[idx];
    const copy = recalcMemoryRow({ ...orig, id: makeMemoryRow().id });
    const next = [...rows.slice(0, idx + 1), copy, ...rows.slice(idx + 1)];
    onChange(next);
  };
  const del = (id: string) => onChange(rows.filter(r => r.id !== id));

  const totalAcrescida = rows
    .filter(r => r.type !== 'suprimida')
    .reduce((acc, r) => acc + (Number.isFinite(r.partial) ? r.partial : 0), 0);
  const totalSuprimida = rows
    .filter(r => r.type === 'suprimida')
    .reduce((acc, r) => acc + (Number.isFinite(r.partial) ? r.partial : 0), 0);

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
        <table className="w-full text-[11px]">
          <thead className="text-muted-foreground">
            <tr className="border-b">
              <th className="px-1.5 py-1 text-left font-medium w-[110px]">Tipo</th>
              <th className="px-1.5 py-1 text-left font-medium">Loc</th>
              <th className="px-1.5 py-1 text-left font-medium">Comentário</th>
              <th className="px-1.5 py-1 text-left font-medium w-[140px]">Fórmula</th>
              <th className="px-1.5 py-1 text-right font-medium w-[70px]">A</th>
              <th className="px-1.5 py-1 text-right font-medium w-[70px]">B</th>
              <th className="px-1.5 py-1 text-right font-medium w-[70px]">C</th>
              <th className="px-1.5 py-1 text-right font-medium w-[70px]">D</th>
              <th className="px-1.5 py-1 text-right font-medium w-[80px]">Parcial</th>
              <th className="px-1.5 py-1 text-center font-medium w-[80px]">Ações</th>
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
            {rows.map(r => {
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
                      value={r.loc ?? ''}
                      disabled={isLocked}
                      onChange={e => update(r.id, { loc: e.target.value })}
                      className="h-7 text-[11px]"
                      placeholder="Ex.: Entrada de bomba"
                    />
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
                      placeholder="A*B*C*D"
                      title={isInvalid ? ev.error : 'Fórmula opcional. Use A, B, C, D, +, -, *, /, ( )'}
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
                        className="h-7 text-[11px] text-right"
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
