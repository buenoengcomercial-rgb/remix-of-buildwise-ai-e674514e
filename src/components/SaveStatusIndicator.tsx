import { Cloud, CloudOff, Loader2, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface Props {
  status: SaveStatus;
  className?: string;
}

export default function SaveStatusIndicator({ status, className }: Props) {
  const map = {
    idle:   { icon: Cloud,   text: 'Pronto',          color: 'text-muted-foreground' },
    saving: { icon: Loader2, text: 'Salvando...',     color: 'text-muted-foreground', spin: true },
    saved:  { icon: Check,   text: 'Salvo na nuvem',  color: 'text-primary' },
    error:  { icon: CloudOff, text: 'Erro ao salvar', color: 'text-destructive' },
  } as const;
  const cfg = map[status];
  const Icon = cfg.icon;
  return (
    <div className={cn('flex items-center gap-1.5 text-xs', cfg.color, className)}>
      <Icon className={cn('w-3.5 h-3.5', 'spin' in cfg && cfg.spin && 'animate-spin')} />
      <span>{cfg.text}</span>
    </div>
  );
}
