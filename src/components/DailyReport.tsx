import { useMemo, useState, useCallback, useEffect } from 'react';
import { Project, DailyReport as DailyReportEntry, DailyReportTeamRow, DailyReportEquipmentRow, WeatherCondition, WorkCondition, Task, Phase } from '@/types/project';
import { NotebookPen, CalendarDays, Cloud, CloudRain, CloudSun, Sun, AlertTriangle, Users, Wrench, FileText, Plus, Trash2, Printer, FolderTree, ListChecks, AlertOctagon, CheckCircle2, Clock4, Activity, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { getChapterTree, getChapterNumbering, ChapterNode } from '@/lib/chapters';
import { summarizeDailyReportsForPeriod } from '@/lib/dailyReportSummary';
import jsPDF from 'jspdf';

interface DailyReportProps {
  project: Project;
  onProjectChange: (next: Project | ((prev: Project) => Project)) => void;
  undoButton?: React.ReactNode;
  /** Data ISO inicial vinda da Medição (ao clicar em "Abrir Diário"). */
  initialDate?: string;
  /** Filtro de medição inicial vindo da Medição (ex.: 'draft' ou id da medição). */
  initialMeasurementFilter?: string;
}

const WEATHER_OPTIONS: Array<{ value: WeatherCondition; label: string; icon: React.ElementType }> = [
  { value: 'ensolarado', label: 'Ensolarado', icon: Sun },
  { value: 'parcialmente_nublado', label: 'Parc. nublado', icon: CloudSun },
  { value: 'nublado', label: 'Nublado', icon: Cloud },
  { value: 'chuvoso', label: 'Chuvoso', icon: CloudRain },
  { value: 'outro', label: 'Outro', icon: AlertTriangle },
];

const WORK_OPTIONS: Array<{ value: WorkCondition; label: string }> = [
  { value: 'normal', label: 'Normal' },
  { value: 'parcialmente_prejudicada', label: 'Parcialmente prejudicada' },
  { value: 'paralisada', label: 'Paralisada' },
  { value: 'outro', label: 'Outro' },
];

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatBR(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

interface ProductionEntry {
  chapterId: string;
  chapterName: string;
  chapterNumber: string;
  subChapterId?: string;
  subChapterName?: string;
  subChapterNumber?: string;
  taskId: string;
  taskName: string;
  unit: string;
  actualQuantity: number;
  plannedQuantity: number;
  notes?: string;
}

/** Coleta todos os apontamentos da data, respeitando hierarquia capítulo/subcapítulo. */
function collectProductionForDate(project: Project, dateISO: string): ProductionEntry[] {
  const numbering = getChapterNumbering(project);
  const tree = getChapterTree(project);
  const out: ProductionEntry[] = [];

  const visit = (node: ChapterNode, parent?: ChapterNode) => {
    const phase = node.phase;
    (phase.tasks || []).forEach(task => {
      (task.dailyLogs || []).forEach(log => {
        if (log.date !== dateISO) return;
        if ((log.actualQuantity ?? 0) <= 0 && (log.plannedQuantity ?? 0) <= 0 && !log.notes) return;
        const isSub = !!parent;
        out.push({
          chapterId: parent?.phase.id ?? phase.id,
          chapterName: parent?.phase.name ?? phase.name,
          chapterNumber: numbering.get(parent?.phase.id ?? phase.id) || '',
          subChapterId: isSub ? phase.id : undefined,
          subChapterName: isSub ? phase.name : undefined,
          subChapterNumber: isSub ? (numbering.get(phase.id) || '') : undefined,
          taskId: task.id,
          taskName: task.name,
          unit: task.unit || 'un',
          actualQuantity: log.actualQuantity || 0,
          plannedQuantity: log.plannedQuantity || 0,
          notes: log.notes,
        });
      });
    });
    node.children.forEach(child => visit(child, node));
  };

  tree.forEach(node => visit(node));
  return out;
}

export default function DailyReport({ project, onProjectChange, undoButton, initialDate, initialMeasurementFilter }: DailyReportProps) {
  const [selectedDate, setSelectedDate] = useState<string>(initialDate || todayISO());
  const [measurementFilter, setMeasurementFilter] = useState<string>(initialMeasurementFilter || 'all');

  // Sincroniza filtro vindo da Medição
  useEffect(() => {
    if (initialMeasurementFilter) setMeasurementFilter(initialMeasurementFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMeasurementFilter]);

  const reports = project.dailyReports || [];

  // Lista de períodos selecionáveis (medições geradas + medição em preparação)
  const measurementPeriods = useMemo(() => {
    const list: Array<{ id: string; label: string; startDate: string; endDate: string }> = [];
    (project.measurements || []).slice().sort((a, b) => a.number - b.number).forEach(m => {
      list.push({
        id: m.id,
        label: `Medição Nº ${m.number}`,
        startDate: m.startDate,
        endDate: m.endDate,
      });
    });
    const draft = project.measurementDraft;
    if (draft?.startDate && draft?.endDate) {
      list.push({
        id: 'draft',
        label: `Medição em preparação (Nº ${draft.number})`,
        startDate: draft.startDate,
        endDate: draft.endDate,
      });
    }
    return list;
  }, [project.measurements, project.measurementDraft]);

  const activePeriod = useMemo(
    () => measurementPeriods.find(p => p.id === measurementFilter) || null,
    [measurementPeriods, measurementFilter],
  );

  // Datas exibidas no seletor secundário (quando filtra por uma medição)
  const periodDates = useMemo(() => {
    if (!activePeriod) return [] as string[];
    const out: string[] = [];
    const [sy, sm, sd] = activePeriod.startDate.split('-').map(Number);
    const [ey, em, ed] = activePeriod.endDate.split('-').map(Number);
    const cur = new Date(Date.UTC(sy, (sm || 1) - 1, sd || 1));
    const end = new Date(Date.UTC(ey, (em || 1) - 1, ed || 1));
    while (cur.getTime() <= end.getTime()) {
      out.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return out;
  }, [activePeriod]);

  // Detecta se a data selecionada pertence a alguma medição (gerada ou em preparação)
  const dateMembership = useMemo(() => {
    const generated = (project.measurements || []).find(
      m => selectedDate >= m.startDate && selectedDate <= m.endDate,
    );
    if (generated) {
      return { kind: 'generated' as const, label: `Medição Nº ${generated.number}` };
    }
    const draft = project.measurementDraft;
    if (draft?.startDate && draft?.endDate &&
        selectedDate >= draft.startDate && selectedDate <= draft.endDate) {
      return { kind: 'draft' as const, label: `Medição em preparação (Nº ${draft.number})` };
    }
    return null;
  }, [project.measurements, project.measurementDraft, selectedDate]);

  const currentReport: DailyReportEntry = useMemo(() => {
    const found = reports.find(r => r.date === selectedDate);
    if (found) return found;
    const now = new Date().toISOString();
    return {
      id: uid('dr'),
      date: selectedDate,
      teamsPresent: [],
      equipment: [],
      attachments: [],
      createdAt: now,
      updatedAt: now,
    };
  }, [reports, selectedDate]);

  const production = useMemo(
    () => collectProductionForDate(project, selectedDate),
    [project, selectedDate]
  );

  // Sincroniza data quando a Medição navega para o Diário com uma data específica.
  useEffect(() => {
    if (initialDate && initialDate !== selectedDate) {
      setSelectedDate(initialDate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDate]);

  // Agrupa por capítulo > subcapítulo > tarefa
  const grouped = useMemo(() => {
    const byChapter = new Map<string, {
      chapterNumber: string;
      chapterName: string;
      subs: Map<string, { number: string; name: string; entries: ProductionEntry[] }>;
      direct: ProductionEntry[];
    }>();
    production.forEach(p => {
      if (!byChapter.has(p.chapterId)) {
        byChapter.set(p.chapterId, {
          chapterNumber: p.chapterNumber,
          chapterName: p.chapterName,
          subs: new Map(),
          direct: [],
        });
      }
      const bucket = byChapter.get(p.chapterId)!;
      if (p.subChapterId) {
        if (!bucket.subs.has(p.subChapterId)) {
          bucket.subs.set(p.subChapterId, {
            number: p.subChapterNumber || '',
            name: p.subChapterName || '',
            entries: [],
          });
        }
        bucket.subs.get(p.subChapterId)!.entries.push(p);
      } else {
        bucket.direct.push(p);
      }
    });
    return Array.from(byChapter.values());
  }, [production]);

  const summary = useMemo(() => ({
    tasks: new Set(production.map(p => p.taskId)).size,
    chapters: new Set(production.map(p => p.chapterId)).size,
    teams: (currentReport.teamsPresent?.length || 0),
    occurrences: (currentReport.occurrences?.trim() ? 1 : 0),
    hasImpediments: !!currentReport.impediments?.trim(),
  }), [production, currentReport]);

  // ───── Persistência ─────
  const persist = useCallback((mutator: (r: DailyReportEntry) => DailyReportEntry) => {
    onProjectChange(prev => {
      const list = prev.dailyReports || [];
      const idx = list.findIndex(r => r.date === selectedDate);
      const base = idx >= 0 ? list[idx] : currentReport;
      const updated: DailyReportEntry = { ...mutator(base), date: selectedDate, updatedAt: new Date().toISOString() };
      const nextList = idx >= 0
        ? list.map((r, i) => i === idx ? updated : r)
        : [...list, updated];
      return { ...prev, dailyReports: nextList };
    });
  }, [onProjectChange, selectedDate, currentReport]);

  const updateField = <K extends keyof DailyReportEntry>(key: K, value: DailyReportEntry[K]) => {
    persist(r => ({ ...r, [key]: value }));
  };

  // Equipes
  const addTeamRow = () => persist(r => ({
    ...r,
    teamsPresent: [...(r.teamsPresent || []), { id: uid('tm'), name: '', role: '', count: 1 }],
  }));
  const updateTeamRow = (id: string, patch: Partial<DailyReportTeamRow>) => persist(r => ({
    ...r,
    teamsPresent: (r.teamsPresent || []).map(t => t.id === id ? { ...t, ...patch } : t),
  }));
  const removeTeamRow = (id: string) => persist(r => ({
    ...r,
    teamsPresent: (r.teamsPresent || []).filter(t => t.id !== id),
  }));

  // Equipamentos
  const addEqRow = () => persist(r => ({
    ...r,
    equipment: [...(r.equipment || []), { id: uid('eq'), name: '', count: 1, notes: '' }],
  }));
  const updateEqRow = (id: string, patch: Partial<DailyReportEquipmentRow>) => persist(r => ({
    ...r,
    equipment: (r.equipment || []).map(e => e.id === id ? { ...e, ...patch } : e),
  }));
  const removeEqRow = (id: string) => persist(r => ({
    ...r,
    equipment: (r.equipment || []).filter(e => e.id !== id),
  }));

  // ───── PDF ─────
  const handlePrint = () => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 14;
    let y = margin;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('DIÁRIO DE OBRA', pageW / 2, y, { align: 'center' });
    y += 6;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Obra: ${project.name}`, margin, y);
    doc.text(`Data: ${formatBR(selectedDate)}`, pageW - margin, y, { align: 'right' });
    y += 5;
    if (project.contractInfo?.contracted) {
      doc.text(`Contratada: ${project.contractInfo.contracted}`, margin, y);
      y += 5;
    }
    doc.setDrawColor(180);
    doc.line(margin, y, pageW - margin, y);
    y += 5;

    const writeKV = (label: string, value: string) => {
      if (y > 270) { doc.addPage(); y = margin; }
      doc.setFont('helvetica', 'bold');
      doc.text(`${label}:`, margin, y);
      doc.setFont('helvetica', 'normal');
      const lines = doc.splitTextToSize(value || '—', pageW - margin * 2 - 35);
      doc.text(lines, margin + 35, y);
      y += Math.max(5, lines.length * 5);
    };

    const weatherLabel = currentReport.weather === 'outro'
      ? `Outro: ${currentReport.weatherOther || ''}`
      : (WEATHER_OPTIONS.find(w => w.value === currentReport.weather)?.label || '—');
    const workLabel = currentReport.workCondition === 'outro'
      ? `Outro: ${currentReport.workConditionOther || ''}`
      : (WORK_OPTIONS.find(w => w.value === currentReport.workCondition)?.label || '—');

    writeKV('Responsável', currentReport.responsible || '—');
    writeKV('Clima', weatherLabel);
    writeKV('Condição de trabalho', workLabel);

    if ((currentReport.teamsPresent || []).length) {
      y += 2;
      doc.setFont('helvetica', 'bold'); doc.text('Equipe presente:', margin, y); y += 5;
      doc.setFont('helvetica', 'normal');
      currentReport.teamsPresent!.forEach(t => {
        if (y > 275) { doc.addPage(); y = margin; }
        doc.text(`• ${t.name || '—'}${t.role ? ` (${t.role})` : ''} — ${t.count ?? 1}`, margin + 4, y);
        y += 5;
      });
    }

    if ((currentReport.equipment || []).length) {
      y += 2;
      doc.setFont('helvetica', 'bold'); doc.text('Equipamentos:', margin, y); y += 5;
      doc.setFont('helvetica', 'normal');
      currentReport.equipment!.forEach(e => {
        if (y > 275) { doc.addPage(); y = margin; }
        doc.text(`• ${e.name || '—'} — ${e.count ?? 1}${e.notes ? ` (${e.notes})` : ''}`, margin + 4, y);
        y += 5;
      });
    }

    if (currentReport.occurrences) { y += 2; writeKV('Ocorrências', currentReport.occurrences); }
    if (currentReport.impediments) { writeKV('Impedimentos', currentReport.impediments); }
    if (currentReport.observations) { writeKV('Observações', currentReport.observations); }

    y += 4;
    if (y > 260) { doc.addPage(); y = margin; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text('Produção executada no dia', margin, y); y += 6;
    doc.setFontSize(9); doc.setFont('helvetica', 'normal');

    if (grouped.length === 0) {
      doc.text('Nenhum apontamento de produção lançado nesta data.', margin, y);
      y += 5;
    } else {
      grouped.forEach(ch => {
        if (y > 275) { doc.addPage(); y = margin; }
        doc.setFont('helvetica', 'bold');
        doc.text(`${ch.chapterNumber} ${ch.chapterName}`, margin, y); y += 5;
        doc.setFont('helvetica', 'normal');
        const renderEntries = (entries: ProductionEntry[], indent: number) => {
          entries.forEach(e => {
            if (y > 280) { doc.addPage(); y = margin; }
            const txt = `• ${e.taskName} — ${e.actualQuantity.toFixed(2)} ${e.unit}` +
              (e.plannedQuantity ? ` (meta ${e.plannedQuantity.toFixed(2)})` : '') +
              (e.notes ? ` — ${e.notes}` : '');
            const lines = doc.splitTextToSize(txt, pageW - margin * 2 - indent);
            doc.text(lines, margin + indent, y);
            y += lines.length * 4.5;
          });
        };
        renderEntries(ch.direct, 4);
        ch.subs.forEach(sub => {
          if (y > 275) { doc.addPage(); y = margin; }
          doc.setFont('helvetica', 'bold');
          doc.text(`  ${sub.number} ${sub.name}`, margin + 2, y); y += 5;
          doc.setFont('helvetica', 'normal');
          renderEntries(sub.entries, 8);
        });
        y += 2;
      });
    }

    // Rodapé em todas as páginas
    const total = doc.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      doc.setPage(i);
      doc.setFontSize(8); doc.setTextColor(120);
      const orgLine = project.contractInfo?.contracted || '';
      doc.text(orgLine, margin, 290);
      doc.text(`Página ${i}/${total}`, pageW - margin, 290, { align: 'right' });
      doc.setTextColor(0);
    }

    const safeName = project.name.replace(/[^a-z0-9]+/gi, '_');
    doc.save(`Diario_${selectedDate}_${safeName}.pdf`);
  };

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <NotebookPen className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Diário de Obra</h1>
            <p className="text-xs text-muted-foreground">
              Registro diário de equipes, ocorrências e produção da obra.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {undoButton}
          <Select value={measurementFilter} onValueChange={setMeasurementFilter}>
            <SelectTrigger className="h-9 w-[230px] text-xs">
              <SelectValue placeholder="Filtrar por medição" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as datas</SelectItem>
              {measurementPeriods.map(p => (
                <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {activePeriod && periodDates.length > 0 ? (
            <Select value={selectedDate} onValueChange={setSelectedDate}>
              <SelectTrigger className="h-9 w-[170px] text-xs">
                <SelectValue placeholder="Data" />
              </SelectTrigger>
              <SelectContent className="max-h-[260px]">
                {periodDates.map(d => (
                  <SelectItem key={d} value={d}>{formatBR(d)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-1.5">
              <CalendarDays className="w-4 h-4 text-muted-foreground" />
              <input
                type="date"
                value={selectedDate}
                onChange={e => setSelectedDate(e.target.value)}
                className="bg-transparent text-sm focus:outline-none"
              />
            </div>
          )}
          <Button onClick={handlePrint} variant="outline" size="sm">
            <Printer className="w-4 h-4 mr-1.5" /> Imprimir / PDF
          </Button>
        </div>
      </div>

      {/* Vínculo com Medição */}
      {dateMembership && (
        <div className={`rounded-md border px-3 py-2 text-xs flex items-center gap-2 ${
          dateMembership.kind === 'generated'
            ? 'border-info/40 bg-info/10 text-info'
            : 'border-warning/40 bg-warning/10 text-warning'
        }`}>
          <FileText className="w-3.5 h-3.5" />
          <span>
            {dateMembership.kind === 'generated'
              ? <>Este diário faz parte da <strong>{dateMembership.label}</strong>.</>
              : <>Este diário está dentro do período da <strong>{dateMembership.label}</strong>.</>}
          </span>
        </div>
      )}

      {/* Resumo */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <SummaryCard icon={ListChecks} label="Tarefas com produção" value={summary.tasks} />
        <SummaryCard icon={FolderTree} label="Capítulos com produção" value={summary.chapters} />
        <SummaryCard icon={Users} label="Equipes presentes" value={summary.teams} />
        <SummaryCard icon={FileText} label="Ocorrências" value={summary.occurrences} />
        <SummaryCard
          icon={AlertOctagon}
          label="Impedimentos"
          value={summary.hasImpediments ? 'Sim' : 'Não'}
          tone={summary.hasImpediments ? 'warning' : 'ok'}
        />
      </div>

      {/* Informações gerais */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Informações do dia</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Responsável pelo lançamento</Label>
              <Input
                value={currentReport.responsible || ''}
                onChange={e => updateField('responsible', e.target.value)}
                placeholder="Nome / função"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Clima</Label>
              <Select
                value={currentReport.weather || ''}
                onValueChange={(v) => updateField('weather', v as WeatherCondition)}
              >
                <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                <SelectContent>
                  {WEATHER_OPTIONS.map(o => {
                    const Icon = o.icon;
                    return (
                      <SelectItem key={o.value} value={o.value}>
                        <span className="inline-flex items-center gap-2">
                          <Icon className="w-3.5 h-3.5" /> {o.label}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {currentReport.weather === 'outro' && (
                <Input
                  className="mt-1"
                  placeholder="Descreva o clima"
                  value={currentReport.weatherOther || ''}
                  onChange={e => updateField('weatherOther', e.target.value)}
                />
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Condição de trabalho</Label>
              <Select
                value={currentReport.workCondition || ''}
                onValueChange={(v) => updateField('workCondition', v as WorkCondition)}
              >
                <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                <SelectContent>
                  {WORK_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {currentReport.workCondition === 'outro' && (
                <Input
                  className="mt-1"
                  placeholder="Descreva a condição"
                  value={currentReport.workConditionOther || ''}
                  onChange={e => updateField('workConditionOther', e.target.value)}
                />
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Equipes / Equipamentos lado a lado */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="w-4 h-4 text-info" /> Equipe presente
            </CardTitle>
            <Button size="sm" variant="ghost" onClick={addTeamRow}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Adicionar
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {(currentReport.teamsPresent || []).length === 0 && (
              <p className="text-xs text-muted-foreground italic">Nenhuma equipe lançada.</p>
            )}
            {(currentReport.teamsPresent || []).map(t => (
              <div key={t.id} className="grid grid-cols-[1fr_1fr_70px_auto] gap-2 items-center">
                <Input placeholder="Nome" value={t.name}
                  onChange={e => updateTeamRow(t.id, { name: e.target.value })} />
                <Input placeholder="Função" value={t.role || ''}
                  onChange={e => updateTeamRow(t.id, { role: e.target.value })} />
                <Input type="number" min={0} placeholder="Qtd" value={t.count ?? ''}
                  onChange={e => updateTeamRow(t.id, { count: Number(e.target.value) })} />
                <Button size="icon" variant="ghost" onClick={() => removeTeamRow(t.id)}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Wrench className="w-4 h-4 text-info" /> Equipamentos
            </CardTitle>
            <Button size="sm" variant="ghost" onClick={addEqRow}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Adicionar
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {(currentReport.equipment || []).length === 0 && (
              <p className="text-xs text-muted-foreground italic">Nenhum equipamento lançado.</p>
            )}
            {(currentReport.equipment || []).map(e => (
              <div key={e.id} className="grid grid-cols-[1fr_70px_1fr_auto] gap-2 items-center">
                <Input placeholder="Equipamento" value={e.name}
                  onChange={ev => updateEqRow(e.id, { name: ev.target.value })} />
                <Input type="number" min={0} placeholder="Qtd" value={e.count ?? ''}
                  onChange={ev => updateEqRow(e.id, { count: Number(ev.target.value) })} />
                <Input placeholder="Observação" value={e.notes || ''}
                  onChange={ev => updateEqRow(e.id, { notes: ev.target.value })} />
                <Button size="icon" variant="ghost" onClick={() => removeEqRow(e.id)}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Textos longos */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Ocorrências</CardTitle></CardHeader>
          <CardContent>
            <Textarea rows={4} value={currentReport.occurrences || ''}
              onChange={e => updateField('occurrences', e.target.value)}
              placeholder="Fatos importantes do dia..." />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Impedimentos</CardTitle></CardHeader>
          <CardContent>
            <Textarea rows={4} value={currentReport.impediments || ''}
              onChange={e => updateField('impediments', e.target.value)}
              placeholder="Problemas que afetaram a produção..." />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Observações gerais</CardTitle></CardHeader>
          <CardContent>
            <Textarea rows={4} value={currentReport.observations || ''}
              onChange={e => updateField('observations', e.target.value)}
              placeholder="Notas adicionais..." />
          </CardContent>
        </Card>
      </div>

      {/* Produção do dia */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-primary" />
            Produção executada no dia ({formatBR(selectedDate)})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {grouped.length === 0 ? (
            <p className="text-sm text-muted-foreground italic py-3">
              Nenhum apontamento de produção lançado nesta data.
            </p>
          ) : (
            <div className="space-y-4">
              {grouped.map(ch => (
                <div key={ch.chapterNumber + ch.chapterName} className="space-y-2">
                  <div className="font-semibold text-sm text-foreground">
                    {ch.chapterNumber} — {ch.chapterName}
                  </div>
                  {ch.direct.length > 0 && (
                    <ProductionTable entries={ch.direct} />
                  )}
                  {Array.from(ch.subs.values()).map(sub => (
                    <div key={sub.number + sub.name} className="ml-4 space-y-1">
                      <div className="text-xs font-medium text-muted-foreground">
                        {sub.number} — {sub.name}
                      </div>
                      <ProductionTable entries={sub.entries} />
                    </div>
                  ))}
                  <Separator />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({
  icon: Icon, label, value, tone = 'default',
}: { icon: React.ElementType; label: string; value: number | string; tone?: 'default' | 'ok' | 'warning' }) {
  const toneCls =
    tone === 'warning' ? 'text-warning' :
    tone === 'ok' ? 'text-success' :
    'text-foreground';
  return (
    <div className="bg-card border border-border rounded-lg p-3 flex items-center gap-3">
      <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center">
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">{label}</div>
        <div className={`text-lg font-bold leading-tight ${toneCls}`}>{value}</div>
      </div>
    </div>
  );
}

function ProductionTable({ entries }: { entries: ProductionEntry[] }) {
  return (
    <div className="border border-border rounded-md overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-muted/40 text-muted-foreground">
          <tr>
            <th className="text-left px-2 py-1.5 font-medium">Tarefa</th>
            <th className="text-center px-2 py-1.5 font-medium w-20">Unid.</th>
            <th className="text-right px-2 py-1.5 font-medium w-24">Realizado</th>
            <th className="text-right px-2 py-1.5 font-medium w-24">Meta</th>
            <th className="text-right px-2 py-1.5 font-medium w-24">Saldo</th>
            <th className="text-left px-2 py-1.5 font-medium">Observação</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(e => {
            const saldo = (e.plannedQuantity || 0) - (e.actualQuantity || 0);
            return (
              <tr key={e.taskId + e.notes} className="border-t border-border">
                <td className="px-2 py-1.5">{e.taskName}</td>
                <td className="px-2 py-1.5 text-center text-muted-foreground">{e.unit}</td>
                <td className="px-2 py-1.5 text-right font-semibold">{e.actualQuantity.toFixed(2)}</td>
                <td className="px-2 py-1.5 text-right">{e.plannedQuantity.toFixed(2)}</td>
                <td className={`px-2 py-1.5 text-right ${saldo > 0 ? 'text-warning' : 'text-success'}`}>
                  {saldo.toFixed(2)}
                </td>
                <td className="px-2 py-1.5 text-muted-foreground">{e.notes || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
