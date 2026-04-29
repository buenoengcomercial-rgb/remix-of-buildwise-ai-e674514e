import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  importName: string;
  setImportName: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function AdditiveImportDialog({
  open, onOpenChange, importName, setImportName, onConfirm, onCancel,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nome do aditivo</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Input value={importName} onChange={e => setImportName(e.target.value)} placeholder="Ex.: SINTÉTICA CORREÇÃO 02" />
          <p className="text-xs text-muted-foreground">
            Esse nome aparecerá no topo da tela e no PDF exportado.
          </p>
          <p className="text-[11px] text-muted-foreground border-t pt-2">
            <strong>Formatos aceitos:</strong> arquivo único com SINTETICA + ANALITICA, somente SINTETICA, ou somente ANALITICA (vincula ao rascunho ativo).
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
          <Button onClick={onConfirm}>Importar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
