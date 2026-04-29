import { Card } from '@/components/ui/card';
import { fmtBRL } from './types';

interface Totals {
  compCount: number;
  acrescidos: number;
  suprimidos: number;
  impactoSemBDI: number;
  impactoComBDI: number;
  inputCount: number;
  semAnalitico: number;
}

export default function AdditiveSummaryCards({ totals }: { totals: Totals }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
      <Card className="p-3">
        <div className="text-[11px] text-muted-foreground">Composições</div>
        <div className="text-lg font-semibold">{totals.compCount}</div>
      </Card>
      <Card className="p-3">
        <div className="text-[11px] text-muted-foreground">Acrescidas</div>
        <div className="text-lg font-semibold text-emerald-700">{totals.acrescidos}</div>
      </Card>
      <Card className="p-3">
        <div className="text-[11px] text-muted-foreground">Suprimidas</div>
        <div className="text-lg font-semibold text-rose-700">{totals.suprimidos}</div>
      </Card>
      <Card className="p-3">
        <div className="text-[11px] text-muted-foreground">Impacto s/ BDI</div>
        <div className={`text-lg font-semibold ${totals.impactoSemBDI < 0 ? 'text-rose-700' : ''}`}>
          {fmtBRL(totals.impactoSemBDI)}
        </div>
      </Card>
      <Card className="p-3">
        <div className="text-[11px] text-muted-foreground">Impacto c/ BDI</div>
        <div className={`text-lg font-semibold ${totals.impactoComBDI < 0 ? 'text-rose-700' : 'text-primary'}`}>
          {fmtBRL(totals.impactoComBDI)}
        </div>
      </Card>
      <Card className="p-3">
        <div className="text-[11px] text-muted-foreground">Insumos</div>
        <div className="text-lg font-semibold">{totals.inputCount}</div>
      </Card>
      <Card className="p-3">
        <div className="text-[11px] text-muted-foreground">Sem analítico</div>
        <div className={`text-lg font-semibold ${totals.semAnalitico > 0 ? 'text-amber-600' : ''}`}>
          {totals.semAnalitico}
        </div>
      </Card>
    </div>
  );
}
