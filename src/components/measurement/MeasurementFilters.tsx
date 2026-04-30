import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CalendarDays, Search } from 'lucide-react';
import type { Project } from '@/types/project';

interface MeasurementFiltersProps {
  project: Project;
  isSnapshotMode: boolean;
  effStart: string;
  effEnd: string;
  setStartDate: (v: string) => void;
  setEndDate: (v: string) => void;
  chapterFilter: string;
  setChapterFilter: (v: string) => void;
  search: string;
  setSearch: (v: string) => void;
  numbering: Map<string, string>;
}

export default function MeasurementFilters({
  project,
  isSnapshotMode,
  effStart,
  effEnd,
  setStartDate,
  setEndDate,
  chapterFilter,
  setChapterFilter,
  search,
  setSearch,
  numbering,
}: MeasurementFiltersProps) {
  return (
    <Card className="print:hidden">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Filtros</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-1">
            <CalendarDays className="w-3 h-3" /> Data inicial
          </label>
          <Input type="date" value={effStart} disabled={isSnapshotMode}
            onChange={e => setStartDate(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-1">
            <CalendarDays className="w-3 h-3" /> Data final
          </label>
          <Input type="date" value={effEnd} disabled={isSnapshotMode}
            onChange={e => setEndDate(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Capítulo</label>
          <Select value={chapterFilter} onValueChange={setChapterFilter} disabled={isSnapshotMode}>
            <SelectTrigger><SelectValue placeholder="Todos os capítulos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os capítulos</SelectItem>
              {project.phases.map(p => (
                <SelectItem key={p.id} value={p.id}>
                  {numbering.get(p.id)} — {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-1">
            <Search className="w-3 h-3" /> Busca
          </label>
          <Input placeholder="Item, código, capítulo ou descrição"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </CardContent>
    </Card>
  );
}
