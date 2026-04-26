import { CalendarDays, CheckCircle2, AlertOctagon, Clock4, Activity, FileText, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { DailyReportPeriodSummary, DailyEntryStatus } from '@/lib/dailyReportSummary';

interface Props {
  summary: DailyReportPeriodSummary;
  onOpenDiary?: (date: string) => void;
}

const STATUS_META: Record<DailyEntryStatus, { label: string; cls: string; icon: React.ElementType }> = {
  filled:        { label: 'Preenchido',          cls: 'text-success border-success/40 bg-success/10',           icon: CheckCircle2 },
  pending:       { label: 'Pendente',            cls: 'text-warning border-warning/40 bg-warning/10',           icon: Clock4 },
  noProduction:  { label: 'Sem diário',          cls: 'text-info border-info/40 bg-info/10',                    icon: FileText },
  impediment:    { label: 'Com impedimento',     cls: 'text-destructive border-destructive/40 bg-destructive/10', icon: AlertOctagon },
};

const fmtDateBR = (iso: string) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

const WEATHER_LABEL: Record<string, string> = {
  ensolarado: 'Ensolarado',
  parcialmente_nublado: 'Parc. nublado',
  nublado: 'Nublado',
  chuvoso: 'Chuvoso',
  outro: 'Outro',
};

export default function MeasurementDailyReportsPanel({ summary, onOpenDiary }: Props) {
  return (
    <Card className="border border-border print:hidden">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-primary" /> Diários de Obra do Período
        </CardTitle>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {fmtDateBR(summary.startDate)} a {fmtDateBR(summary.endDate)}
        </span>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
          <Stat label="Dias no período" value={summary.totalDays} />
          <Stat label="Diários preenchidos" value={summary.filledReports} tone="success" />
          <Stat label="Diários pendentes" value={summary.missingReports} tone={summary.missingReports > 0 ? 'warning' : 'default'} />
          <Stat label="Dias com produção" value={summary.productionDays} tone="info" />
          <Stat label="Dias sem produção" value={summary.noProductionDays} />
          <Stat label="Dias com impedimento" value={summary.impedimentDays} tone={summary.impedimentDays > 0 ? 'destructive' : 'default'} />
        </div>

        {summary.entries.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">Defina o período da medição para listar os diários.</p>
        ) : (
          <div className="border border-border rounded-md overflow-hidden">
            <div className="max-h-[260px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-muted-foreground sticky top-0">
                  <tr>
                    <th className="text-left px-2 py-1.5 font-medium w-24">Data</th>
                    <th className="text-left px-2 py-1.5 font-medium w-36">Status</th>
                    <th className="text-left px-2 py-1.5 font-medium">Responsável</th>
                    <th className="text-left px-2 py-1.5 font-medium w-28">Clima</th>
                    <th className="text-right px-2 py-1.5 font-medium w-28">Produção</th>
                    <th className="text-right px-2 py-1.5 font-medium w-28">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.entries.map(e => {
                    const meta = STATUS_META[e.status];
                    const Icon = meta.icon;
                    return (
                      <tr key={e.date} className="border-t border-border hover:bg-muted/20">
                        <td className="px-2 py-1.5 tabular-nums">{fmtDateBR(e.date)}</td>
                        <td className="px-2 py-1.5">
                          <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${meta.cls}`}>
                            <Icon className="w-3 h-3" /> {meta.label}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 truncate max-w-[200px]">{e.responsible || <span className="text-muted-foreground italic">—</span>}</td>
                        <td className="px-2 py-1.5">{e.weather ? (WEATHER_LABEL[e.weather] || e.weather) : <span className="text-muted-foreground italic">—</span>}</td>
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
                            variant="ghost"
                            className="h-6 px-2 text-[11px]"
                            onClick={() => onOpenDiary?.(e.date)}
                          >
                            Abrir Diário <ArrowRight className="w-3 h-3 ml-1" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({
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
