import { Card, CardContent } from '@/components/ui/card';
import { fmtBRL, fmtPct } from '@/components/measurement/measurementFormat';
import type { GroupTotals } from '@/components/measurement/types';

interface MeasurementSummaryCardsProps {
  totals: GroupTotals;
}

export default function MeasurementSummaryCards({ totals }: MeasurementSummaryCardsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      <SummaryCard label="Contratado c/ BDI" value={fmtBRL(totals.contracted)} />
      <SummaryCard label="Desta medição" value={fmtBRL(totals.period)} highlight />
      <SummaryCard label="Acumulado" value={fmtBRL(totals.accum)} />
      <SummaryCard label="Saldo a executar" value={fmtBRL(totals.balance)} />
      <SummaryCard label="% desta medição" value={fmtPct(totals.pctPeriod)} />
      <SummaryCard label="% acumulado" value={fmtPct(totals.pctAccum)} />
    </div>
  );
}

function SummaryCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <Card className={highlight ? 'border-primary/40 bg-primary/5' : ''}>
      <CardContent className="p-3">
        <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">{label}</p>
        <p className={`text-sm font-bold mt-1 tabular-nums ${highlight ? 'text-primary' : 'text-foreground'}`}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
