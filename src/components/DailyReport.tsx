import { CalendarDays, Plus, Trash2, FolderTree, ListChecks, AlertOctagon, Activity, ArrowRight, Camera } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

import { summarizeDailyReportsForPeriod } from '@/lib/dailyReportSummary';

import {
  WEATHER_LABEL_MAP,
  STATUS_META,
  formatBR,
} from '@/components/dailyReport/dailyReportFormat';
import type { ProductionEntry, DailyReportProps } from '@/components/dailyReport/types';
import { useDailyReportState } from '@/hooks/useDailyReportState';
import { useDailyReportPeriods } from '@/hooks/useDailyReportPeriods';
import { useDailyReportProduction } from '@/hooks/useDailyReportProduction';
import { useDailyReportTeams } from '@/hooks/useDailyReportTeams';
import { useDailyReportEquipment } from '@/hooks/useDailyReportEquipment';
import { useDailyReportPhotos } from '@/hooks/useDailyReportPhotos';
import { useDailyReportPdf } from '@/hooks/useDailyReportPdf';
import { DailyReportHeader } from '@/components/dailyReport/DailyReportHeader';
import { DailyReportMeasurementBanner } from '@/components/dailyReport/DailyReportMeasurementBanner';
import { DailyReportSummaryCards } from '@/components/dailyReport/DailyReportSummaryCards';
import { DailyReportGeneralInfo } from '@/components/dailyReport/DailyReportGeneralInfo';
import { DailyReportTextAreas } from '@/components/dailyReport/DailyReportTextAreas';
import { DailyReportTeamsCard } from '@/components/dailyReport/DailyReportTeamsCard';
import { DailyReportEquipmentCard } from '@/components/dailyReport/DailyReportEquipmentCard';
import { DailyReportPhotosCard } from '@/components/dailyReport/DailyReportPhotosCard';
import { DailyReportPhotoLightbox } from '@/components/dailyReport/DailyReportPhotoLightbox';
import { DailyReportPhotoDeleteDialog } from '@/components/dailyReport/DailyReportPhotoDeleteDialog';


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

  const { production, grouped, summary } = useDailyReportProduction({
    project,
    selectedDate,
    currentReport,
  });

  // periodSummary vem de useDailyReportPeriods

  // persist e updateField vêm de useDailyReportState


  const {
    projectTeams,
    teamByCode,
    teamDisplay,
    suggestedTeamCodes,
    addTeamRow,
    updateTeamRow,
    removeTeamRow,
    addSuggestedTeams,
  } = useDailyReportTeams({ project, production, persist });

  const { addEqRow, updateEqRow, removeEqRow } = useDailyReportEquipment({ persist });

  // ───── Fotos / Anexos ─────
  const {
    pendingTaskId,
    setPendingTaskId,
    photoFilter,
    setPhotoFilter,
    uploadingCount,
    lightbox,
    setLightbox,
    confirmDelete,
    setConfirmDelete,
    fileInputRef,
    photos,
    photosByTask,
    visiblePhotos,
    photoTaskOptions,
    handleFiles,
    updatePhoto,
    removePhoto,
  } = useDailyReportPhotos({ project, currentReport, persist, production, selectedDate });
  const { handlePrintDay, handlePrintPeriod } = useDailyReportPdf({
    project,
    selectedDate,
    currentReport,
    activePeriod,
    periodDates,
    periodSummary,
    production,
    grouped,
    summary,
    photos,
    photosByTask,
    teamByCode,
    teamDisplay,
    dateMembership,
    measurementFilter,
  });

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-[1400px] mx-auto">
      {/* Header */}
      <DailyReportHeader
        undoButton={undoButton}
        measurementFilter={measurementFilter}
        setMeasurementFilter={setMeasurementFilter}
        measurementPeriods={measurementPeriods}
        activePeriod={activePeriod}
        periodDates={periodDates}
        selectedDate={selectedDate}
        setSelectedDate={setSelectedDate}
        handlePrintDay={handlePrintDay}
        handlePrintPeriod={handlePrintPeriod}
      />

      {/* Vínculo com Medição */}
      <DailyReportMeasurementBanner dateMembership={dateMembership} />

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
      <DailyReportSummaryCards summary={summary} />

      {/* Informações gerais */}
      <DailyReportGeneralInfo currentReport={currentReport} updateField={updateField} />

      {/* Equipes / Equipamentos lado a lado */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DailyReportTeamsCard
          currentReport={currentReport}
          projectTeams={projectTeams}
          teamByCode={teamByCode}
          teamDisplay={teamDisplay}
          suggestedTeamCodes={suggestedTeamCodes}
          addTeamRow={addTeamRow}
          updateTeamRow={updateTeamRow}
          removeTeamRow={removeTeamRow}
          addSuggestedTeams={addSuggestedTeams}
        />
        <DailyReportEquipmentCard
          currentReport={currentReport}
          addEqRow={addEqRow}
          updateEqRow={updateEqRow}
          removeEqRow={removeEqRow}
        />
      </div>

      {/* Textos longos */}
      <DailyReportTextAreas currentReport={currentReport} updateField={updateField} />

      {/* Fotos da Obra */}
      <DailyReportPhotosCard
        photos={photos}
        visiblePhotos={visiblePhotos}
        photosByTask={photosByTask}
        photoTaskOptions={photoTaskOptions}
        pendingTaskId={pendingTaskId}
        setPendingTaskId={setPendingTaskId}
        photoFilter={photoFilter}
        setPhotoFilter={setPhotoFilter}
        uploadingCount={uploadingCount}
        fileInputRef={fileInputRef}
        handleFiles={handleFiles}
        updatePhoto={updatePhoto}
        setLightbox={setLightbox}
        setConfirmDelete={setConfirmDelete}
      />

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
      <DailyReportPhotoLightbox lightbox={lightbox} setLightbox={setLightbox} />

      {/* Confirmação de remoção */}
      <DailyReportPhotoDeleteDialog
        confirmDelete={confirmDelete}
        setConfirmDelete={setConfirmDelete}
        removePhoto={removePhoto}
      />
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

