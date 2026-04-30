import { useMemo } from 'react';
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
import type { Row, GroupTotals, GroupNode } from '@/components/measurement/types';
import { STATUS_LABEL, STATUS_CLASS } from '@/components/measurement/types';
import {
  fmtBRL,
  fmtNum,
  fmtPct,
  fmtDateBR,
} from '@/components/measurement/measurementFormat';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertCircle,
  ChevronRight,
  ChevronDown,
  Lock,
  Pencil,
  Check,
  X,
} from 'lucide-react';
import MeasurementHeader from '@/components/measurement/MeasurementHeader';
import MeasurementStatusBar from '@/components/measurement/MeasurementStatusBar';
import MeasurementContractInfo from '@/components/measurement/MeasurementContractInfo';
import MeasurementFilters from '@/components/measurement/MeasurementFilters';
import MeasurementSummaryCards from '@/components/measurement/MeasurementSummaryCards';
import MeasurementTotals from '@/components/measurement/MeasurementTotals';
import { useAuth } from '@/hooks/useAuth';
import { logToProject, userInfoFromSupabaseUser } from '@/lib/audit';
import AuditHistoryPanel from '@/components/AuditHistoryPanel';
import { useMeasurementExports } from '@/hooks/useMeasurementExports';
import { useMeasurementState } from '@/hooks/useMeasurementState';
import { useMeasurementActions } from '@/hooks/useMeasurementActions';
import { useMeasurementRows } from '@/hooks/useMeasurementRows';
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
import { summarizeDailyReportsForPeriod, buildDailyReportSnapshot } from '@/lib/dailyReportSummary';
import { loadCompanyLogoForPdf } from '@/lib/companyBranding';

interface MeasurementProps {
  project: Project;
  onProjectChange: (project: Project) => void;
  undoButton?: React.ReactNode;
  /** Navega até a aba Diário de Obra abrindo a data informada e, opcionalmente, aplicando o filtro de medição. */
  onOpenDailyReport?: (dateISO: string, measurementFilter?: string) => void;
}

// ───────────────────────── Componente principal ─────────────────────────
export default function Measurement({ project, onProjectChange, undoButton, onOpenDailyReport }: MeasurementProps) {
  const { user } = useAuth();
  const auditUser = useMemo(() => userInfoFromSupabaseUser(user), [user]);

  const measurementState = useMeasurementState({ project, onProjectChange });
  const {
    projectRef,
    measurements,
    contract,
    today,
    monthAgo,
    defaultNextNumber,
    issueDate,
    activeId, setActiveId,
    historyOpen, setHistoryOpen,
    startDate, setStartDate,
    endDate, setEndDate,
    chapterFilter, setChapterFilter,
    search, setSearch,
    collapsed, setCollapsed,
    contractor, setContractor,
    contracted, setContracted,
    contractNumber, setContractNumber,
    contractObject, setContractObject,
    location, setLocation,
    budgetSource, setBudgetSource,
    bdiInput, setBdiInput,
    measurementNumber, setMeasurementNumber,
    confirmGenerate, setConfirmGenerate,
    confirmEdit, setConfirmEdit,
    confirmDelete, setConfirmDelete,
    editReason, setEditReason,
    editingPriceTaskId, setEditingPriceTaskId,
    editingPriceValue, setEditingPriceValue,
  } = measurementState;

  const parsedBdi = Number.isFinite(parseFloat(bdiInput)) ? Math.max(0, parseFloat(bdiInput)) : 0;
  // Sintética importada tem prioridade sobre o BDI do contrato.
  const bdiPercent = (project.syntheticBdiPercent !== undefined && Number.isFinite(project.syntheticBdiPercent))
    ? Math.max(0, project.syntheticBdiPercent)
    : parsedBdi;
  const bdiFactor = 1 + bdiPercent / 100;

  // ───────── Linhas, filtros, agrupamento e totais (extraído para useMeasurementRows) ─────────
  const {
    syntheticBudgetItems,
    hasSyntheticBudget,
    numbering,
    orderedTasks,
    activeMeasurement,
    isLocked,
    isSnapshotMode,
    effStart,
    effEnd,
    effBdi,
    effBdiFactor,
    effIssue,
    effNumber,
    priorAccumByTask,
    rows,
    filteredRows,
    groupTree,
    totals,
  } = useMeasurementRows({
    project,
    measurements,
    activeId,
    startDate,
    endDate,
    chapterFilter,
    search,
    issueDate,
    bdiPercent,
    measurementNumber,
  });

  // ───────── Diários de Obra do período ─────────
  const dailyReportsSummary = useMemo(
    () => summarizeDailyReportsForPeriod(project, effStart, effEnd),
    [project, effStart, effEnd],
  );

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
      dailyReports: {
        missingReports: dailyReportsSummary.missingReports,
        productionWithoutReportDays: dailyReportsSummary.productionWithoutReportDates.length,
        impedimentDays: dailyReportsSummary.impedimentDays,
      },
    });
  }, [activeMeasurement, startDate, endDate, measurementNumber, rows, measurements, contractor, contracted, contractNumber, contractObject, location, budgetSource, bdiPercent, dailyReportsSummary]);
  const validationSummary = useMemo(() => summarizeIssues(validationIssues), [validationIssues]);

  /** Tem avisos não-bloqueantes específicos de diário/impedimento que requerem confirmação extra. */
  const hasDailyWarnings =
    !activeMeasurement && (
      dailyReportsSummary.missingReports > 0 ||
      dailyReportsSummary.productionWithoutReportDates.length > 0 ||
      dailyReportsSummary.impedimentDays > 0
    );

  // ───────── Ações (extraídas para useMeasurementActions) ─────────
  const {
    persistContractInfo,
    updateTaskField,
    updateUnitPriceNoBDI,
    setManualPeriodQuantity,
    patchSnapshotItem,
    generateMeasurement,
    unlockForEdit,
    setStatus,
    deleteMeasurement,
    newMeasurementDraft,
  } = useMeasurementActions({
    project,
    projectRef,
    onProjectChange,
    auditUser,
    activeMeasurement,
    isLocked,
    isSnapshotMode,
    setActiveId,
    rows,
    measurements,
    dailyReportsSummary,
    validationSummary,
    effStart,
    effEnd,
    effBdi,
    effBdiFactor,
    startDate,
    endDate,
    today,
    monthAgo,
    bdiPercent,
    bdiFactor,
    contractor,
    contracted,
    contractNumber,
    contractObject,
    location,
    budgetSource,
    measurementNumber,
    editReason,
    setStartDate,
    setEndDate,
    setChapterFilter,
    setSearch,
    setMeasurementNumber,
    setConfirmGenerate,
    setConfirmEdit,
    setConfirmDelete,
    setEditReason,
  });

  // ───────── Collapse helpers ─────────
  const toggleCollapsed = (id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ───────── EXPORT XLSX / PDF (extraído para useMeasurementExports) ─────────
  const { exportXLSX, exportPDF, handlePrint } = useMeasurementExports({
    project,
    projectRef,
    onProjectChange,
    activeMeasurement,
    groupTree,
    totals,
    headerForm: {
      contractor, contracted, contractNumber, contractObject, location, budgetSource, bdiPercent,
    },
    effStart,
    effEnd,
    effIssue,
    effBdi,
    effNumber,
    dailyReportsSummary,
    auditUser,
  });

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
      <MeasurementHeader
        undoButton={undoButton}
        onExportXLSX={exportXLSX}
        onPrint={handlePrint}
        showHistory={!!activeMeasurement}
        onOpenHistory={() => setHistoryOpen(true)}
      />

      {/* Seletor de medições salvas + status */}
      <MeasurementStatusBar
        measurements={measurements}
        activeId={activeId}
        setActiveId={setActiveId}
        activeMeasurement={activeMeasurement}
        isLocked={isLocked}
        newMeasurementDraft={newMeasurementDraft}
        onConfirmGenerate={() => setConfirmGenerate(true)}
        onConfirmEdit={() => setConfirmEdit(true)}
        onConfirmDelete={() => setConfirmDelete(true)}
        setStatus={setStatus}
        validationHasBlocking={validationSummary.hasBlocking}
      />

      {/* Painel de validação (somente em modo "live") */}
      {!activeMeasurement && (
        <div className="print:hidden">
          <MeasurementValidationPanel
            issues={validationIssues}
            onOpenDailyReport={
              onOpenDailyReport
                ? () => onOpenDailyReport(effStart, 'draft')
                : undefined
            }
          />
        </div>
      )}

      {/* Cabeçalho técnico do boletim */}
      <MeasurementContractInfo
        project={project}
        isSnapshotMode={isSnapshotMode}
        effStart={effStart}
        effEnd={effEnd}
        effIssue={effIssue}
        effBdi={effBdi}
        effNumber={effNumber}
        contractor={contractor} setContractor={setContractor}
        contracted={contracted} setContracted={setContracted}
        contractNumber={contractNumber} setContractNumber={setContractNumber}
        contractObject={contractObject} setContractObject={setContractObject}
        location={location} setLocation={setLocation}
        budgetSource={budgetSource} setBudgetSource={setBudgetSource}
        bdiInput={bdiInput} setBdiInput={setBdiInput}
        bdiPercent={bdiPercent}
        measurementNumber={measurementNumber} setMeasurementNumber={setMeasurementNumber}
        persistContractInfo={persistContractInfo}
      />

      {/* Filtros (live e snapshot) */}
      <MeasurementFilters
        project={project}
        isSnapshotMode={isSnapshotMode}
        effStart={effStart}
        effEnd={effEnd}
        setStartDate={setStartDate}
        setEndDate={setEndDate}
        chapterFilter={chapterFilter}
        setChapterFilter={setChapterFilter}
        search={search}
        setSearch={setSearch}
        numbering={numbering}
      />

      {/* Resumo técnico */}
      <MeasurementSummaryCards totals={totals} />

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
      <MeasurementTotals totals={totals} effBdi={effBdi} />

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
      {activeMeasurement && (
        <AuditHistoryPanel
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          project={project}
          entityType="measurement"
          entityId={activeMeasurement.id}
          title={`Medição nº ${activeMeasurement.number}`}
        />
      )}
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
