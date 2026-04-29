import { Button } from '@/components/ui/button';
import { AlertTriangle, Trash2 } from 'lucide-react';
import type { Additive as AdditiveModel } from '@/types/project';
import { STATUS_LABEL, STATUS_BADGE } from './types';

interface Props {
  additives: AdditiveModel[];
  active: AdditiveModel | null;
  onSelect: (id: string) => void;
  onRequestDelete: (id: string) => void;
  onOpenIssues: () => void;
}

export default function AdditiveTabs({ additives, active, onSelect, onRequestDelete, onOpenIssues }: Props) {
  if (additives.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">Aditivos:</span>
      {additives.map(a => {
        const st = a.status ?? 'rascunho';
        return (
          <div key={a.id} className="flex items-center">
            <button
              onClick={() => onSelect(a.id)}
              className={`px-2.5 py-1 rounded-l text-xs border flex items-center gap-1.5 ${a.id === active?.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-card hover:bg-muted'}`}
            >
              {a.name}
              <span className={`text-[9px] px-1 py-0.5 rounded ${STATUS_BADGE[st]}`}>
                {STATUS_LABEL[st]}
              </span>
            </button>
            <button
              onClick={() => onRequestDelete(a.id)}
              title="Excluir aditivo"
              className="px-1.5 py-1 rounded-r text-xs border border-l-0 hover:bg-destructive/10 text-destructive"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        );
      })}
      {active?.issues && active.issues.some(i => i.level !== 'info') && (
        <Button variant="ghost" size="sm" onClick={onOpenIssues}>
          <AlertTriangle className="w-3.5 h-3.5 mr-1 text-amber-600" />
          Inconsistências
        </Button>
      )}
    </div>
  );
}
