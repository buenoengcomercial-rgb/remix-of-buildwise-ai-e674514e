import { CalendarDays, Users, Wrench, Plus, Trash2, FolderTree, ListChecks, AlertOctagon, Activity, ArrowRight, Camera, Image as ImageIcon, Loader2, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

import { summarizeDailyReportsForPeriod } from '@/lib/dailyReportSummary';

import {
  GENERAL_TASK_VALUE,
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

