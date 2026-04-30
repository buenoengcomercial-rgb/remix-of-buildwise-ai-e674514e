import { Camera } from 'lucide-react';
import type { ProductionEntry } from '@/components/dailyReport/types';

interface ProductionTableProps {
  entries: ProductionEntry[];
  photosByTask?: Map<string, number>;
  onShowPhotos?: (taskId: string) => void;
}

export function ProductionTable({ entries, photosByTask, onShowPhotos }: ProductionTableProps) {
  return (
    <div className="border border-border rounded-md overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-muted/40 text-muted-foreground">
          <tr>
            <th className="text-left px-2 py-1.5 font-medium">Tarefa</th>
            <th className="text-center px-2 py-1.5 font-medium w-20">Unid.</th>
            <th className="text-right px-2 py-1.5 font-medium w-28">Qtd. executada</th>
            <th className="text-left px-2 py-1.5 font-medium">Observação</th>
            <th className="text-center px-2 py-1.5 font-medium w-20">Fotos</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(e => {
            const count = photosByTask?.get(e.taskId) || 0;
            return (
              <tr key={e.taskId + (e.notes || '')} className="border-t border-border">
                <td className="px-2 py-1.5">{e.taskName}</td>
                <td className="px-2 py-1.5 text-center text-muted-foreground">{e.unit}</td>
                <td className="px-2 py-1.5 text-right font-semibold">{e.actualQuantity.toFixed(2)}</td>
                <td className="px-2 py-1.5 text-muted-foreground">{e.notes || '—'}</td>
                <td className="px-2 py-1.5 text-center">
                  {count > 0 ? (
                    <button
                      type="button"
                      onClick={() => onShowPhotos?.(e.taskId)}
                      className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                      title="Ver fotos vinculadas"
                    >
                      <Camera className="w-3 h-3" /> {count}
                    </button>
                  ) : (
                    <span className="text-muted-foreground text-[11px]">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
