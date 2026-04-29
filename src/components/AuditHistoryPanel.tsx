import { useMemo } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AUDIT_ACTION_BADGE,
  AUDIT_ACTION_LABEL,
  getEntityAuditLogs,
  summarizeAuditLogs,
} from '@/lib/audit';
import type { AuditEntityType, Project } from '@/types/project';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  project: Project;
  entityType: AuditEntityType;
  entityId: string;
  title?: string;
}

const fmtDateTime = (iso: string) => {
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
};

const fmtVal = (v: unknown): string => {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return v.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
};

export default function AuditHistoryPanel({
  open, onOpenChange, project, entityType, entityId, title,
}: Props) {
  const logs = useMemo(
    () => getEntityAuditLogs(project, entityType, entityId),
    [project, entityType, entityId],
  );
  const summary = useMemo(() => summarizeAuditLogs(logs), [logs]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Histórico {title ? `— ${title}` : ''}</SheetTitle>
          <div className="text-xs text-muted-foreground">
            {summary.total} evento(s)
            {summary.lastAt && (
              <> · última alteração em <strong>{fmtDateTime(summary.lastAt)}</strong></>
            )}
          </div>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-7rem)] mt-4 pr-3">
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Nenhum evento registrado ainda.
            </p>
          ) : (
            <ol className="space-y-3 pb-4">
              {logs.map(l => (
                <li
                  key={l.id}
                  className="border rounded-md p-3 bg-card text-xs space-y-1"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={AUDIT_ACTION_BADGE[l.action]}>
                        {AUDIT_ACTION_LABEL[l.action]}
                      </Badge>
                      <span className="font-medium text-foreground">{l.title}</span>
                    </div>
                    <span className="text-muted-foreground whitespace-nowrap">
                      {fmtDateTime(l.at)}
                    </span>
                  </div>
                  {l.description && (
                    <p className="text-muted-foreground">{l.description}</p>
                  )}
                  <div className="text-muted-foreground">
                    Por: <strong>{l.userName || l.userEmail || 'Sistema'}</strong>
                  </div>
                  {(l.before !== undefined || l.after !== undefined) && (
                    <div className="grid grid-cols-2 gap-2 mt-1">
                      <div className="rounded bg-rose-50 border border-rose-200 px-2 py-1">
                        <div className="text-[10px] uppercase text-rose-700">Antes</div>
                        <div className="font-mono text-[11px] text-rose-900 break-words">
                          {fmtVal(l.before)}
                        </div>
                      </div>
                      <div className="rounded bg-emerald-50 border border-emerald-200 px-2 py-1">
                        <div className="text-[10px] uppercase text-emerald-700">Depois</div>
                        <div className="font-mono text-[11px] text-emerald-900 break-words">
                          {fmtVal(l.after)}
                        </div>
                      </div>
                    </div>
                  )}
                  {l.metadata && Object.keys(l.metadata).length > 0 && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
                        Detalhes
                      </summary>
                      <ul className="mt-1 space-y-0.5 text-[11px] font-mono">
                        {Object.entries(l.metadata).map(([k, v]) => (
                          <li key={k} className="break-words">
                            <span className="text-muted-foreground">{k}:</span>{' '}
                            <span className="text-foreground">{fmtVal(v)}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              ))}
            </ol>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
