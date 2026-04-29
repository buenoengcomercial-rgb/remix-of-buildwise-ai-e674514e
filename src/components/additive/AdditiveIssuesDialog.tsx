import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { Additive as AdditiveModel } from '@/types/project';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  active: AdditiveModel | null;
}

export default function AdditiveIssuesDialog({ open, onOpenChange, active }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Inconsistências da importação</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto divide-y text-xs">
          {(active?.issues ?? []).map((iss, idx) => (
            <div key={idx} className="py-2 flex gap-2">
              <Badge
                variant="outline"
                className={
                  iss.level === 'error' ? 'border-red-400 text-red-700' :
                  iss.level === 'warning' ? 'border-amber-400 text-amber-700' :
                  'border-sky-300 text-sky-700'
                }
              >
                {iss.level === 'error' ? 'Erro' : iss.level === 'warning' ? 'Aviso' : 'Info'}
              </Badge>
              <div className="flex-1">
                <div>{iss.message}</div>
                {(iss.code || iss.line) && (
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {iss.code && `Código: ${iss.code}`}{iss.code && iss.line && ' · '}
                    {iss.line && `Linha: ${iss.line}`}
                  </div>
                )}
              </div>
            </div>
          ))}
          {(!active?.issues || active.issues.length === 0) && (
            <div className="py-8 text-center text-muted-foreground">Sem inconsistências.</div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
