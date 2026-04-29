/**
 * Mutações da Planilha de Medição:
 * - generateMeasurement, unlockForEdit, setStatus, deleteMeasurement
 * - newMeasurementDraft
 * - updateTaskField, updateUnitPriceNoBDI, updateUnitPriceWithBDI, setManualPeriodQuantity
 * - patchSnapshotItem, persistContractInfo, toggleCollapsed
 *
 * Toda mudança relevante registra logToProject (auditoria).
 * Não muda regras financeiras nem fluxo de aprovação — apenas reorganização.
 */
import { useCallback } from 'react';
import type {
  Project, Task, ContractInfo, SavedMeasurement,
  MeasurementSnapshotItem, MeasurementChangeLog, MeasurementStatus,
} from '@/types/project';
import { trunc2, calculateUnitPriceWithBDI } from '@/lib/measurementCalculations';
import { logToProject, userInfoFromSupabaseUser } from '@/lib/audit';
import { buildDailyReportSnapshot } from '@/lib/dailyReportSummary';
import { toast } from '@/hooks/use-toast';
import type { User } from '@supabase/supabase-js';
import { isoAddDays, suggestPeriodForNext } from '@/components/measurement/measurementFormat';
import type { Row } from '@/components/measurement/types';

type ValidationSummary = { hasBlocking: boolean; warnings: number };
type DailyReportsSummary = ReturnType<typeof buildDailyReportSnapshot> extends infer _T ? any : any;

export interface UseMeasurementActionsParams {
  project: Project;
  projectRef: React.MutableRefObject<Project>;
  onProjectChange: (p: Project) => void;
  user: User | null;
  measurements: SavedMeasurement[];
  activeMeasurement: SavedMeasurement | null;
  isSnapshotMode: boolean;
  isLocked: boolean;
  // Estado UI controlado pelo useMeasurementState
  startDate: string;
  endDate: string;
  measurementNumber: string;
  bdiPercent: number;
  bdiFactor: number;
  effBdi: number;
  effBdiFactor: number;
  effStart: string;
  effEnd: string;
  today: string;
  monthAgo: string;
  contractor: string;
  contracted: string;
  contractNumber: string;
  contractObject: string;
  location: string;
  budgetSource: string;
  editReason: string;
  rows: Row[];
  validationSummary: ValidationSummary;
  dailyReportsSummary: any;
  setActiveId: (id: string) => void;
  setStartDate: (s: string) => void;
  setEndDate: (s: string) => void;
  setChapterFilter: (s: string) => void;
  setSearch: (s: string) => void;
  setMeasurementNumber: (s: string) => void;
  setConfirmGenerate: (b: boolean) => void;
  setConfirmEdit: (b: boolean) => void;
  setConfirmDelete: (b: boolean) => void;
  setEditReason: (s: string) => void;
  setCollapsed: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export function useMeasurementActions(p: UseMeasurementActionsParams) {
  const auditUser = userInfoFromSupabaseUser(p.user);

  const persistContractInfo = useCallback((next: Partial<ContractInfo>) => {
    const latestProject = p.projectRef.current;
    p.onProjectChange({
      ...latestProject,
      contractInfo: { ...(latestProject.contractInfo || {}), ...next },
    });
  }, [p.onProjectChange, p.projectRef]);

  const updateMeasurement = useCallback((id: string, patch: (m: SavedMeasurement) => SavedMeasurement) => {
    p.onProjectChange({
      ...p.project,
      measurements: (p.project.measurements || []).map(m => (m.id === id ? patch(m) : m)),
    });
  }, [p.project, p.onProjectChange]);

  const extractLogValues = (item: MeasurementSnapshotItem, patch: Partial<MeasurementSnapshotItem>) => {
    const out: Record<string, unknown> = {};
    Object.keys(patch).forEach(k => {
      const key = k as keyof MeasurementSnapshotItem;
      out[k] = item[key];
    });
    return out;
  };

  const patchSnapshotItem = useCallback((taskId: string, patch: Partial<MeasurementSnapshotItem>, fieldLabel: string) => {
    if (!p.activeMeasurement) return;
    if (p.isLocked) return;
    const existing = p.activeMeasurement.items.find(i => i.taskId === taskId);
    const log: MeasurementChangeLog = {
      at: new Date().toISOString(),
      field: fieldLabel,
      itemId: taskId,
      previous: existing ? JSON.stringify(extractLogValues(existing, patch)) : '',
      next: JSON.stringify(patch),
      reason: p.editReason || undefined,
    };
    updateMeasurement(p.activeMeasurement.id, m => ({
      ...m,
      items: m.items.map(i => (i.taskId === taskId ? { ...i, ...patch } : i)),
      history: [...(m.history || []), log],
    }));
  }, [p.activeMeasurement, p.isLocked, p.editReason, updateMeasurement]);

  const updateTaskField = useCallback((taskId: string, patch: Partial<Task>) => {
    if (p.isLocked) return;
    p.onProjectChange({
      ...p.project,
      phases: p.project.phases.map(ph => ({
        ...ph,
        tasks: ph.tasks.map(t => (t.id === taskId ? { ...t, ...patch } : t)),
      })),
    });
  }, [p.project, p.onProjectChange, p.isLocked]);

  const updateUnitPriceNoBDI = useCallback((taskId: string, value: number) => {
    const noBDI = trunc2(value);
    if (p.isSnapshotMode) {
      patchSnapshotItem(taskId, {
        unitPriceNoBDI: noBDI,
        unitPriceWithBDI: calculateUnitPriceWithBDI(noBDI, p.effBdi),
      }, 'Valor unit. s/ BDI');
    } else {
      updateTaskField(taskId, {
        unitPriceNoBDI: noBDI,
        unitPrice: calculateUnitPriceWithBDI(noBDI, p.bdiPercent),
      });
    }
  }, [p.isSnapshotMode, p.effBdi, p.bdiPercent, patchSnapshotItem, updateTaskField]);

  const updateUnitPriceWithBDI = useCallback((taskId: string, value: number) => {
    if (p.isSnapshotMode) {
      patchSnapshotItem(taskId, {
        unitPriceWithBDI: value,
        unitPriceNoBDI: value / p.effBdiFactor,
      }, 'Valor unit. c/ BDI');
    } else {
      updateTaskField(taskId, {
        unitPrice: value,
        unitPriceNoBDI: value / p.bdiFactor,
      });
    }
  }, [p.isSnapshotMode, p.effBdiFactor, p.bdiFactor, patchSnapshotItem, updateTaskField]);

  const setManualPeriodQuantity = useCallback((taskId: string, value: number) => {
    if (p.isSnapshotMode) return;
    const safeValue = Math.max(0, Number.isFinite(value) ? value : 0);
    const manualId = `manual-measurement-${p.effStart}-${p.effEnd}`;
    p.onProjectChange({
      ...p.project,
      phases: p.project.phases.map(ph => ({
        ...ph,
        tasks: ph.tasks.map(t => {
          if (t.id !== taskId) return t;
          const others = (t.dailyLogs || []).filter(l => l.id !== manualId);
          if (safeValue <= 0) return { ...t, dailyLogs: others };
          return {
            ...t,
            dailyLogs: [
              ...others,
              {
                id: manualId, date: p.effEnd, plannedQuantity: 0,
                actualQuantity: safeValue,
                notes: 'Lançamento manual via Planilha de Medição',
              },
            ],
          };
        }),
      })),
    });
  }, [p.project, p.onProjectChange, p.isSnapshotMode, p.effStart, p.effEnd]);

  const generateMeasurement = useCallback(() => {
    if (p.validationSummary.hasBlocking) {
      toast({
        title: 'Não é possível gerar a medição',
        description: 'Corrija os erros listados no painel de validação antes de prosseguir.',
        variant: 'destructive',
      });
      p.setConfirmGenerate(false);
      return;
    }
    const number = Number(p.measurementNumber) || (p.measurements[p.measurements.length - 1]?.number || 0) + 1;
    const items: MeasurementSnapshotItem[] = p.rows.map(r => ({
      item: r.item,
      phaseId: r.phaseId,
      phaseChain: r.phaseChain,
      taskId: r.taskId,
      description: r.description,
      unit: r.unit,
      itemCode: r.itemCode,
      priceBank: r.priceBank,
      qtyContracted: r.qtyContracted,
      unitPriceNoBDI: r.unitPriceNoBDI,
      unitPriceWithBDI: r.unitPriceWithBDI,
      qtyProposed: r.qtyPeriod,
      qtyPriorAccum: r.qtyPriorAccum,
    }));

    const snapshot: SavedMeasurement = {
      id: `meas-${Date.now()}`,
      number,
      startDate: p.startDate, endDate: p.endDate,
      issueDate: p.today,
      status: 'generated',
      bdiPercent: p.bdiPercent,
      items,
      generatedAt: new Date().toISOString(),
      contractSnapshot: {
        contractor: p.contractor, contracted: p.contracted,
        contractNumber: p.contractNumber, contractObject: p.contractObject,
        location: p.location, budgetSource: p.budgetSource, bdiPercent: p.bdiPercent,
        nextMeasurementNumber: number + 1,
      },
      history: [],
      dailyReportSnapshot: buildDailyReportSnapshot(p.dailyReportsSummary),
    };

    const nextStartIso = isoAddDays(p.endDate, 1);
    const nextEndIso = isoAddDays(nextStartIso, 30);
    const nextNumber = number + 1;
    const latestProject = p.projectRef.current;
    const nextProject: Project = {
      ...latestProject,
      contractInfo: {
        ...(latestProject.contractInfo || {}),
        nextMeasurementNumber: nextNumber,
      },
      measurements: [...(latestProject.measurements || []), snapshot],
      measurementDraft: {
        number: nextNumber,
        startDate: nextStartIso,
        endDate: nextEndIso,
        chapterFilter: 'all',
        search: '',
      },
    };
    const nextProjectWithLog = logToProject(nextProject, {
      ...auditUser,
      entityType: 'measurement',
      entityId: snapshot.id,
      action: 'created',
      title: `Medição nº ${number} gerada`,
      metadata: {
        number,
        startDate: p.startDate,
        endDate: p.endDate,
        bdiPercent: p.bdiPercent,
        itemsCount: items.length,
      },
    });
    p.projectRef.current = nextProjectWithLog;
    p.onProjectChange(nextProjectWithLog);
    p.setStartDate(nextStartIso);
    p.setEndDate(nextEndIso);
    p.setChapterFilter('all');
    p.setSearch('');
    p.setMeasurementNumber(String(nextNumber));
    p.setActiveId('live');
    p.setConfirmGenerate(false);
    toast({
      title: `Medição nº ${number} gerada`,
      description: `Snapshot bloqueado. Preparando ${nextNumber}ª Medição.`,
    });
  }, [p, auditUser]);

  const unlockForEdit = useCallback(() => {
    if (!p.activeMeasurement) return;
    updateMeasurement(p.activeMeasurement.id, m => ({
      ...m,
      status: 'rejected',
      history: [
        ...(m.history || []),
        {
          at: new Date().toISOString(),
          field: 'status',
          previous: m.status,
          next: 'rejected',
          reason: p.editReason || 'Liberada para ajustes',
        },
      ],
    }));
    p.setConfirmEdit(false);
    p.setEditReason('');
    toast({ title: 'Medição aberta para ajustes', description: 'Edite os campos liberados e refaça a aprovação.' });
  }, [p, updateMeasurement]);

  const setStatus = useCallback((next: MeasurementStatus) => {
    if (!p.activeMeasurement) return;
    const previous = p.activeMeasurement.status;
    updateMeasurement(p.activeMeasurement.id, m => ({
      ...m,
      status: next,
      history: [
        ...(m.history || []),
        { at: new Date().toISOString(), field: 'status', previous: m.status, next },
      ],
    }));
    const actionMap: Record<MeasurementStatus, { action: Parameters<typeof logToProject>[1]['action']; title: string } | null> = {
      draft: null,
      generated: { action: 'created', title: 'Medição gerada' },
      in_review: { action: 'submitted_for_review', title: 'Medição enviada para análise fiscal' },
      approved: { action: 'approved', title: 'Medição aprovada' },
      rejected: { action: 'rejected', title: 'Medição reprovada — liberada para ajuste' },
    };
    const cfg = actionMap[next];
    if (cfg) {
      p.onProjectChange(logToProject(p.projectRef.current, {
        ...auditUser,
        entityType: 'measurement',
        entityId: p.activeMeasurement.id,
        action: cfg.action,
        title: cfg.title,
        metadata: {
          number: p.activeMeasurement.number,
          previousStatus: previous,
          nextStatus: next,
        },
      }));
    }
  }, [p, updateMeasurement, auditUser]);

  const deleteMeasurement = useCallback(() => {
    if (!p.activeMeasurement) return;
    p.onProjectChange({
      ...p.project,
      measurements: (p.project.measurements || []).filter(m => m.id !== p.activeMeasurement!.id),
    });
    p.setActiveId('live');
    p.setConfirmDelete(false);
    toast({ title: 'Medição excluída' });
  }, [p]);

  const newMeasurementDraft = useCallback(() => {
    const last = p.measurements[p.measurements.length - 1];
    const suggested = suggestPeriodForNext(p.measurements, p.today, p.monthAgo);
    p.setStartDate(suggested.startDate);
    p.setEndDate(suggested.endDate);
    p.setMeasurementNumber(String((last?.number || 0) + 1));
    p.setActiveId('live');
  }, [p]);

  const toggleCollapsed = useCallback((id: string) => {
    p.setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, [p.setCollapsed]);

  return {
    auditUser,
    persistContractInfo,
    updateMeasurement,
    patchSnapshotItem,
    updateTaskField,
    updateUnitPriceNoBDI,
    updateUnitPriceWithBDI,
    setManualPeriodQuantity,
    generateMeasurement,
    unlockForEdit,
    setStatus,
    deleteMeasurement,
    newMeasurementDraft,
    toggleCollapsed,
  };
}
