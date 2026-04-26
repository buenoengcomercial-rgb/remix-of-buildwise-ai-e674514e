import { useMemo, useState, useEffect, useCallback } from 'react';
import {
  Project,
  Task,
  Phase,
  ContractInfo,
  SavedMeasurement,
  MeasurementSnapshotItem,
  MeasurementStatus,
  MeasurementChangeLog,
} from '@/types/project';
import { getChapterTree, getChapterNumbering, ChapterNode } from '@/lib/chapters';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ClipboardList,
  FileSpreadsheet,
  Printer,
  Search,
  CalendarDays,
  Building2,
  AlertCircle,
  ChevronRight,
  ChevronDown,
  Plus,
  Lock,
  Unlock,
  CheckCircle2,
  XCircle,
  FileCheck2,
  Trash2,
  Pencil,
  Check,
  X,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from '@/hooks/use-toast';
import { validateMeasurement, summarizeIssues, type ValidationIssue } from '@/lib/measurementValidation';
import MeasurementValidationPanel from '@/components/MeasurementValidationPanel';

interface MeasurementProps {
  project: Project;
  onProjectChange: (project: Project) => void;
  undoButton?: React.ReactNode;
}

// ───────────────────────── Tipos internos ─────────────────────────
interface Row {
  item: string;
  phaseId: string;
  phaseChain: string;
  taskId: string;
  description: string;
  unit: string;
  itemCode: string;
  priceBank: string;
  qtyContracted: number;
  qtyPriorAccum: number;
  /** Quantidade efetivamente medida no período (proposed por padrão; approved se houver). */
  qtyPeriod: number;
  qtyProposed: number;
  qtyApproved?: number;
  qtyCurrentAccum: number;
  qtyBalance: number;
  percentExecuted: number;
  unitPriceNoBDI: number;
  unitPriceWithBDI: number;
  unitPriceIsEstimated: boolean;
  valueContractedNoBDI: number;
  valuePeriodNoBDI: number;
  valueAccumNoBDI: number;
  valueBalanceNoBDI: number;
  valueContracted: number;
  valuePeriod: number;
  valueAccum: number;
  valueBalance: number;
  hasNoLogsInPeriod: boolean;
  hasNoLogsAtAll: boolean;
  notes?: string;
}

interface GroupTotals {
  contracted: number;
  period: number;
  accum: number;
  balance: number;
  contractedNoBDI: number;
  periodNoBDI: number;
  accumNoBDI: number;
  balanceNoBDI: number;
  qtyContracted: number;
  qtyAccum: number;
}

interface GroupNode {
  phaseId: string;
  number: string;
  name: string;
  depth: number;
  rows: Row[];
  children: GroupNode[];
  totals: GroupTotals;
}

// ───────────────────────── Helpers ─────────────────────────
const fmtBRL = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
const fmtNum = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const fmtPct = (n: number) => `${n.toFixed(2)}%`;
/** Truncamento financeiro em 2 casas decimais (NUNCA arredonda). */
const trunc2 = (value: number): number => Math.trunc((value || 0) * 100) / 100;
const fmtDateBR = (iso: string) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

const emptyTotals = (): GroupTotals => ({
  contracted: 0, period: 0, accum: 0, balance: 0,
  contractedNoBDI: 0, periodNoBDI: 0, accumNoBDI: 0, balanceNoBDI: 0,
  qtyContracted: 0, qtyAccum: 0,
});

function estimateTaskValue(task: Task): number {
  const materialsCost = (task.materials || []).reduce(
    (s, m) => s + (m.estimatedCost || 0) * (m.quantity || 1), 0,
  );
  const laborCost = (task.laborCompositions || []).reduce((s, c) => {
    if (!c.hourlyRate || !task.quantity) return s;
    return s + task.quantity * c.rup * c.hourlyRate;
  }, 0);
  return materialsCost + laborCost;
}

function buildOrderedTasks(
  project: Project,
): Array<{ task: Task; phase: Phase; itemNumber: string; chain: string }> {
  const tree = getChapterTree(project);
  const numbering = getChapterNumbering(project);
  const out: Array<{ task: Task; phase: Phase; itemNumber: string; chain: string }> = [];

  const walk = (nodes: ChapterNode[], chain: string[]) => {
    nodes.forEach(node => {
      const phaseNumber = numbering.get(node.phase.id) || '';
      const newChain = [...chain, node.phase.name];
      node.phase.tasks.forEach((task, idx) => {
        out.push({
          task, phase: node.phase,
          itemNumber: `${phaseNumber}.${idx + 1}`,
          chain: newChain.join(' › '),
        });
      });
      walk(node.children, newChain);
    });
  };
  walk(tree, []);

  const visited = new Set(out.map(o => o.phase.id));
  project.phases.forEach(phase => {
    if (visited.has(phase.id)) return;
    const phaseNumber = numbering.get(phase.id) || '?';
    phase.tasks.forEach((task, idx) => {
      out.push({
        task, phase,
        itemNumber: `${phaseNumber}.${idx + 1}`,
        chain: phase.name,
      });
    });
  });

  return out;
}

const STATUS_LABEL: Record<MeasurementStatus, string> = {
  draft: 'Rascunho',
  generated: 'Gerada',
  in_review: 'Em análise fiscal',
  approved: 'Aprovada',
  rejected: 'Reprovada / Ajustar',
};

const STATUS_CLASS: Record<MeasurementStatus, string> = {
  draft: 'bg-muted text-muted-foreground border-border',
  generated: 'bg-info/15 text-info border-info/40',
  in_review: 'bg-warning/15 text-warning border-warning/40',
  approved: 'bg-success/15 text-success border-success/40',
  rejected: 'bg-destructive/15 text-destructive border-destructive/40',
};

const isLockedStatus = (s: MeasurementStatus) =>
  s === 'generated' || s === 'in_review' || s === 'approved';

// ───────────────────────── Componente principal ─────────────────────────
export default function Measurement({ project, onProjectChange, undoButton }: MeasurementProps) {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  const measurements = useMemo<SavedMeasurement[]>(
    () => (project.measurements || []).slice().sort((a, b) => a.number - b.number),
    [project.measurements],
  );

  const contract = project.contractInfo || {};
  const [activeId, setActiveId] = useState<string>('live');

  // Número da próxima medição em preparação (default)
  const defaultNextNumber =
    (contract.nextMeasurementNumber ??
      ((measurements[measurements.length - 1]?.number || 0) + 1)) || 1;

  // Rascunho persistido para a medição em preparação
  const initialDraft = project.measurementDraft;
  const initialDraftMatches = initialDraft && initialDraft.number === defaultNextNumber;

  // Form de filtros (modo "live" = preview antes de gerar)
  const [startDate, setStartDate] = useState(
    initialDraftMatches && initialDraft?.startDate ? initialDraft.startDate : monthAgo,
  );
  const [endDate, setEndDate] = useState(
    initialDraftMatches && initialDraft?.endDate ? initialDraft.endDate : today,
  );
  const [chapterFilter, setChapterFilter] = useState<string>(
    initialDraftMatches && initialDraft?.chapterFilter ? initialDraft.chapterFilter : 'all',
  );
  const [search, setSearch] = useState(
    initialDraftMatches && initialDraft?.search ? initialDraft.search : '',
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Cabeçalho (formulário contratual)
  const [contractor, setContractor] = useState(contract.contractor || '');
  const [contracted, setContracted] = useState(contract.contracted || '');
  const [contractNumber, setContractNumber] = useState(contract.contractNumber || '');
  const [contractObject, setContractObject] = useState(contract.contractObject || '');
  const [location, setLocation] = useState(contract.location || '');
  const [budgetSource, setBudgetSource] = useState(contract.budgetSource || '');
  const [bdiInput, setBdiInput] = useState(
    contract.bdiPercent !== undefined ? String(contract.bdiPercent) : '25',
  );
  const [measurementNumber, setMeasurementNumber] = useState(String(defaultNextNumber));
  const issueDate = today;

  // Diálogos
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [confirmEdit, setConfirmEdit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editReason, setEditReason] = useState('');
  const [editingPriceTaskId, setEditingPriceTaskId] = useState<string | null>(null);
  const [editingPriceValue, setEditingPriceValue] = useState<string>('');

  useEffect(() => {
    const c = project.contractInfo || {};
    setContractor(c.contractor || '');
    setContracted(c.contracted || '');
    setContractNumber(c.contractNumber || '');
    setContractObject(c.contractObject || '');
    setLocation(c.location || '');
    setBudgetSource(c.budgetSource || '');
    setBdiInput(c.bdiPercent !== undefined ? String(c.bdiPercent) : '25');

    // Recarrega rascunho de filtros ao trocar de obra
    const sortedMs = (project.measurements || []).slice().sort((a, b) => a.number - b.number);
    const nextNum =
      (c.nextMeasurementNumber ?? ((sortedMs[sortedMs.length - 1]?.number || 0) + 1)) || 1;
    setMeasurementNumber(String(nextNum));
    const d = project.measurementDraft;
    if (d && d.number === nextNum) {
      if (d.startDate) setStartDate(d.startDate);
      if (d.endDate) setEndDate(d.endDate);
      setChapterFilter(d.chapterFilter || 'all');
      setSearch(d.search || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  // Sincroniza nº sugerido quando muda quantidade de medições; tenta restaurar rascunho
  useEffect(() => {
    if (activeId !== 'live') return;
    const next = (measurements[measurements.length - 1]?.number || 0) + 1;
    setMeasurementNumber(prev => (prev === String(next) ? prev : String(next || 1)));
    const d = project.measurementDraft;
    if (d && d.number === next) {
      if (d.startDate) setStartDate(d.startDate);
      if (d.endDate) setEndDate(d.endDate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measurements.length, activeId]);

  // Persiste rascunho (datas + filtros) por nº de medição em preparação
  useEffect(() => {
    if (activeId !== 'live') return;
    const num = Number(measurementNumber);
    if (!Number.isFinite(num) || num <= 0) return;
    const current = project.measurementDraft;
    const nextDraft = {
      number: num,
      startDate,
      endDate,
      chapterFilter,
      search,
    };
    if (
      current &&
      current.number === nextDraft.number &&
      current.startDate === nextDraft.startDate &&
      current.endDate === nextDraft.endDate &&
      (current.chapterFilter || 'all') === nextDraft.chapterFilter &&
      (current.search || '') === nextDraft.search
    ) {
      return;
    }
    onProjectChange({ ...project, measurementDraft: nextDraft });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, measurementNumber, startDate, endDate, chapterFilter, search]);

  const bdiPercent = Number.isFinite(parseFloat(bdiInput)) ? Math.max(0, parseFloat(bdiInput)) : 0;
  const bdiFactor = 1 + bdiPercent / 100;

  const persistContractInfo = (next: Partial<ContractInfo>) => {
    onProjectChange({
      ...project,
      contractInfo: { ...(project.contractInfo || {}), ...next },
    });
  };

  const numbering = useMemo(() => getChapterNumbering(project), [project]);
  const orderedTasks = useMemo(() => buildOrderedTasks(project), [project]);

  // ───────── Medição ativa ─────────
  const activeMeasurement = useMemo<SavedMeasurement | null>(() => {
    if (activeId === 'live') return null;
    return measurements.find(m => m.id === activeId) || null;
  }, [activeId, measurements]);

  const isLocked = activeMeasurement ? isLockedStatus(activeMeasurement.status) : false;
  const isSnapshotMode = !!activeMeasurement;

  // Período/BDI vigentes para cálculo (snapshot vs live)
  const effStart = activeMeasurement?.startDate ?? startDate;
  const effEnd = activeMeasurement?.endDate ?? endDate;
  const effBdi = activeMeasurement?.bdiPercent ?? bdiPercent;
  const effBdiFactor = 1 + effBdi / 100;
  const effIssue = activeMeasurement?.issueDate ?? issueDate;
  const effNumber = activeMeasurement?.number?.toString() ?? measurementNumber;

  // Acumulado anterior considerando medições anteriores APROVADAS/GERADAS quando em live
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

  // ───────── Cálculo das linhas ─────────
  const rows: Row[] = useMemo(() => {
    if (isSnapshotMode && activeMeasurement) {
      // Snapshot: não recalcula da EAP — usa o que foi salvo
      return activeMeasurement.items.map(it => {
        const qtyPeriod = it.qtyApproved ?? it.qtyProposed ?? 0;
        const qtyCurrentAccum = it.qtyPriorAccum + qtyPeriod;
        const qtyBalance = Math.max(it.qtyContracted - qtyCurrentAccum, 0);
        const pct = it.qtyContracted > 0 ? (qtyCurrentAccum / it.qtyContracted) * 100 : 0;
        const unitPriceWithBDI = trunc2(it.unitPriceWithBDI);
        const unitPriceNoBDI = trunc2(it.unitPriceNoBDI);
        const valueContracted = trunc2(unitPriceWithBDI * it.qtyContracted);
        const valuePeriod = trunc2(unitPriceWithBDI * qtyPeriod);
        const valueAccum = trunc2(unitPriceWithBDI * qtyCurrentAccum);
        const valueBalance = Math.max(trunc2(valueContracted - valueAccum), 0);
        const valueContractedNoBDI = trunc2(unitPriceNoBDI * it.qtyContracted);
        const valuePeriodNoBDI = trunc2(unitPriceNoBDI * qtyPeriod);
        const valueAccumNoBDI = trunc2(unitPriceNoBDI * qtyCurrentAccum);
        const valueBalanceNoBDI = Math.max(trunc2(valueContractedNoBDI - valueAccumNoBDI), 0);
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
          qtyCurrentAccum,
          qtyBalance,
          percentExecuted: pct,
          unitPriceNoBDI,
          unitPriceWithBDI,
          unitPriceIsEstimated: false,
          valueContractedNoBDI, valuePeriodNoBDI, valueAccumNoBDI, valueBalanceNoBDI,
          valueContracted, valuePeriod, valueAccum, valueBalance,
          hasNoLogsInPeriod: qtyPeriod === 0,
          hasNoLogsAtAll: false,
          notes: it.notes,
        };
      });
    }

    // Modo Live: calcula a partir da EAP + apontamentos
    return orderedTasks.map(({ task, phase, itemNumber, chain }) => {
      const qtyContracted = task.quantity ?? task.baseline?.quantity ?? 0;
      const unit = task.unit || '';

      let qtyPriorAccumLogs = 0;
      let qtyPeriod = 0;
      const logs = task.dailyLogs || [];
      const hasNoLogsAtAll = logs.length === 0;
      let hasLogsInPeriod = false;

      if (!hasNoLogsAtAll) {
        for (const log of logs) {
          const d = log.date;
          if (d < effStart) {
            qtyPriorAccumLogs += log.actualQuantity || 0;
          } else if (d >= effStart && d <= effEnd) {
            qtyPeriod += log.actualQuantity || 0;
            if ((log.actualQuantity || 0) > 0) hasLogsInPeriod = true;
          }
        }
      } else {
        const pct = (task.percentComplete || 0) / 100;
        qtyPriorAccumLogs = qtyContracted * pct;
        qtyPeriod = 0;
      }

      // Soma medições anteriores aprovadas/geradas
      const priorFromMeas = priorAccumByTask.get(task.id) || 0;
      const qtyPriorAccum = Math.max(qtyPriorAccumLogs, priorFromMeas);

      const hasNoLogsInPeriod = !hasLogsInPeriod;
      const qtyCurrentAccum = qtyPriorAccum + qtyPeriod;
      const qtyBalance = Math.max(qtyContracted - qtyCurrentAccum, 0);
      const percentExecuted =
        qtyContracted > 0 ? (qtyCurrentAccum / qtyContracted) * 100 : task.percentComplete || 0;

      // Prioridade: 1) unitPriceNoBDI importado/manual → c/BDI sempre derivado do BDI editável
      //             2) unitPrice c/BDI manual (sem s/BDI) → s/BDI = c/BDI / (1+BDI)
      //             3) Estimativa por materiais/mão de obra
      let unitPriceNoBDI = task.unitPriceNoBDI ?? 0;
      let unitPriceWithBDI = 0;
      let unitPriceIsEstimated = false;

      if (unitPriceNoBDI > 0) {
        // Sempre recalcular c/BDI a partir do BDI vigente — nunca substituir o preço importado
        unitPriceWithBDI = trunc2(unitPriceNoBDI * effBdiFactor);
      } else if ((task.unitPrice ?? 0) > 0) {
        unitPriceWithBDI = trunc2(task.unitPrice!);
        unitPriceNoBDI = trunc2(unitPriceWithBDI / effBdiFactor);
      } else {
        const est = estimateTaskValue(task);
        unitPriceWithBDI = qtyContracted > 0 ? trunc2(est / qtyContracted) : 0;
        unitPriceNoBDI = trunc2(unitPriceWithBDI / effBdiFactor);
        unitPriceIsEstimated = unitPriceWithBDI > 0;
      }
      unitPriceNoBDI = trunc2(unitPriceNoBDI);

      const valueContracted = trunc2(unitPriceWithBDI * qtyContracted);
      const valuePeriod = trunc2(unitPriceWithBDI * qtyPeriod);
      const valueAccum = trunc2(unitPriceWithBDI * qtyCurrentAccum);
      const valueBalance = Math.max(trunc2(valueContracted - valueAccum), 0);
      const valueContractedNoBDI = trunc2(unitPriceNoBDI * qtyContracted);
      const valuePeriodNoBDI = trunc2(unitPriceNoBDI * qtyPeriod);
      const valueAccumNoBDI = trunc2(unitPriceNoBDI * qtyCurrentAccum);
      const valueBalanceNoBDI = Math.max(trunc2(valueContractedNoBDI - valueAccumNoBDI), 0);

      return {
        item: itemNumber, phaseId: phase.id, phaseChain: chain, taskId: task.id,
        description: task.name, unit,
        itemCode: task.itemCode || '', priceBank: task.priceBank || '',
        qtyContracted, qtyPriorAccum, qtyPeriod,
        qtyProposed: qtyPeriod,
        qtyApproved: undefined,
        qtyCurrentAccum, qtyBalance, percentExecuted,
        unitPriceNoBDI, unitPriceWithBDI, unitPriceIsEstimated,
        valueContractedNoBDI, valuePeriodNoBDI, valueAccumNoBDI, valueBalanceNoBDI,
        valueContracted, valuePeriod, valueAccum, valueBalance,
        hasNoLogsInPeriod, hasNoLogsAtAll,
      };
    });
  }, [isSnapshotMode, activeMeasurement, orderedTasks, effStart, effEnd, effBdiFactor, priorAccumByTask]);

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

  // ───────── Validação da medição (somente no modo "live") ─────────
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
    });
  }, [activeMeasurement, startDate, endDate, measurementNumber, rows, measurements, contractor, contracted, contractNumber, contractObject, location, budgetSource, bdiPercent]);
  const validationSummary = useMemo(() => summarizeIssues(validationIssues), [validationIssues]);

  // ───────── Árvore de grupos ─────────
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
    return groups.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
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
    const pctPeriod = t.contracted > 0 ? (t.period / t.contracted) * 100 : 0;
    const pctAccum = t.contracted > 0 ? (t.accum / t.contracted) * 100 : 0;
    const pctBalance = t.contracted > 0 ? (t.balance / t.contracted) * 100 : 0;
    return { ...t, pctPeriod, pctAccum, pctBalance };
  }, [filteredRows]);

  // ───────── Persistência ─────────
  const updateTaskField = (taskId: string, patch: Partial<Task>) => {
    if (isLocked) return;
    onProjectChange({
      ...project,
      phases: project.phases.map(p => ({
        ...p,
        tasks: p.tasks.map(t => (t.id === taskId ? { ...t, ...patch } : t)),
      })),
    });
  };
  const updateUnitPriceNoBDI = (taskId: string, value: number) => {
    if (isSnapshotMode) {
      patchSnapshotItem(taskId, { unitPriceNoBDI: value, unitPriceWithBDI: value * effBdiFactor }, 'Valor unit. s/ BDI');
    } else {
      updateTaskField(taskId, { unitPriceNoBDI: value, unitPrice: value * bdiFactor });
    }
  };
  const updateUnitPriceWithBDI = (taskId: string, value: number) => {
    if (isSnapshotMode) {
      patchSnapshotItem(taskId, { unitPriceWithBDI: value, unitPriceNoBDI: value / effBdiFactor }, 'Valor unit. c/ BDI');
    } else {
      updateTaskField(taskId, { unitPrice: value, unitPriceNoBDI: value / bdiFactor });
    }
  };

  const setManualPeriodQuantity = (taskId: string, value: number) => {
    if (isSnapshotMode) return; // snapshot usa proposta/aprovada
    const safeValue = Math.max(0, Number.isFinite(value) ? value : 0);
    const manualId = `manual-measurement-${effStart}-${effEnd}`;
    onProjectChange({
      ...project,
      phases: project.phases.map(p => ({
        ...p,
        tasks: p.tasks.map(t => {
          if (t.id !== taskId) return t;
          const others = (t.dailyLogs || []).filter(l => l.id !== manualId);
          if (safeValue <= 0) return { ...t, dailyLogs: others };
          return {
            ...t,
            dailyLogs: [
              ...others,
              {
                id: manualId, date: effEnd, plannedQuantity: 0,
                actualQuantity: safeValue,
                notes: 'Lançamento manual via Planilha de Medição',
              },
            ],
          };
        }),
      })),
    });
  };

  // ───────── Snapshot (medição salva) ─────────
  const updateMeasurement = useCallback((id: string, patch: (m: SavedMeasurement) => SavedMeasurement) => {
    onProjectChange({
      ...project,
      measurements: (project.measurements || []).map(m => (m.id === id ? patch(m) : m)),
    });
  }, [project, onProjectChange]);

  const patchSnapshotItem = (taskId: string, patch: Partial<MeasurementSnapshotItem>, fieldLabel: string) => {
    if (!activeMeasurement) return;
    if (isLocked) return;
    const existing = activeMeasurement.items.find(i => i.taskId === taskId);
    const log: MeasurementChangeLog = {
      at: new Date().toISOString(),
      field: fieldLabel,
      itemId: taskId,
      previous: existing ? JSON.stringify(extractLogValues(existing, patch)) : '',
      next: JSON.stringify(patch),
      reason: editReason || undefined,
    };
    updateMeasurement(activeMeasurement.id, m => ({
      ...m,
      items: m.items.map(i => (i.taskId === taskId ? { ...i, ...patch } : i)),
      history: [...(m.history || []), log],
    }));
  };

  const extractLogValues = (item: MeasurementSnapshotItem, patch: Partial<MeasurementSnapshotItem>) => {
    const out: Record<string, unknown> = {};
    Object.keys(patch).forEach(k => {
      const key = k as keyof MeasurementSnapshotItem;
      out[k] = item[key];
    });
    return out;
  };

  // Gerar nova medição (snapshot a partir do live)
  const generateMeasurement = () => {
    // Defesa: nunca gerar se houver erros bloqueantes
    if (validationSummary.hasBlocking) {
      toast({
        title: 'Não é possível gerar a medição',
        description: 'Corrija os erros listados no painel de validação antes de prosseguir.',
        variant: 'destructive',
      });
      setConfirmGenerate(false);
      return;
    }
    const number = Number(measurementNumber) || (measurements[measurements.length - 1]?.number || 0) + 1;
    const items: MeasurementSnapshotItem[] = rows.map(r => ({
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
      startDate, endDate,
      issueDate: today,
      status: 'generated',
      bdiPercent,
      items,
      generatedAt: new Date().toISOString(),
      contractSnapshot: {
        contractor, contracted, contractNumber, contractObject, location,
        budgetSource, bdiPercent,
        nextMeasurementNumber: number + 1,
      },
      history: [],
    };

    onProjectChange({
      ...project,
      contractInfo: {
        ...(project.contractInfo || {}),
        nextMeasurementNumber: number + 1,
      },
      measurements: [...(project.measurements || []), snapshot],
    });
    // Prepara automaticamente a próxima medição (volta ao modo "live")
    const nextStart = new Date(endDate);
    nextStart.setDate(nextStart.getDate() + 1);
    setStartDate(nextStart.toISOString().slice(0, 10));
    setEndDate(today);
    setMeasurementNumber(String(number + 1));
    setActiveId('live');
    setConfirmGenerate(false);
    toast({
      title: `Medição nº ${number} gerada`,
      description: `Snapshot bloqueado. Preparando ${number + 1}ª Medição.`,
    });
  };

  // Editar medição gerada (destrava parcialmente)
  const unlockForEdit = () => {
    if (!activeMeasurement) return;
    updateMeasurement(activeMeasurement.id, m => ({
      ...m,
      status: 'rejected',
      history: [
        ...(m.history || []),
        {
          at: new Date().toISOString(),
          field: 'status',
          previous: m.status,
          next: 'rejected',
          reason: editReason || 'Liberada para ajustes',
        },
      ],
    }));
    setConfirmEdit(false);
    setEditReason('');
    toast({ title: 'Medição aberta para ajustes', description: 'Edite os campos liberados e refaça a aprovação.' });
  };

  const setStatus = (next: MeasurementStatus) => {
    if (!activeMeasurement) return;
    updateMeasurement(activeMeasurement.id, m => ({
      ...m,
      status: next,
      history: [
        ...(m.history || []),
        { at: new Date().toISOString(), field: 'status', previous: m.status, next },
      ],
    }));
  };

  const deleteMeasurement = () => {
    if (!activeMeasurement) return;
    onProjectChange({
      ...project,
      measurements: (project.measurements || []).filter(m => m.id !== activeMeasurement.id),
    });
    setActiveId('live');
    setConfirmDelete(false);
    toast({ title: 'Medição excluída' });
  };

  const newMeasurementDraft = () => {
    const last = measurements[measurements.length - 1];
    if (last) {
      const next = new Date(last.endDate);
      next.setDate(next.getDate() + 1);
      setStartDate(next.toISOString().slice(0, 10));
    }
    setEndDate(today);
    setMeasurementNumber(String((last?.number || 0) + 1));
    setActiveId('live');
  };

  // ───────── Collapse helpers ─────────
  const toggleCollapsed = (id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ───────── EXPORT XLSX ─────────
  const exportXLSX = () => {
    const headerCtx = activeMeasurement?.contractSnapshot ?? {
      contractor, contracted, contractNumber, contractObject, location, budgetSource, bdiPercent,
    };
    const headerRows: (string | number)[][] = [
      ['BOLETIM DE MEDIÇÃO PARA PAGAMENTO'],
      [],
      ['Contratante:', headerCtx.contractor || '', '', 'Contratada:', headerCtx.contracted || ''],
      ['Obra:', project.name, '', 'Local/Município:', headerCtx.location || ''],
      ['Objeto:', headerCtx.contractObject || '', '', 'Nº Contrato:', headerCtx.contractNumber || ''],
      ['Medição Nº:', effNumber, '', 'Período:', `${fmtDateBR(effStart)} a ${fmtDateBR(effEnd)}`],
      ['Data emissão:', fmtDateBR(effIssue), '', 'Fonte de orçamento:', headerCtx.budgetSource || ''],
      ['BDI %:', effBdi, '', 'Status:', activeMeasurement ? STATUS_LABEL[activeMeasurement.status] : 'Em preparação'],
      [],
    ];

    const tableHeader = [
      'Item', 'Código', 'Banco', 'Descrição', 'Und.',
      'Quant. Contratada', 'V. Unit. s/ BDI', 'V. Unit. c/ BDI', 'Total Contratado',
      'Quant. Medição', 'Subtotal Medição',
      'Quant. Acumulada', 'Subtotal Acumulado',
      'Quant. a Executar', 'Subtotal a Executar',
    ];
    const dataRows: (string | number)[][] = [tableHeader];
    const blank = (n: number) => Array.from({ length: n }, () => '');

    const walkXLSX = (group: GroupNode) => {
      const indent = '  '.repeat(group.depth);
      dataRows.push([group.number, '', '', `${indent}${group.name}`, ...blank(11)]);
      group.rows.forEach(r => {
        dataRows.push([
          r.item, r.itemCode, r.priceBank, r.description, r.unit,
          Number(r.qtyContracted.toFixed(3)),
          trunc2(r.unitPriceNoBDI),
          trunc2(r.unitPriceWithBDI),
          trunc2(r.valueContracted),
          Number(r.qtyPeriod.toFixed(3)),
          trunc2(r.valuePeriod),
          Number(r.qtyCurrentAccum.toFixed(3)),
          trunc2(r.valueAccum),
          Number(r.qtyBalance.toFixed(3)),
          trunc2(r.valueBalance),
        ]);
      });
      group.children.forEach(walkXLSX);
      dataRows.push([
        '', '', '', `${indent}Subtotal ${group.number} ${group.name}`,
        '', '', '', '',
        trunc2(group.totals.contracted), '',
        trunc2(group.totals.period), '',
        trunc2(group.totals.accum), '',
        trunc2(group.totals.balance),
      ]);
    };
    groupTree.forEach(walkXLSX);

    dataRows.push([
      '', '', '', 'TOTAL GERAL', '', '', '', '',
      trunc2(totals.contracted), '',
      trunc2(totals.period), '',
      trunc2(totals.accum), '',
      trunc2(totals.balance),
    ]);

    const sheetData = [...headerRows, ...dataRows];
    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    ws['!cols'] = [
      { wch: 8 }, { wch: 12 }, { wch: 10 }, { wch: 38 }, { wch: 6 },
      { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 16 },
      { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 16 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Medição ${effNumber}`);
    XLSX.writeFile(wb, `medicao_${effNumber}_${effStart}_a_${effEnd}.xlsx`);
  };

  // ───────── EXPORT PDF (limpo, A4 paisagem, sem chrome do navegador) ─────────
  const exportPDF = () => {
    const headerCtx = activeMeasurement?.contractSnapshot ?? {
      contractor, contracted, contractNumber, contractObject, location, budgetSource, bdiPercent,
    };

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 5;

    // ── Cabeçalho do boletim ──
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('BOLETIM DE MEDIÇÃO PARA PAGAMENTO', pageW / 2, margin + 4, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    const labelVal = (label: string, value: string) => {
      doc.setFont('helvetica', 'bold');
      const lw = doc.getTextWidth(label + ' ');
      doc.text(label, 0, 0);
      doc.setFont('helvetica', 'normal');
      doc.text(value, lw, 0);
    };
    // Linhas em duas colunas
    const col1X = margin;
    const col2X = pageW / 2 + 2;
    let y = margin + 8;
    const lineH = 3.2;

    const drawPair = (lbl1: string, val1: string, lbl2: string, val2: string) => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
      doc.text(lbl1, col1X, y);
      doc.setFont('helvetica', 'normal');
      doc.text(String(val1 || '-'), col1X + doc.getTextWidth(lbl1 + ' '), y, {
        maxWidth: col2X - col1X - doc.getTextWidth(lbl1 + ' ') - 2,
      });
      doc.setFont('helvetica', 'bold');
      doc.text(lbl2, col2X, y);
      doc.setFont('helvetica', 'normal');
      doc.text(String(val2 || '-'), col2X + doc.getTextWidth(lbl2 + ' '), y, {
        maxWidth: pageW - margin - col2X - doc.getTextWidth(lbl2 + ' ') - 2,
      });
      y += lineH;
    };

    drawPair('Obra:', project.name || '', 'Local/Município:', headerCtx.location || '');
    drawPair('Contratante:', headerCtx.contractor || '', 'Contratada:', headerCtx.contracted || '');
    drawPair('Objeto:', headerCtx.contractObject || '', 'Nº Contrato:', headerCtx.contractNumber || '');
    drawPair(
      'Medição Nº:', String(effNumber),
      'Período:', `${fmtDateBR(effStart)} a ${fmtDateBR(effEnd)}`
    );
    drawPair(
      'Data emissão:', fmtDateBR(effIssue),
      'BDI %:', `${effBdi}`
    );
    drawPair(
      'Fonte de orçamento:', headerCtx.budgetSource || '',
      'Status:', activeMeasurement ? STATUS_LABEL[activeMeasurement.status] : 'Em preparação'
    );

    // Faixa resumida de totais
    y += 1;
    doc.setDrawColor(180); doc.setLineWidth(0.2);
    doc.line(margin, y, pageW - margin, y);
    y += 3;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
    const summary = [
      ['Contratado', fmtBRL(totals.contracted)],
      ['Medição', fmtBRL(totals.period)],
      ['Acumulado', fmtBRL(totals.accum)],
      ['Saldo', fmtBRL(totals.balance)],
    ];
    const cellW = (pageW - margin * 2) / summary.length;
    summary.forEach((s, i) => {
      const x = margin + i * cellW;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
      doc.text(s[0], x + 2, y);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
      doc.text(s[1], x + cellW - 2, y, { align: 'right' });
    });
    y += 2;

    // ── Tabela ──
    const head = [[
      'Item', 'Código', 'Banco', 'Descrição', 'Und.',
      'Q. Contrat.', 'V.Un. s/BDI', 'V.Un. c/BDI', 'Total Contrat.',
      'Q. Medição', 'Subt. Medição',
      'Q. Acum.', 'Subt. Acum.',
      'Q. Saldo', 'Subt. Saldo',
    ]];

    type Row = (string | number)[];
    type RowMeta = { kind: 'chapter' | 'item' | 'subtotal' | 'total'; depth: number };
    const body: Row[] = [];
    const meta: RowMeta[] = [];

    const walkPDF = (group: GroupNode) => {
      const indent = '  '.repeat(group.depth);
      body.push([`${group.number}`, '', '', `${indent}${group.name}`, '', '', '', '', '', '', '', '', '', '', '']);
      meta.push({ kind: 'chapter', depth: group.depth });
      group.rows.forEach(r => {
        body.push([
          r.item, r.itemCode || '', r.priceBank || '', r.description, r.unit || '',
          fmtNum(r.qtyContracted),
          fmtBRL(r.unitPriceNoBDI),
          fmtBRL(r.unitPriceWithBDI),
          fmtBRL(r.valueContracted),
          fmtNum(r.qtyPeriod),
          fmtBRL(r.valuePeriod),
          fmtNum(r.qtyCurrentAccum),
          fmtBRL(r.valueAccum),
          fmtNum(r.qtyBalance),
          fmtBRL(r.valueBalance),
        ]);
        meta.push({ kind: 'item', depth: group.depth });
      });
      group.children.forEach(walkPDF);
      body.push([
        '', '', '', `${indent}Subtotal ${group.number} ${group.name}`, '', '', '', '',
        fmtBRL(group.totals.contracted), '',
        fmtBRL(group.totals.period), '',
        fmtBRL(group.totals.accum), '',
        fmtBRL(group.totals.balance),
      ]);
      meta.push({ kind: 'subtotal', depth: group.depth });
    };
    groupTree.forEach(walkPDF);

    body.push([
      '', '', '', 'TOTAL GERAL', '', '', '', '',
      fmtBRL(totals.contracted), '',
      fmtBRL(totals.period), '',
      fmtBRL(totals.accum), '',
      fmtBRL(totals.balance),
    ]);
    meta.push({ kind: 'total', depth: 0 });

    // Cores por grupo (em RGB neutros para PDF)
    const C_ID = [245, 245, 245] as [number, number, number];
    const C_CONTRACT = [219, 234, 254] as [number, number, number];   // azul claro
    const C_PERIOD = [220, 252, 231] as [number, number, number];     // verde claro
    const C_ACCUM = [254, 243, 199] as [number, number, number];      // amarelo claro
    const C_BALANCE = [254, 226, 226] as [number, number, number];    // vermelho claro

    const groupColor = (col: number): [number, number, number] | undefined => {
      if (col <= 4) return C_ID;
      if (col <= 8) return C_CONTRACT;
      if (col <= 10) return C_PERIOD;
      if (col <= 12) return C_ACCUM;
      return C_BALANCE;
    };

    autoTable(doc, {
      startY: y + 1,
      head,
      body,
      margin: { left: margin, right: margin, top: margin, bottom: margin + 14 },
      theme: 'grid',
      styles: {
        font: 'helvetica',
        fontSize: 6.2,
        cellPadding: 1,
        overflow: 'linebreak',
        lineColor: [200, 200, 200],
        lineWidth: 0.1,
        valign: 'top',
      },
      headStyles: {
        fillColor: [60, 60, 70],
        textColor: 255,
        fontSize: 6.2,
        fontStyle: 'bold',
        halign: 'center',
      },
      tableWidth: pageW - margin * 2,
      columnStyles: (() => {
        // Larguras proporcionais (somam 108) — normalizadas para a largura útil.
        const pct = [4, 5, 5, 20, 4, 6, 7, 7, 8, 6, 8, 6, 8, 6, 8];
        const sum = pct.reduce((a, b) => a + b, 0);
        const usable = pageW - margin * 2;
        const aligns: Array<'left' | 'right' | 'center'> = [
          'center', 'left', 'left', 'left', 'center',
          'right', 'right', 'right', 'right',
          'right', 'right', 'right', 'right', 'right', 'right',
        ];
        const styles: Record<number, { cellWidth: number; halign: 'left' | 'right' | 'center' }> = {};
        pct.forEach((p, i) => {
          styles[i] = { cellWidth: (usable * p) / sum, halign: aligns[i] };
        });
        return styles;
      })(),
      didParseCell: (data) => {
        if (data.section === 'head') {
          const c = groupColor(data.column.index);
          if (c) {
            // sobrescreve com tons de cabeçalho mais escuros
            const darken = (rgb: [number, number, number]): [number, number, number] =>
              [Math.max(0, rgb[0] - 40), Math.max(0, rgb[1] - 40), Math.max(0, rgb[2] - 40)];
            data.cell.styles.fillColor = darken(c);
            data.cell.styles.textColor = [30, 30, 30];
          }
          return;
        }
        const m = meta[data.row.index];
        if (!m) return;
        if (m.kind === 'chapter') {
          data.cell.styles.fillColor = m.depth === 0 ? [219, 234, 254] : [241, 245, 249];
          data.cell.styles.fontStyle = 'bold';
        } else if (m.kind === 'subtotal') {
          data.cell.styles.fillColor = m.depth === 0 ? [224, 231, 255] : [243, 244, 246];
          data.cell.styles.fontStyle = 'bold';
        } else if (m.kind === 'total') {
          data.cell.styles.fillColor = [55, 65, 81];
          data.cell.styles.textColor = 255;
          data.cell.styles.fontStyle = 'bold';
        } else {
          // body row: tonalizar conforme grupo
          const c = groupColor(data.column.index);
          if (c) data.cell.styles.fillColor = c;
        }
      },
      didDrawPage: () => {
        // ───── Rodapé fixo: apenas dados da empresa ─────
        const footerTop = pageH - margin - 10;
        doc.setDrawColor(180);
        doc.setLineWidth(0.2);
        doc.line(margin, footerTop, pageW - margin, footerTop);

        doc.setTextColor(80);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(6.4);
        doc.text('K. C. BUENO DE GODOY OLIVEIRA LTDA', pageW / 2, footerTop + 2.8, { align: 'center' });
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6);
        doc.text(
          'CNPJ: 39.973.085/0001-20  •  Rua Getúlio Vargas, 2533, São Cristóvão  •  Porto Velho/RO',
          pageW / 2, footerTop + 5.4, { align: 'center' }
        );

        // Numeração de páginas
        const pageCount = doc.getNumberOfPages();
        const current = doc.getCurrentPageInfo().pageNumber;
        doc.setFontSize(6); doc.setTextColor(120);
        doc.text(
          `Medição Nº ${effNumber} — ${project.name || ''}`,
          margin, pageH - 1.5
        );
        doc.text(`Página ${current} / ${pageCount}`, pageW - margin, pageH - 1.5, { align: 'right' });
        doc.setTextColor(0);
      },
    });

    // ───── Bloco de assinaturas (somente na última página) ─────
    const drawSignatures = () => {
      const blockH = 26; // altura necessária do bloco
      const footerReserved = 14; // espaço do rodapé fixo
      let yPos = (doc as any).lastAutoTable?.finalY ?? margin;
      yPos += 8;
      if (yPos + blockH > pageH - margin - footerReserved) {
        doc.addPage();
        yPos = margin + 4;
      }
      const colW = (pageW - margin * 2 - 20) / 2;
      const leftX = margin + 10;
      const rightX = margin + colW + 30;
      const lineY = yPos + 12;

      doc.setDrawColor(60); doc.setLineWidth(0.3);
      doc.line(leftX, lineY, leftX + colW - 20, lineY);
      doc.line(rightX, lineY, rightX + colW - 20, lineY);

      doc.setTextColor(0);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
      const leftCx = leftX + (colW - 20) / 2;
      const rightCx = rightX + (colW - 20) / 2;
      doc.text('Kennedy Christian Bueno de Godoy Oliveira', leftCx, lineY + 4, { align: 'center' });
      doc.text('Kelper Maximilian Bueno de Godoy Oliveira', rightCx, lineY + 4, { align: 'center' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(80);
      doc.text('Responsável Legal — CREA 17279-D/RO', leftCx, lineY + 8, { align: 'center' });
      doc.text('Responsável Técnico — CREA 13940-D/RO', rightCx, lineY + 8, { align: 'center' });
      doc.setTextColor(0);
    };
    drawSignatures();

    const safe = (s: string) => (s || '').replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '');
    const num = String(effNumber).padStart(2, '0');
    const projectSlug = safe(project.name || 'Obra');
    doc.save(`Medicao_${num}_${projectSlug}.pdf`);
  };

  const handlePrint = () => exportPDF();

  // ───────── RENDER ─────────
  const COLSPAN = 15;

  // Cores por grupo (tokens semânticos)
  const G_BG = {
    id: 'bg-muted/40',                 // Identificação
    contract: 'bg-info/10',            // Contrato
    period: 'bg-success/10',           // Medição atual
    accum: 'bg-warning/10',            // Acumulado
    balance: 'bg-destructive/10',      // Saldo
  };
  const G_HEAD = {
    id: 'bg-muted text-foreground',
    contract: 'bg-info/20 text-foreground',
    period: 'bg-success/20 text-foreground',
    accum: 'bg-warning/20 text-foreground',
    balance: 'bg-destructive/15 text-foreground',
  };
  const BORDER_L = 'border-l-2 border-border';

  const headerStyleByDepth = (depth: number) => {
    if (depth === 0) return 'bg-primary/10 text-foreground font-bold border-y-2 border-primary/40';
    if (depth === 1) return 'bg-muted/70 text-foreground font-semibold border-y border-border';
    return 'bg-muted/40 text-foreground font-semibold border-y border-border';
  };
  const subtotalStyleByDepth = (depth: number) => {
    if (depth === 0) return 'bg-primary/5 border-y border-primary/30 font-bold';
    if (depth === 1) return 'bg-muted/50 border-y border-border font-semibold';
    return 'bg-muted/30 border-y border-border font-semibold';
  };

  return (
    <div className="measurement-print-root p-6 space-y-5 print:p-0 print:space-y-3">
      <style>{`
        .measurement-table { table-layout: fixed; min-width: 1400px; }
        .measurement-table col.col-item { width: 70px; }
        .measurement-table col.col-code { width: 90px; }
        .measurement-table col.col-bank { width: 70px; }
        .measurement-table col.col-desc { width: 360px; min-width: 280px; max-width: 460px; }
        .measurement-table col.col-und  { width: 70px; }
        .measurement-table col.col-qty  { width: 100px; }
        .measurement-table col.col-val  { width: 120px; }
        .measurement-table th, .measurement-table td { vertical-align: top; }
        .measurement-table .cell-desc {
          overflow-wrap: anywhere;
          word-break: break-word;
          white-space: normal;
          line-height: 1.25;
        }
        .measurement-table .cell-und {
          text-align: center;
          white-space: nowrap;
          border-left: 1px solid hsl(var(--border));
        }
        @media print {
          @page { size: A4 landscape; margin: 8mm; }
          html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; background: white !important; }
          .print-hide { display: none !important; }
          /* Hide app chrome (sidebar, toolbars, etc.) */
          [data-sidebar],
          aside,
          [data-sidebar="sidebar"],
          [data-sidebar="trigger"],
          [data-sidebar="rail"] { display: none !important; }
          /* Make the main content take full width */
          main, [role="main"] { width: 100% !important; max-width: 100% !important; margin: 0 !important; padding: 0 !important; }

          .measurement-table {
            font-size: 6.5px !important;
            min-width: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
            table-layout: fixed !important;
          }
          .measurement-table th, .measurement-table td {
            padding: 2px 3px !important;
            line-height: 1.15 !important;
            overflow-wrap: anywhere !important;
            word-break: break-word !important;
            white-space: normal !important;
            vertical-align: top !important;
          }
          .measurement-table tr,
          .measurement-table tbody tr.chapter-row,
          .measurement-table tbody tr.subtotal-row { page-break-inside: avoid; break-inside: avoid; }
          .measurement-table .cell-desc {
            white-space: normal !important;
            word-break: break-word !important;
            overflow-wrap: anywhere !important;
            text-align: left !important;
          }
          .measurement-table .cell-und { white-space: nowrap !important; text-align: center !important; }
          /* Right-align monetary cells (those whose <th> were text-right map by column index via colgroup) */
          .measurement-table th, .measurement-table td { position: static !important; }

          /* Column widths in % to fit a single landscape page (15 cols) */
          .measurement-table col.col-item { width: 4% !important; }
          .measurement-table col.col-code { width: 6% !important; }
          .measurement-table col.col-bank { width: 5% !important; }
          .measurement-table col.col-desc { width: 25% !important; min-width: 0 !important; max-width: none !important; }
          .measurement-table col.col-und  { width: 4% !important; }
          /* qty/val columns: there are 5 qty + 5 val after desc/und.
             Use nth-of-type to set widths in print precisely. */
          .measurement-table colgroup col:nth-child(6)  { width: 6% !important; } /* Quant Contrat */
          .measurement-table colgroup col:nth-child(7)  { width: 7% !important; } /* V Unit s/BDI */
          .measurement-table colgroup col:nth-child(8)  { width: 7% !important; } /* V Unit c/BDI */
          .measurement-table colgroup col:nth-child(9)  { width: 8% !important; } /* Total Contratado */
          .measurement-table colgroup col:nth-child(10) { width: 6% !important; } /* Quant Medição */
          .measurement-table colgroup col:nth-child(11) { width: 8% !important; } /* Subtotal Medição */
          .measurement-table colgroup col:nth-child(12) { width: 6% !important; } /* Quant Acum */
          .measurement-table colgroup col:nth-child(13) { width: 8% !important; } /* Subtotal Acum */
          .measurement-table colgroup col:nth-child(14) { width: 6% !important; } /* Quant a Executar */
          .measurement-table colgroup col:nth-child(15) { width: 8% !important; } /* Subtotal a Executar */

          /* Compact header/summary cards */
          .print\\:break-inside-avoid { break-inside: avoid; page-break-inside: avoid; }
          .measurement-print-root .summary-card { padding: 4px 6px !important; }
          .measurement-print-root h1, .measurement-print-root h2 { font-size: 12px !important; margin: 0 !important; }
          .measurement-print-root .text-2xl { font-size: 12px !important; }
          .measurement-print-root .text-xl { font-size: 11px !important; }
          .measurement-print-root .text-lg { font-size: 10px !important; }
        }
      `}</style>

      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <ClipboardList className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Boletim de Medição</h1>
            <p className="text-sm text-muted-foreground">Planilha de medição para pagamento</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {undoButton}
          <Button variant="outline" size="sm" onClick={exportXLSX}>
            <FileSpreadsheet className="w-4 h-4 mr-1" /> Excel
          </Button>
          <Button variant="default" size="sm" onClick={handlePrint}>
            <Printer className="w-4 h-4 mr-1" /> Imprimir / PDF
          </Button>
        </div>
      </div>

      {/* Seletor de medições salvas */}
      <Card className="print:hidden">
        <CardContent className="p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mr-2">
              Medições
            </span>

            {measurements.map(m => (
              <button
                key={m.id}
                onClick={() => setActiveId(m.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors flex items-center gap-1.5 ${
                  activeId === m.id
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background hover:bg-muted/60 border-border'
                }`}
              >
                <span className="font-mono">{m.number}ª</span> Medição
                <span
                  className={`text-[9px] uppercase px-1.5 py-0.5 rounded border ${STATUS_CLASS[m.status]} ${
                    activeId === m.id ? 'opacity-90' : ''
                  }`}
                >
                  {STATUS_LABEL[m.status]}
                </span>
              </button>
            ))}

            {(() => {
              const nextNumber = (measurements[measurements.length - 1]?.number || 0) + 1;
              return (
                <button
                  onClick={newMeasurementDraft}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border border-dashed transition-colors flex items-center gap-1.5 ${
                    activeId === 'live'
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background hover:bg-muted/60 border-border text-muted-foreground'
                  }`}
                  title="Medição em preparação"
                >
                  Preparando {nextNumber}ª Medição
                </button>
              );
            })()}

            <div className="ml-auto flex items-center gap-2">
              {!activeMeasurement && (
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => setConfirmGenerate(true)}
                  disabled={validationSummary.hasBlocking}
                  title={validationSummary.hasBlocking
                    ? 'Existem erros de validação que impedem gerar a medição.'
                    : undefined}
                >
                  <FileCheck2 className="w-4 h-4 mr-1" /> Gerar Medição
                </Button>
              )}
              {activeMeasurement && (
                <Button size="sm" variant="outline" onClick={newMeasurementDraft}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> Continuar próxima medição
                </Button>
              )}
              {activeMeasurement && isLocked && (
                <>
                  <Button size="sm" variant="outline" onClick={() => setConfirmEdit(true)}>
                    <Unlock className="w-4 h-4 mr-1" /> Editar Medição
                  </Button>
                  {activeMeasurement.status === 'generated' && (
                    <Button size="sm" variant="outline" onClick={() => setStatus('in_review')}>
                      Enviar p/ Fiscal
                    </Button>
                  )}
                  {activeMeasurement.status === 'in_review' && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => setStatus('approved')}>
                        <CheckCircle2 className="w-4 h-4 mr-1 text-success" /> Aprovar
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setStatus('rejected')}>
                        <XCircle className="w-4 h-4 mr-1 text-destructive" /> Reprovar
                      </Button>
                    </>
                  )}
                </>
              )}
              {activeMeasurement && !isLocked && activeMeasurement.status === 'rejected' && (
                <Button size="sm" variant="default" onClick={() => setStatus('generated')}>
                  <Lock className="w-4 h-4 mr-1" /> Reaprovar (bloquear)
                </Button>
              )}
              {activeMeasurement && (
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              )}
            </div>
          </div>

          {/* Linha de status */}
          {activeMeasurement && (
            <div className="mt-3 flex items-center justify-between text-xs">
              <div className="flex items-center gap-3">
                <span className={`px-2 py-1 rounded border font-semibold ${STATUS_CLASS[activeMeasurement.status]}`}>
                  {STATUS_LABEL[activeMeasurement.status]}
                </span>
                <span className="text-muted-foreground">
                  Medição nº <strong className="text-foreground">{activeMeasurement.number}</strong> ·
                  período {fmtDateBR(activeMeasurement.startDate)} a {fmtDateBR(activeMeasurement.endDate)} ·
                  emitida em {fmtDateBR(activeMeasurement.issueDate)}
                </span>
              </div>
              {isLocked && (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Lock className="w-3.5 h-3.5" /> Snapshot bloqueado
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Painel de validação (somente em modo "live") */}
      {!activeMeasurement && (
        <div className="print:hidden">
          <MeasurementValidationPanel issues={validationIssues} />
        </div>
      )}

      {/* Cabeçalho técnico do boletim */}
      <Card className="border-2 border-foreground/20 print:border-foreground print:shadow-none">
        <CardContent className="p-0">
          <div className="bg-muted/40 px-5 py-3 border-b-2 border-foreground/20 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Building2 className="w-5 h-5 text-foreground" />
              <h2 className="text-sm font-bold tracking-widest uppercase text-foreground">
                Boletim de Medição para Pagamento
              </h2>
            </div>
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Medição Nº</p>
              <p className="text-lg font-bold tabular-nums text-foreground leading-none">
                {effNumber || '—'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-12 text-[11px]">
            <FormField label="Contratante" colSpan={6}>
              <Input
                className="h-7 text-xs border-0 px-0 focus-visible:ring-0 bg-transparent"
                value={contractor}
                disabled={isSnapshotMode}
                onChange={e => setContractor(e.target.value)}
                onBlur={() => persistContractInfo({ contractor })}
                placeholder="Nome do contratante"
              />
            </FormField>
            <FormField label="Contratada" colSpan={6}>
              <Input
                className="h-7 text-xs border-0 px-0 focus-visible:ring-0 bg-transparent"
                value={contracted}
                disabled={isSnapshotMode}
                onChange={e => setContracted(e.target.value)}
                onBlur={() => persistContractInfo({ contracted })}
                placeholder="Nome da contratada"
              />
            </FormField>
            <FormField label="Obra" colSpan={8}>
              <p className="text-xs font-semibold text-foreground py-1">{project.name}</p>
            </FormField>
            <FormField label="Local / Município" colSpan={4}>
              <Input
                className="h-7 text-xs border-0 px-0 focus-visible:ring-0 bg-transparent"
                value={location}
                disabled={isSnapshotMode}
                onChange={e => setLocation(e.target.value)}
                onBlur={() => persistContractInfo({ location })}
                placeholder="Cidade / UF"
              />
            </FormField>
            <FormField label="Objeto" colSpan={8}>
              <Input
                className="h-7 text-xs border-0 px-0 focus-visible:ring-0 bg-transparent"
                value={contractObject}
                disabled={isSnapshotMode}
                onChange={e => setContractObject(e.target.value)}
                onBlur={() => persistContractInfo({ contractObject })}
                placeholder="Descrição resumida do escopo"
              />
            </FormField>
            <FormField label="Nº do Contrato" colSpan={4}>
              <Input
                className="h-7 text-xs border-0 px-0 focus-visible:ring-0 bg-transparent"
                value={contractNumber}
                disabled={isSnapshotMode}
                onChange={e => setContractNumber(e.target.value)}
                onBlur={() => persistContractInfo({ contractNumber })}
                placeholder="Ex.: 001/2025"
              />
            </FormField>
            <FormField label="Período da Medição" colSpan={4}>
              <p className="text-xs font-semibold text-foreground py-1 tabular-nums">
                {fmtDateBR(effStart)} a {fmtDateBR(effEnd)}
              </p>
            </FormField>
            <FormField label="Data de Emissão" colSpan={2}>
              <p className="text-xs font-semibold text-foreground py-1 tabular-nums">
                {fmtDateBR(effIssue)}
              </p>
            </FormField>
            <FormField label="Fonte de Orçamento" colSpan={4}>
              <Input
                className="h-7 text-xs border-0 px-0 focus-visible:ring-0 bg-transparent"
                value={budgetSource}
                disabled={isSnapshotMode}
                onChange={e => setBudgetSource(e.target.value)}
                onBlur={() => persistContractInfo({ budgetSource })}
                placeholder="Ex.: SINAPI 07/2024"
              />
            </FormField>
            <FormField label="BDI %" colSpan={2} last>
              <Input
                type="number"
                step="0.01"
                min="0"
                disabled={isSnapshotMode}
                className="h-7 text-xs border-0 px-0 focus-visible:ring-0 bg-transparent tabular-nums font-semibold"
                value={isSnapshotMode ? String(effBdi) : bdiInput}
                onChange={e => setBdiInput(e.target.value)}
                onBlur={() => persistContractInfo({ bdiPercent: bdiPercent })}
              />
            </FormField>
            <FormField label="Medição Nº" colSpan={3} bottom>
              <Input
                className="h-7 text-xs border-0 px-0 focus-visible:ring-0 bg-transparent tabular-nums font-semibold"
                value={effNumber}
                disabled={isSnapshotMode}
                onChange={e => setMeasurementNumber(e.target.value)}
                onBlur={() => persistContractInfo({ nextMeasurementNumber: Number(measurementNumber) || 1 })}
              />
            </FormField>
            <div className="col-span-9 border-t border-border" />
          </div>
        </CardContent>
      </Card>

      {/* Filtros (live e snapshot) */}
      <Card className="print:hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Filtros</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-1">
              <CalendarDays className="w-3 h-3" /> Data inicial
            </label>
            <Input type="date" value={effStart} disabled={isSnapshotMode}
              onChange={e => setStartDate(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-1">
              <CalendarDays className="w-3 h-3" /> Data final
            </label>
            <Input type="date" value={effEnd} disabled={isSnapshotMode}
              onChange={e => setEndDate(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Capítulo</label>
            <Select value={chapterFilter} onValueChange={setChapterFilter} disabled={isSnapshotMode}>
              <SelectTrigger><SelectValue placeholder="Todos os capítulos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os capítulos</SelectItem>
                {project.phases.map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    {numbering.get(p.id)} — {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-1">
              <Search className="w-3 h-3" /> Busca
            </label>
            <Input placeholder="Item, código, capítulo ou descrição"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {/* Resumo técnico */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <SummaryCard label="Contratado c/ BDI" value={fmtBRL(totals.contracted)} />
        <SummaryCard label="Desta medição" value={fmtBRL(totals.period)} highlight />
        <SummaryCard label="Acumulado" value={fmtBRL(totals.accum)} />
        <SummaryCard label="Saldo a executar" value={fmtBRL(totals.balance)} />
        <SummaryCard label="% desta medição" value={fmtPct(totals.pctPeriod)} />
        <SummaryCard label="% acumulado" value={fmtPct(totals.pctAccum)} />
      </div>

      {/* Tabela */}
      <Card>
        <CardHeader className="pb-3 print:hidden">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            Planilha de medição ({filteredRows.length} itens)
            {isLocked && (
              <span className="text-[10px] font-normal text-muted-foreground flex items-center gap-1">
                <Lock className="w-3 h-3" /> somente leitura
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-hidden">
          <div className="overflow-x-auto max-w-full print:overflow-visible">
            <table className="measurement-table w-full text-[11px] border-collapse print:min-w-0">
              <colgroup>
                <col className="col-item" />
                <col className="col-code" />
                <col className="col-bank" />
                <col className="col-desc" />
                <col className="col-und" />
                <col className="col-qty" />
                <col className="col-val" />
                <col className="col-val" />
                <col className="col-val" />
                <col className="col-qty" />
                <col className="col-val" />
                <col className="col-qty" />
                <col className="col-val" />
                <col className="col-qty" />
                <col className="col-val" />
              </colgroup>
              <thead className="sticky top-0 z-10">
                {/* Linha de grupos coloridos */}
                <tr>
                  <th colSpan={5} className={`px-2 py-1 text-[10px] uppercase tracking-wider font-bold ${G_HEAD.id}`}>
                    Identificação
                  </th>
                  <th colSpan={4} className={`px-2 py-1 text-[10px] uppercase tracking-wider font-bold ${G_HEAD.contract} ${BORDER_L}`}>
                    Contrato
                  </th>
                  <th colSpan={2} className={`px-2 py-1 text-[10px] uppercase tracking-wider font-bold ${G_HEAD.period} ${BORDER_L}`}>
                    Medição Atual
                  </th>
                  <th colSpan={2} className={`px-2 py-1 text-[10px] uppercase tracking-wider font-bold ${G_HEAD.accum} ${BORDER_L}`}>
                    Acumulado
                  </th>
                  <th colSpan={2} className={`px-2 py-1 text-[10px] uppercase tracking-wider font-bold ${G_HEAD.balance} ${BORDER_L}`}>
                    Saldo
                  </th>
                </tr>
                <tr className="bg-foreground text-background">
                  {/* Identificação */}
                  <th className="px-2 py-2 text-left font-semibold">Item</th>
                  <th className="px-2 py-2 text-center font-semibold">Código</th>
                  <th className="px-2 py-2 text-center font-semibold">Banco</th>
                  <th className="px-2 py-2 text-left font-semibold">Descrição</th>
                  <th className="px-2 py-2 text-center font-semibold cell-und">Und.</th>
                  {/* Contrato */}
                  <th className={`px-2 py-2 text-right font-semibold ${BORDER_L}`}>Quant. Contrat.</th>
                  <th className="px-2 py-2 text-right font-semibold">V. Unit. s/ BDI</th>
                  <th className="px-2 py-2 text-right font-semibold">V. Unit. c/ BDI</th>
                  <th className="px-2 py-2 text-right font-semibold">Total Contratado</th>
                  {/* Medição atual */}
                  <th className={`px-2 py-2 text-right font-semibold ${BORDER_L}`}>Quant. Medição</th>
                  <th className="px-2 py-2 text-right font-semibold">Subtotal Medição</th>
                  {/* Acumulado */}
                  <th className={`px-2 py-2 text-right font-semibold ${BORDER_L}`}>Quant. Acum.</th>
                  <th className="px-2 py-2 text-right font-semibold">Subtotal Acumulado</th>
                  {/* Saldo */}
                  <th className={`px-2 py-2 text-right font-semibold ${BORDER_L}`}>Quant. a Executar</th>
                  <th className="px-2 py-2 text-right font-semibold">Subtotal a Executar</th>
                </tr>
              </thead>
              <tbody>
                {groupTree.length === 0 ? (
                  <tr>
                    <td colSpan={COLSPAN} className="text-center py-8 text-muted-foreground">
                      Nenhum item encontrado para os filtros selecionados.
                    </td>
                  </tr>
                ) : (
                  (() => {
                    const out: JSX.Element[] = [];

                    const renderGroup = (g: GroupNode) => {
                      const indentPx = g.depth * 14;
                      const isCollapsed = collapsed.has(g.phaseId);

                      out.push(
                        <tr key={`h-${g.phaseId}`} className={headerStyleByDepth(g.depth)}>
                          <td colSpan={COLSPAN} className="px-2 py-1.5">
                            <button
                              type="button"
                              onClick={() => toggleCollapsed(g.phaseId)}
                              className="inline-flex items-center gap-1 hover:opacity-80 print-hide"
                              style={{ paddingLeft: indentPx }}
                            >
                              {isCollapsed
                                ? <ChevronRight className="w-3.5 h-3.5" />
                                : <ChevronDown className="w-3.5 h-3.5" />}
                              <span className="font-mono tabular-nums">{g.number}</span>
                              <span className="ml-1 uppercase tracking-wide">{g.name}</span>
                            </button>
                            <span className="hidden print:inline font-mono tabular-nums" style={{ paddingLeft: indentPx }}>
                              {g.number} {g.name}
                            </span>
                          </td>
                        </tr>,
                      );

                      if (!isCollapsed) {
                        g.rows.forEach(r => {
                          const baseBg = r.hasNoLogsInPeriod ? 'bg-warning/5' : 'bg-background';
                          const stickyBg = r.hasNoLogsInPeriod ? 'bg-warning/5' : 'bg-background';

                          out.push(
                            <tr key={r.taskId} className={`border-b border-border/60 hover:bg-muted/30 ${baseBg}`}>
                              {/* Identificação */}
                              <td
                                className={`px-2 py-1.5 font-mono tabular-nums text-foreground align-top ${stickyBg}`}
                                style={{ paddingLeft: indentPx + 8 }}
                              >
                                {r.item}
                              </td>
                              <td className={`px-1 py-1 align-top text-center ${stickyBg}`}>
                                <Input
                                  className="h-7 px-1.5 text-[11px] text-center border-transparent hover:border-input focus-visible:ring-1 print:hidden"
                                  value={r.itemCode}
                                  disabled={isLocked}
                                  onChange={e => isSnapshotMode
                                    ? patchSnapshotItem(r.taskId, { itemCode: e.target.value }, 'Código')
                                    : updateTaskField(r.taskId, { itemCode: e.target.value })}
                                  placeholder="—"
                                />
                                <span className="hidden print:inline">{r.itemCode || '—'}</span>
                              </td>
                              <td className={`px-1 py-1 align-top text-center ${stickyBg}`}>
                                <Input
                                  className="h-7 px-1.5 text-[11px] text-center border-transparent hover:border-input focus-visible:ring-1 print:hidden"
                                  value={r.priceBank}
                                  disabled={isLocked}
                                  onChange={e => isSnapshotMode
                                    ? patchSnapshotItem(r.taskId, { priceBank: e.target.value }, 'Banco')
                                    : updateTaskField(r.taskId, { priceBank: e.target.value })}
                                  placeholder="—"
                                />
                                <span className="hidden print:inline">{r.priceBank || '—'}</span>
                              </td>
                              <td className={`px-2 py-1.5 text-foreground align-top cell-desc ${stickyBg}`}>
                                <div className="flex items-start gap-1.5">
                                  {r.hasNoLogsInPeriod && (
                                    <AlertCircle
                                      className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5 print:hidden"
                                      aria-label="Sem apontamento no período"
                                    />
                                  )}
                                  <span className="leading-snug break-words">{r.description}</span>
                                </div>
                              </td>
                              <td className={`px-2 py-1.5 text-muted-foreground align-top cell-und ${G_BG.id}`}>
                                {r.unit}
                              </td>

                              {/* Contrato */}
                              <td className={`px-2 py-1.5 text-right tabular-nums text-foreground align-top ${BORDER_L} ${G_BG.contract}`}>
                                {fmtNum(r.qtyContracted)}
                              </td>
                              <td className={`px-1 py-1 text-right align-top ${G_BG.contract}`} style={{ minWidth: 210, width: 220 }}>
                                {editingPriceTaskId === r.taskId ? (
                                  <div className="flex items-center justify-end gap-1 print:hidden bg-accent/40 rounded px-1 py-0.5 min-w-[210px]">
                                    <div className="relative">
                                      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">R$</span>
                                      <Input
                                        autoFocus
                                        type="number" step="0.01" min="0"
                                        value={editingPriceValue}
                                        placeholder="0,00"
                                        onChange={e => setEditingPriceValue(e.target.value)}
                                        onKeyDown={e => {
                                          if (e.key === 'Enter') {
                                            updateUnitPriceNoBDI(r.taskId, parseFloat(editingPriceValue) || 0);
                                            setEditingPriceTaskId(null);
                                          } else if (e.key === 'Escape') {
                                            setEditingPriceTaskId(null);
                                          }
                                        }}
                                        className="h-7 pl-7 pr-2 text-right tabular-nums text-xs w-[150px] min-w-[150px]"
                                      />
                                    </div>
                                    <Button
                                      type="button" size="icon" variant="ghost"
                                      className="h-6 w-6 shrink-0 text-success hover:text-success"
                                      title="Confirmar (Enter)"
                                      onClick={() => {
                                        updateUnitPriceNoBDI(r.taskId, parseFloat(editingPriceValue) || 0);
                                        setEditingPriceTaskId(null);
                                      }}
                                    >
                                      <Check className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      type="button" size="icon" variant="ghost"
                                      className="h-6 w-6 shrink-0 text-destructive hover:text-destructive"
                                      title="Cancelar (Esc)"
                                      onClick={() => setEditingPriceTaskId(null)}
                                    >
                                      <X className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-end gap-1 print:hidden">
                                    <span className={`tabular-nums text-[11px] ${r.unitPriceIsEstimated ? 'italic text-muted-foreground' : ''}`}>
                                      {fmtBRL(r.unitPriceNoBDI || 0)}
                                    </span>
                                    {!isLocked && (
                                      <Button
                                        type="button" size="icon" variant="ghost"
                                        className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                                        title={r.unitPriceIsEstimated ? 'Preço estimado — clique para editar' : 'Editar valor unitário s/ BDI'}
                                        onClick={() => {
                                          setEditingPriceValue(((r.unitPriceNoBDI || 0)).toFixed(2));
                                          setEditingPriceTaskId(r.taskId);
                                        }}
                                      >
                                        <Pencil className="h-3 w-3" />
                                      </Button>
                                    )}
                                    {isLocked && (
                                      <Lock className="h-3 w-3 text-muted-foreground" aria-label="Medição bloqueada" />
                                    )}
                                  </div>
                                )}
                                <span className="hidden print:inline tabular-nums">{fmtBRL(r.unitPriceNoBDI || 0)}</span>
                              </td>
                              <td className={`px-2 py-1.5 text-right tabular-nums text-foreground align-top ${G_BG.contract}`}>
                                {fmtBRL(r.unitPriceWithBDI || 0)}
                              </td>
                              <td className={`px-2 py-1.5 text-right tabular-nums text-foreground align-top ${G_BG.contract}`}>
                                {fmtBRL(r.valueContracted)}
                              </td>

                              {/* Medição atual */}
                              <td className={`px-1 py-1 text-right align-top ${BORDER_L} ${G_BG.period}`}>
                                {isSnapshotMode ? (
                                  <Input
                                    type="number" step="0.01" min="0"
                                    value={r.qtyPeriod ? Number(r.qtyPeriod.toFixed(3)) : ''}
                                    placeholder="0,00"
                                    disabled={isLocked}
                                    onChange={e => {
                                      const v = parseFloat(e.target.value) || 0;
                                      // Em modo edição liberada de snapshot, ajusta qtyApproved
                                      patchSnapshotItem(r.taskId, { qtyApproved: v }, 'Quant. medição (aprovada)');
                                    }}
                                    className="h-7 px-1.5 text-right tabular-nums text-[11px] border-transparent hover:border-input focus-visible:ring-1 print:hidden"
                                    title="Quantidade desta medição"
                                  />
                                ) : r.hasNoLogsInPeriod ? (
                                  <Input
                                    type="number" step="0.01" min="0"
                                    value={r.qtyPeriod ? Number(r.qtyPeriod.toFixed(3)) : ''}
                                    placeholder="0,00"
                                    onChange={e => setManualPeriodQuantity(r.taskId, parseFloat(e.target.value) || 0)}
                                    className="h-7 px-1.5 text-right tabular-nums text-[11px] border-warning/50 print:hidden"
                                    title="Sem apontamento no período — lance manualmente"
                                  />
                                ) : (
                                  <span className="tabular-nums font-semibold pr-2">{fmtNum(r.qtyPeriod)}</span>
                                )}
                                <span className="hidden print:inline tabular-nums">{fmtNum(r.qtyPeriod)}</span>
                              </td>
                              <td className={`px-2 py-1.5 text-right tabular-nums font-semibold text-foreground align-top ${G_BG.period}`}>
                                {fmtBRL(r.valuePeriod)}
                              </td>

                              {/* Acumulado */}
                              <td className={`px-2 py-1.5 text-right tabular-nums text-foreground align-top ${BORDER_L} ${G_BG.accum}`}>
                                {fmtNum(r.qtyCurrentAccum)}
                              </td>
                              <td className={`px-2 py-1.5 text-right tabular-nums text-foreground align-top ${G_BG.accum}`}>
                                {fmtBRL(r.valueAccum)}
                              </td>

                              {/* Saldo */}
                              <td className={`px-2 py-1.5 text-right tabular-nums text-muted-foreground align-top ${BORDER_L} ${G_BG.balance}`}>
                                {fmtNum(r.qtyBalance)}
                              </td>
                              <td className={`px-2 py-1.5 text-right tabular-nums text-muted-foreground align-top ${G_BG.balance}`}>
                                {fmtBRL(r.valueBalance)}
                              </td>
                            </tr>,
                          );
                        });
                        g.children.forEach(renderGroup);
                      }

                      out.push(
                        <tr key={`s-${g.phaseId}`} className={subtotalStyleByDepth(g.depth)}>
                          <td colSpan={8} className="px-2 py-1.5 text-right text-foreground border-t-2 border-border">
                            <span style={{ paddingLeft: indentPx }}>
                              Subtotal {g.number} — {g.name}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-foreground border-t-2 border-border">
                            {fmtBRL(g.totals.contracted)}
                          </td>
                          <td className={`px-2 py-1.5 text-right tabular-nums text-foreground border-t-2 border-border ${BORDER_L}`}>—</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-foreground border-t-2 border-border">
                            {fmtBRL(g.totals.period)}
                          </td>
                          <td className={`px-2 py-1.5 text-right tabular-nums text-foreground border-t-2 border-border ${BORDER_L}`}>—</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-foreground border-t-2 border-border">
                            {fmtBRL(g.totals.accum)}
                          </td>
                          <td className={`px-2 py-1.5 text-right tabular-nums text-foreground border-t-2 border-border ${BORDER_L}`}>—</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-foreground border-t-2 border-border">
                            {fmtBRL(g.totals.balance)}
                          </td>
                        </tr>,
                      );
                    };

                    groupTree.forEach(renderGroup);
                    return out;
                  })()
                )}
              </tbody>
              {groupTree.length > 0 && (
                <tfoot>
                  <tr className="bg-foreground text-background border-t-2 border-foreground font-bold">
                    <td colSpan={8} className="px-2 py-2 text-right uppercase tracking-wide">Total Geral</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtBRL(totals.contracted)}</td>
                    <td className={`px-2 py-2 text-right ${BORDER_L}`}>—</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtBRL(totals.period)}</td>
                    <td className={`px-2 py-2 text-right ${BORDER_L}`}>—</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtBRL(totals.accum)}</td>
                    <td className={`px-2 py-2 text-right ${BORDER_L}`}>—</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtBRL(totals.balance)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Rodapé técnico */}
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

      {/* Histórico de alterações */}
      {activeMeasurement?.history && activeMeasurement.history.length > 0 && (
        <Card className="print:hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Histórico de alterações</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-64 overflow-auto text-xs">
              <table className="w-full">
                <thead className="bg-muted/40 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-1.5">Data/Hora</th>
                    <th className="text-left px-3 py-1.5">Campo</th>
                    <th className="text-left px-3 py-1.5">Anterior</th>
                    <th className="text-left px-3 py-1.5">Novo</th>
                    <th className="text-left px-3 py-1.5">Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {activeMeasurement.history.slice().reverse().map((h, i) => (
                    <tr key={i} className="border-t border-border/60">
                      <td className="px-3 py-1 tabular-nums">{new Date(h.at).toLocaleString('pt-BR')}</td>
                      <td className="px-3 py-1">{h.field}</td>
                      <td className="px-3 py-1 text-muted-foreground">{h.previous}</td>
                      <td className="px-3 py-1">{h.next}</td>
                      <td className="px-3 py-1 text-muted-foreground">{h.reason || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Assinaturas (impressão) */}
      <div className="hidden print:grid grid-cols-2 gap-8 mt-12 pt-8 text-[11px]">
        <SignatureBox label="Responsável Técnico" />
        <SignatureBox label="Fiscal da Obra" />
        <SignatureBox label="Contratante" />
        <SignatureBox label="Contratada" />
      </div>

      {/* Diálogo: Gerar Medição */}
      <AlertDialog open={confirmGenerate} onOpenChange={setConfirmGenerate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {validationSummary.warnings > 0
                ? 'Esta medição possui avisos. Deseja gerar mesmo assim?'
                : `Gerar medição nº ${measurementNumber}?`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  Será criado um snapshot com {rows.length} item(ns) referente ao período de{' '}
                  {fmtDateBR(startDate)} a {fmtDateBR(endDate)}.
                  Após gerar, esta medição ficará bloqueada para edição direta.
                  Alterações futuras na EAP ou nos apontamentos não afetarão o snapshot.
                </p>
                {validationSummary.warnings > 0 && (
                  <div className="rounded border border-warning/30 bg-warning/10 p-2">
                    <p className="font-medium text-warning mb-1">
                      Avisos encontrados ({validationSummary.warnings}):
                    </p>
                    <ul className="list-disc pl-5 space-y-0.5 text-xs">
                      {validationIssues
                        .filter(i => i.level === 'warning')
                        .map((i, idx) => (
                          <li key={idx}>{i.message}</li>
                        ))}
                    </ul>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={generateMeasurement}>
              {validationSummary.warnings > 0 ? 'Gerar mesmo assim' : 'Gerar Medição'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Diálogo: Editar Medição */}
      <AlertDialog open={confirmEdit} onOpenChange={setConfirmEdit}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Liberar medição para ajustes?</AlertDialogTitle>
            <AlertDialogDescription>
              A medição nº {activeMeasurement?.number} sairá do bloqueio e o status passará para “Reprovada / Ajustar”.
              Os campos editáveis serão: Quantidade da medição (aprovada), Código, Banco e Valor unitário.
              O snapshot original será preservado e cada alteração ficará registrada no histórico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-1">
            <label className="text-xs font-medium text-muted-foreground">Motivo do ajuste</label>
            <Input
              placeholder="Ex.: Fiscal solicitou redução de quantidade no item 1.2.1"
              value={editReason}
              onChange={e => setEditReason(e.target.value)}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={unlockForEdit}>Liberar edição</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Diálogo: Excluir */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir medição nº {activeMeasurement?.number}?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação remove o snapshot e seu histórico permanentemente. A EAP e os apontamentos diários não são afetados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={deleteMeasurement} className="bg-destructive text-destructive-foreground">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ───────── Subcomponentes ─────────
function FormField({
  label, colSpan, children, last, bottom,
}: {
  label: string; colSpan: number; children: React.ReactNode; last?: boolean; bottom?: boolean;
}) {
  return (
    <div
      className={`col-span-${colSpan} px-3 py-1.5 border-border ${last ? '' : 'border-r'} ${bottom ? '' : 'border-b'}`}
      style={{ gridColumn: `span ${colSpan} / span ${colSpan}` }}
    >
      <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      {children}
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

function SignatureBox({ label }: { label: string }) {
  return (
    <div>
      <div className="border-t border-foreground pt-1 text-center">
        <p className="font-semibold uppercase tracking-wider text-[10px]">{label}</p>
        <p className="text-[9px] text-muted-foreground">Nome / CREA / Assinatura</p>
      </div>
    </div>
  );
}
