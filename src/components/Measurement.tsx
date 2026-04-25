import { useMemo, useState, useEffect, Fragment } from 'react';
import { Project, Task, Phase, ContractInfo } from '@/types/project';
import { getChapterTree, getChapterNumbering, ChapterNode } from '@/lib/chapters';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ClipboardList, FileSpreadsheet, FileDown, Printer, Search, CalendarDays, Building2 } from 'lucide-react';
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
  qtyContracted: number;
  qtyPriorAccum: number;
  qtyPeriod: number;
  qtyCurrentAccum: number;
  qtyBalance: number;
  percentExecuted: number;
  unitPrice: number;
  unitPriceIsEstimated: boolean;
  valuePeriod: number;
  valueAccum: number;
  valueContracted: number;
  valueBalance: number;
}

interface GroupNode {
  phaseId: string;
  number: string;        // "1", "1.1"
  name: string;
  depth: number;         // 0 = capítulo principal, 1 = subcapítulo, ...
  rows: Row[];           // tarefas diretas desta phase
  children: GroupNode[]; // subgrupos
  totals: {
    contracted: number;
    period: number;
    accum: number;
    balance: number;
    qtyContracted: number;
    qtyAccum: number;
  };
}

const fmtBRL = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });

const fmtNum = (n: number) =>
  n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

const fmtPct = (n: number) => `${n.toFixed(1)}%`;

const fmtDateBR = (iso: string) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

/** Estimate task value from materials + labor (when no explicit unit price). */
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

/** Order tasks following chapter tree (depth-first), generating hierarchical item numbers. */
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

      // Tasks of this phase first
      node.phase.tasks.forEach((task, idx) => {
        out.push({
          task,
          phase: node.phase,
          itemNumber: `${phaseNumber}.${idx + 1}`,
          chain: newChain.join(' › '),
        });
      });

      // Then descend into subchapters
      walk(node.children, newChain);
    });
  };
  walk(tree, []);

  // Legacy/orphan phases not in tree
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

  // Contract info — controlled local state synced with project
  const contract = project.contractInfo || {};
  const [contractor, setContractor] = useState(contract.contractor || '');
  const [contracted, setContracted] = useState(contract.contracted || '');
  const [measurementNumber, setMeasurementNumber] = useState(
    contract.nextMeasurementNumber?.toString() || '1'
  );
  const issueDate = today;

  useEffect(() => {
    setContractor(project.contractInfo?.contractor || '');
    setContracted(project.contractInfo?.contracted || '');
    setMeasurementNumber(project.contractInfo?.nextMeasurementNumber?.toString() || '1');
  }, [project.id]);

  const persistContractInfo = (next: Partial<ContractInfo>) => {
    onProjectChange({
      ...project,
      contractInfo: { ...(project.contractInfo || {}), ...next },
    });
  };

  const numbering = useMemo(() => getChapterNumbering(project), [project]);

  // Build ordered/numbered task list
  const orderedTasks = useMemo(() => buildOrderedTasks(project), [project]);

  // Calculate row data
  const rows: Row[] = useMemo(() => {
    return orderedTasks.map(({ task, phase, itemNumber, chain }) => {
      const qtyContracted = task.quantity ?? task.baseline?.quantity ?? 0;
      const unit = task.unit || '';

      let qtyPriorAccum = 0;
      let qtyPeriod = 0;

      const logs = task.dailyLogs || [];
      if (logs.length > 0) {
        for (const log of logs) {
          const d = log.date;
          if (d < startDate) {
            qtyPriorAccum += log.actualQuantity || 0;
          } else if (d >= startDate && d <= endDate) {
            qtyPeriod += log.actualQuantity || 0;
          }
        }
      } else {
        // Fallback: use percentComplete as accumulated
        const pct = (task.percentComplete || 0) / 100;
        qtyPriorAccum = 0;
        qtyPeriod = qtyContracted * pct;
      }

      const qtyCurrentAccum = qtyPriorAccum + qtyPeriod;
      const qtyBalance = Math.max(qtyContracted - qtyCurrentAccum, 0);
      const percentExecuted =
        qtyContracted > 0 ? (qtyCurrentAccum / qtyContracted) * 100 : task.percentComplete || 0;

      // Unit price: explicit, or estimated
      let unitPrice = task.unitPrice ?? 0;
      let unitPriceIsEstimated = false;
      if (!unitPrice) {
        const est = estimateTaskValue(task);
        unitPrice = qtyContracted > 0 ? est / qtyContracted : 0;
        unitPriceIsEstimated = unitPrice > 0;
      }

      const valueContracted = unitPrice * qtyContracted;
      const valuePeriod = unitPrice * qtyPeriod;
      const valueAccum = unitPrice * qtyCurrentAccum;
      const valueBalance = Math.max(valueContracted - valueAccum, 0);

      return {
        item: itemNumber,
        phaseId: phase.id,
        phaseChain: chain,
        taskId: task.id,
        description: task.name,
        unit,
        qtyContracted,
        qtyPriorAccum,
        qtyPeriod,
        qtyCurrentAccum,
        qtyBalance,
        percentExecuted,
        unitPrice,
        unitPriceIsEstimated,
        valuePeriod,
        valueAccum,
        valueContracted,
        valueBalance,
      };
    });
  }, [orderedTasks, startDate, endDate]);

  // Apply filters
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (chapterFilter !== 'all') {
        // include task if its phase or any ancestor matches the filter
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
        const blob = `${r.item} ${r.phaseChain} ${r.description}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [rows, chapterFilter, search, project.phases]);

  // Build hierarchical group tree (capítulo → subcapítulo → ...) only including
  // nodes that contain at least one filtered task (directly or via descendants).
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

      const totals = {
        contracted: 0, period: 0, accum: 0, balance: 0,
        qtyContracted: 0, qtyAccum: 0,
      };
      directRows.forEach(r => {
        totals.contracted += r.valueContracted;
        totals.period += r.valuePeriod;
        totals.accum += r.valueAccum;
        totals.balance += r.valueBalance;
        totals.qtyContracted += r.qtyContracted;
        totals.qtyAccum += r.qtyCurrentAccum;
      });
      childGroups.forEach(c => {
        totals.contracted += c.totals.contracted;
        totals.period += c.totals.period;
        totals.accum += c.totals.accum;
        totals.balance += c.totals.balance;
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

  // Totals
  const totals = useMemo(() => {
    const totalsSum = filteredRows.reduce(
      (acc, r) => ({
        contracted: acc.contracted + r.valueContracted,
        period: acc.period + r.valuePeriod,
        accum: acc.accum + r.valueAccum,
        balance: acc.balance + r.valueBalance,
        qtyContracted: acc.qtyContracted + r.qtyContracted,
        qtyAccum: acc.qtyAccum + r.qtyCurrentAccum,
      }),
      { contracted: 0, period: 0, accum: 0, balance: 0, qtyContracted: 0, qtyAccum: 0 }
    );
    const physicalPct = totalsSum.qtyContracted > 0
      ? (totalsSum.qtyAccum / totalsSum.qtyContracted) * 100
      : 0;
    const financialPct = totalsSum.contracted > 0
      ? (totalsSum.accum / totalsSum.contracted) * 100
      : 0;
    return { ...totalsSum, physicalPct, financialPct };
  }, [filteredRows]);

  // Update unit price for a task
  const updateUnitPrice = (taskId: string, value: number) => {
    onProjectChange({
      ...project,
      phases: project.phases.map(p => ({
        ...p,
        tasks: p.tasks.map(t => (t.id === taskId ? { ...t, unitPrice: value } : t)),
      })),
    });
  };

  // ---------- EXPORTS ----------
  const exportXLSX = () => {
    const headerRows: (string | number)[][] = [
      ['BOLETIM DE MEDIÇÃO'],
      [],
      ['Obra:', project.name],
      ['Contratante:', contractor],
      ['Contratada:', contracted],
      ['Medição Nº:', measurementNumber],
      ['Período:', `${fmtDateBR(startDate)} a ${fmtDateBR(endDate)}`],
      ['Data de emissão:', fmtDateBR(issueDate)],
      [],
    ];

    const tableHeader = [
      'Item', 'Capítulo', 'Descrição', 'Unidade',
      'Qtd Contratada', 'Acum. Anterior', 'Medição Período', 'Acum. Atual',
      'Saldo Qtd', '% Executado',
      'Valor Unitário (R$)', 'Valor Contratado (R$)',
      'Valor Período (R$)', 'Valor Acumulado (R$)', 'Saldo Financeiro (R$)',
    ];

    const dataRows: (string | number)[][] = [tableHeader];

    const blank = (n: number) => Array.from({ length: n }, () => '');

    const walkXLSX = (group: GroupNode) => {
      const indent = '  '.repeat(group.depth);
      // Chapter header row
      dataRows.push([
        group.number,
        `${indent}${group.name}`,
        ...blank(13),
      ]);

      // Direct rows
      group.rows.forEach(r => {
        dataRows.push([
          r.item, '', r.description, r.unit,
          r.qtyContracted, r.qtyPriorAccum, r.qtyPeriod, r.qtyCurrentAccum,
          r.qtyBalance, Number(r.percentExecuted.toFixed(2)),
          Number(r.unitPrice.toFixed(2)),
          Number(r.valueContracted.toFixed(2)),
          Number(r.valuePeriod.toFixed(2)),
          Number(r.valueAccum.toFixed(2)),
          Number(r.valueBalance.toFixed(2)),
        ]);
      });

      // Recurse into children
      group.children.forEach(walkXLSX);

      // Subtotal row for this chapter (after rows + children)
      dataRows.push([
        '',
        `${indent}Subtotal ${group.number} ${group.name}`,
        ...blank(9),
        Number(group.totals.contracted.toFixed(2)),
        Number(group.totals.period.toFixed(2)),
        Number(group.totals.accum.toFixed(2)),
        Number(group.totals.balance.toFixed(2)),
      ]);
    };

    groupTree.forEach(walkXLSX);

    dataRows.push([
      '', 'TOTAL GERAL', '', '', '', '', '', '', '', '',
      '',
      Number(totals.contracted.toFixed(2)),
      Number(totals.period.toFixed(2)),
      Number(totals.accum.toFixed(2)),
      Number(totals.balance.toFixed(2)),
    ]);

    const sheetData = [...headerRows, ...dataRows];
    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    ws['!cols'] = [
      { wch: 8 }, { wch: 30 }, { wch: 36 }, { wch: 8 },
      { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
      { wch: 12 }, { wch: 11 },
      { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Medição ${measurementNumber}`);
    XLSX.writeFile(wb, `medicao_${measurementNumber}_${startDate}_a_${endDate}.xlsx`);
  };

  const exportCSV = () => {
    const escape = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lines: string[] = [];
    lines.push(escape('BOLETIM DE MEDIÇÃO'));
    lines.push(`${escape('Obra')};${escape(project.name)}`);
    lines.push(`${escape('Contratante')};${escape(contractor)}`);
    lines.push(`${escape('Contratada')};${escape(contracted)}`);
    lines.push(`${escape('Medição Nº')};${escape(measurementNumber)}`);
    lines.push(`${escape('Período')};${escape(`${fmtDateBR(startDate)} a ${fmtDateBR(endDate)}`)}`);
    lines.push('');
    const headers = [
      'Item', 'Capítulo', 'Descrição', 'Unidade',
      'Qtd Contratada', 'Acum. Anterior', 'Medição Período', 'Acum. Atual',
      'Saldo Qtd', '% Executado',
      'Valor Unitário', 'Valor Contratado', 'Valor Período', 'Valor Acumulado', 'Saldo Financeiro',
    ];
    lines.push(headers.map(escape).join(';'));
    groups.forEach(group => {
      lines.push(`${escape(group.number)};${escape(group.name)}`);
      group.rows.forEach(r => {
        lines.push([
          r.item, r.phaseChain, r.description, r.unit,
          r.qtyContracted, r.qtyPriorAccum, r.qtyPeriod, r.qtyCurrentAccum,
          r.qtyBalance, r.percentExecuted.toFixed(2),
          r.unitPrice.toFixed(2), r.valueContracted.toFixed(2),
          r.valuePeriod.toFixed(2), r.valueAccum.toFixed(2), r.valueBalance.toFixed(2),
        ].map(escape).join(';'));
      });
      lines.push([
        '', `Subtotal ${group.number} ${group.name}`, '', '', '', '', '', '', '', '',
        '',
        group.subtotalContracted.toFixed(2),
        group.subtotalPeriod.toFixed(2),
        group.subtotalAccum.toFixed(2),
        group.subtotalBalance.toFixed(2),
      ].map(escape).join(';'));
    });
    lines.push([
      '', 'TOTAL GERAL', '', '', '', '', '', '', '', '',
      '',
      totals.contracted.toFixed(2),
      totals.period.toFixed(2),
      totals.accum.toFixed(2),
      totals.balance.toFixed(2),
    ].map(escape).join(';'));

    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `medicao_${measurementNumber}_${startDate}_a_${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => window.print();

  return (
    <div className="p-6 space-y-6 print:p-0">
      <div className="flex items-center justify-between flex-wrap gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <ClipboardList className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Planilha de Medição</h1>
            <p className="text-sm text-muted-foreground">Boletim físico-financeiro</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportXLSX}>
            <FileSpreadsheet className="w-4 h-4" /> Excel
          </Button>
          <Button variant="outline" size="sm" onClick={exportCSV}>
            <FileDown className="w-4 h-4" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="w-4 h-4" /> Imprimir
          </Button>
        </div>
      </div>

      {/* Cabeçalho do boletim */}
      <Card className="border-2">
        <CardContent className="p-5">
          <div className="flex items-start justify-between mb-4 pb-3 border-b border-border">
            <div className="flex items-center gap-3">
              <Building2 className="w-6 h-6 text-primary" />
              <div>
                <h2 className="text-base font-bold tracking-wide uppercase text-foreground">
                  Boletim de Medição
                </h2>
                <p className="text-xs text-muted-foreground">
                  Medição Nº {measurementNumber || '—'} · Emitido em {fmtDateBR(issueDate)}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Obra
              </label>
              <p className="text-sm font-medium text-foreground mt-1">{project.name}</p>
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Contratante
              </label>
              <Input
                className="mt-1 h-8 text-sm"
                value={contractor}
                onChange={e => setContractor(e.target.value)}
                onBlur={() => persistContractInfo({ contractor })}
                placeholder="Nome do contratante"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Contratada
              </label>
              <Input
                className="mt-1 h-8 text-sm"
                value={contracted}
                onChange={e => setContracted(e.target.value)}
                onBlur={() => persistContractInfo({ contracted })}
                placeholder="Nome da contratada"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Medição Nº
              </label>
              <Input
                className="mt-1 h-8 text-sm"
                value={measurementNumber}
                onChange={e => setMeasurementNumber(e.target.value)}
                onBlur={() =>
                  persistContractInfo({
                    nextMeasurementNumber: Number(measurementNumber) || 1,
                  })
                }
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Período
              </label>
              <p className="text-sm font-medium text-foreground mt-1">
                {fmtDateBR(startDate)} a {fmtDateBR(endDate)}
              </p>
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Data de emissão
              </label>
              <p className="text-sm font-medium text-foreground mt-1">{fmtDateBR(issueDate)}</p>
            </div>
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
              placeholder="Item, capítulo ou descrição"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Resumo */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
              Valor contratado
            </p>
            <p className="text-base font-bold text-foreground mt-1 tabular-nums">
              {fmtBRL(totals.contracted)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
              Desta medição
            </p>
            <p className="text-base font-bold text-primary mt-1 tabular-nums">
              {fmtBRL(totals.period)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
              Acumulado
            </p>
            <p className="text-base font-bold text-foreground mt-1 tabular-nums">
              {fmtBRL(totals.accum)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
              Saldo a medir
            </p>
            <p className="text-base font-bold text-foreground mt-1 tabular-nums">
              {fmtBRL(totals.balance)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
              % Físico acumulado
            </p>
            <p className="text-base font-bold text-foreground mt-1 tabular-nums">
              {fmtPct(totals.physicalPct)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
              % Financeiro acumulado
            </p>
            <p className="text-base font-bold text-foreground mt-1 tabular-nums">
              {fmtPct(totals.financialPct)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabela */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">
            Itens medidos ({filteredRows.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-muted/60 border-y border-border text-foreground">
                <th className="px-2 py-2 text-left font-semibold w-[60px]">Item</th>
                <th className="px-2 py-2 text-left font-semibold min-w-[220px]">Descrição</th>
                <th className="px-2 py-2 text-center font-semibold w-[50px]">Un.</th>
                <th className="px-2 py-2 text-right font-semibold w-[90px]">Qtd Contrat.</th>
                <th className="px-2 py-2 text-right font-semibold w-[90px]">Acum. Ant.</th>
                <th className="px-2 py-2 text-right font-semibold w-[90px]">Medição</th>
                <th className="px-2 py-2 text-right font-semibold w-[90px]">Acum. Atual</th>
                <th className="px-2 py-2 text-right font-semibold w-[80px]">Saldo</th>
                <th className="px-2 py-2 text-right font-semibold w-[60px]">% Exec.</th>
                <th className="px-2 py-2 text-right font-semibold w-[110px]">Preço Unit.</th>
                <th className="px-2 py-2 text-right font-semibold w-[110px]">Vlr Contrat.</th>
                <th className="px-2 py-2 text-right font-semibold w-[110px]">Vlr Medição</th>
                <th className="px-2 py-2 text-right font-semibold w-[110px]">Vlr Acumul.</th>
                <th className="px-2 py-2 text-right font-semibold w-[110px]">Saldo Fin.</th>
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 ? (
                <tr>
                  <td colSpan={14} className="text-center py-8 text-muted-foreground">
                    Nenhum item encontrado para os filtros selecionados.
                  </td>
                </tr>
              ) : (
                groups.map(group => (
                  <Fragment key={group.phaseId}>
                    <tr className="bg-primary/5 border-y border-border">
                      <td colSpan={14} className="px-2 py-2 font-bold text-foreground text-[13px]">
                        {group.number} — {group.name}
                      </td>
                    </tr>
                    {group.rows.map((r, i) => (
                      <tr
                        key={r.taskId}
                        className={`border-b border-border/60 hover:bg-muted/30 ${
                          i % 2 === 0 ? 'bg-background' : 'bg-muted/10'
                        }`}
                      >
                        <td className="px-2 py-1.5 font-mono tabular-nums text-foreground align-top">
                          {r.item}
                        </td>
                        <td className="px-2 py-1.5 text-foreground align-top">
                          <div className="font-medium">{r.description}</div>
                          {r.phaseChain && (
                            <div className="text-[10px] text-muted-foreground mt-0.5 truncate" title={r.phaseChain}>
                              {r.phaseChain}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-center text-muted-foreground align-top">
                          {r.unit}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-foreground align-top">
                          {fmtNum(r.qtyContracted)}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground align-top">
                          {fmtNum(r.qtyPriorAccum)}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-primary align-top">
                          {fmtNum(r.qtyPeriod)}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-foreground align-top">
                          {fmtNum(r.qtyCurrentAccum)}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground align-top">
                          {fmtNum(r.qtyBalance)}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-foreground align-top">
                          {fmtPct(r.percentExecuted)}
                        </td>
                        <td className="px-2 py-1.5 text-right align-top print:hidden">
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={r.unitPrice ? Number(r.unitPrice.toFixed(2)) : ''}
                            placeholder="0,00"
                            onChange={e => updateUnitPrice(r.taskId, parseFloat(e.target.value) || 0)}
                            className={`h-7 px-2 text-right tabular-nums text-xs ${
                              r.unitPriceIsEstimated ? 'italic text-muted-foreground' : ''
                            }`}
                            title={r.unitPriceIsEstimated ? 'Preço estimado — clique para editar' : 'Preço unitário'}
                          />
                        </td>
                        <td className="hidden print:table-cell px-2 py-1.5 text-right tabular-nums text-foreground align-top">
                          {fmtBRL(r.unitPrice)}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-foreground align-top">
                          {fmtBRL(r.valueContracted)}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-primary align-top">
                          {fmtBRL(r.valuePeriod)}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-foreground align-top">
                          {fmtBRL(r.valueAccum)}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground align-top">
                          {fmtBRL(r.valueBalance)}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-muted/40 border-y border-border font-semibold">
                      <td colSpan={10} className="px-2 py-1.5 text-right text-foreground text-[11px]">
                        Subtotal {group.number} — {group.name}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-foreground">
                        {fmtBRL(group.subtotalContracted)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-primary">
                        {fmtBRL(group.subtotalPeriod)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-foreground">
                        {fmtBRL(group.subtotalAccum)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-foreground">
                        {fmtBRL(group.subtotalBalance)}
                      </td>
                    </tr>
                  </Fragment>
                ))
              )}
            </tbody>
            {groups.length > 0 && (
              <tfoot>
                <tr className="bg-primary/10 border-t-2 border-primary font-bold">
                  <td colSpan={10} className="px-2 py-2 text-right text-foreground text-[12px] uppercase tracking-wide">
                    Total geral
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-foreground">
                    {fmtBRL(totals.contracted)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-primary">
                    {fmtBRL(totals.period)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-foreground">
                    {fmtBRL(totals.accum)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-foreground">
                    {fmtBRL(totals.balance)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
