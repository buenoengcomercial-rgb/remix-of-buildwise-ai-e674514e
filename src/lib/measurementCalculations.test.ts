import { describe, it, expect } from 'vitest';
import {
  trunc2,
  calculateUnitPriceWithBDI,
  calculateMeasurementLine,
  calculateMeasurementTotals,
} from './measurementCalculations';

describe('trunc2', () => {
  it('trunca sem arredondar para baixo', () => {
    expect(trunc2(10.999)).toBe(10.99);
    expect(trunc2(10.994)).toBe(10.99);
  });
  it('mantém valor exato', () => {
    expect(trunc2(10.001)).toBe(10);
    expect(trunc2(0)).toBe(0);
  });
  it('trata valores inválidos como 0', () => {
    expect(trunc2(NaN)).toBe(0);
    expect(trunc2(undefined)).toBe(0);
    expect(trunc2(null)).toBe(0);
  });
});

describe('calculateUnitPriceWithBDI', () => {
  it('aplica BDI simples (100 + 25%)', () => {
    expect(calculateUnitPriceWithBDI(100, 25)).toBe(125);
  });
  it('trunca e não arredonda preço com BDI decimal', () => {
    // 424.83 * 1.2758 = 541.998114 → trunca para 541.99 (arredondaria para 542.00)
    const result = calculateUnitPriceWithBDI(424.83, 27.58);
    expect(result).toBe(541.99);
    expect(result).not.toBe(542);
  });
  it('caso clássico de truncamento abaixo do arredondamento (10.999 vs 11.00)', () => {
    // 10.999 * 1 = 10.999 → trunca 10.99 (arredondaria 11.00)
    expect(calculateUnitPriceWithBDI(10.999, 0)).toBe(10.99);
  });
  it('BDI 0 retorna o próprio preço', () => {
    expect(calculateUnitPriceWithBDI(100, 0)).toBe(100);
  });
});

describe('calculateMeasurementLine — total contratado', () => {
  it('multiplica quantidade contratada pelo preço c/ BDI truncado', () => {
    const r = calculateMeasurementLine({
      quantityContracted: 6,
      quantityPeriod: 0,
      quantityPriorAccum: 0,
      unitPriceNoBDI: 424.83,
      bdiPercent: 27.58,
    });
    // c/BDI truncado = 541.99 → 6 * 541.99 = 3251.94
    expect(r.unitPriceWithBDI).toBe(541.99);
    expect(r.totalContracted).toBe(3251.94);
  });
});

describe('calculateMeasurementLine — valor desta medição / acumulado / saldo', () => {
  const base = {
    quantityContracted: 6,
    quantityPriorAccum: 3,
    quantityPeriod: 2,
    unitPriceNoBDI: 100,
    bdiPercent: 25,
  };

  it('valor desta medição = qty * unit c/ BDI truncado', () => {
    const r = calculateMeasurementLine(base);
    expect(r.unitPriceWithBDI).toBe(125);
    expect(r.totalPeriod).toBe(250); // 2 * 125
  });

  it('acumulado correto', () => {
    const r = calculateMeasurementLine(base);
    expect(r.quantityCurrentAccum).toBe(5);
    expect(r.totalAccumulated).toBe(625); // 5 * 125
  });

  it('saldo correto', () => {
    const r = calculateMeasurementLine(base);
    expect(r.quantityBalance).toBe(1);
    expect(r.totalBalance).toBe(125); // 1 * 125
  });

  it('saldo nunca negativo quando acumulado ultrapassa o contratado', () => {
    const r = calculateMeasurementLine({
      quantityContracted: 6,
      quantityPriorAccum: 6,
      quantityPeriod: 2, // acumulado = 8 > 6
      unitPriceNoBDI: 100,
      bdiPercent: 25,
    });
    expect(r.quantityBalance).toBe(0);
    expect(r.totalBalance).toBe(0);
  });
});

describe('calculateMeasurementLine — percentual executado', () => {
  it('20% quando 2 de 10', () => {
    const r = calculateMeasurementLine({
      quantityContracted: 10,
      quantityPriorAccum: 0,
      quantityPeriod: 2,
      unitPriceNoBDI: 100,
      bdiPercent: 0,
    });
    expect(r.percentExecuted).toBe(20);
  });
  it('0% quando contratado = 0', () => {
    const r = calculateMeasurementLine({
      quantityContracted: 0,
      quantityPriorAccum: 0,
      quantityPeriod: 0,
      unitPriceNoBDI: 100,
      bdiPercent: 25,
    });
    expect(r.percentExecuted).toBe(0);
  });
});

describe('calculateMeasurementTotals', () => {
  it('soma totais já truncados das linhas', () => {
    const l1 = calculateMeasurementLine({
      quantityContracted: 6, quantityPriorAccum: 0, quantityPeriod: 2,
      unitPriceNoBDI: 424.83, bdiPercent: 27.58,
    });
    const l2 = calculateMeasurementLine({
      quantityContracted: 10, quantityPriorAccum: 1, quantityPeriod: 3,
      unitPriceNoBDI: 100, bdiPercent: 25,
    });
    const l3 = calculateMeasurementLine({
      quantityContracted: 4, quantityPriorAccum: 0, quantityPeriod: 1,
      unitPriceNoBDI: 50.55, bdiPercent: 20,
    });
    const totals = calculateMeasurementTotals([l1, l2, l3]);
    const expectedContracted = trunc2(l1.totalContracted + l2.totalContracted + l3.totalContracted);
    const expectedPeriod = trunc2(l1.totalPeriod + l2.totalPeriod + l3.totalPeriod);
    expect(totals.totalContracted).toBe(expectedContracted);
    expect(totals.totalPeriod).toBe(expectedPeriod);
  });
});

describe('calculateMeasurementLine — totais s/ BDI', () => {
  it('calcula totais sem BDI usando preço s/ BDI truncado', () => {
    const r = calculateMeasurementLine({
      quantityContracted: 6,
      quantityPriorAccum: 1,
      quantityPeriod: 2,
      unitPriceNoBDI: 100,
      bdiPercent: 25,
    });
    expect(r.totalContractedNoBDI).toBe(600); // 6 * 100
    expect(r.totalPeriodNoBDI).toBe(200);     // 2 * 100
    expect(r.totalAccumulatedNoBDI).toBe(300); // 3 * 100
    expect(r.totalBalanceNoBDI).toBe(300);    // 600 - 300
  });
  it('saldo s/ BDI nunca negativo', () => {
    const r = calculateMeasurementLine({
      quantityContracted: 5,
      quantityPriorAccum: 4,
      quantityPeriod: 3,
      unitPriceNoBDI: 100,
      bdiPercent: 25,
    });
    expect(r.totalBalanceNoBDI).toBe(0);
  });
  it('trunca total s/ BDI sem arredondar', () => {
    const r = calculateMeasurementLine({
      quantityContracted: 3,
      quantityPriorAccum: 0,
      quantityPeriod: 0,
      unitPriceNoBDI: 10.999,
      bdiPercent: 0,
    });
    // unitPriceNoBDI truncado = 10.99 → 3 * 10.99 = 32.97
    expect(r.totalContractedNoBDI).toBe(32.97);
  });
});
  it('mudar BDI altera apenas preço c/ BDI e totais; preço s/ BDI permanece', () => {
    const input = {
      quantityContracted: 6, quantityPriorAccum: 0, quantityPeriod: 2,
      unitPriceNoBDI: 100,
    };
    const r25 = calculateMeasurementLine({ ...input, bdiPercent: 25 });
    const r30 = calculateMeasurementLine({ ...input, bdiPercent: 30 });
    expect(r25.unitPriceNoBDI).toBe(100);
    expect(r30.unitPriceNoBDI).toBe(100);
    expect(r25.unitPriceWithBDI).toBe(125);
    expect(r30.unitPriceWithBDI).toBe(130);
    expect(r25.totalContracted).toBe(750);
    expect(r30.totalContracted).toBe(780);
    expect(r25.totalPeriod).toBe(250);
    expect(r30.totalPeriod).toBe(260);
  });
});

describe('Snapshot de medição congelado', () => {
  it('snapshot mantém BDI antigo mesmo após mudança no projeto', () => {
    // Snapshot gerado com BDI 25 — guardamos os valores
    const snapshot = calculateMeasurementLine({
      quantityContracted: 6, quantityPriorAccum: 0, quantityPeriod: 2,
      unitPriceNoBDI: 100, bdiPercent: 25,
    });
    const frozen = { ...snapshot };

    // Projeto muda para BDI 30 — recalculo "live"
    const live = calculateMeasurementLine({
      quantityContracted: 6, quantityPriorAccum: 0, quantityPeriod: 2,
      unitPriceNoBDI: 100, bdiPercent: 30,
    });

    // Snapshot original não pode mudar
    expect(frozen.unitPriceWithBDI).toBe(125);
    expect(frozen.totalPeriod).toBe(250);
    // Live reflete o novo BDI
    expect(live.unitPriceWithBDI).toBe(130);
    expect(live.totalPeriod).toBe(260);
  });
});

describe('Acumulado entre medições', () => {
  it('M1 mede 2, M2 mede 3 → acumulado da M2 = 5, saldo = 5', () => {
    const m1 = calculateMeasurementLine({
      quantityContracted: 10, quantityPriorAccum: 0, quantityPeriod: 2,
      unitPriceNoBDI: 100, bdiPercent: 0,
    });
    expect(m1.quantityCurrentAccum).toBe(2);
    expect(m1.quantityBalance).toBe(8);

    const m2 = calculateMeasurementLine({
      quantityContracted: 10,
      quantityPriorAccum: m1.quantityCurrentAccum, // 2
      quantityPeriod: 3,
      unitPriceNoBDI: 100, bdiPercent: 0,
    });
    expect(m2.quantityCurrentAccum).toBe(5);
    expect(m2.quantityBalance).toBe(5);
    expect(m2.totalAccumulated).toBe(500);
    expect(m2.totalBalance).toBe(500);
  });
});
