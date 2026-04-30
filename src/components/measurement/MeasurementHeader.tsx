import { Button } from '@/components/ui/button';
import { ClipboardList, FileSpreadsheet, Printer, History } from 'lucide-react';

interface MeasurementHeaderProps {
  undoButton?: React.ReactNode;
  onExportXLSX: () => void;
  onPrint: () => void;
  showHistory: boolean;
  onOpenHistory: () => void;
}

export default function MeasurementHeader({
  undoButton,
  onExportXLSX,
  onPrint,
  showHistory,
  onOpenHistory,
}: MeasurementHeaderProps) {
  return (
    <div className="flex items-center justify-between flex-wrap gap-3 print:hidden">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <ClipboardList className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Boletim de Medição</h1>
          <p className="text-sm text-muted-foreground">Planilha de medição para pagamento</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {undoButton}
        <Button variant="outline" size="sm" onClick={onExportXLSX}>
          <FileSpreadsheet className="w-4 h-4 mr-1" /> Excel
        </Button>
        <Button variant="default" size="sm" onClick={onPrint}>
          <Printer className="w-4 h-4 mr-1" /> Imprimir / PDF
        </Button>
        {showHistory && (
          <Button variant="outline" size="sm" onClick={onOpenHistory}>
            <History className="w-4 h-4 mr-1" /> Histórico
          </Button>
        )}
      </div>
    </div>
  );
}
