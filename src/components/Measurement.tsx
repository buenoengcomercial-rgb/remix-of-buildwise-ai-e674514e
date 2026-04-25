import { useMemo, useState, useEffect } from 'react';
import { Project, Task, Phase, ContractInfo } from '@/types/project';
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
} from 'lucide-react';
import * as XLSX from 'xlsx';

interface MeasurementProps {
  project: Project;
  onProjectChange: (project: Project) => void;
}

interface Row {
  item: string;          // numeração hierárquica (ex.: 1.1.2)
  phaseId: string;
  phaseChain: string;
  taskId: string;
  description: string;
  unit: string;
  itemCode: string;
  priceBank: string;
  qtyContracted: number;
  qtyPriorAccum: number;
  qtyPeriod: number;
  qtyCurrentAccum: number;
  qtyBalance: number;
  percentExecuted: number;
  // Preços
  unitPriceNoBDI: number;
  unitPriceWithBDI: number;
  unitPriceIsEstimated: boolean;
  // Valores SEM BDI
  valueContractedNoBDI: number;
  valuePeriodNoBDI: number;
  valueAccumNoBDI: number;
  valueBalanceNoBDI: number;
  // Valores COM BDI
  valueContracted: number;
  valuePeriod: number;
  valueAccum: number;
  valueBalance: number;
  /** true quando não há nenhum apontamento dentro do período selecionado */
  hasNoLogsInPeriod: boolean;
  hasNoLogsAtAll: boolean;
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

const fmtBRL = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });

const fmtNum = (n: number) =>
  n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

const fmtPct = (n: number) => `${n.toFixed(2)}%`;

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
    (s, m) => s + (m.estimatedCost || 0) * (m.quantity || 1),
    0
  );
  const laborCost = (task.laborCompositions || []).reduce((s, c) => {
    if (!c.hourlyRate || !task.quantity) return s;
    return s + task.quantity * c.rup * c.hourlyRate;
  }, 0);
  return materialsCost + laborCost;
}

function buildOrderedTasks(
  project: Project
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
          task,
          phase: node.phase,
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
        task,
        phase,
        itemNumber: `${phaseNumber}.${idx + 1}`,
        chain: phase.name,
      });
    });
  });

  return out;
}

export default function Measurement({ project, onProjectChange }: MeasurementProps) {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  const [startDate, setStartDate] = useState(monthAgo);
  const [endDate, setEndDate] = useState(today);
  const [chapterFilter, setChapterFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const contract = project.contractInfo || {};
  const [contractor, setContractor] = useState(contract.contractor || '');
  const [contracted, setContracted] = useState(contract.contracted || '');
  const [contractNumber, setContractNumber] = useState(contract.contractNumber || '');
  const [contractObject, setContractObject] = useState(contract.contractObject || '');
  const [location, setLocation] = useState(contract.location || '');
  const [budgetSource, setBudgetSource] = useState(contract.budgetSource || '');
  const [bdiInput, setBdiInput] = useState(
    contract.bdiPercent !== undefined ? String(contract.bdiPercent) : '25'
  );
  const [measurementNumber, setMeasurementNumber] = useState(
    contract.nextMeasurementNumber?.toString() || '1'
  );
  const issueDate = today;

  useEffect(() => {
    const c = project.contractInfo || {};
    setContractor(c.contractor || '');
    setContracted(c.contracted || '');
    setContractNumber(c.contractNumber || '');
    setContractObject(c.contractObject || '');
    setLocation(c.location || '');
    setBudgetSource(c.budgetSource || '');
    setBdiInput(c.bdiPercent !== undefined ? String(c.bdiPercent) : '25');
    setMeasurementNumber(c.nextMeasurementNumber?.toString() || '1');
  }, [project.id]);

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

  // ---------- Cálculo das linhas ----------
  const rows: Row[] = useMemo(() => {
    return orderedTasks.map(({ task, phase, itemNumber, chain }) => {
      const qtyContracted = task.quantity ?? task.baseline?.quantity ?? 0;
      const unit = task.unit || '';

      let qtyPriorAccum = 0;
      let qtyPeriod = 0;

      const logs = task.dailyLogs || [];
      const hasNoLogsAtAll = logs.length === 0;
      let hasLogsInPeriod = false;

      if (!hasNoLogsAtAll) {
        for (const log of logs) {
          const d = log.date;
          if (d < startDate) {
            qtyPriorAccum += log.actualQuantity || 0;
          } else if (d >= startDate && d <= endDate) {
            qtyPeriod += log.actualQuantity || 0;
            if ((log.actualQuantity || 0) > 0) hasLogsInPeriod = true;
          }
        }
      } else {
        const pct = (task.percentComplete || 0) / 100;
        qtyPriorAccum = qtyContracted * pct;
        qtyPeriod = 0;
      }

      const hasNoLogsInPeriod = !hasLogsInPeriod;
      const qtyCurrentAccum = qtyPriorAccum + qtyPeriod;
      const qtyBalance = Math.max(qtyContracted - qtyCurrentAccum, 0);
      const percentExecuted =
        qtyContracted > 0 ? (qtyCurrentAccum / qtyContracted) * 100 : task.percentComplete || 0;

      // Preço unitário c/ BDI: prioridade unitPrice (legado), senão unitPriceNoBDI*BDI, senão estimativa
      let unitPriceWithBDI = task.unitPrice ?? 0;
      let unitPriceNoBDI = task.unitPriceNoBDI ?? 0;
      let unitPriceIsEstimated = false;

      if (unitPriceNoBDI > 0 && !task.unitPrice) {
        unitPriceWithBDI = unitPriceNoBDI * bdiFactor;
      } else if (unitPriceWithBDI > 0 && !unitPriceNoBDI) {
        unitPriceNoBDI = unitPriceWithBDI / bdiFactor;
      }

      if (!unitPriceWithBDI && !unitPriceNoBDI) {
        const est = estimateTaskValue(task);
        unitPriceWithBDI = qtyContracted > 0 ? est / qtyContracted : 0;
        unitPriceNoBDI = unitPriceWithBDI / bdiFactor;
        unitPriceIsEstimated = unitPriceWithBDI > 0;
      }

      const valueContracted = unitPriceWithBDI * qtyContracted;
      const valuePeriod = unitPriceWithBDI * qtyPeriod;
      const valueAccum = unitPriceWithBDI * qtyCurrentAccum;
      const valueBalance = Math.max(valueContracted - valueAccum, 0);

      const valueContractedNoBDI = unitPriceNoBDI * qtyContracted;
      const valuePeriodNoBDI = unitPriceNoBDI * qtyPeriod;
      const valueAccumNoBDI = unitPriceNoBDI * qtyCurrentAccum;
      const valueBalanceNoBDI = Math.max(valueContractedNoBDI - valueAccumNoBDI, 0);

      return {
        item: itemNumber,
        phaseId: phase.id,
        phaseChain: chain,
        taskId: task.id,
        description: task.name,
        unit,
        itemCode: task.itemCode || '',
        priceBank: task.priceBank || '',
        qtyContracted,
        qtyPriorAccum,
        qtyPeriod,
        qtyCurrentAccum,
        qtyBalance,
        percentExecuted,
        unitPriceNoBDI,
        unitPriceWithBDI,
        unitPriceIsEstimated,
        valueContractedNoBDI,
        valuePeriodNoBDI,
        valueAccumNoBDI,
        valueBalanceNoBDI,
        valueContracted,
        valuePeriod,
        valueAccum,
        valueBalance,
        hasNoLogsInPeriod,
        hasNoLogsAtAll,
      };
    });
  }, [orderedTasks, startDate, endDate, bdiFactor]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (chapterFilter !== 'all') {
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
  }, [rows, chapterFilter, search, project.phases]);

  // ---------- Árvore de grupos ----------
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
        depth,
        rows: directRows,
        children: childGroups,
        totals,
      };
    };

    const groups = tree
      .map(n => buildNode(n, 0))
      .filter((g): g is GroupNode => g !== null);

    return groups.sort((a, b) =>
      a.number.localeCompare(b.number, undefined, { numeric: true })
    );
  }, [filteredRows, project, numbering]);

  const totals = useMemo(() => {
    const t = emptyTotals();
    filteredRows.forEach(r => {
      t.contracted += r.valueContracted;
      t.period += r.valuePeriod;
      t.accum += r.valueAccum;
      t.balance += r.valueBalance;
      t.contractedNoBDI += r.valueContractedNoBDI;
      t.periodNoBDI += r.valuePeriodNoBDI;
      t.accumNoBDI += r.valueAccumNoBDI;
      t.balanceNoBDI += r.valueBalanceNoBDI;
      t.qtyContracted += r.qtyContracted;
      t.qtyAccum += r.qtyCurrentAccum;
    });
    const pctPeriod = t.contracted > 0 ? (t.period / t.contracted) * 100 : 0;
    const pctAccum = t.contracted > 0 ? (t.accum / t.contracted) * 100 : 0;
    const pctBalance = t.contracted > 0 ? (t.balance / t.contracted) * 100 : 0;
    return { ...t, pctPeriod, pctAccum, pctBalance };
  }, [filteredRows]);

  // ---------- Persistência por tarefa ----------
  const updateTaskField = (taskId: string, patch: Partial<Task>) => {
    onProjectChange({
      ...project,
      phases: project.phases.map(p => ({
        ...p,
        tasks: p.tasks.map(t => (t.id === taskId ? { ...t, ...patch } : t)),
      })),
    });
  };

  const updateUnitPriceNoBDI = (taskId: string, value: number) => {
    updateTaskField(taskId, {
      unitPriceNoBDI: value,
      unitPrice: value * bdiFactor,
    });
  };

  const updateUnitPriceWithBDI = (taskId: string, value: number) => {
    updateTaskField(taskId, {
      unitPrice: value,
      unitPriceNoBDI: value / bdiFactor,
    });
  };

  const setManualPeriodQuantity = (taskId: string, value: number) => {
    const safeValue = Math.max(0, Number.isFinite(value) ? value : 0);
    const manualId = `manual-measurement-${startDate}-${endDate}`;
    onProjectChange({
      ...project,
      phases: project.phases.map(p => ({
        ...p,
        tasks: p.tasks.map(t => {
          if (t.id !== taskId) return t;
          const existing = t.dailyLogs || [];
          const others = existing.filter(l => l.id !== manualId);
          if (safeValue <= 0) {
            return { ...t, dailyLogs: others };
          }
          return {
            ...t,
            dailyLogs: [
              ...others,
              {
                id: manualId,
                date: endDate,
                plannedQuantity: 0,
                actualQuantity: safeValue,
                notes: 'Lançamento manual via Planilha de Medição',
              },
            ],
          };
        }),
      })),
    });
  };

  // ---------- Collapse helpers ----------
  const toggleCollapsed = (id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ---------- EXPORT XLSX ----------
  const exportXLSX = () => {
    const headerRows: (string | number)[][] = [
      ['BOLETIM DE MEDIÇÃO PARA PAGAMENTO'],
      [],
      ['Contratante:', contractor, '', 'Contratada:', contracted],
      ['Obra:', project.name, '', 'Local/Município:', location],
      ['Objeto:', contractObject, '', 'Nº Contrato:', contractNumber],
      ['Medição Nº:', measurementNumber, '', 'Período:', `${fmtDateBR(startDate)} a ${fmtDateBR(endDate)}`],
      ['Data emissão:', fmtDateBR(issueDate), '', 'Fonte de orçamento:', budgetSource],
      ['BDI %:', bdiPercent],
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
      dataRows.push([
        group.number,
        '', '',
        `${indent}${group.name}`,
        ...blank(11),
      ]);

      group.rows.forEach(r => {
        dataRows.push([
          r.item, r.itemCode, r.priceBank, r.description, r.unit,
          Number(r.qtyContracted.toFixed(3)),
          Number(r.unitPriceNoBDI.toFixed(2)),
          Number(r.unitPriceWithBDI.toFixed(2)),
          Number(r.valueContracted.toFixed(2)),
          Number(r.qtyPeriod.toFixed(3)),
          Number(r.valuePeriod.toFixed(2)),
          Number(r.qtyCurrentAccum.toFixed(3)),
          Number(r.valueAccum.toFixed(2)),
          Number(r.qtyBalance.toFixed(3)),
          Number(r.valueBalance.toFixed(2)),
        ]);
      });

      group.children.forEach(walkXLSX);

      dataRows.push([
        '', '', '',
        `${indent}Subtotal ${group.number} ${group.name}`,
        '', '', '', '',
        Number(group.totals.contracted.toFixed(2)),
        '',
        Number(group.totals.period.toFixed(2)),
        '',
        Number(group.totals.accum.toFixed(2)),
        '',
        Number(group.totals.balance.toFixed(2)),
      ]);
    };

    groupTree.forEach(walkXLSX);

    dataRows.push([
      '', '', '', 'TOTAL GERAL', '', '', '', '',
      Number(totals.contracted.toFixed(2)), '',
      Number(totals.period.toFixed(2)), '',
      Number(totals.accum.toFixed(2)), '',
      Number(totals.balance.toFixed(2)),
    ]);

    // Totais finais (3 blocos)
    dataRows.push([]);
    dataRows.push(['RESUMO FINANCEIRO']);
    dataRows.push(['', 'Sem BDI', '', 'BDI', '', 'Com BDI']);
    dataRows.push([
      'Custo total da obra',
      Number(totals.contractedNoBDI.toFixed(2)), '',
      Number((totals.contracted - totals.contractedNoBDI).toFixed(2)), '',
      Number(totals.contracted.toFixed(2)),
    ]);
    dataRows.push([
      'Valor desta medição',
      Number(totals.periodNoBDI.toFixed(2)), '',
      Number((totals.period - totals.periodNoBDI).toFixed(2)), '',
      Number(totals.period.toFixed(2)),
    ]);
    dataRows.push([
      'Valor acumulado',
      Number(totals.accumNoBDI.toFixed(2)), '',
      Number((totals.accum - totals.accumNoBDI).toFixed(2)), '',
      Number(totals.accum.toFixed(2)),
    ]);
    dataRows.push([
      'Valor a executar',
      Number(totals.balanceNoBDI.toFixed(2)), '',
      Number((totals.balance - totals.balanceNoBDI).toFixed(2)), '',
      Number(totals.balance.toFixed(2)),
    ]);
    dataRows.push([]);
    dataRows.push(['% desta medição', Number(totals.pctPeriod.toFixed(2))]);
    dataRows.push(['% acumulado', Number(totals.pctAccum.toFixed(2))]);
    dataRows.push(['% a executar', Number(totals.pctBalance.toFixed(2))]);

    const sheetData = [...headerRows, ...dataRows];
    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    ws['!cols'] = [
      { wch: 8 }, { wch: 12 }, { wch: 10 }, { wch: 38 }, { wch: 6 },
      { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 16 },
      { wch: 14 }, { wch: 16 },
      { wch: 14 }, { wch: 16 },
      { wch: 14 }, { wch: 16 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Medição ${measurementNumber}`);
    XLSX.writeFile(wb, `medicao_${measurementNumber}_${startDate}_a_${endDate}.xlsx`);
  };

  const handlePrint = () => window.print();

  // ---------- RENDER ----------
  const COLSPAN = 15;

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
    <div className="p-6 space-y-5 print:p-0 print:space-y-3">
      {/* Print styles inline */}
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 12mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print-hide { display: none !important; }
          .measurement-table { font-size: 9px !important; }
          .measurement-table th, .measurement-table td { padding: 3px 4px !important; }
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
          <Button variant="outline" size="sm" onClick={exportXLSX}>
            <FileSpreadsheet className="w-4 h-4 mr-1" /> Excel
          </Button>
          <Button variant="default" size="sm" onClick={handlePrint}>
            <Printer className="w-4 h-4 mr-1" /> Imprimir / PDF
          </Button>
        </div>
      </div>

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
                {measurementNumber || '—'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-12 text-[11px]">
            {/* Linha 1 */}
            <FormField label="Contratante" colSpan={6}>
              <Input
                className="h-7 text-xs border-0 px-0 focus-visible:ring-0 bg-transparent"
                value={contractor}
                onChange={e => setContractor(e.target.value)}
                onBlur={() => persistContractInfo({ contractor })}
                placeholder="Nome do contratante"
              />
            </FormField>
            <FormField label="Contratada" colSpan={6}>
              <Input
                className="h-7 text-xs border-0 px-0 focus-visible:ring-0 bg-transparent"
                value={contracted}
                onChange={e => setContracted(e.target.value)}
                onBlur={() => persistContractInfo({ contracted })}
                placeholder="Nome da contratada"
              />
            </FormField>

            {/* Linha 2 */}
            <FormField label="Obra" colSpan={8}>
              <p className="text-xs font-semibold text-foreground py-1">{project.name}</p>
            </FormField>
            <FormField label="Local / Município" colSpan={4}>
              <Input
                className="h-7 text-xs border-0 px-0 focus-visible:ring-0 bg-transparent"
                value={location}
                onChange={e => setLocation(e.target.value)}
                onBlur={() => persistContractInfo({ location })}
                placeholder="Cidade / UF"
              />
            </FormField>

            {/* Linha 3 */}
            <FormField label="Objeto" colSpan={8}>
              <Input
                className="h-7 text-xs border-0 px-0 focus-visible:ring-0 bg-transparent"
                value={contractObject}
                onChange={e => setContractObject(e.target.value)}
                onBlur={() => persistContractInfo({ contractObject })}
                placeholder="Descrição resumida do escopo"
              />
            </FormField>
            <FormField label="Nº do Contrato" colSpan={4}>
              <Input
                className="h-7 text-xs border-0 px-0 focus-visible:ring-0 bg-transparent"
                value={contractNumber}
                onChange={e => setContractNumber(e.target.value)}
                onBlur={() => persistContractInfo({ contractNumber })}
                placeholder="Ex.: 001/2025"
              />
            </FormField>

            {/* Linha 4 */}
            <FormField label="Período da Medição" colSpan={4}>
              <p className="text-xs font-semibold text-foreground py-1 tabular-nums">
                {fmtDateBR(startDate)} a {fmtDateBR(endDate)}
              </p>
            </FormField>
            <FormField label="Data de Emissão" colSpan={2}>
              <p className="text-xs font-semibold text-foreground py-1 tabular-nums">
                {fmtDateBR(issueDate)}
              </p>
            </FormField>
            <FormField label="Fonte de Orçamento" colSpan={4}>
              <Input
                className="h-7 text-xs border-0 px-0 focus-visible:ring-0 bg-transparent"
                value={budgetSource}
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
                className="h-7 text-xs border-0 px-0 focus-visible:ring-0 bg-transparent tabular-nums font-semibold"
                value={bdiInput}
                onChange={e => setBdiInput(e.target.value)}
                onBlur={() => persistContractInfo({ bdiPercent: bdiPercent })}
              />
            </FormField>

            {/* Linha 5 — número da medição editável */}
            <FormField label="Medição Nº" colSpan={3} bottom>
              <Input
                className="h-7 text-xs border-0 px-0 focus-visible:ring-0 bg-transparent tabular-nums font-semibold"
                value={measurementNumber}
                onChange={e => setMeasurementNumber(e.target.value)}
                onBlur={() =>
                  persistContractInfo({ nextMeasurementNumber: Number(measurementNumber) || 1 })
                }
              />
            </FormField>
            <div className="col-span-9 border-t border-border" />
          </div>
        </CardContent>
      </Card>

      {/* Filtros */}
      <Card className="print:hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Filtros</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-1">
              <CalendarDays className="w-3 h-3" /> Data inicial
            </label>
            <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-1">
              <CalendarDays className="w-3 h-3" /> Data final
            </label>
            <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Capítulo</label>
            <Select value={chapterFilter} onValueChange={setChapterFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Todos os capítulos" />
              </SelectTrigger>
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
            <Input
              placeholder="Item, código, capítulo ou descrição"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Resumo técnico (6 cards) */}
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
          <CardTitle className="text-sm font-semibold">
            Planilha de medição ({filteredRows.length} itens)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="measurement-table w-full text-[11px] border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-foreground text-background">
                  <th className="px-2 py-2 text-left font-semibold w-[60px] sticky left-0 bg-foreground z-20">Item</th>
                  <th className="px-2 py-2 text-left font-semibold w-[90px]">Código</th>
                  <th className="px-2 py-2 text-left font-semibold w-[80px]">Banco</th>
                  <th className="px-2 py-2 text-left font-semibold min-w-[260px] sticky left-[60px] bg-foreground z-20">Descrição</th>
                  <th className="px-2 py-2 text-center font-semibold w-[50px]">Und.</th>
                  <th className="px-2 py-2 text-right font-semibold w-[90px]">Quant. Contrat.</th>
                  <th className="px-2 py-2 text-right font-semibold w-[100px]">V. Unit. s/ BDI</th>
                  <th className="px-2 py-2 text-right font-semibold w-[100px]">V. Unit. c/ BDI</th>
                  <th className="px-2 py-2 text-right font-semibold w-[110px]">Total Contratado</th>
                  <th className="px-2 py-2 text-right font-semibold w-[90px]">Quant. Medição</th>
                  <th className="px-2 py-2 text-right font-semibold w-[110px]">Subtotal Medição</th>
                  <th className="px-2 py-2 text-right font-semibold w-[90px]">Quant. Acum.</th>
                  <th className="px-2 py-2 text-right font-semibold w-[110px]">Subtotal Acumulado</th>
                  <th className="px-2 py-2 text-right font-semibold w-[90px]">Quant. a Executar</th>
                  <th className="px-2 py-2 text-right font-semibold w-[110px]">Subtotal a Executar</th>
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

                      // Chapter header row
                      out.push(
                        <tr key={`h-${g.phaseId}`} className={headerStyleByDepth(g.depth)}>
                          <td colSpan={COLSPAN} className="px-2 py-1.5">
                            <button
                              type="button"
                              onClick={() => toggleCollapsed(g.phaseId)}
                              className="inline-flex items-center gap-1 hover:opacity-80 print-hide"
                              style={{ paddingLeft: indentPx }}
                            >
                              {isCollapsed ? (
                                <ChevronRight className="w-3.5 h-3.5" />
                              ) : (
                                <ChevronDown className="w-3.5 h-3.5" />
                              )}
                              <span className="font-mono tabular-nums">{g.number}</span>
                              <span className="ml-1 uppercase tracking-wide">{g.name}</span>
                            </button>
                            <span
                              className="hidden print:inline font-mono tabular-nums"
                              style={{ paddingLeft: indentPx }}
                            >
                              {g.number} {g.name}
                            </span>
                          </td>
                        </tr>
                      );

                      if (!isCollapsed) {
                        // Direct rows
                        g.rows.forEach((r, i) => {
                          out.push(
                            <tr
                              key={r.taskId}
                              className={`border-b border-border/60 hover:bg-muted/30 ${
                                r.hasNoLogsInPeriod
                                  ? 'bg-warning/10'
                                  : i % 2 === 0
                                    ? 'bg-background'
                                    : 'bg-muted/10'
                              }`}
                            >
                              <td
                                className="px-2 py-1.5 font-mono tabular-nums text-foreground align-top sticky left-0 bg-inherit"
                                style={{ paddingLeft: indentPx + 8 }}
                              >
                                {r.item}
                              </td>
                              <td className="px-1 py-1 align-top">
                                <Input
                                  className="h-7 px-1.5 text-[11px] border-transparent hover:border-input focus-visible:ring-1 print:hidden"
                                  value={r.itemCode}
                                  onChange={e => updateTaskField(r.taskId, { itemCode: e.target.value })}
                                  placeholder="—"
                                />
                                <span className="hidden print:inline">{r.itemCode || '—'}</span>
                              </td>
                              <td className="px-1 py-1 align-top">
                                <Input
                                  className="h-7 px-1.5 text-[11px] border-transparent hover:border-input focus-visible:ring-1 print:hidden"
                                  value={r.priceBank}
                                  onChange={e => updateTaskField(r.taskId, { priceBank: e.target.value })}
                                  placeholder="—"
                                />
                                <span className="hidden print:inline">{r.priceBank || '—'}</span>
                              </td>
                              <td className="px-2 py-1.5 text-foreground align-top sticky left-[60px] bg-inherit">
                                <div className="flex items-start gap-1.5">
                                  {r.hasNoLogsInPeriod && (
                                    <AlertCircle
                                      className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5 print:hidden"
                                      aria-label="Sem apontamento no período"
                                    />
                                  )}
                                  <span className="leading-snug">{r.description}</span>
                                </div>
                              </td>
                              <td className="px-2 py-1.5 text-center text-muted-foreground align-top">
                                {r.unit}
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-foreground align-top">
                                {fmtNum(r.qtyContracted)}
                              </td>
                              <td className="px-1 py-1 text-right align-top">
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={r.unitPriceNoBDI ? Number(r.unitPriceNoBDI.toFixed(2)) : ''}
                                  placeholder="0,00"
                                  onChange={e => updateUnitPriceNoBDI(r.taskId, parseFloat(e.target.value) || 0)}
                                  className={`h-7 px-1.5 text-right tabular-nums text-[11px] border-transparent hover:border-input focus-visible:ring-1 print:hidden ${
                                    r.unitPriceIsEstimated ? 'italic text-muted-foreground' : ''
                                  }`}
                                  title={r.unitPriceIsEstimated ? 'Preço estimado — clique para editar' : 'Valor unitário sem BDI'}
                                />
                                <span className="hidden print:inline tabular-nums">
                                  {fmtBRL(r.unitPriceNoBDI)}
                                </span>
                              </td>
                              <td className="px-1 py-1 text-right align-top">
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={r.unitPriceWithBDI ? Number(r.unitPriceWithBDI.toFixed(2)) : ''}
                                  placeholder="0,00"
                                  onChange={e => updateUnitPriceWithBDI(r.taskId, parseFloat(e.target.value) || 0)}
                                  className={`h-7 px-1.5 text-right tabular-nums text-[11px] border-transparent hover:border-input focus-visible:ring-1 print:hidden ${
                                    r.unitPriceIsEstimated ? 'italic text-muted-foreground' : ''
                                  }`}
                                  title="Valor unitário com BDI"
                                />
                                <span className="hidden print:inline tabular-nums">
                                  {fmtBRL(r.unitPriceWithBDI)}
                                </span>
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-foreground align-top">
                                {fmtBRL(r.valueContracted)}
                              </td>
                              <td className="px-1 py-1 text-right align-top">
                                {r.hasNoLogsInPeriod ? (
                                  <>
                                    <Input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      value={r.qtyPeriod ? Number(r.qtyPeriod.toFixed(3)) : ''}
                                      placeholder="0,00"
                                      onChange={e =>
                                        setManualPeriodQuantity(r.taskId, parseFloat(e.target.value) || 0)
                                      }
                                      className="h-7 px-1.5 text-right tabular-nums text-[11px] border-warning/50 print:hidden"
                                      title="Sem apontamento no período — lance manualmente"
                                    />
                                    <span className="hidden print:inline tabular-nums">
                                      {fmtNum(r.qtyPeriod)}
                                    </span>
                                  </>
                                ) : (
                                  <span className="tabular-nums font-semibold">
                                    {fmtNum(r.qtyPeriod)}
                                  </span>
                                )}
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-foreground align-top">
                                {fmtBRL(r.valuePeriod)}
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-foreground align-top">
                                {fmtNum(r.qtyCurrentAccum)}
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-foreground align-top">
                                {fmtBRL(r.valueAccum)}
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground align-top">
                                {fmtNum(r.qtyBalance)}
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground align-top">
                                {fmtBRL(r.valueBalance)}
                              </td>
                            </tr>
                          );
                        });

                        g.children.forEach(renderGroup);
                      }

                      // Subtotal row
                      out.push(
                        <tr key={`s-${g.phaseId}`} className={subtotalStyleByDepth(g.depth)}>
                          <td colSpan={8} className="px-2 py-1.5 text-right text-foreground">
                            <span style={{ paddingLeft: indentPx }}>
                              Subtotal {g.number} — {g.name}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-foreground">
                            {fmtBRL(g.totals.contracted)}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-foreground">—</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-foreground">
                            {fmtBRL(g.totals.period)}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-foreground">—</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-foreground">
                            {fmtBRL(g.totals.accum)}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-foreground">—</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-foreground">
                            {fmtBRL(g.totals.balance)}
                          </td>
                        </tr>
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
                    <td colSpan={8} className="px-2 py-2 text-right uppercase tracking-wide">
                      Total Geral
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtBRL(totals.contracted)}</td>
                    <td className="px-2 py-2 text-right">—</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtBRL(totals.period)}</td>
                    <td className="px-2 py-2 text-right">—</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtBRL(totals.accum)}</td>
                    <td className="px-2 py-2 text-right">—</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtBRL(totals.balance)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Rodapé técnico — 3 blocos de totais */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <TotalsBlock
          title="Sem BDI"
          rows={[
            ['Custo total da obra', fmtBRL(totals.contractedNoBDI)],
            ['Valor desta medição', fmtBRL(totals.periodNoBDI)],
            ['Valor acumulado', fmtBRL(totals.accumNoBDI)],
            ['Valor a executar', fmtBRL(totals.balanceNoBDI)],
          ]}
        />
        <TotalsBlock
          title={`BDI (${fmtPct(bdiPercent)})`}
          rows={[
            ['BDI total', fmtBRL(totals.contracted - totals.contractedNoBDI)],
            ['BDI desta medição', fmtBRL(totals.period - totals.periodNoBDI)],
            ['BDI acumulado', fmtBRL(totals.accum - totals.accumNoBDI)],
            ['BDI a executar', fmtBRL(totals.balance - totals.balanceNoBDI)],
          ]}
        />
        <TotalsBlock
          title="Com BDI"
          highlight
          rows={[
            ['Custo total da obra', fmtBRL(totals.contracted)],
            ['Valor desta medição', fmtBRL(totals.period)],
            ['Valor acumulado', fmtBRL(totals.accum)],
            ['Valor a executar', fmtBRL(totals.balance)],
            ['% desta medição', fmtPct(totals.pctPeriod)],
            ['% acumulado', fmtPct(totals.pctAccum)],
            ['% a executar', fmtPct(totals.pctBalance)],
          ]}
        />
      </div>

      {/* Assinaturas (impressão) */}
      <div className="hidden print:grid grid-cols-2 gap-8 mt-12 pt-8 text-[11px]">
        <SignatureBox label="Responsável Técnico" />
        <SignatureBox label="Fiscal da Obra" />
        <SignatureBox label="Contratante" />
        <SignatureBox label="Contratada" />
      </div>
    </div>
  );
}

// ─── Subcomponentes ─────────────────────────────────────────

function FormField({
  label,
  colSpan,
  children,
  last,
  bottom,
}: {
  label: string;
  colSpan: number;
  children: React.ReactNode;
  last?: boolean;
  bottom?: boolean;
}) {
  return (
    <div
      className={`col-span-${colSpan} px-3 py-1.5 border-border ${
        last ? '' : 'border-r'
      } ${bottom ? '' : 'border-b'}`}
      style={{ gridColumn: `span ${colSpan} / span ${colSpan}` }}
    >
      <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? 'border-primary/40 bg-primary/5' : ''}>
      <CardContent className="p-3">
        <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
          {label}
        </p>
        <p
          className={`text-sm font-bold mt-1 tabular-nums ${
            highlight ? 'text-primary' : 'text-foreground'
          }`}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function TotalsBlock({
  title,
  rows,
  highlight,
}: {
  title: string;
  rows: [string, string][];
  highlight?: boolean;
}) {
  return (
    <Card
      className={`${
        highlight ? 'border-primary/40 bg-primary/5' : ''
      } print:break-inside-avoid`}
    >
      <CardHeader className="py-2 border-b border-border">
        <CardTitle className="text-xs font-bold uppercase tracking-wider">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-xs">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k} className="border-b border-border/60 last:border-0">
                <td className="px-3 py-1.5 text-muted-foreground">{k}</td>
                <td
                  className={`px-3 py-1.5 text-right tabular-nums font-semibold ${
                    highlight ? 'text-primary' : 'text-foreground'
                  }`}
                >
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
