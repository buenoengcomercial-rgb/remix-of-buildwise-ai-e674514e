import { useMemo, useState } from 'react';
import { Project, Task, Phase } from '@/types/project';
import { getAllTasks } from '@/data/sampleProject';
import { getChapterNumbering } from '@/lib/chapters';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ClipboardList, FileSpreadsheet, FileDown, Printer, Search, CalendarDays } from 'lucide-react';
import * as XLSX from 'xlsx';

interface MeasurementProps {
  project: Project;
}

interface Row {
  item: string;
  chapter: string;
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
  valuePeriod: number;
  valueAccum: number;
  valueContracted: number;
}

const fmtBRL = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });

const fmtNum = (n: number) =>
  n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

/** Estimate task total cost from materials + labor (when no explicit budget). */
function estimateTaskValue(task: Task): number {
  const materialsCost = (task.materials || []).reduce((s, m) => s + (m.estimatedCost || 0) * (m.quantity || 1), 0);
  const laborCost = (task.laborCompositions || []).reduce((s, c) => {
    if (!c.hourlyRate || !task.quantity) return s;
    return s + (task.quantity * c.rup * (c.hourlyRate || 0));
  }, 0);
  return materialsCost + laborCost;
}

export default function Measurement({ project }: MeasurementProps) {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  const [startDate, setStartDate] = useState(monthAgo);
  const [endDate, setEndDate] = useState(today);
  const [chapterFilter, setChapterFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  const numbering = useMemo(() => getChapterNumbering(project), [project]);
  const phasesById = useMemo(() => {
    const m = new Map<string, Phase>();
    project.phases.forEach(p => m.set(p.id, p));
    return m;
  }, [project]);

  const phaseChain = (phaseId: string): string => {
    const parts: string[] = [];
    let current: Phase | undefined = phasesById.get(phaseId);
    while (current) {
      parts.unshift(current.name);
      current = current.parentId ? phasesById.get(current.parentId) : undefined;
    }
    return parts.join(' › ');
  };

  const phaseOfTask = (task: Task): Phase | undefined => {
    return project.phases.find(p => p.tasks.some(t => t.id === task.id));
  };

  const rows: Row[] = useMemo(() => {
    const tasks = getAllTasks(project);
    return tasks.map(task => {
      const phase = phaseOfTask(task);
      const phaseId = phase?.id;
      const item = phaseId ? `${numbering.get(phaseId) || ''}` : '';
      const chapter = phaseId ? phaseChain(phaseId) : task.phase || '';

      const qtyContracted = task.quantity ?? task.baseline?.quantity ?? 0;
      const unit = task.unit || '';

      // Calculate executed quantities
      let qtyPriorAccum = 0;
      let qtyPeriod = 0;
      let qtyCurrentAccum = 0;

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
        qtyCurrentAccum = qtyPriorAccum + qtyPeriod;
      } else {
        // Fallback: use percentComplete
        const pct = (task.percentComplete || 0) / 100;
        qtyCurrentAccum = qtyContracted * pct;
        qtyPriorAccum = 0;
        qtyPeriod = qtyCurrentAccum;
      }

      const qtyBalance = Math.max(qtyContracted - qtyCurrentAccum, 0);
      const percentExecuted = qtyContracted > 0 ? (qtyCurrentAccum / qtyContracted) * 100 : (task.percentComplete || 0);

      const valueContracted = estimateTaskValue(task);
      const unitPrice = qtyContracted > 0 ? valueContracted / qtyContracted : 0;
      const valuePeriod = unitPrice * qtyPeriod;
      const valueAccum = unitPrice * qtyCurrentAccum;

      return {
        item,
        chapter,
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
        valuePeriod,
        valueAccum,
        valueContracted,
      };
    });
  }, [project, numbering, startDate, endDate]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (chapterFilter !== 'all') {
        const phase = project.phases.find(p => p.id === chapterFilter);
        if (phase && !r.chapter.includes(phase.name)) return false;
      }
      if (q) {
        const blob = `${r.item} ${r.chapter} ${r.description}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [rows, chapterFilter, search, project.phases]);

  const totals = useMemo(() => {
    return filteredRows.reduce(
      (acc, r) => ({
        contracted: acc.contracted + r.valueContracted,
        period: acc.period + r.valuePeriod,
        accum: acc.accum + r.valueAccum,
      }),
      { contracted: 0, period: 0, accum: 0 }
    );
  }, [filteredRows]);

  const balance = totals.contracted - totals.accum;

  const exportXLSX = () => {
    const data = [
      [
        'Item', 'Capítulo', 'Descrição', 'Unidade',
        'Qtd Contratada', 'Acum. Anterior', 'Medição Período', 'Acum. Atual',
        'Saldo Qtd', '% Executado',
        'Valor Unitário', 'Valor Período', 'Valor Acumulado', 'Valor Contratado',
      ],
      ...filteredRows.map(r => [
        r.item, r.chapter, r.description, r.unit,
        r.qtyContracted, r.qtyPriorAccum, r.qtyPeriod, r.qtyCurrentAccum,
        r.qtyBalance, Number(r.percentExecuted.toFixed(2)),
        Number(r.unitPrice.toFixed(2)), Number(r.valuePeriod.toFixed(2)),
        Number(r.valueAccum.toFixed(2)), Number(r.valueContracted.toFixed(2)),
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Medição');
    XLSX.writeFile(wb, `medicao_${startDate}_a_${endDate}.xlsx`);
  };

  const exportCSV = () => {
    const headers = [
      'Item', 'Capítulo', 'Descrição', 'Unidade',
      'Qtd Contratada', 'Acum. Anterior', 'Medição Período', 'Acum. Atual',
      'Saldo Qtd', '% Executado', 'Valor Unitário', 'Valor Período',
      'Valor Acumulado', 'Valor Contratado',
    ];
    const escape = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [headers.join(';')];
    filteredRows.forEach(r => {
      lines.push([
        r.item, r.chapter, r.description, r.unit,
        r.qtyContracted, r.qtyPriorAccum, r.qtyPeriod, r.qtyCurrentAccum,
        r.qtyBalance, r.percentExecuted.toFixed(2),
        r.unitPrice.toFixed(2), r.valuePeriod.toFixed(2),
        r.valueAccum.toFixed(2), r.valueContracted.toFixed(2),
      ].map(escape).join(';'));
    });
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `medicao_${startDate}_a_${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => window.print();

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <ClipboardList className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Planilha de Medição</h1>
            <p className="text-sm text-muted-foreground">
              Relatório físico-financeiro do período
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 print:hidden">
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
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Valor contratado</p>
            <p className="text-xl font-bold text-foreground mt-1">{fmtBRL(totals.contracted)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Valor desta medição</p>
            <p className="text-xl font-bold text-primary mt-1">{fmtBRL(totals.period)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Valor acumulado</p>
            <p className="text-xl font-bold text-foreground mt-1">{fmtBRL(totals.accum)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Saldo a medir</p>
            <p className="text-xl font-bold text-foreground mt-1">{fmtBRL(Math.max(balance, 0))}</p>
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
          <table className="w-full text-xs">
            <thead className="bg-muted/50 border-b border-border">
              <tr className="text-left">
                <th className="px-3 py-2 font-semibold text-foreground">Item</th>
                <th className="px-3 py-2 font-semibold text-foreground">Capítulo</th>
                <th className="px-3 py-2 font-semibold text-foreground min-w-[180px]">Descrição</th>
                <th className="px-3 py-2 font-semibold text-foreground">Un.</th>
                <th className="px-3 py-2 font-semibold text-foreground text-right">Qtd Contrat.</th>
                <th className="px-3 py-2 font-semibold text-foreground text-right">Acum. Ant.</th>
                <th className="px-3 py-2 font-semibold text-foreground text-right">Período</th>
                <th className="px-3 py-2 font-semibold text-foreground text-right">Acum. Atual</th>
                <th className="px-3 py-2 font-semibold text-foreground text-right">Saldo</th>
                <th className="px-3 py-2 font-semibold text-foreground text-right">% Exec.</th>
                <th className="px-3 py-2 font-semibold text-foreground text-right">Valor Unit.</th>
                <th className="px-3 py-2 font-semibold text-foreground text-right">Valor Período</th>
                <th className="px-3 py-2 font-semibold text-foreground text-right">Valor Acum.</th>
                <th className="px-3 py-2 font-semibold text-foreground text-right">Valor Contrat.</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={14} className="text-center py-8 text-muted-foreground">
                    Nenhum item encontrado para os filtros selecionados.
                  </td>
                </tr>
              ) : (
                filteredRows.map((r, i) => (
                  <tr
                    key={r.taskId}
                    className={`border-b border-border hover:bg-muted/30 ${i % 2 === 0 ? 'bg-background' : 'bg-muted/10'}`}
                  >
                    <td className="px-3 py-2 font-mono tabular-nums text-foreground">{r.item}</td>
                    <td className="px-3 py-2 text-muted-foreground truncate max-w-[160px]" title={r.chapter}>{r.chapter}</td>
                    <td className="px-3 py-2 text-foreground">{r.description}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.unit}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">{fmtNum(r.qtyContracted)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtNum(r.qtyPriorAccum)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-primary">{fmtNum(r.qtyPeriod)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">{fmtNum(r.qtyCurrentAccum)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtNum(r.qtyBalance)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">{r.percentExecuted.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtBRL(r.unitPrice)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-primary">{fmtBRL(r.valuePeriod)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">{fmtBRL(r.valueAccum)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">{fmtBRL(r.valueContracted)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {filteredRows.length > 0 && (
              <tfoot className="bg-muted/50 border-t-2 border-border font-semibold">
                <tr>
                  <td colSpan={11} className="px-3 py-2 text-right text-foreground">Totais:</td>
                  <td className="px-3 py-2 text-right tabular-nums text-primary">{fmtBRL(totals.period)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-foreground">{fmtBRL(totals.accum)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-foreground">{fmtBRL(totals.contracted)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
