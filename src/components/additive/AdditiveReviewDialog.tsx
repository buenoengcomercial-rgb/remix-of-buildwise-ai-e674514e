import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  approvedBy: string;
  setApprovedBy: (v: string) => void;
  reviewNotes: string;
  setReviewNotes: (v: string) => void;
  onApprove: () => void;
  onReject: () => void;
}

export default function AdditiveReviewDialog({
  open, onOpenChange, approvedBy, setApprovedBy, reviewNotes, setReviewNotes, onApprove, onReject,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Aprovar ou reprovar aditivo</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Responsável / Fiscal (opcional)</label>
            <Input value={approvedBy} onChange={e => setApprovedBy(e.target.value)} placeholder="Nome do responsável" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Observações</label>
            <Textarea value={reviewNotes} onChange={e => setReviewNotes(e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button variant="outline" className="border-rose-300 text-rose-700" onClick={onReject}>
            <XCircle className="w-4 h-4 mr-1" /> Reprovar
          </Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={onApprove}>
            <CheckCircle2 className="w-4 h-4 mr-1" /> Aprovar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
