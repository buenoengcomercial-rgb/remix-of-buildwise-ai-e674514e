import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import type { DailyReportAttachment } from '@/types/project';

interface DailyReportPhotoDeleteDialogProps {
  confirmDelete: DailyReportAttachment | null;
  setConfirmDelete: (p: DailyReportAttachment | null) => void;
  removePhoto: (att: DailyReportAttachment) => void;
}

export function DailyReportPhotoDeleteDialog({
  confirmDelete,
  setConfirmDelete,
  removePhoto,
}: DailyReportPhotoDeleteDialogProps) {
  return (
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
  );
}
