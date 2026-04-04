import { Project, Task, ViewMode } from '@/types/project';
import { getAllTasks } from '@/data/sampleProject';
import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';

interface GanttChartProps {
  project: Project;
}

const DAY_WIDTH = { days: 36, weeks: 8, months: 3 };

function addDays(date: Date, days: number) {
  const r = new Date(date);
  r.setDate(r.getDate() + days);
  return r;
}

function diffDays(a: Date, b: Date) {
  return Math.ceil((b.getTime() - a.getTime()) / 86400000);
}

function formatDateFull(d: string) {
  return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateShort(d: string) {
  return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function getEndDate(startDate: string, duration: number): string {
  const d = new Date(startDate);
  d.setDate(d.getDate() + duration);
  return d.toISOString();
}

const MONTH_NAMES_PT: Record<number, string> = {
  0: 'Janeiro', 1: 'Fevereiro', 2: 'Março', 3: 'Abril',
  4: 'Maio', 5: 'Junho', 6: 'Julho', 7: 'Agosto',
  8: 'Setembro', 9: 'Outubro', 10: 'Novembro', 11: 'Dezembro',
};

export default function GanttChart({ project }: GanttChartProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('weeks');
  const [collapsedPhases, setCollapsedPhases] = useState<Set<string>>(new Set());
  const [showCriticalOnly, setShowCriticalOnly] = useState(false);

  const tasks = getAllTasks(project);
  const criticalCount = tasks.filter(t => t.isCritical).length;
  const projectStart = new Date(Math.min(...tasks.map(t => new Date(t.startDate).getTime())));
  const projectEnd = new Date(Math.max(...tasks.map(t => addDays(new Date(t.startDate), t.duration).getTime())));
  const totalDays = diffDays(projectStart, projectEnd) + 5;
  const dayWidth = DAY_WIDTH[viewMode];
  const chartWidth = totalDays * dayWidth;

  const today = new Date();
  const todayOffset = diffDays(projectStart, today);

  const togglePhase = (id: string) => {
    setCollapsedPhases(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  // Week-level dates (day numbers)
  const weekDates = useMemo(() => {
    const dates: { day: number; month: number; year: number; offset: number; width: number }[] = [];
    if (viewMode === 'weeks') {
      for (let i = 0; i < totalDays; i += 7) {
        const d = addDays(projectStart, i);
        dates.push({ day: d.getDate(), month: d.getMonth(), year: d.getFullYear(), offset: i * dayWidth, width: 7 * dayWidth });
      }
    }
    return dates;
  }, [viewMode, totalDays, dayWidth]);

  // Month groups for top header row (weeks view)
  const monthGroups = useMemo(() => {
    if (viewMode !== 'weeks' || weekDates.length === 0) return [];
    const groups: { label: string; offset: number; width: number }[] = [];
    let currentKey = `${weekDates[0].year}-${weekDates[0].month}`;
    let currentOffset = weekDates[0].offset;
    let currentWidth = weekDates[0].width;
    let currentMonth = weekDates[0].month;
    let currentYear = weekDates[0].year;

    for (let i = 1; i < weekDates.length; i++) {
      const key = `${weekDates[i].year}-${weekDates[i].month}`;
      if (key === currentKey) {
        currentWidth += weekDates[i].width;
      } else {
        groups.push({ label: `${MONTH_NAMES_PT[currentMonth]} ${currentYear}`, offset: currentOffset, width: currentWidth });
        currentKey = key;
        currentOffset = weekDates[i].offset;
        currentWidth = weekDates[i].width;
        currentMonth = weekDates[i].month;
        currentYear = weekDates[i].year;
      }
    }
    groups.push({ label: `${MONTH_NAMES_PT[currentMonth]} ${currentYear}`, offset: currentOffset, width: currentWidth });
    return groups;
  }, [weekDates, viewMode]);

  const headerDates = useMemo(() => {
    const dates: { label: string; offset: number; width: number }[] = [];
    if (viewMode === 'days') {
      for (let i = 0; i < totalDays; i++) {
        const d = addDays(projectStart, i);
        dates.push({ label: d.getDate().toString(), offset: i * dayWidth, width: dayWidth });
      }
    } else if (viewMode === 'weeks') {
      for (let i = 0; i < totalDays; i += 7) {
        const d = addDays(projectStart, i);
        dates.push({ label: d.getDate().toString().padStart(2, '0'), offset: i * dayWidth, width: 7 * dayWidth });
      }
    } else {
      let current = new Date(projectStart);
      while (current <= projectEnd) {
        const monthStart = diffDays(projectStart, current);
        const daysInMonth = new Date(current.getFullYear(), current.getMonth() + 1, 0).getDate();
        dates.push({
          label: current.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
          offset: monthStart * dayWidth,
          width: daysInMonth * dayWidth,
        });
        current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
      }
    }
    return dates;
  }, [viewMode, totalDays, dayWidth]);

  const getBarStyle = (task: Task) => {
    const start = diffDays(projectStart, new Date(task.startDate));
    const width = task.duration * dayWidth;
    const isDelayed = addDays(new Date(task.startDate), task.duration) < today && task.percentComplete < 100;
    return { left: start * dayWidth, width, isDelayed };
  };

  const headerHeight = viewMode === 'weeks' ? 'h-16' : 'h-10';
  const headerHeightPx = viewMode === 'weeks' ? 64 : 40;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Cronograma</h2>
          <p className="text-sm text-muted-foreground mt-1">Gráfico de Gantt com Caminho Crítico (CPM)</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowCriticalOnly(!showCriticalOnly)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              showCriticalOnly
                ? 'bg-destructive/10 border-destructive/30 text-destructive'
                : 'bg-card border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            Crítico ({criticalCount})
          </button>
          <div className="flex gap-1 bg-secondary rounded-lg p-1">
            {(['days', 'weeks', 'months'] as ViewMode[]).map(m => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  viewMode === m ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {m === 'days' ? 'Dias' : m === 'weeks' ? 'Semanas' : 'Meses'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-1.5"><div className="w-4 h-2 rounded-full bg-primary opacity-85" /> Normal</div>
        <div className="flex items-center gap-1.5"><div className="w-4 h-2 rounded-full bg-success opacity-85" /> Concluído</div>
        <div className="flex items-center gap-1.5"><div className="w-4 h-2 rounded-full bg-destructive opacity-85" /> Atrasado</div>
        <div className="flex items-center gap-1.5"><div className="w-4 h-2 rounded-full" style={{ background: 'hsl(var(--gantt-critical))' }} /> Caminho Crítico</div>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="flex">
          {/* Task list — removed Folga, added Início and Fim */}
          <div className="w-[420px] min-w-[420px] border-r border-border flex-shrink-0">
            <div className={`${headerHeight} border-b border-border bg-secondary/50 grid grid-cols-12 items-center px-4`}>
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider col-span-4">Tarefa</span>
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider col-span-1 text-center">Dur.</span>
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider col-span-2 text-center">Início</span>
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider col-span-2 text-center">Fim</span>
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider col-span-3 text-center">Gargalo</span>
            </div>
            {project.phases.map(phase => (
              <div key={phase.id}>
                <button
                  onClick={() => togglePhase(phase.id)}
                  className="w-full flex items-center gap-2 px-4 py-2.5 bg-muted/50 border-b border-border hover:bg-muted transition-colors"
                >
                  {collapsedPhases.has(phase.id) ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  <span className="text-xs font-bold text-foreground">{phase.name}</span>
                  <span className="text-[10px] text-muted-foreground ml-auto">{phase.tasks.length}</span>
                </button>
                {!collapsedPhases.has(phase.id) &&
                  phase.tasks
                    .filter(t => !showCriticalOnly || t.isCritical)
                    .map(task => (
                    <div key={task.id} className={`grid grid-cols-12 items-center gap-1 px-4 py-2 border-b border-border hover:bg-muted/30 transition-colors ${task.isCritical ? 'bg-destructive/5' : ''}`}>
                      <div className="col-span-4 min-w-0">
                        <div className="flex items-center gap-1.5">
                          {task.isCritical && <div className="w-1.5 h-1.5 rounded-full bg-destructive flex-shrink-0" />}
                          <p className="text-[11px] font-medium text-foreground truncate">{task.name}</p>
                        </div>
                        <p className="text-[9px] text-muted-foreground">{task.responsible}</p>
                      </div>
                      <div className="col-span-1 text-center">
                        <span className="text-[10px] font-bold text-foreground">{task.duration}d</span>
                      </div>
                      <div className="col-span-2 text-center">
                        <span className="text-[10px] text-foreground">{formatDateFull(task.startDate)}</span>
                      </div>
                      <div className="col-span-2 text-center">
                        <span className="text-[10px] text-foreground">{formatDateFull(getEndDate(task.startDate, task.duration))}</span>
                      </div>
                      <div className="col-span-3 text-center">
                        {task.bottleneckRole ? (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-warning/15 text-warning font-medium truncate block">
                            {task.bottleneckRole}
                          </span>
                        ) : <span className="text-[9px] text-muted-foreground">—</span>}
                      </div>
                    </div>
                  ))}
              </div>
            ))}
          </div>

          {/* Gantt bars */}
          <div className="flex-1 overflow-x-auto scrollbar-thin">
            <div style={{ width: chartWidth, minWidth: '100%' }}>
              {/* Header — two rows for weeks, single row otherwise */}
              {viewMode === 'weeks' ? (
                <div className="h-16 border-b border-border bg-secondary/50 relative">
                  {/* Top row: month names */}
                  {monthGroups.map((g, i) => (
                    <div
                      key={i}
                      className="absolute top-0 h-8 flex items-center justify-center text-[10px] text-foreground font-semibold border-r border-b border-border"
                      style={{ left: g.offset, width: g.width }}
                    >
                      {g.label}
                    </div>
                  ))}
                  {/* Bottom row: day numbers */}
                  {headerDates.map((d, i) => (
                    <div
                      key={i}
                      className="absolute top-8 h-8 flex items-center justify-center text-[10px] text-muted-foreground font-medium border-r border-border"
                      style={{ left: d.offset, width: d.width }}
                    >
                      {d.label}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-10 border-b border-border bg-secondary/50 relative">
                  {headerDates.map((d, i) => (
                    <div
                      key={i}
                      className="absolute h-full flex items-center justify-center text-[10px] text-muted-foreground font-medium border-r border-border"
                      style={{ left: d.offset, width: d.width }}
                    >
                      {d.label}
                    </div>
                  ))}
                </div>
              )}

              <div className="relative">
                {todayOffset >= 0 && todayOffset <= totalDays && (
                  <div className="absolute top-0 bottom-0 w-0.5 bg-gantt-today z-20" style={{ left: todayOffset * dayWidth }}>
                    <div className="absolute -top-0 -left-1.5 w-3.5 h-3.5 rounded-full bg-gantt-today" />
                  </div>
                )}

                {project.phases.map(phase => (
                  <div key={phase.id}>
                    <div className="h-[37px] border-b border-border bg-muted/30" />
                    {!collapsedPhases.has(phase.id) &&
                      phase.tasks
                        .filter(t => !showCriticalOnly || t.isCritical)
                        .map(task => {
                        const bar = getBarStyle(task);
                        const isCritical = task.isCritical && !bar.isDelayed && task.percentComplete < 100;
                        return (
                          <div key={task.id} className="h-[37px] border-b border-border relative">
                            {headerDates.map((d, i) => (
                              <div key={i} className="absolute top-0 bottom-0 border-r border-gantt-grid" style={{ left: d.offset + d.width }} />
                            ))}
                            <motion.div
                              initial={{ scaleX: 0 }}
                              animate={{ scaleX: 1 }}
                              transition={{ duration: 0.5, ease: 'easeOut' }}
                              className={`absolute top-1.5 h-5 rounded-full origin-left cursor-pointer group ${isCritical ? 'ring-2 ring-destructive/50' : ''}`}
                              style={{
                                left: bar.left,
                                width: bar.width,
                                background: bar.isDelayed
                                  ? 'hsl(var(--gantt-bar-delayed))'
                                  : task.percentComplete === 100
                                  ? 'hsl(var(--gantt-bar-complete))'
                                  : isCritical
                                  ? 'hsl(var(--gantt-critical))'
                                  : 'hsl(var(--gantt-bar))',
                                opacity: 0.85,
                              }}
                            >
                              <div className="h-full rounded-full opacity-40" style={{ width: `${task.percentComplete}%`, background: 'white' }} />
                              <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-foreground text-background text-[10px] px-2.5 py-1.5 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-30 space-y-0.5">
                                <div className="font-semibold">{task.name} — {task.percentComplete}%</div>
                                <div>{formatDateShort(task.startDate)} • {task.duration}d {task.totalHours ? `(${Math.round(task.totalHours)}h)` : ''}</div>
                                {task.isCritical && <div className="text-red-300">⚠ Caminho Crítico • Folga: {task.float}d</div>}
                                {task.bottleneckRole && <div>Gargalo: {task.bottleneckRole}</div>}
                              </div>
                            </motion.div>
                          </div>
                        );
                      })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
