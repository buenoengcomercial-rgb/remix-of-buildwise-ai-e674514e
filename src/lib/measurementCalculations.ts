/**
 * Cálculos financeiros puros da Planilha de Medição.
 *
 * Regra fundamental: TRUNCAR (nunca arredondar) em 2 casas decimais
 * em cada etapa intermediária — preço c/ BDI, totais por linha — antes
 * de somar totais gerais.
 */

/** Trunca um número em 2 casas decimais (sem arredondar). */
export function trunc2(value: number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n * 100) / 100;
}

/**
 * Calcula o preço unitário c/ BDI a partir do preço s/ BDI e do percentual de BDI.
 * Resultado já truncado em 2 casas.
 */
export function calculateUnitPriceWithBDI(unitPriceNoBDI: number, bdiPercent: number): number {
  const safeNo = Number(unitPriceNoBDI) || 0;
  const safeBdi = Number.isFinite(bdiPercent) ? Math.max(0, bdiPercent) : 0;
  return trunc2(safeNo * (1 + safeBdi / 100));
}

export interface MeasurementLineInput {
  quantityContracted: number;
  quantityPeriod: number;
  quantityPriorAccum: number;
  unitPriceNoBDI: number;
  bdiPercent: number;
}

export interface MeasurementLineResult {
  unitPriceNoBDI: number;
  unitPriceWithBDI: number;
  quantityCurrentAccum: number;
  quantityBalance: number;
  totalContracted: number;
  totalPeriod: number;
  totalAccumulated: number;
  totalBalance: number;
  percentExecuted: number;
}

/** Calcula uma linha completa da planilha de medição. */
export function calculateMeasurementLine(input: MeasurementLineInput): MeasurementLineResult {
  const qtyContracted = Math.max(0, Number(input.quantityContracted) || 0);
  const qtyPeriod = Math.max(0, Number(input.quantityPeriod) || 0);
  const qtyPrior = Math.max(0, Number(input.quantityPriorAccum) || 0);

  const unitPriceNoBDI = trunc2(input.unitPriceNoBDI);
  const unitPriceWithBDI = calculateUnitPriceWithBDI(unitPriceNoBDI, input.bdiPercent);

  const quantityCurrentAccum = qtyPrior + qtyPeriod;
  const quantityBalance = Math.max(0, qtyContracted - quantityCurrentAccum);

  const totalContracted = trunc2(unitPriceWithBDI * qtyContracted);
  const totalPeriod = trunc2(unitPriceWithBDI * qtyPeriod);
  const totalAccumulated = trunc2(unitPriceWithBDI * quantityCurrentAccum);
  const totalBalance = Math.max(0, trunc2(totalContracted - totalAccumulated));

  const percentExecuted = qtyContracted > 0
    ? trunc2((quantityCurrentAccum / qtyContracted) * 100)
    : 0;

  return {
    unitPriceNoBDI,
    unitPriceWithBDI,
    quantityCurrentAccum,
    quantityBalance,
    totalContracted,
    totalPeriod,
    totalAccumulated,
    totalBalance,
    percentExecuted,
  };
}

export interface MeasurementTotals {
  totalContracted: number;
  totalPeriod: number;
  totalAccumulated: number;
  totalBalance: number;
}

/** Soma totais usando os valores já truncados de cada linha. */
export function calculateMeasurementTotals(lines: MeasurementLineResult[]): MeasurementTotals {
  const totals: MeasurementTotals = {
    totalContracted: 0,
    totalPeriod: 0,
    totalAccumulated: 0,
    totalBalance: 0,
  };
  for (const l of lines) {
    totals.totalContracted = trunc2(totals.totalContracted + l.totalContracted);
    totals.totalPeriod = trunc2(totals.totalPeriod + l.totalPeriod);
    totals.totalAccumulated = trunc2(totals.totalAccumulated + l.totalAccumulated);
    totals.totalBalance = trunc2(totals.totalBalance + l.totalBalance);
  }
  return totals;
}
