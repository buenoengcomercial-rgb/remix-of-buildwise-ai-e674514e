import { AlertCircle, AlertTriangle, Info, CheckCircle2, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ValidationIssue } from '@/lib/measurementValidation';

interface Props {
  issues: ValidationIssue[];
  /** Callback opcional para abrir o Diário de Obra com o filtro da medição em preparação. */
  onOpenDailyReport?: () => void;
}

const LEVEL_META = {
  error: {
    icon: AlertCircle,
    label: 'Erro',
    cls: 'text-destructive',
    bg: 'bg-destructive/10 border-destructive/30',
  },
  warning: {
    icon: AlertTriangle,
    label: 'Aviso',
    cls: 'text-warning',
    bg: 'bg-warning/10 border-warning/30',
  },
  info: {
    icon: Info,
    label: 'Info',
    cls: 'text-primary',
    bg: 'bg-primary/10 border-primary/30',
  },
} as const;

const DAILY_CODES = new Set([
  'daily-reports-pending',
  'production-without-report',
  'impediments-in-period',
]);

export default function MeasurementValidationPanel({ issues, onOpenDailyReport }: Props) {
  const errors = issues.filter(i => i.level === 'error');
  const warnings = issues.filter(i => i.level === 'warning');
  const infos = issues.filter(i => i.level === 'info');
  const total = issues.length;
  const hasDailyIssue = issues.some(i => DAILY_CODES.has(i.code));

  return (
    <div className="rounded-md border border-border bg-card/50 p-3 text-xs">
      <div className="flex items-center gap-2 mb-2">
        <span className="font-semibold uppercase tracking-wide text-muted-foreground">
          Validação da Medição
        </span>
        {total === 0 ? (
          <span className="ml-auto inline-flex items-center gap-1 text-success font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" /> Tudo certo
          </span>
        ) : (
          <span className="ml-auto text-muted-foreground">
            <strong className="text-destructive">{errors.length}</strong> erro(s) ·{' '}
            <strong className="text-warning">{warnings.length}</strong> aviso(s) ·{' '}
            <strong className="text-primary">{infos.length}</strong> info
          </span>
        )}
      </div>

      {total === 0 ? (
        <p className="text-muted-foreground">
          Nenhuma inconsistência encontrada para o período selecionado.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {issues.map((iss, i) => {
            const meta = LEVEL_META[iss.level];
            const Icon = meta.icon;
            return (
              <li
                key={`${iss.code}-${i}`}
                className={`flex items-start gap-2 rounded border px-2 py-1.5 ${meta.bg}`}
              >
                <Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${meta.cls}`} />
                <span className="text-foreground flex-1">{iss.message}</span>
                {DAILY_CODES.has(iss.code) && onOpenDailyReport && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px] -my-0.5"
                    onClick={onOpenDailyReport}
                  >
                    Ver no Diário <ExternalLink className="w-3 h-3 ml-1" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {hasDailyIssue && onOpenDailyReport && (
        <div className="mt-2 pt-2 border-t border-border flex justify-end">
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={onOpenDailyReport}>
            <ExternalLink className="w-3 h-3 mr-1" /> Ver no Diário de Obra
          </Button>
        </div>
      )}
    </div>
  );
}
