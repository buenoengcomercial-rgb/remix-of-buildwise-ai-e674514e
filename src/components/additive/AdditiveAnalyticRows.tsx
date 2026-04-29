import type { AdditiveComposition } from '@/types/project';
import { sumAnalyticTotalNoBDI, money2, truncar2 } from '@/lib/additiveImport';
import { fmtBRL } from './types';

interface Props {
  c: AdditiveComposition;
  bdi: number;
  globalDiscount: number;
  /** Resultado de computeCompositionWithBDI(c, bdi) — passado para evitar recálculo. */
  cb: { totalAnalyticWithBDI: number; diff: number };
}

export default function AdditiveAnalyticRows({ c, bdi, globalDiscount, cb }: Props) {
  const isNew = !!c.isNewService;
  const showDiscount = isNew && globalDiscount > 0;
  const discFactor = showDiscount ? (1 - globalDiscount / 100) : 1;
  const sumNoBDI = sumAnalyticTotalNoBDI(c);
  const sumNoBDIDisc = money2(sumNoBDI * discFactor);
  const qty = c.addedQuantity ?? c.quantity ?? 0;
  const fator = 1 + bdi / 100;
  const totalAnalyticWithBDI = showDiscount
    ? truncar2(truncar2(sumNoBDIDisc * fator) * qty)
    : cb.totalAnalyticWithBDI;

  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="text-muted-foreground">
          <th className="text-left px-1.5 py-1 font-medium">Código</th>
          <th className="text-left px-1.5 py-1 font-medium">Banco</th>
          <th className="text-left px-1.5 py-1 font-medium">Descrição</th>
          <th className="text-left px-1.5 py-1 font-medium">Un</th>
          <th className="text-right px-1.5 py-1 font-medium">Coef.</th>
          <th className="text-right px-1.5 py-1 font-medium">V. Unit s/ BDI</th>
          {showDiscount && (
            <th className="text-right px-1.5 py-1 font-medium text-sky-700">V. Unit s/ BDI c/ Desc.</th>
          )}
          <th className="text-right px-1.5 py-1 font-medium">Total s/ BDI</th>
          {showDiscount && (
            <th className="text-right px-1.5 py-1 font-medium text-sky-700">Total s/ BDI c/ Desc.</th>
          )}
        </tr>
      </thead>
      <tbody>
        {c.inputs.map(i => {
          const unitDisc = money2(i.unitPrice * discFactor);
          const totalDisc = money2(i.coefficient * unitDisc);
          return (
            <tr key={i.id} className="border-t border-border/50">
              <td className="px-1.5 py-1 font-mono">{i.code}</td>
              <td className="px-1.5 py-1">{i.bank}</td>
              <td className="px-1.5 py-1">{i.description}</td>
              <td className="px-1.5 py-1">{i.unit}</td>
              <td className="px-1.5 py-1 text-right">{i.coefficient.toLocaleString('pt-BR')}</td>
              <td className="px-1.5 py-1 text-right">{fmtBRL(i.unitPrice)}</td>
              {showDiscount && (
                <td className="px-1.5 py-1 text-right text-sky-700">{fmtBRL(unitDisc)}</td>
              )}
              <td className="px-1.5 py-1 text-right">{fmtBRL(i.total)}</td>
              {showDiscount && (
                <td className="px-1.5 py-1 text-right text-sky-700">{fmtBRL(totalDisc)}</td>
              )}
            </tr>
          );
        })}
        <tr className="border-t font-medium">
          <td colSpan={showDiscount ? 6 : 6} className="px-1.5 py-1 text-right">Soma analítica s/ BDI:</td>
          {showDiscount && <td />}
          <td className="px-1.5 py-1 text-right">{fmtBRL(sumNoBDI)}</td>
          {showDiscount && <td />}
        </tr>
        {showDiscount && (
          <tr className="font-medium text-sky-700">
            <td colSpan={6} className="px-1.5 py-1 text-right">Soma analítica s/ BDI c/ desconto ({globalDiscount}%):</td>
            <td />
            <td />
            <td className="px-1.5 py-1 text-right">{fmtBRL(sumNoBDIDisc)}</td>
          </tr>
        )}
        <tr className="font-medium text-primary">
          <td colSpan={showDiscount ? 8 : 6} className="px-1.5 py-1 text-right">Valor analítico c/ BDI calculado (× qtd):</td>
          <td className="px-1.5 py-1 text-right">{fmtBRL(totalAnalyticWithBDI)}</td>
        </tr>
      </tbody>
    </table>
  );
}
