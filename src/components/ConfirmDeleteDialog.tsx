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
import { useState, useCallback, ReactNode } from 'react';

export interface ConfirmDeleteOptions {
  title: string;
  /** Pode ser texto simples ou ReactNode com formatação. */
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
}

interface PendingState extends ConfirmDeleteOptions {
  onConfirm: () => void;
}

/**
 * Hook que provê um confirmador de exclusão reutilizável.
 * Use o objeto `dialog` no JSX e `confirm(options, action)` para disparar a confirmação.
 */
export function useConfirmDelete() {
  const [pending, setPending] = useState<PendingState | null>(null);

  const confirm = useCallback((options: ConfirmDeleteOptions, action: () => void) => {
    setPending({ ...options, onConfirm: action });
  }, []);

  const close = useCallback(() => setPending(null), []);

  const dialog = (
    <AlertDialog open={!!pending} onOpenChange={(o) => !o && close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="text-sm text-muted-foreground space-y-2">
              {pending?.description}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{pending?.cancelLabel ?? 'Cancelar'}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              pending?.onConfirm();
              close();
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {pending?.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirm, dialog };
}
