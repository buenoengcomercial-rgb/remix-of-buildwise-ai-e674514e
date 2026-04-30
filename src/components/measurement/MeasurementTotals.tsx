import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtBRL, fmtPct } from '@/components/measurement/measurementFormat';
import type { GroupTotals } from '@/components/measurement/types';

interface MeasurementTotalsProps {
  totals: GroupTotals;
  effBdi: number;
}

export default function MeasurementTotals({ totals, effBdi }: MeasurementTotalsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <TotalsBlock title="Sem BDI" rows={[
        ['Custo total da obra', fmtBRL(totals.contractedNoBDI)],
        ['Valor desta medição', fmtBRL(totals.periodNoBDI)],
        ['Valor acumulado', fmtBRL(totals.accumNoBDI)],
        ['Valor a executar', fmtBRL(totals.balanceNoBDI)],
      ]} />
      <TotalsBlock title={`BDI (${fmtPct(effBdi)})`} rows={[
        ['BDI total', fmtBRL(totals.contracted - totals.contractedNoBDI)],
        ['BDI desta medição', fmtBRL(totals.period - totals.periodNoBDI)],
        ['BDI acumulado', fmtBRL(totals.accum - totals.accumNoBDI)],
        ['BDI a executar', fmtBRL(totals.balance - totals.balanceNoBDI)],
      ]} />
      <TotalsBlock title="Com BDI" highlight rows={[
        ['Custo total da obra', fmtBRL(totals.contracted)],
        ['Valor desta medição', fmtBRL(totals.period)],
        ['Valor acumulado', fmtBRL(totals.accum)],
        ['Valor a executar', fmtBRL(totals.balance)],
        ['% desta medição', fmtPct(totals.pctPeriod)],
        ['% acumulado', fmtPct(totals.pctAccum)],
        ['% a executar', fmtPct(totals.pctBalance)],
      ]} />
    </div>
  );
}

function TotalsBlock({
  title, rows, highlight,
}: { title: string; rows: [string, string][]; highlight?: boolean }) {
  return (
    <Card className={`${highlight ? 'border-primary/40 bg-primary/5' : ''} print:break-inside-avoid`}>
      <CardHeader className="py-2 border-b border-border">
        <CardTitle className="text-xs font-bold uppercase tracking-wider">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-xs">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k} className="border-b border-border/60 last:border-0">
                <td className="px-3 py-1.5 text-muted-foreground">{k}</td>
                <td className={`px-3 py-1.5 text-right tabular-nums font-semibold ${highlight ? 'text-primary' : 'text-foreground'}`}>
                  {v}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
