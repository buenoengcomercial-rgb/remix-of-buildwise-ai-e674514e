import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { Project, DailyReport as DailyReportEntry, DailyReportTeamRow, DailyReportEquipmentRow, DailyReportAttachment, WeatherCondition, WorkCondition } from '@/types/project';
import { NotebookPen, CalendarDays, Users, Wrench, FileText, Plus, Trash2, Printer, FolderTree, ListChecks, AlertOctagon, Activity, ArrowRight, Camera, Image as ImageIcon, Loader2, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { getChapterTree, getChapterNumbering, ChapterNode } from '@/lib/chapters';
import { summarizeDailyReportsForPeriod } from '@/lib/dailyReportSummary';
import { DEFAULT_TEAMS, type TeamDefinition } from '@/lib/teams';
import { loadCompanyLogoForPdf } from '@/lib/companyBranding';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import type jsPDFType from 'jspdf';
type AutoTableFn = typeof import('jspdf-autotable').default;
// jsPDF/autoTable são carregados sob demanda (~300 kB) só ao gerar PDF.
async function loadPdfDeps(): Promise<{ jsPDF: typeof jsPDFType; autoTable: AutoTableFn }> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  return { jsPDF, autoTable };
}

import {
  PHOTO_BUCKET,
  GENERAL_TASK_VALUE,
  WEATHER_OPTIONS,
  WORK_OPTIONS,
  WEATHER_LABEL_MAP,
  STATUS_META,
  todayISO,
  formatBR,
  uid,
  readFileAsDataURL,
  shortTaskName,
} from '@/components/dailyReport/dailyReportFormat';
import type { ProductionEntry, DailyReportProps } from '@/components/dailyReport/types';
import { useDailyReportState } from '@/hooks/useDailyReportState';
import { useDailyReportPeriods } from '@/hooks/useDailyReportPeriods';

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
          teamCode: task.team,
        });
      });
    });
    node.children.forEach(child => visit(child, node));
  };

  tree.forEach(node => visit(node));
  return out;
}

export default function DailyReport({ project, onProjectChange, undoButton, initialDate, initialMeasurementFilter, navKey }: DailyReportProps) {
  const {
    selectedDate,
    setSelectedDate,
    measurementFilter,
    setMeasurementFilter,
    currentReport,
    persist,
    updateField,
  } = useDailyReportState({ project, onProjectChange, initialDate, initialMeasurementFilter, navKey });

  const reports = project.dailyReports || [];

  const { measurementPeriods, activePeriod, periodDates, dateMembership, periodSummary } =
    useDailyReportPeriods({ project, selectedDate, measurementFilter });

  // currentReport vem de useDailyReportState


  const production = useMemo(
    () => collectProductionForDate(project, selectedDate),
    [project, selectedDate]
  );

  // (sincronização de initialDate/initialMeasurementFilter agora vive no useEffect com navKey, acima)

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

  // periodSummary vem de useDailyReportPeriods

  // persist e updateField vêm de useDailyReportState


  // Equipes cadastradas no projeto (fallback para defaults se ainda não definidas)
  const projectTeams: TeamDefinition[] = useMemo(
    () => (project.teams && project.teams.length > 0) ? project.teams : DEFAULT_TEAMS,
    [project.teams],
  );
  const teamByCode = useMemo(
    () => new Map(projectTeams.map(t => [t.code, t])),
    [projectTeams],
  );
  /** Exibição amigável da equipe: composition → label → code. */
  const teamDisplay = (def?: TeamDefinition, fallback?: string): string => {
    if (def) return (def.composition?.trim() || def.label?.trim() || def.code);
    return fallback?.trim() || '—';
  };

  // Equipes sugeridas: códigos vindos das tarefas com produção no dia
  const suggestedTeamCodes = useMemo(() => {
    const set = new Set<string>();
    production.forEach(p => { if (p.teamCode) set.add(p.teamCode); });
    return Array.from(set);
  }, [production]);

  // Equipes
  const addTeamRow = (teamCode?: string) => persist(r => {
    const def = teamCode ? teamByCode.get(teamCode) : undefined;
    return {
      ...r,
      teamsPresent: [
        ...(r.teamsPresent || []),
        { id: uid('tm'), teamCode, name: def?.label || '', role: def?.composition || '', count: 1 },
      ],
    };
  });
  const updateTeamRow = (id: string, patch: Partial<DailyReportTeamRow>) => persist(r => ({
    ...r,
    teamsPresent: (r.teamsPresent || []).map(t => t.id === id ? { ...t, ...patch } : t),
  }));
  const removeTeamRow = (id: string) => persist(r => ({
    ...r,
    teamsPresent: (r.teamsPresent || []).filter(t => t.id !== id),
  }));

  /** Adiciona em lote as equipes sugeridas pelo apontamento, evitando duplicar códigos já presentes. */
  const addSuggestedTeams = () => persist(r => {
    const existingCodes = new Set((r.teamsPresent || []).map(t => t.teamCode).filter(Boolean) as string[]);
    const toAdd = suggestedTeamCodes.filter(c => !existingCodes.has(c));
    if (toAdd.length === 0) return r;
    const newRows: DailyReportTeamRow[] = toAdd.map(code => {
      const def = teamByCode.get(code);
      return { id: uid('tm'), teamCode: code, name: def?.label || code, role: def?.composition || '', count: 1 };
    });
    return { ...r, teamsPresent: [...(r.teamsPresent || []), ...newRows] };
  });

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

  // ───── Fotos / Anexos ─────
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingTaskId, setPendingTaskId] = useState<string>(GENERAL_TASK_VALUE);
  const [photoFilter, setPhotoFilter] = useState<string>('all'); // 'all' | taskId | GENERAL_TASK_VALUE
  const [uploadingCount, setUploadingCount] = useState(0);
  const [lightbox, setLightbox] = useState<DailyReportAttachment | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DailyReportAttachment | null>(null);

  const photos: DailyReportAttachment[] = useMemo(
    () => (currentReport.attachments || []).filter(a => (a.type ?? 'image') === 'image'),
    [currentReport.attachments],
  );

  const photosByTask = useMemo(() => {
    const m = new Map<string, number>();
    photos.forEach(p => {
      const key = p.taskId || GENERAL_TASK_VALUE;
      m.set(key, (m.get(key) || 0) + 1);
    });
    return m;
  }, [photos]);

  const visiblePhotos = useMemo(() => {
    if (photoFilter === 'all') return photos;
    return photos.filter(p => (p.taskId || GENERAL_TASK_VALUE) === photoFilter);
  }, [photos, photoFilter]);

  const photoTaskOptions = useMemo(() => {
    const seen = new Set<string>();
    const opts: { value: string; label: string; phaseChain: string; quantity: number; unit: string; taskName: string }[] = [];
    production.forEach(p => {
      if (seen.has(p.taskId)) return;
      seen.add(p.taskId);
      const chain = p.subChapterName
        ? `${p.chapterNumber} ${p.chapterName} > ${p.subChapterNumber} ${p.subChapterName}`
        : `${p.chapterNumber} ${p.chapterName}`;
      const numero = p.subChapterNumber ? `${p.subChapterNumber}` : `${p.chapterNumber}`;
      opts.push({
        value: p.taskId,
        label: `${numero} — ${p.taskName} — ${p.actualQuantity.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${p.unit}`,
        phaseChain: chain,
        quantity: p.actualQuantity,
        unit: p.unit,
        taskName: p.taskName,
      });
    });
    return opts;
  }, [production]);

  const uploadOne = useCallback(async (file: File): Promise<DailyReportAttachment> => {
    const id = uid('att');
    const safeExt = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `${project.id || 'local'}/${selectedDate}/${id}.${safeExt}`;
    const taskMeta = pendingTaskId !== GENERAL_TASK_VALUE
      ? photoTaskOptions.find(o => o.value === pendingTaskId)
      : undefined;
    const base: DailyReportAttachment = {
      id,
      type: 'image',
      fileName: file.name,
      mimeType: file.type || 'image/jpeg',
      caption: '',
      taskId: taskMeta?.value,
      taskName: taskMeta?.taskName,
      phaseChain: taskMeta?.phaseChain,
      quantity: taskMeta?.quantity,
      unit: taskMeta?.unit,
      uploadedBy: currentReport.responsible || undefined,
      uploadedAt: new Date().toISOString(),
    };
    try {
      const { error } = await supabase.storage
        .from(PHOTO_BUCKET)
        .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false });
      if (error) throw error;
      const { data: pub } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path);
      return { ...base, storagePath: path, publicUrl: pub.publicUrl };
    } catch (err) {
      const dataUrl = await readFileAsDataURL(file);
      return { ...base, dataUrl };
    }
  }, [project.id, selectedDate, pendingTaskId, photoTaskOptions, currentReport.responsible]);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files).filter(f => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic)$/i.test(f.name));
    if (arr.length === 0) return;
    setUploadingCount(c => c + arr.length);
    try {
      const uploaded: DailyReportAttachment[] = [];
      for (const f of arr) {
        try {
          const att = await uploadOne(f);
          uploaded.push(att);
        } catch (err) {
          console.error('Falha ao anexar foto', err);
        }
      }
      if (uploaded.length > 0) {
        persist(r => ({ ...r, attachments: [...(r.attachments || []), ...uploaded] }));
        toast({ title: `${uploaded.length} foto(s) anexada(s)`, description: 'A galeria do dia foi atualizada.' });
      }
    } finally {
      setUploadingCount(c => Math.max(0, c - arr.length));
    }
  }, [uploadOne, persist]);

  const updatePhoto = (id: string, patch: Partial<DailyReportAttachment>) => persist(r => ({
    ...r,
    attachments: (r.attachments || []).map(a => a.id === id ? { ...a, ...patch } : a),
  }));

  const removePhoto = useCallback(async (att: DailyReportAttachment) => {
    if (att.storagePath) {
      try { await supabase.storage.from(PHOTO_BUCKET).remove([att.storagePath]); } catch { /* ignore */ }
    }
    persist(r => ({ ...r, attachments: (r.attachments || []).filter(a => a.id !== att.id) }));
    toast({ title: 'Foto removida' });
  }, [persist]);

  /** Carrega URL como dataURL (necessário para embed no PDF). */
  const fetchAsDataURL = async (url: string): Promise<string | null> => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  };

  /**
   * Carrega a imagem respeitando orientação EXIF e devolve dataURL JPEG
   * com largura/altura naturais já corrigidas. Usa createImageBitmap quando
   * disponível (aplica EXIF) com fallback para <img> + canvas.
   */
  const loadOrientedImage = async (
    src: string,
    mimeType?: string,
  ): Promise<{ dataUrl: string; width: number; height: number } | null> => {
    try {
      let bitmapW = 0, bitmapH = 0;
      let canvas: HTMLCanvasElement;

      // Caminho preferido: createImageBitmap com correção EXIF
      if (typeof createImageBitmap === 'function') {
        const res = await fetch(src);
        const blob = await res.blob();
        const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' } as ImageBitmapOptions).catch(async () => {
          // Safari antigos: sem opção EXIF — usa fallback
          return await createImageBitmap(blob);
        });
        bitmapW = bmp.width; bitmapH = bmp.height;
        canvas = document.createElement('canvas');
        canvas.width = bitmapW; canvas.height = bitmapH;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bmp, 0, 0);
        bmp.close?.();
      } else {
        // Fallback: <img> (em navegadores modernos respeita EXIF ao desenhar)
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const i = new Image();
          i.crossOrigin = 'anonymous';
          i.onload = () => resolve(i);
          i.onerror = () => reject(new Error('img load fail'));
          i.src = src;
        });
        bitmapW = img.naturalWidth; bitmapH = img.naturalHeight;
        canvas = document.createElement('canvas');
        canvas.width = bitmapW; canvas.height = bitmapH;
        canvas.getContext('2d')!.drawImage(img, 0, 0);
      }

      // Reduz dimensão máxima para um PDF leve (longest side <= 1600px)
      const MAX = 1600;
      const longest = Math.max(bitmapW, bitmapH);
      if (longest > MAX) {
        const scale = MAX / longest;
        const dw = Math.round(bitmapW * scale);
        const dh = Math.round(bitmapH * scale);
        const c2 = document.createElement('canvas');
        c2.width = dw; c2.height = dh;
        c2.getContext('2d')!.drawImage(canvas, 0, 0, dw, dh);
        canvas = c2;
        bitmapW = dw; bitmapH = dh;
      }

      const isPng = (mimeType || '').includes('png');
      const dataUrl = canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.85);
      return { dataUrl, width: bitmapW, height: bitmapH };
    } catch {
      return null;
    }
  };


  // ───── PDF ─────
  /**
   * Gera o PDF do Diário de Obra.
   * - mode='day': apenas a data atualmente selecionada.
   * - mode='period': todos os dias do período da medição filtrada (ou da data atual, como fallback).
   */
  const generatePDF = useCallback(async (mode: 'day' | 'period') => {
    const { jsPDF, autoTable } = await loadPdfDeps();
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 12;
    const footerReserved = 14;

    // Define escopo (datas e título contextual)
    let dates: string[];
    let scopeTitle: string;
    let fileName: string;
    const safeName = project.name.replace(/[^a-z0-9]+/gi, '_');

    if (mode === 'period' && activePeriod && periodDates.length > 0) {
      dates = periodDates;
      const isDraft = activePeriod.id === 'draft';
      scopeTitle = isDraft
        ? 'DIÁRIO DE OBRA — MEDIÇÃO EM PREPARAÇÃO'
        : `DIÁRIO DE OBRA — ${activePeriod.label.toUpperCase()}`;
      fileName = isDraft
        ? `Diario_Obra_Medicao_Preparacao_${safeName}.pdf`
        : `Diario_Obra_${activePeriod.label.replace(/[^a-z0-9]+/gi, '_')}_${safeName}.pdf`;
    } else {
      dates = [selectedDate];
      scopeTitle = `DIÁRIO DE OBRA — ${formatBR(selectedDate)}`;
      fileName = `Diario_Obra_${safeName}_${selectedDate}.pdf`;
    }

    // Snapshot da medição (para cabeçalho)
    const ci = project.contractInfo || {};
    const periodoStr = mode === 'period' && activePeriod
      ? `${formatBR(activePeriod.startDate)} a ${formatBR(activePeriod.endDate)}`
      : formatBR(selectedDate);
    const issueStr = formatBR(todayISO());

    // Logo da empresa (canto superior esquerdo)
    const logo = await loadCompanyLogoForPdf();
    const logoTargetW = 28; // mm
    let logoH = 0;
    if (logo) {
      const ratio = logo.width / logo.height;
      logoH = logoTargetW / ratio;
      try { doc.addImage(logo.dataUrl, 'PNG', margin, margin, logoTargetW, logoH, undefined, 'FAST'); } catch {}
    }

    // ───── Cabeçalho ─────
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(scopeTitle, pageW / 2, margin + 4, { align: 'center' });

    let y = Math.max(margin + 7, margin + logoH + 1);
    const usable = pageW - margin * 2;

    const headerColWidths = [usable * 0.18, usable * 0.32, usable * 0.18, usable * 0.32];
    const headerRows: [string, string, string, string][] = [
      ['Obra:', project.name || '-', 'Período:', periodoStr],
      ['Contratante:', ci.contractor || '-', 'Contratada:', ci.contracted || '-'],
      ['Local/Município:', ci.location || '-', 'Nº Contrato:', ci.contractNumber || '-'],
      ['Objeto:', ci.contractObject || '-', 'Fonte de orçamento:', ci.budgetSource || '-'],
      ['Data emissão:', issueStr, 'BDI %:', ci.bdiPercent != null ? String(ci.bdiPercent) : '-'],
    ];
    autoTable(doc, {
      startY: y,
      body: headerRows,
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.4, overflow: 'linebreak', valign: 'middle', lineColor: [180, 180, 180], lineWidth: 0.15, textColor: 20 },
      columnStyles: {
        0: { cellWidth: headerColWidths[0], fontStyle: 'bold', fillColor: [243, 244, 246] },
        1: { cellWidth: headerColWidths[1] },
        2: { cellWidth: headerColWidths[2], fontStyle: 'bold', fillColor: [243, 244, 246] },
        3: { cellWidth: headerColWidths[3] },
      },
      margin: { left: margin, right: margin },
      tableWidth: usable,
    });
    y = ((doc as any).lastAutoTable?.finalY ?? y) + 3;

    // ───── Resumo geral do período ─────
    const periodSum = summarizeDailyReportsForPeriod(
      project,
      dates[0],
      dates[dates.length - 1],
    );

    // Totaliza equipes / ocorrências / impedimentos no período
    let totalTeams = 0;
    let totalOccurrences = 0;
    let totalImpediments = 0;
    const reportsByDate = new Map<string, DailyReportEntry>();
    (project.dailyReports || []).forEach(r => reportsByDate.set(r.date, r));
    dates.forEach(d => {
      const r = reportsByDate.get(d);
      if (!r) return;
      totalTeams += (r.teamsPresent || []).reduce((a, t) => a + (t.count || 0), 0);
      if (r.occurrences?.trim()) totalOccurrences++;
      if (r.impediments?.trim()) totalImpediments++;
    });

    const cards: [string, string][] = [
      ['Total de dias', String(periodSum.totalDays)],
      ['Diários preench.', String(periodSum.filledReports)],
      ['Diários pendentes', String(periodSum.missingReports)],
      ['Dias c/ produção', String(periodSum.productionDays)],
      ['Dias s/ produção', String(periodSum.noProductionDays)],
      ['Dias c/ impedim.', String(periodSum.impedimentDays)],
      ['Equipes (qtd)', String(totalTeams)],
      ['Ocorrências', String(totalOccurrences)],
    ];
    const cardH = 9;
    const perRow = 4;
    const cardW = usable / perRow;
    for (let i = 0; i < cards.length; i++) {
      const col = i % perRow;
      const row = Math.floor(i / perRow);
      const cx = margin + col * cardW;
      const cy = y + row * cardH;
      doc.setDrawColor(180); doc.setLineWidth(0.15);
      doc.setFillColor(249, 250, 251);
      doc.rect(cx, cy, cardW, cardH, 'FD');
      doc.setTextColor(110); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.6);
      doc.text(cards[i][0], cx + 2, cy + 3.4);
      doc.setTextColor(20); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
      doc.text(cards[i][1], cx + cardW - 2, cy + 6.6, { align: 'right' });
    }
    y += Math.ceil(cards.length / perRow) * cardH + 3;

    // ───── Pendências do Período ─────
    const pendingDates = periodSum.entries.filter(e => e.status === 'pending').map(e => e.date);
    const prodNoReport = periodSum.productionWithoutReportDates;
    const impedimentDates = periodSum.entries.filter(e => e.hasImpediment).map(e => e.date);
    const hasAnyPending = pendingDates.length || prodNoReport.length || impedimentDates.length;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(20);
    if (y + 12 > pageH - footerReserved) { doc.addPage(); y = margin; }
    doc.text('Pendências do Período', margin, y); y += 4;

    if (!hasAnyPending) {
      doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5); doc.setTextColor(90);
      doc.text('Não há pendências no período.', margin, y); y += 6;
    } else {
      const pendRows: [string, string][] = [];
      if (pendingDates.length) pendRows.push(['Sem diário', pendingDates.map(formatBR).join(', ')]);
      if (prodNoReport.length) pendRows.push(['Produção sem diário', prodNoReport.map(formatBR).join(', ')]);
      if (impedimentDates.length) pendRows.push(['Com impedimento', impedimentDates.map(formatBR).join(', ')]);
      autoTable(doc, {
        startY: y,
        body: pendRows,
        theme: 'grid',
        styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 1.3, overflow: 'linebreak', lineColor: [200, 200, 200], lineWidth: 0.12 },
        columnStyles: {
          0: { cellWidth: usable * 0.22, fontStyle: 'bold', fillColor: [254, 243, 199] },
          1: { cellWidth: usable * 0.78 },
        },
        margin: { left: margin, right: margin },
      });
      y = ((doc as any).lastAutoTable?.finalY ?? y) + 4;
    }

    // ───── Conteúdo de cada dia ─────
    const STATUS_LABEL: Record<string, string> = {
      filled: 'Preenchido',
      pending: 'Pendente',
      noProduction: 'Produção sem diário',
      impediment: 'Com impedimento',
    };

    const ensureSpace = (h: number) => {
      if (y + h > pageH - footerReserved) { doc.addPage(); y = margin; }
    };

    for (let idx = 0; idx < dates.length; idx++) {
      const dateISO = dates[idx];
      const entry = periodSum.entries.find(e => e.date === dateISO);
      const report = reportsByDate.get(dateISO);
      const dayProduction = collectProductionForDate(project, dateISO);

      // Quebra de página a cada novo dia (exceto o primeiro), para visual limpo.
      if (idx > 0) { doc.addPage(); y = margin; }
      else { ensureSpace(20); }

      // Cabeçalho do dia
      doc.setFillColor(31, 41, 55); // slate-800
      doc.setTextColor(255);
      doc.rect(margin, y, usable, 7, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
      doc.text(`Diário de Obra — ${formatBR(dateISO)}`, margin + 2, y + 4.8);
      const statusLabel = entry ? STATUS_LABEL[entry.status] : 'Pendente';
      doc.setFontSize(8);
      doc.text(`Status: ${statusLabel}`, margin + usable - 2, y + 4.8, { align: 'right' });
      doc.setTextColor(20);
      y += 9;

      // Aviso de pendência / produção sem diário
      const hasReport = !!report;
      const hasProd = dayProduction.length > 0;
      if (!hasReport) {
        doc.setFillColor(254, 243, 199);
        doc.setDrawColor(245, 158, 11); doc.setLineWidth(0.2);
        doc.rect(margin, y, usable, 6, 'FD');
        doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(120, 53, 15);
        const msg = hasProd
          ? 'Produção apontada, mas diário não preenchido.'
          : 'Diário pendente de preenchimento.';
        doc.text(msg, margin + 2, y + 4);
        doc.setTextColor(20);
        y += 8;
      }

      // Cabeçalho do dia (responsável / clima / condição)
      const weatherLabel = report?.weather === 'outro'
        ? `Outro: ${report?.weatherOther || ''}`
        : (WEATHER_OPTIONS.find(w => w.value === report?.weather)?.label || '—');
      const workLabel = report?.workCondition === 'outro'
        ? `Outro: ${report?.workConditionOther || ''}`
        : (WORK_OPTIONS.find(w => w.value === report?.workCondition)?.label || '—');

      autoTable(doc, {
        startY: y,
        body: [
          ['Responsável:', report?.responsible || '—', 'Clima:', weatherLabel],
          ['Condição:', workLabel, 'Apontamentos:', String(dayProduction.length)],
        ],
        theme: 'grid',
        styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.2, lineColor: [200, 200, 200], lineWidth: 0.12 },
        columnStyles: {
          0: { cellWidth: usable * 0.16, fontStyle: 'bold', fillColor: [243, 244, 246] },
          1: { cellWidth: usable * 0.34 },
          2: { cellWidth: usable * 0.16, fontStyle: 'bold', fillColor: [243, 244, 246] },
          3: { cellWidth: usable * 0.34 },
        },
        margin: { left: margin, right: margin },
      });
      y = ((doc as any).lastAutoTable?.finalY ?? y) + 2;

      // Equipe presente
      const teams = report?.teamsPresent || [];
      ensureSpace(10);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
      doc.text('Equipe presente', margin, y); y += 1.5;
      if (teams.length === 0) {
        autoTable(doc, {
          startY: y,
          body: [['—']],
          theme: 'grid',
          styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 1.2, textColor: 120, lineColor: [220, 220, 220], lineWidth: 0.12 },
          margin: { left: margin, right: margin },
        });
      } else {
        autoTable(doc, {
          startY: y,
          head: [['Equipe', 'Qtd.', 'Observação']],
          body: teams.map(t => {
            const label = teamDisplay(t.teamCode ? teamByCode.get(t.teamCode) : undefined, t.role || t.name);
            return [label, String(t.count ?? 1), t.notes || ''];
          }),
          theme: 'grid',
          headStyles: { fillColor: [55, 65, 81], textColor: 255, fontSize: 7.5 },
          styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 1.2, lineColor: [220, 220, 220], lineWidth: 0.12 },
          columnStyles: {
            0: { cellWidth: usable * 0.40 },
            1: { cellWidth: usable * 0.10, halign: 'center' },
            2: { cellWidth: usable * 0.50 },
          },
          margin: { left: margin, right: margin },
        });
      }
      y = ((doc as any).lastAutoTable?.finalY ?? y) + 2;

      // Equipamentos
      const equipments = report?.equipment || [];
      ensureSpace(10);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
      doc.text('Equipamentos', margin, y); y += 1.5;
      if (equipments.length === 0) {
        autoTable(doc, {
          startY: y,
          body: [['—']],
          theme: 'grid',
          styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 1.2, textColor: 120, lineColor: [220, 220, 220], lineWidth: 0.12 },
          margin: { left: margin, right: margin },
        });
      } else {
        autoTable(doc, {
          startY: y,
          head: [['Equipamento', 'Qtd.', 'Observação']],
          body: equipments.map(e => [e.name || '—', String(e.count ?? 1), e.notes || '']),
          theme: 'grid',
          headStyles: { fillColor: [55, 65, 81], textColor: 255, fontSize: 7.5 },
          styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 1.2, lineColor: [220, 220, 220], lineWidth: 0.12 },
          columnStyles: {
            0: { cellWidth: usable * 0.40 },
            1: { cellWidth: usable * 0.10, halign: 'center' },
            2: { cellWidth: usable * 0.50 },
          },
          margin: { left: margin, right: margin },
        });
      }
      y = ((doc as any).lastAutoTable?.finalY ?? y) + 2;

      // Produção executada
      ensureSpace(10);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
      doc.text('Produção executada', margin, y); y += 1.5;
      if (dayProduction.length === 0) {
        autoTable(doc, {
          startY: y,
          body: [['Nenhuma produção apontada nesta data.']],
          theme: 'grid',
          styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 1.2, textColor: 120, fontStyle: 'italic', lineColor: [220, 220, 220], lineWidth: 0.12 },
          margin: { left: margin, right: margin },
        });
      } else {
        autoTable(doc, {
          startY: y,
          head: [['Capítulo', 'Subcapítulo', 'Tarefa', 'Und.', 'Qtd. exec.', 'Observação']],
          body: dayProduction.map(p => [
            `${p.chapterNumber} ${p.chapterName}`,
            p.subChapterName ? `${p.subChapterNumber} ${p.subChapterName}` : '',
            p.taskName,
            p.unit || 'un',
            p.actualQuantity.toFixed(2),
            p.notes || '',
          ]),
          theme: 'grid',
          headStyles: { fillColor: [55, 65, 81], textColor: 255, fontSize: 7.3 },
          styles: { font: 'helvetica', fontSize: 7.3, cellPadding: 1.2, lineColor: [220, 220, 220], lineWidth: 0.12, overflow: 'linebreak' },
          columnStyles: {
            0: { cellWidth: usable * 0.18 },
            1: { cellWidth: usable * 0.18 },
            2: { cellWidth: usable * 0.28 },
            3: { cellWidth: usable * 0.07, halign: 'center' },
            4: { cellWidth: usable * 0.10, halign: 'right' },
            5: { cellWidth: usable * 0.19 },
          },
          margin: { left: margin, right: margin },
          // Repetir cabeçalho ao quebrar página
          showHead: 'everyPage',
        });
      }
      y = ((doc as any).lastAutoTable?.finalY ?? y) + 2;

      // Ocorrências / Impedimentos / Observações
      const longBlock = (title: string, value?: string) => {
        ensureSpace(14);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
        doc.text(title, margin, y); y += 1.5;
        autoTable(doc, {
          startY: y,
          body: [[value?.trim() ? value : '—']],
          theme: 'grid',
          styles: {
            font: 'helvetica', fontSize: 8, cellPadding: 1.6,
            textColor: value?.trim() ? 20 : 120,
            fontStyle: value?.trim() ? 'normal' : 'italic',
            lineColor: [220, 220, 220], lineWidth: 0.12, overflow: 'linebreak',
            minCellHeight: 8,
          },
          margin: { left: margin, right: margin },
        });
        y = ((doc as any).lastAutoTable?.finalY ?? y) + 2;
      };
      longBlock('Ocorrências', report?.occurrences);
      longBlock('Impedimentos', report?.impediments);
      longBlock('Observações', report?.observations);

      // ───── Fotos do dia ─────
      const dayPhotos = (report?.attachments || []).filter(a => (a.type ?? 'image') === 'image');
      if (dayPhotos.length > 0) {
        ensureSpace(14);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(20);
        doc.text(`Fotos da Obra (${dayPhotos.length})`, margin, y); y += 3;

        // Agrupar por tarefa mantendo numeração geral sequencial
        const byTask = new Map<string, { taskShort: string; phaseChain?: string; photos: DailyReportAttachment[] }>();
        const taskOrder: string[] = [];
        dayPhotos.forEach(p => {
          const k = p.taskId || GENERAL_TASK_VALUE;
          if (!byTask.has(k)) {
            taskOrder.push(k);
            byTask.set(k, {
              taskShort: k === GENERAL_TASK_VALUE ? 'Geral' : shortTaskName(p.taskName),
              phaseChain: p.phaseChain,
              photos: [],
            });
          }
          byTask.get(k)!.photos.push(p);
        });

        const cols = 2;
        const gap = 4;
        const cardW = (usable - gap * (cols - 1)) / cols;
        const imgBoxH = 55;       // altura máxima da imagem (mm)
        const headerH = 4.6;
        const captionMaxH = 6.8;  // ~2 linhas
        const metaH = 3.4;
        const cardPad = 2;
        const cardH = headerH + imgBoxH + captionMaxH + metaH + cardPad * 2 + 1;

        const totalPad = dayPhotos.length.toString().length;
        let photoIndex = 0;

        for (const k of taskOrder) {
          const group = byTask.get(k)!;
          // Cabeçalho discreto da atividade (curto)
          ensureSpace(6 + cardH);
          doc.setFont('helvetica', 'bold'); doc.setFontSize(7.6); doc.setTextColor(55, 65, 81);
          doc.text(`Atividade: ${group.taskShort}`, margin, y);
          y += 3.2;
          doc.setTextColor(20);

          for (let pIdx = 0; pIdx < group.photos.length; pIdx += cols) {
            ensureSpace(cardH + 2);
            const rowPhotos = group.photos.slice(pIdx, pIdx + cols);
            const rowTopY = y;

            for (let c = 0; c < rowPhotos.length; c++) {
              const ph = rowPhotos[c];
              photoIndex += 1;
              const x = margin + c * (cardW + gap);
              const cardTop = rowTopY;

              // Card border
              doc.setDrawColor(220); doc.setLineWidth(0.2);
              doc.rect(x, cardTop, cardW, cardH);

              // Header: "Foto NN — Nome curto"
              const num = String(photoIndex).padStart(Math.max(2, totalPad), '0');
              const shortName = group.taskShort;
              const titleRaw = `Foto ${num} — ${shortName}`;
              doc.setFont('helvetica', 'bold'); doc.setFontSize(7.4); doc.setTextColor(31, 41, 55);
              const titleLines = doc.splitTextToSize(titleRaw, cardW - cardPad * 2);
              doc.text(titleLines[0], x + cardPad, cardTop + cardPad + 2.6);

              // Image area
              const imgTop = cardTop + cardPad + headerH;
              const imgAreaW = cardW - cardPad * 2;
              const imgAreaH = imgBoxH;

              let drew = false;
              const srcUrl = ph.publicUrl || ph.dataUrl || null;
              if (srcUrl) {
                const oriented = await loadOrientedImage(srcUrl, ph.mimeType);
                if (oriented) {
                  // Encaixa preservando proporção (sem distorcer)
                  const ratio = oriented.width / oriented.height;
                  let drawW = imgAreaW;
                  let drawH = drawW / ratio;
                  if (drawH > imgAreaH) {
                    drawH = imgAreaH;
                    drawW = drawH * ratio;
                  }
                  const dx = x + cardPad + (imgAreaW - drawW) / 2;
                  const dy = imgTop + (imgAreaH - drawH) / 2;
                  try {
                    const fmt = oriented.dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';
                    doc.addImage(oriented.dataUrl, fmt, dx, dy, drawW, drawH, undefined, 'FAST');
                    drew = true;
                  } catch { /* fallback below */ }
                }
              }
              if (!drew) {
                doc.setDrawColor(230); doc.rect(x + cardPad, imgTop, imgAreaW, imgAreaH);
                doc.setFontSize(6.5); doc.setTextColor(150);
                doc.text('Imagem indisponível', x + cardPad + imgAreaW / 2, imgTop + imgAreaH / 2, { align: 'center' });
                doc.setTextColor(20);
              }

              // Observação
              const capTop = imgTop + imgAreaH + 2;
              doc.setFont('helvetica', 'normal'); doc.setFontSize(6.6); doc.setTextColor(60);
              const capRaw = ph.caption?.trim() ? `Observação: ${ph.caption.trim()}` : 'Observação: —';
              const capLines = doc.splitTextToSize(capRaw, imgAreaW).slice(0, 2);
              doc.text(capLines, x + cardPad, capTop + 1.6);

              // Meta: data, hora, atividade curta, qtd
              const metaTop = capTop + captionMaxH;
              doc.setFontSize(5.8); doc.setTextColor(130);
              const when = ph.uploadedAt ? new Date(ph.uploadedAt) : null;
              const dateStr = when ? when.toLocaleDateString('pt-BR') : '';
              const timeStr = when ? when.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
              const qtyStr = (ph.quantity != null && ph.unit) ? ` — ${ph.quantity} ${ph.unit}` : '';
              const metaParts = [
                [dateStr, timeStr].filter(Boolean).join(', '),
                shortName,
              ].filter(Boolean).join(' — ') + qtyStr;
              const metaLines = doc.splitTextToSize(metaParts, imgAreaW).slice(0, 1);
              doc.text(metaLines, x + cardPad, metaTop + 1.4);
              doc.setTextColor(20);
            }
            y = rowTopY + cardH + 2;
          }
          y += 1;
        }
      }
    }

    // ───── Rodapé fixo em todas as páginas ─────
    const total = doc.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      doc.setPage(i);
      const footerTop = pageH - margin - 10;
      doc.setDrawColor(180); doc.setLineWidth(0.2);
      doc.line(margin, footerTop, pageW - margin, footerTop);

      doc.setTextColor(80);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6.4);
      doc.text('K. C. BUENO DE GODOY OLIVEIRA LTDA', pageW / 2, footerTop + 2.8, { align: 'center' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(6);
      doc.text(
        'CNPJ: 39.973.085/0001-20  •  Rua Getúlio Vargas, 2533, São Cristóvão  •  Porto Velho/RO',
        pageW / 2, footerTop + 5.4, { align: 'center' }
      );

      doc.setFontSize(6); doc.setTextColor(120);
      const leftFoot = mode === 'period' && activePeriod
        ? `${scopeTitle} — ${project.name || ''}`
        : `Diário de Obra — ${project.name || ''}`;
      doc.text(leftFoot, margin, pageH - 1.5);
      doc.text(`Página ${i}/${total}`, pageW - margin, pageH - 1.5, { align: 'right' });
      doc.setTextColor(0);
    }

    doc.save(fileName);
  }, [project, activePeriod, periodDates, selectedDate, teamByCode]);

  const handlePrintDay = () => generatePDF('day');
  const handlePrintPeriod = () => generatePDF('period');

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
          <Button onClick={handlePrintDay} variant="outline" size="sm" title="Exporta apenas a data selecionada">
            <Printer className="w-4 h-4 mr-1.5" /> PDF do dia
          </Button>
          {activePeriod && (
            <Button onClick={handlePrintPeriod} variant="default" size="sm" title="Exporta todos os dias do período da medição">
              <Printer className="w-4 h-4 mr-1.5" /> PDF da medição
            </Button>
          )}
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

      {/* Diários por Medição (quando há período selecionado) */}
      {activePeriod && periodSummary && (
        <PeriodReportsSection
          period={activePeriod}
          summary={periodSummary}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
        />
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
          <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="w-4 h-4 text-info" /> Equipe presente
            </CardTitle>
            <div className="flex items-center gap-1">
              {suggestedTeamCodes.length > 0 && (
                <Button size="sm" variant="ghost" onClick={addSuggestedTeams} title="Adiciona as equipes vinculadas às tarefas com produção no dia">
                  <Activity className="w-3.5 h-3.5 mr-1" /> Sugerir do dia
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => addTeamRow()}>
                <Plus className="w-3.5 h-3.5 mr-1" /> Adicionar
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {(currentReport.teamsPresent || []).length === 0 && (
              <p className="text-xs text-muted-foreground italic">
                Nenhuma equipe lançada.
                {suggestedTeamCodes.length > 0 && (
                  <> Há {suggestedTeamCodes.length} equipe(s) com produção no dia — clique em <strong>Sugerir do dia</strong>.</>
                )}
              </p>
            )}
            {(currentReport.teamsPresent || []).map(t => (
              <div key={t.id} className="grid grid-cols-[minmax(0,1.6fr)_70px_minmax(0,1.4fr)_auto] gap-2 items-center">
                <Select
                  value={t.teamCode || ''}
                  onValueChange={(v) => {
                    const def = teamByCode.get(v);
                    updateTeamRow(t.id, { teamCode: v, name: def?.label || t.name, role: def?.composition || t.role });
                  }}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder={teamDisplay(undefined, t.role || t.name) === '—' ? 'Selecionar equipe...' : teamDisplay(t.teamCode ? teamByCode.get(t.teamCode) : undefined, t.role || t.name)} />
                  </SelectTrigger>
                  <SelectContent>
                    {projectTeams.map(team => (
                      <SelectItem key={team.code} value={team.code}>
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="inline-block w-2.5 h-2.5 rounded-sm border"
                            style={{ backgroundColor: team.barColor, borderColor: team.borderColor }}
                          />
                          <span>{teamDisplay(team)}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input type="number" min={0} placeholder="Qtd" value={t.count ?? ''}
                  onChange={e => {
                    const n = Number(e.target.value);
                    updateTeamRow(t.id, { count: Number.isFinite(n) && n >= 0 ? n : 0 });
                  }} />
                <Input placeholder="Observação" value={t.notes || ''}
                  onChange={e => updateTeamRow(t.id, { notes: e.target.value })} />
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

      {/* Fotos da Obra */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-sm flex items-center gap-2">
            <Camera className="w-4 h-4 text-primary" /> Fotos da Obra ({photos.length})
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1">
              <Label className="text-[11px] text-muted-foreground">Vincular à atividade:</Label>
              <Select value={pendingTaskId} onValueChange={setPendingTaskId}>
                <SelectTrigger className="h-8 text-xs w-[280px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={GENERAL_TASK_VALUE}>Foto geral do dia / Sem atividade específica</SelectItem>
                  {photoTaskOptions.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              capture="environment"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  handleFiles(e.target.files);
                  e.target.value = '';
                }
              }}
            />
            <Button size="sm" variant="default" onClick={() => fileInputRef.current?.click()} disabled={uploadingCount > 0}>
              {uploadingCount > 0 ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Plus className="w-3.5 h-3.5 mr-1" />}
              Anexar fotos
            </Button>
          </div>
        </CardHeader>
        <CardContent
          className="space-y-3"
          onDragOver={(e) => { e.preventDefault(); }}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
              handleFiles(e.dataTransfer.files);
            }
          }}
        >
          {/* Filtro por atividade */}
          {photos.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <Filter className="w-3.5 h-3.5 text-muted-foreground" />
              <Button size="sm" variant={photoFilter === 'all' ? 'default' : 'outline'} className="h-7 text-[11px]" onClick={() => setPhotoFilter('all')}>
                Todas ({photos.length})
              </Button>
              {photosByTask.has(GENERAL_TASK_VALUE) && (
                <Button size="sm" variant={photoFilter === GENERAL_TASK_VALUE ? 'default' : 'outline'} className="h-7 text-[11px]" onClick={() => setPhotoFilter(GENERAL_TASK_VALUE)}>
                  Geral ({photosByTask.get(GENERAL_TASK_VALUE)})
                </Button>
              )}
              {photoTaskOptions.filter(o => photosByTask.has(o.value)).map(o => (
                <Button key={o.value} size="sm" variant={photoFilter === o.value ? 'default' : 'outline'} className="h-7 text-[11px]" onClick={() => setPhotoFilter(o.value)}>
                  {o.taskName} ({photosByTask.get(o.value)})
                </Button>
              ))}
            </div>
          )}

          {visiblePhotos.length === 0 ? (
            <div className="border border-dashed border-border rounded-md py-8 text-center text-xs text-muted-foreground">
              <ImageIcon className="w-6 h-6 mx-auto mb-1 opacity-50" />
              {photos.length === 0
                ? 'Nenhuma foto anexada. Arraste imagens aqui ou clique em "Anexar fotos".'
                : 'Nenhuma foto neste filtro.'}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {visiblePhotos.map(p => {
                const src = p.publicUrl || p.dataUrl;
                return (
                  <div key={p.id} className="border border-border rounded-md overflow-hidden bg-card group">
                    <div className="relative aspect-[4/3] bg-muted cursor-pointer" onClick={() => setLightbox(p)}>
                      {src ? (
                        <img src={src} alt={p.caption || p.fileName || 'foto'} className="w-full h-full object-cover" loading="lazy" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">Sem preview</div>
                      )}
                      <button
                        type="button"
                        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-destructive/90 text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                        onClick={(e) => { e.stopPropagation(); setConfirmDelete(p); }}
                        title="Remover foto"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="p-2 space-y-1.5">
                      <Input
                        className="h-7 text-[11px]"
                        placeholder="Legenda"
                        value={p.caption || ''}
                        onChange={(e) => updatePhoto(p.id, { caption: e.target.value })}
                      />
                      <Select
                        value={p.taskId || GENERAL_TASK_VALUE}
                        onValueChange={(v) => {
                          if (v === GENERAL_TASK_VALUE) {
                            updatePhoto(p.id, { taskId: undefined, taskName: undefined, phaseChain: undefined, quantity: undefined, unit: undefined });
                          } else {
                            const meta = photoTaskOptions.find(o => o.value === v);
                            updatePhoto(p.id, { taskId: v, taskName: meta?.taskName, phaseChain: meta?.phaseChain, quantity: meta?.quantity, unit: meta?.unit });
                          }
                        }}
                      >
                        <SelectTrigger className="h-7 text-[11px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={GENERAL_TASK_VALUE}>Geral / Sem atividade</SelectItem>
                          {photoTaskOptions.map(o => (
                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {p.uploadedAt && (
                        <div className="text-[10px] text-muted-foreground truncate">
                          {new Date(p.uploadedAt).toLocaleString('pt-BR')}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

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
                    <ProductionTable entries={ch.direct} photosByTask={photosByTask} onShowPhotos={(taskId) => setPhotoFilter(taskId)} />
                  )}
                  {Array.from(ch.subs.values()).map(sub => (
                    <div key={sub.number + sub.name} className="ml-4 space-y-1">
                      <div className="text-xs font-medium text-muted-foreground">
                        {sub.number} — {sub.name}
                      </div>
                      <ProductionTable entries={sub.entries} photosByTask={photosByTask} onShowPhotos={(taskId) => setPhotoFilter(taskId)} />
                    </div>
                  ))}
                  <Separator />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Lightbox */}
      <Dialog open={!!lightbox} onOpenChange={(o) => !o && setLightbox(null)}>
        <DialogContent className="max-w-4xl p-2">
          {lightbox && (
            <div className="space-y-2">
              <img
                src={lightbox.publicUrl || lightbox.dataUrl}
                alt={lightbox.caption || lightbox.fileName || 'foto'}
                className="w-full max-h-[75vh] object-contain rounded bg-black"
              />
              <div className="px-2 pb-1 text-xs space-y-0.5">
                {lightbox.caption && <div className="font-medium">{lightbox.caption}</div>}
                {lightbox.taskName && <div className="text-muted-foreground">{lightbox.taskName}{lightbox.phaseChain ? ` — ${lightbox.phaseChain}` : ''}</div>}
                {lightbox.uploadedAt && <div className="text-muted-foreground">{new Date(lightbox.uploadedAt).toLocaleString('pt-BR')}</div>}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirmação de remoção */}
      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover foto?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação remove a foto do diário. O apontamento de produção e a tarefa não são afetados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDelete) removePhoto(confirmDelete);
                setConfirmDelete(null);
              }}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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

function ProductionTable({
  entries,
  photosByTask,
  onShowPhotos,
}: {
  entries: ProductionEntry[];
  photosByTask?: Map<string, number>;
  onShowPhotos?: (taskId: string) => void;
}) {
  return (
    <div className="border border-border rounded-md overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-muted/40 text-muted-foreground">
          <tr>
            <th className="text-left px-2 py-1.5 font-medium">Tarefa</th>
            <th className="text-center px-2 py-1.5 font-medium w-20">Unid.</th>
            <th className="text-right px-2 py-1.5 font-medium w-28">Qtd. executada</th>
            <th className="text-left px-2 py-1.5 font-medium">Observação</th>
            <th className="text-center px-2 py-1.5 font-medium w-20">Fotos</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(e => {
            const count = photosByTask?.get(e.taskId) || 0;
            return (
              <tr key={e.taskId + (e.notes || '')} className="border-t border-border">
                <td className="px-2 py-1.5">{e.taskName}</td>
                <td className="px-2 py-1.5 text-center text-muted-foreground">{e.unit}</td>
                <td className="px-2 py-1.5 text-right font-semibold">{e.actualQuantity.toFixed(2)}</td>
                <td className="px-2 py-1.5 text-muted-foreground">{e.notes || '—'}</td>
                <td className="px-2 py-1.5 text-center">
                  {count > 0 ? (
                    <button
                      type="button"
                      onClick={() => onShowPhotos?.(e.taskId)}
                      className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                      title="Ver fotos vinculadas"
                    >
                      <Camera className="w-3 h-3" /> {count}
                    </button>
                  ) : (
                    <span className="text-muted-foreground text-[11px]">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ───── Seção: Diários por Medição ─────

interface PeriodReportsSectionProps {
  period: { id: string; label: string; startDate: string; endDate: string };
  summary: ReturnType<typeof summarizeDailyReportsForPeriod>;
  selectedDate: string;
  onSelectDate: (date: string) => void;
}

function PeriodReportsSection({ period, summary, selectedDate, onSelectDate }: PeriodReportsSectionProps) {
  return (
    <Card className="border border-border">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-primary" /> Diários por Medição — {period.label}
        </CardTitle>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {formatBR(period.startDate)} a {formatBR(period.endDate)}
        </span>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
          <PeriodStat label="Dias no período" value={summary.totalDays} />
          <PeriodStat label="Diários preenchidos" value={summary.filledReports} tone="success" />
          <PeriodStat label="Diários pendentes" value={summary.missingReports} tone={summary.missingReports > 0 ? 'warning' : 'default'} />
          <PeriodStat label="Dias com produção" value={summary.productionDays} tone="info" />
          <PeriodStat label="Dias sem produção" value={summary.noProductionDays} />
          <PeriodStat label="Dias com impedimento" value={summary.impedimentDays} tone={summary.impedimentDays > 0 ? 'destructive' : 'default'} />
        </div>

        <div className="border border-border rounded-md overflow-hidden">
          <div className="max-h-[320px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground sticky top-0">
                <tr>
                  <th className="text-left px-2 py-1.5 font-medium w-24">Data</th>
                  <th className="text-left px-2 py-1.5 font-medium w-36">Status</th>
                  <th className="text-left px-2 py-1.5 font-medium">Responsável</th>
                  <th className="text-left px-2 py-1.5 font-medium w-28">Clima</th>
                  <th className="text-right px-2 py-1.5 font-medium w-28">Produção</th>
                  <th className="text-right px-2 py-1.5 font-medium w-32">Ação</th>
                </tr>
              </thead>
              <tbody>
                {summary.entries.map(e => {
                  const meta = STATUS_META[e.status];
                  const Icon = meta.icon;
                  const isCurrent = e.date === selectedDate;
                  return (
                    <tr
                      key={e.date}
                      className={`border-t border-border ${meta.row} ${isCurrent ? 'ring-1 ring-primary/40' : ''}`}
                    >
                      <td className="px-2 py-1.5 tabular-nums">{formatBR(e.date)}</td>
                      <td className="px-2 py-1.5">
                        <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${meta.pill}`}>
                          <Icon className="w-3 h-3" /> {meta.label}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 truncate max-w-[200px]">
                        {e.responsible || <span className="text-muted-foreground italic">—</span>}
                      </td>
                      <td className="px-2 py-1.5">
                        {e.weather ? (WEATHER_LABEL_MAP[e.weather] || e.weather) : <span className="text-muted-foreground italic">—</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {e.totalProduction > 0 ? (
                          <span className="inline-flex items-center gap-1 text-foreground">
                            <Activity className="w-3 h-3 text-info" />
                            {e.totalProduction.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <Button
                          size="sm"
                          variant={isCurrent ? 'default' : 'ghost'}
                          className="h-6 px-2 text-[11px]"
                          onClick={() => onSelectDate(e.date)}
                        >
                          Abrir/Editar <ArrowRight className="w-3 h-3 ml-1" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PeriodStat({
  label, value, tone = 'default',
}: { label: string; value: number; tone?: 'default' | 'success' | 'warning' | 'info' | 'destructive' }) {
  const toneCls =
    tone === 'success' ? 'text-success' :
    tone === 'warning' ? 'text-warning' :
    tone === 'info' ? 'text-info' :
    tone === 'destructive' ? 'text-destructive' :
    'text-foreground';
  return (
    <div className="bg-muted/30 border border-border rounded p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">{label}</div>
      <div className={`text-base font-bold tabular-nums leading-tight ${toneCls}`}>{value}</div>
    </div>
  );
}

