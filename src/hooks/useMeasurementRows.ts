/**
 * Cálculo das linhas, grupos, totais e validação da Planilha de Medição.
 * Toda a lógica financeira vem de @/lib/measurementCalculations.
 * Não modifica nada — apenas espelha o que o componente Measurement já fazia.
 */
import { useMemo } from 'react';
import type { Project, Phase, SavedMeasurement, Task } from '@/types/project';
import { trunc2, money2, calculateMeasurementLine } from '@/lib/measurementCalculations';
import { getChapterTree, getChapterNumbering, ChapterNode } from '@/lib/chapters';
import { validateMeasurement, summarizeIssues, type ValidationIssue } from '@/lib/measurementValidation';
import { summarizeDailyReportsForPeriod } from '@/lib/dailyReportSummary';
import type { Row, GroupNode } from '@/components/measurement/types';
import { emptyTotals, estimateTaskValue, buildOrderedTasks } from '@/components/measurement/measurementFormat';

export interface UseMeasurementRowsParams {
  project: Project;
  measurements: SavedMeasurement[];
  activeMeasurement: SavedMeasurement | null;
  isSnapshotMode: boolean;
  effStart: string;
  effEnd: string;
  effBdi: number;
  effBdiFactor: number;
  startDate: string;
  endDate: string;
  measurementNumber: string;
  chapterFilter: string;
  search: string;
  contractor: string;
  contracted: string;
  contractNumber: string;
  contractObject: string;
  location: string;
  budgetSource: string;
  bdiPercent: number;
}

export function useMeasurementRows(params: UseMeasurementRowsParams) {
  const {
    project, measurements, activeMeasurement, isSnapshotMode,
    effStart, effEnd, effBdi, effBdiFactor,
    startDate, endDate, measurementNumber, chapterFilter, search,
    contractor, contracted, contractNumber, contractObject, location, budgetSource, bdiPercent,
  } = params;

  const numbering = useMemo(() => getChapterNumbering(project), [project]);
  const orderedTasks = useMemo(() => buildOrderedTasks(project), [project]);

  // Itens financeiros: Sintética + aditivos APROVADOS
  const syntheticBudgetItems = useMemo(
    () => (project.budgetItems || []).filter(b => b.source === 'sintetica' || b.source === 'aditivo'),
    [project.budgetItems],
  );
  const hasSyntheticBudget = syntheticBudgetItems.length > 0;

  // Acumulado anterior por tarefa (medições aprovadas/geradas anteriores), apenas em modo live
  const priorAccumByTask = useMemo<Map<string, number>>(() => {
    const map = new Map<string, number>();
    if (isSnapshotMode) return map;
    measurements.forEach(m => {
      if (m.status === 'draft' || m.status === 'rejected') return;
      m.items.forEach(it => {
        const qty = it.qtyApproved ?? it.qtyProposed ?? 0;
        map.set(it.taskId, (map.get(it.taskId) || 0) + qty);
      });
    });
    return map;
  }, [measurements, isSnapshotMode]);

  const rows: Row[] = useMemo(() => {
    if (isSnapshotMode && activeMeasurement) {
      // Snapshot: não recalcula da EAP — usa o que foi salvo
      return activeMeasurement.items.map(it => {
        const qtyPeriod = it.qtyApproved ?? it.qtyProposed ?? 0;
        const snapNoBDI = trunc2(it.unitPriceNoBDI);
        const snapWithBDI = trunc2(it.unitPriceWithBDI);
        const implicitBdi = snapNoBDI > 0 ? ((snapWithBDI / snapNoBDI) - 1) * 100 : 0;
        const calc = calculateMeasurementLine({
          quantityContracted: it.qtyContracted,
          quantityPeriod: qtyPeriod,
          quantityPriorAccum: it.qtyPriorAccum,
          unitPriceNoBDI: snapNoBDI,
          bdiPercent: implicitBdi,
        });
        return {
          item: it.item,
          phaseId: it.phaseId,
          phaseChain: it.phaseChain,
          taskId: it.taskId,
          description: it.description,
          unit: it.unit,
          itemCode: it.itemCode,
          priceBank: it.priceBank,
          qtyContracted: it.qtyContracted,
          qtyPriorAccum: it.qtyPriorAccum,
          qtyPeriod,
          qtyProposed: it.qtyProposed,
          qtyApproved: it.qtyApproved,
          qtyCurrentAccum: calc.quantityCurrentAccum,
          qtyBalance: calc.quantityBalance,
          percentExecuted: calc.percentExecuted,
          unitPriceNoBDI: calc.unitPriceNoBDI,
          unitPriceWithBDI: calc.unitPriceWithBDI,
          unitPriceIsEstimated: false,
          valueContractedNoBDI: calc.totalContractedNoBDI,
          valuePeriodNoBDI: calc.totalPeriodNoBDI,
          valueAccumNoBDI: calc.totalAccumulatedNoBDI,
          valueBalanceNoBDI: calc.totalBalanceNoBDI,
          valueContracted: calc.totalContracted,
          valuePeriod: calc.totalPeriod,
          valueAccum: calc.totalAccumulated,
          valueBalance: calc.totalBalance,
          hasNoLogsInPeriod: qtyPeriod === 0,
          hasNoLogsAtAll: false,
          notes: it.notes,
        };
      });
    }

    // ── Live: cruza EAP com Sintética ──
    const normalizeCode = (s: string | undefined | null): string => {
      if (!s) return '';
      let v = String(s).trim().toUpperCase();
      v = v.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      v = v.replace(/\s+/g, ' ');
      return v;
    };
    const normalizeNumeric = (s: string | undefined | null): string => {
      const v = normalizeCode(s);
      return v.split('.').map(seg => /^\d+$/.test(seg) ? String(parseInt(seg, 10)) : seg).join('.');
    };
    const normalizeDesc = (s: string | undefined | null): string => normalizeCode(s).replace(/[^A-Z0-9 ]/g, '');

    const computeQtyFromTask = (task: Task | undefined): { prior: number; period: number; hasNoLogsAtAll: boolean; hasNoLogsInPeriod: boolean } => {
      if (!task) return { prior: 0, period: 0, hasNoLogsAtAll: true, hasNoLogsInPeriod: true };
      const logs = task.dailyLogs || [];
      const hasNoLogsAtAll = logs.length === 0;
      let prior = 0;
      let period = 0;
      let hasLogsInPeriod = false;
      if (!hasNoLogsAtAll) {
        for (const log of logs) {
          const d = log.date;
          if (d < effStart) prior += log.actualQuantity || 0;
          else if (d >= effStart && d <= effEnd) {
            period += log.actualQuantity || 0;
            if ((log.actualQuantity || 0) > 0) hasLogsInPeriod = true;
          }
        }
      }
      return { prior, period, hasNoLogsAtAll, hasNoLogsInPeriod: !hasLogsInPeriod };
    };

    const budgetById = new Map<string, typeof syntheticBudgetItems[number]>();
    const budgetQueueByCode = new Map<string, typeof syntheticBudgetItems>();
    const budgetQueueByItem = new Map<string, typeof syntheticBudgetItems>();
    const budgetQueueByDesc = new Map<string, typeof syntheticBudgetItems>();
    const consumed = new Set<string>();

    if (hasSyntheticBudget) {
      syntheticBudgetItems.forEach(b => {
        budgetById.set(b.id, b);
        const cKey = normalizeCode(b.code);
        if (cKey) {
          const arr = budgetQueueByCode.get(cKey) || [];
          arr.push(b);
          budgetQueueByCode.set(cKey, arr);
        }
        const iKey = normalizeNumeric(b.item);
        if (iKey) {
          const arr = budgetQueueByItem.get(iKey) || [];
          arr.push(b);
          budgetQueueByItem.set(iKey, arr);
        }
        const dKey = normalizeDesc(b.description);
        if (dKey) {
          const arr = budgetQueueByDesc.get(dKey) || [];
          arr.push(b);
          budgetQueueByDesc.set(dKey, arr);
        }
      });
    }

    const popFromQueue = (q: typeof syntheticBudgetItems | undefined): typeof syntheticBudgetItems[number] | undefined => {
      if (!q) return undefined;
      while (q.length > 0) {
        const candidate = q.shift()!;
        if (!consumed.has(candidate.id)) {
          consumed.add(candidate.id);
          return candidate;
        }
      }
      return undefined;
    };

    const matchBudgetForTask = (task: Task): typeof syntheticBudgetItems[number] | undefined => {
      if (!hasSyntheticBudget) return undefined;
      const direct = syntheticBudgetItems.find(b => b.taskId === task.id && !consumed.has(b.id));
      if (direct) { consumed.add(direct.id); return direct; }
      const codeKey = normalizeCode(task.itemCode);
      if (codeKey) {
        const m = popFromQueue(budgetQueueByCode.get(codeKey));
        if (m) return m;
      }
      const descKey = normalizeDesc(task.name);
      if (descKey) {
        const m = popFromQueue(budgetQueueByDesc.get(descKey));
        if (m) return m;
      }
      return undefined;
    };

    const eapRows: Row[] = orderedTasks.map(({ task, phase, itemNumber, chain }) => {
      const matchedBudget = matchBudgetForTask(task);

      const qtyContracted = matchedBudget
        ? (matchedBudget.quantity || 0)
        : (task.quantity ?? task.baseline?.quantity ?? 0);
      const unit = matchedBudget?.unit || task.unit || '';

      const logsInfo = computeQtyFromTask(task);
      const priorFromMeas = priorAccumByTask.get(task.id) || 0;
      const qtyPriorAccum = Math.max(logsInfo.prior, priorFromMeas);
      let qtyPeriod = logsInfo.period;
      if (logsInfo.hasNoLogsAtAll) {
        qtyPeriod = 0;
      }

      let unitPriceNoBDIBase = 0;
      let unitPriceIsEstimated = false;
      let lineBdi = effBdi;

      if (matchedBudget) {
        const noBDI = money2(matchedBudget.unitPriceNoBDI);
        const withBDI = money2(matchedBudget.unitPriceWithBDI);
        unitPriceNoBDIBase = noBDI;
        lineBdi = noBDI > 0 ? ((withBDI / noBDI) - 1) * 100 : effBdi;
      } else if ((task.unitPriceNoBDI ?? 0) > 0) {
        unitPriceNoBDIBase = task.unitPriceNoBDI!;
      } else if ((task.unitPrice ?? 0) > 0) {
        const withBDI = trunc2(task.unitPrice!);
        unitPriceNoBDIBase = trunc2(withBDI / effBdiFactor);
      } else {
        const est = estimateTaskValue(task);
        const withBDI = qtyContracted > 0 ? trunc2(est / qtyContracted) : 0;
        unitPriceNoBDIBase = trunc2(withBDI / effBdiFactor);
        unitPriceIsEstimated = withBDI > 0;
      }

      const calc = calculateMeasurementLine({
        quantityContracted: qtyContracted,
        quantityPeriod: qtyPeriod,
        quantityPriorAccum: qtyPriorAccum,
        unitPriceNoBDI: unitPriceNoBDIBase,
        bdiPercent: lineBdi,
      });

      const valueContracted = matchedBudget
        ? money2(matchedBudget.totalWithBDI || calc.totalContracted)
        : calc.totalContracted;
      const valueContractedNoBDI = matchedBudget
        ? money2(matchedBudget.totalNoBDI || calc.totalContractedNoBDI)
        : calc.totalContractedNoBDI;
      const valueBalance = matchedBudget
        ? Math.max(0, money2(valueContracted - calc.totalAccumulated))
        : calc.totalBalance;
      const valueBalanceNoBDI = matchedBudget
        ? Math.max(0, money2(valueContractedNoBDI - calc.totalAccumulatedNoBDI))
        : calc.totalBalanceNoBDI;

      return {
        item: itemNumber, phaseId: phase.id, phaseChain: chain, taskId: task.id,
        description: task.name, unit,
        itemCode: matchedBudget?.code || task.itemCode || '',
        priceBank: matchedBudget?.bank || task.priceBank || '',
        qtyContracted, qtyPriorAccum, qtyPeriod,
        qtyProposed: qtyPeriod,
        qtyApproved: undefined,
        qtyCurrentAccum: calc.quantityCurrentAccum,
        qtyBalance: calc.quantityBalance,
        percentExecuted: qtyContracted > 0 ? calc.percentExecuted : (task.percentComplete || 0),
        unitPriceNoBDI: calc.unitPriceNoBDI,
        unitPriceWithBDI: calc.unitPriceWithBDI,
        unitPriceIsEstimated,
        valueContractedNoBDI,
        valuePeriodNoBDI: calc.totalPeriodNoBDI,
        valueAccumNoBDI: calc.totalAccumulatedNoBDI,
        valueBalanceNoBDI,
        valueContracted,
        valuePeriod: calc.totalPeriod,
        valueAccum: calc.totalAccumulated,
        valueBalance,
        hasNoLogsInPeriod: logsInfo.hasNoLogsInPeriod,
        hasNoLogsAtAll: logsInfo.hasNoLogsAtAll,
      };
    });

    // Itens da Sintética sem vínculo na EAP / itens de Aditivo aprovado
    const orphanRows: Row[] = [];
    if (hasSyntheticBudget) {
      syntheticBudgetItems.forEach(b => {
        if (consumed.has(b.id)) return;
        const noBDI = money2(b.unitPriceNoBDI);
        const withBDI = money2(b.unitPriceWithBDI);
        const implicitBdi = noBDI > 0 ? ((withBDI / noBDI) - 1) * 100 : effBdi;
        const calc = calculateMeasurementLine({
          quantityContracted: b.quantity || 0,
          quantityPeriod: 0,
          quantityPriorAccum: 0,
          unitPriceNoBDI: noBDI,
          bdiPercent: implicitBdi,
        });
        const valueContracted = money2(b.totalWithBDI || calc.totalContracted);
        const valueContractedNoBDI = money2(b.totalNoBDI || calc.totalContractedNoBDI);
        const isAdditive = b.source === 'aditivo';
        orphanRows.push({
          item: b.item,
          phaseId: isAdditive ? '__additive_items__' : '__synthetic_orphans__',
          phaseChain: isAdditive ? 'Itens de Aditivo aprovado' : 'Itens da Sintética sem vínculo na EAP',
          taskId: `budget-${b.id}`,
          description: b.description,
          unit: b.unit,
          itemCode: b.code,
          priceBank: b.bank,
          qtyContracted: b.quantity || 0,
          qtyPriorAccum: 0,
          qtyPeriod: 0,
          qtyProposed: 0,
          qtyApproved: undefined,
          qtyCurrentAccum: 0,
          qtyBalance: b.quantity || 0,
          percentExecuted: 0,
          unitPriceNoBDI: noBDI,
          unitPriceWithBDI: withBDI,
          unitPriceIsEstimated: false,
          valueContractedNoBDI,
          valuePeriodNoBDI: 0,
          valueAccumNoBDI: 0,
          valueBalanceNoBDI: valueContractedNoBDI,
          valueContracted,
          valuePeriod: 0,
          valueAccum: 0,
          valueBalance: valueContracted,
          hasNoLogsInPeriod: true,
          hasNoLogsAtAll: true,
        });
      });
    }

    return [...eapRows, ...orphanRows];
  }, [isSnapshotMode, activeMeasurement, orderedTasks, effStart, effEnd, effBdi, effBdiFactor, priorAccumByTask, hasSyntheticBudget, syntheticBudgetItems]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (!isSnapshotMode && chapterFilter !== 'all') {
        const phase = project.phases.find(p => p.id === r.phaseId);
        let match = false;
        let cur: Phase | undefined = phase;
        while (cur) {
          if (cur.id === chapterFilter) { match = true; break; }
          cur = cur.parentId ? project.phases.find(p => p.id === cur!.parentId) : undefined;
        }
        if (!match) return false;
      }
      if (q) {
        const blob = `${r.item} ${r.phaseChain} ${r.description} ${r.itemCode}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [rows, chapterFilter, search, project.phases, isSnapshotMode]);

  // Diários do período
  const dailyReportsSummary = useMemo(
    () => summarizeDailyReportsForPeriod(project, effStart, effEnd),
    [project, effStart, effEnd],
  );

  // Validação (somente live)
  const validationIssues: ValidationIssue[] = useMemo(() => {
    if (activeMeasurement) return [];
    return validateMeasurement({
      startDate,
      endDate,
      measurementNumber,
      rows: rows.map(r => ({
        taskId: r.taskId,
        description: r.description,
        itemCode: r.itemCode,
        priceBank: r.priceBank,
        unitPriceNoBDI: r.unitPriceNoBDI,
        qtyContracted: r.qtyContracted,
        qtyPeriod: r.qtyPeriod,
        qtyPriorAccum: r.qtyPriorAccum,
        qtyCurrentAccum: r.qtyCurrentAccum,
        qtyBalance: r.qtyBalance,
      })),
      measurements,
      contract: {
        contractor, contracted, contractNumber, contractObject, location,
        budgetSource, bdiPercent,
      },
      dailyReports: {
        missingReports: dailyReportsSummary.missingReports,
        productionWithoutReportDays: dailyReportsSummary.productionWithoutReportDates.length,
        impedimentDays: dailyReportsSummary.impedimentDays,
      },
    });
  }, [activeMeasurement, startDate, endDate, measurementNumber, rows, measurements, contractor, contracted, contractNumber, contractObject, location, budgetSource, bdiPercent, dailyReportsSummary]);
  const validationSummary = useMemo(() => summarizeIssues(validationIssues), [validationIssues]);

  const hasDailyWarnings =
    !activeMeasurement && (
      dailyReportsSummary.missingReports > 0 ||
      dailyReportsSummary.productionWithoutReportDates.length > 0 ||
      dailyReportsSummary.impedimentDays > 0
    );

  // Árvore de grupos
  const groupTree: GroupNode[] = useMemo(() => {
    const rowsByPhase = new Map<string, Row[]>();
    filteredRows.forEach(r => {
      const arr = rowsByPhase.get(r.phaseId) || [];
      arr.push(r);
      rowsByPhase.set(r.phaseId, arr);
    });

    const tree = getChapterTree(project);

    const buildNode = (chapterNode: ChapterNode, depth: number): GroupNode | null => {
      const directRows = rowsByPhase.get(chapterNode.phase.id) || [];
      const childGroups = chapterNode.children
        .map(c => buildNode(c, depth + 1))
        .filter((g): g is GroupNode => g !== null);
      if (directRows.length === 0 && childGroups.length === 0) return null;

      const totals = emptyTotals();
      directRows.forEach(r => {
        totals.contracted += r.valueContracted;
        totals.period += r.valuePeriod;
        totals.accum += r.valueAccum;
        totals.balance += r.valueBalance;
        totals.contractedNoBDI += r.valueContractedNoBDI;
        totals.periodNoBDI += r.valuePeriodNoBDI;
        totals.accumNoBDI += r.valueAccumNoBDI;
        totals.balanceNoBDI += r.valueBalanceNoBDI;
        totals.qtyContracted += r.qtyContracted;
        totals.qtyAccum += r.qtyCurrentAccum;
      });
      childGroups.forEach(c => {
        totals.contracted += c.totals.contracted;
        totals.period += c.totals.period;
        totals.accum += c.totals.accum;
        totals.balance += c.totals.balance;
        totals.contractedNoBDI += c.totals.contractedNoBDI;
        totals.periodNoBDI += c.totals.periodNoBDI;
        totals.accumNoBDI += c.totals.accumNoBDI;
        totals.balanceNoBDI += c.totals.balanceNoBDI;
        totals.qtyContracted += c.totals.qtyContracted;
        totals.qtyAccum += c.totals.qtyAccum;
      });

      return {
        phaseId: chapterNode.phase.id,
        number: numbering.get(chapterNode.phase.id) || '',
        name: chapterNode.phase.name,
        depth, rows: directRows, children: childGroups, totals,
      };
    };

    const groups = tree
      .map(n => buildNode(n, 0))
      .filter((g): g is GroupNode => g !== null);
    const sorted = groups.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));

    const orphanRows = rowsByPhase.get('__synthetic_orphans__') || [];
    if (orphanRows.length > 0) {
      const orphanTotals = emptyTotals();
      orphanRows.forEach(r => {
        orphanTotals.contracted += r.valueContracted;
        orphanTotals.period += r.valuePeriod;
        orphanTotals.accum += r.valueAccum;
        orphanTotals.balance += r.valueBalance;
        orphanTotals.contractedNoBDI += r.valueContractedNoBDI;
        orphanTotals.periodNoBDI += r.valuePeriodNoBDI;
        orphanTotals.accumNoBDI += r.valueAccumNoBDI;
        orphanTotals.balanceNoBDI += r.valueBalanceNoBDI;
        orphanTotals.qtyContracted += r.qtyContracted;
        orphanTotals.qtyAccum += r.qtyCurrentAccum;
      });
      sorted.push({
        phaseId: '__synthetic_orphans__',
        number: '∅',
        name: 'Itens da Sintética sem vínculo na EAP',
        depth: 0,
        rows: orphanRows,
        children: [],
        totals: orphanTotals,
      });
    }
    return sorted;
  }, [filteredRows, project, numbering]);

  const totals = useMemo(() => {
    const t = emptyTotals();
    filteredRows.forEach(r => {
      t.contracted += r.valueContracted; t.period += r.valuePeriod;
      t.accum += r.valueAccum; t.balance += r.valueBalance;
      t.contractedNoBDI += r.valueContractedNoBDI; t.periodNoBDI += r.valuePeriodNoBDI;
      t.accumNoBDI += r.valueAccumNoBDI; t.balanceNoBDI += r.valueBalanceNoBDI;
      t.qtyContracted += r.qtyContracted; t.qtyAccum += r.qtyCurrentAccum;
    });
    t.contracted = money2(t.contracted); t.period = money2(t.period);
    t.accum = money2(t.accum); t.balance = money2(t.balance);
    t.contractedNoBDI = money2(t.contractedNoBDI); t.periodNoBDI = money2(t.periodNoBDI);
    t.accumNoBDI = money2(t.accumNoBDI); t.balanceNoBDI = money2(t.balanceNoBDI);
    const pctPeriod = t.contracted > 0 ? (t.period / t.contracted) * 100 : 0;
    const pctAccum = t.contracted > 0 ? (t.accum / t.contracted) * 100 : 0;
    const pctBalance = t.contracted > 0 ? (t.balance / t.contracted) * 100 : 0;
    return { ...t, pctPeriod, pctAccum, pctBalance };
  }, [filteredRows]);

  return {
    numbering,
    rows,
    filteredRows,
    groupTree,
    totals,
    dailyReportsSummary,
    validationIssues,
    validationSummary,
    hasDailyWarnings,
  };
}
