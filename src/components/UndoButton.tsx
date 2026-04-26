import { Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface UndoButtonProps {
  canUndo: boolean;
  onUndo: () => void;
  /** Visual size; defaults to "sm" */
  size?: 'sm' | 'xs';
}

/**
 * Discreto botão "Desfazer" para cada aba.
 * - Mostra ícone Undo2 + texto "Desfazer".
 * - Desabilitado quando não há histórico para reverter.
 * - Tooltip com contexto.
 */
export default function UndoButton({ canUndo, onUndo, size = 'sm' }: UndoButtonProps) {
  const isXs = size === 'xs';
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onUndo}
              disabled={!canUndo}
              className={
                isXs
                  ? 'h-7 px-2 text-[10px] gap-1'
                  : 'gap-1.5'
              }
              aria-label="Desfazer última alteração"
            >
              <Undo2 className={isXs ? 'w-3 h-3' : 'w-4 h-4'} />
              Desfazer
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {canUndo ? 'Desfazer última alteração' : 'Nada para desfazer'}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
