import { Project, Task, ViewMode, DependencyType, TaskDependency } from '@/types/project';
import { getAllTasks } from '@/data/sampleProject';
import { useState, useMemo, useRef, useCallback } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import DependencyArrows from './gantt/DependencyArrows';
import { DAY_WIDTH, ROW_HEIGHT, FlatTask } from './gantt/types';
import { addDays, diffDays, formatDateFull, getEndDate, MONTH_NAMES_PT, dateToISO } from './gantt/utils';

interface GanttChartProps {
  project: Project;
  onProjectChange?: (project: Project) => void;
}

export default function GanttChart({ project, onProjectChange }: GanttChartProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('weeks');
  const [collapsedPhases, setCollapsedPhases] = useState<Set<string>>(new Set());
  const [showCriticalOnly, setShowCriticalOnly] = useState(false);

  // Drag state
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const dragStartX = useRef(0);
  const dragStartLeft = useRef(0);
  const chartContainerRef = useRef<HTMLDivElement>(null);

  const tasks = getAllTasks(project);
  const criticalCount = tasks.filter(t => t.isCritical).length;
  const projectStart = new Date(Math.min(...tasks.map(t => new Date(t.startDate).getTime())));
  const projectEnd = new Date(Math.max(...tasks.map(t => addDays(new Date(t.startDate), t.duration).getTime())));
  const totalDays = diffDays(projectStart, projectEnd) + 10;
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

  // Build sequential numbering for ALL tasks (not phases), regardless of collapse/filter
  const taskNumbering = useMemo(() => {
    const map = new Map<string, number>();
    let num = 0;
    project.phases.forEach(phase => {
      phase.tasks.forEach(task => {
        num++;
        map.set(task.id, num);
      });
    });
    return map;
  }, [project]);

  // Reverse map: number -> taskId
  const numberToTaskId = useMemo(() => {
    const map = new Map<number, string>();
    taskNumbering.forEach((num, id) => map.set(num, id));
    return map;
  }, [taskNumbering]);

  // Build flat task list for row indexing (visual)
  const flatTasks = useMemo(() => {
    const result: FlatTask[] = [];
    let rowIdx = 0;
    project.phases.forEach(phase => {
      rowIdx++; // phase header row
      if (!collapsedPhases.has(phase.id)) {
        phase.tasks
          .filter(t => !showCriticalOnly || t.isCritical)
          .forEach(task => {
            result.push({ task, phaseId: phase.id, phaseName: phase.name, rowIndex: rowIdx });
            rowIdx++;
          });
      }
    });
    return result;
  }, [project, collapsedPhases, showCriticalOnly]);

  // Week dates for header
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
    const isCritical = !!task.isCritical && !isDelayed && task.percentComplete < 100;
    const isComplete = task.percentComplete === 100;
    return { left: start * dayWidth, width, isDelayed, isCritical, isComplete };
  };

  // Update task helper
  const updateTask = useCallback((taskId: string, updates: Partial<Task>) => {
    if (!onProjectChange) return;
    const newProject = {
      ...project,
      phases: project.phases.map(phase => ({
        ...phase,
        tasks: phase.tasks.map(t =>
          t.id === taskId ? { ...t, ...updates } : t
        ),
      })),
    };
    onProjectChange(newProject);
  }, [project, onProjectChange]);

  // Dependency validation: check if task violates its dependencies
  const getViolations = useCallback((task: Task): string[] => {
    const violations: string[] = [];
    const details = task.dependencyDetails || [];
    details.forEach(dep => {
      const predTask = tasks.find(t => t.id === dep.taskId);
      if (!predTask) return;
      const predNum = taskNumbering.get(dep.taskId);
      const predStart = new Date(predTask.startDate);
      const predEnd = addDays(predStart, predTask.duration);
      const taskStart = new Date(task.startDate);
      const taskEnd = addDays(taskStart, task.duration);

      switch (dep.type) {
        case 'TI':
          if (taskStart < predEnd) violations.push(`Conflito de dependência com tarefa #${predNum} (TI)`);
          break;
        case 'II':
          if (taskStart < predStart) violations.push(`Conflito de dependência com tarefa #${predNum} (II)`);
          break;
        case 'TT':
          if (taskEnd < predEnd) violations.push(`Conflito de dependência com tarefa #${predNum} (TT)`);
          break;
        case 'IT':
          if (taskEnd < predStart) violations.push(`Conflito de dependência com tarefa #${predNum} (IT)`);
          break;
      }
    });
    return violations;
  }, [tasks, taskNumbering]);

  // Date change handler
  const handleDateChange = (taskId: string, field: 'start' | 'end', date: Date | undefined) => {
    if (!date) return;
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    if (field === 'start') {
      const oldEnd = addDays(new Date(task.startDate), task.duration);
      const newDuration = Math.max(1, diffDays(date, oldEnd));
      updateTask(taskId, { startDate: dateToISO(date), duration: newDuration });
    } else {
      const start = new Date(task.startDate);
      const newDuration = Math.max(1, diffDays(start, date));
      updateTask(taskId, { duration: newDuration });
    }
    // After date change, propagate to dependent tasks
    setTimeout(() => propagateDependencies(taskId), 0);
  };

  // Propagate dependency constraints to successor tasks
  const propagateDependencies = useCallback((changedTaskId: string) => {
    if (!onProjectChange) return;
    const allTasks = getAllTasks(project);
    const taskMap = new Map(allTasks.map(t => [t.id, t]));

    // Find tasks that depend on changedTaskId
    const updates: Record<string, Partial<Task>> = {};

    allTasks.forEach(t => {
      const details = t.dependencyDetails || [];
      details.forEach(dep => {
        if (dep.taskId !== changedTaskId) return;
        const pred = taskMap.get(dep.taskId);
        if (!pred) return;

        const predStart = new Date(pred.startDate);
        const predEnd = addDays(predStart, pred.duration);
        const taskStart = new Date(t.startDate);
        const taskEnd = addDays(taskStart, t.duration);

        switch (dep.type) {
          case 'TI':
            if (taskStart < predEnd) {
              updates[t.id] = { startDate: dateToISO(predEnd), duration: t.duration };
            }
            break;
          case 'II':
            if (taskStart < predStart) {
              updates[t.id] = { startDate: dateToISO(predStart), duration: t.duration };
            }
            break;
          case 'TT': {
            const requiredStart = addDays(predEnd, -t.duration);
            if (taskEnd < predEnd) {
              updates[t.id] = { startDate: dateToISO(requiredStart), duration: t.duration };
            }
            break;
          }
          case 'IT': {
            const requiredEnd = predStart;
            const requiredStartIT = addDays(requiredEnd, -t.duration);
            if (taskEnd < predStart) {
              updates[t.id] = { startDate: dateToISO(requiredStartIT), duration: t.duration };
            }
            break;
          }
        }
      });
    });

    if (Object.keys(updates).length > 0) {
      const newProject = {
        ...project,
        phases: project.phases.map(phase => ({
          ...phase,
          tasks: phase.tasks.map(t =>
            updates[t.id] ? { ...t, ...updates[t.id] } : t
          ),
        })),
      };
      onProjectChange(newProject);
    }
  }, [project, onProjectChange]);

  // Drag handlers
  const handleMouseDown = (e: React.MouseEvent, taskId: string, barLeft: number) => {
    e.preventDefault();
    setDraggingTaskId(taskId);
    dragStartX.current = e.clientX;
    dragStartLeft.current = barLeft;
    setDragOffset(0);

    const handleMove = (ev: MouseEvent) => {
      const dx = ev.clientX - dragStartX.current;
      setDragOffset(dx);
    };

    const handleUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      const dx = ev.clientX - dragStartX.current;
      const daysMoved = Math.round(dx / dayWidth);
      if (daysMoved !== 0) {
        const task = tasks.find(t => t.id === taskId);
        if (task) {
          const newStart = addDays(new Date(task.startDate), daysMoved);
          updateTask(taskId, { startDate: dateToISO(newStart) });
          setTimeout(() => propagateDependencies(taskId), 0);
        }
      }
      setDraggingTaskId(null);
      setDragOffset(0);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  };

  // Dependency editing - now uses line numbers
  const handleDepChange = (taskId: string, value: string) => {
    if (!onProjectChange) return;
    const nums = value.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    // Get existing dep details to preserve types
    const existingDetails = task.dependencyDetails || [];
    const existingByTaskId = new Map(existingDetails.map(d => [d.taskId, d.type]));

    const deps: TaskDependency[] = nums.map(num => {
      const depTaskId = numberToTaskId.get(num);
      if (!depTaskId) return null;
      // Preserve existing type if available, default TI
      const existingType = existingByTaskId.get(depTaskId);
      return { taskId: depTaskId, type: existingType || 'TI' };
    }).filter(Boolean) as TaskDependency[];

    updateTask(taskId, {
      dependencies: deps.map(d => d.taskId),
      dependencyDetails: deps,
    });
  };

  // Dependency type change for a specific dependency index
  const handleDepTypeChange = (taskId: string, depIndex: number, newType: DependencyType) => {
    if (!onProjectChange) return;
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const details = [...(task.dependencyDetails || [])];
    if (depIndex < details.length) {
      details[depIndex] = { ...details[depIndex], type: newType };
      updateTask(taskId, {
        dependencies: details.map(d => d.taskId),
        dependencyDetails: details,
      });
    }
  };

  // Format dep numbers for display
  const getDepDisplay = (task: Task): string => {
    const details = task.dependencyDetails || [];
    return details.map(d => {
      const num = taskNumbering.get(d.taskId);
      return num ? String(num) : '';
    }).filter(Boolean).join(', ');
  };

  // Get combined type display for dropdown
  const getDepTypes = (task: Task): { taskId: string; type: DependencyType; num: number }[] => {
    const details = task.dependencyDetails || [];
    return details.map(d => {
      const num = taskNumbering.get(d.taskId) || 0;
      return { taskId: d.taskId, type: d.type, num };
    }).filter(d => d.num > 0);
  };

  const headerHeightPx = viewMode === 'weeks' ? 52 : 32;

  // Compute drag preview date for tooltip
  const getDragDate = (task: Task) => {
    if (draggingTaskId !== task.id) return null;
    const daysMoved = Math.round(dragOffset / dayWidth);
    const newStart = addDays(new Date(task.startDate), daysMoved);
    const newEnd = addDays(newStart, task.duration);
    return { start: formatDateFull(dateToISO(newStart)), end: formatDateFull(dateToISO(newEnd)) };
  };

  // sidebar grid: #(24px) name(1fr) dur(36px) start(68px) end(68px) dep(50px) type(50px)
  const sidebarCols = '24px 1fr 36px 68px 68px 50px 50px';
  const sidebarWidth = 420;

  return (
    <div className="p-4 space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-foreground">Cronograma</h2>
          <p className="text-[10px] text-muted-foreground">Gantt Interativo com CPM</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCriticalOnly(!showCriticalOnly)}
            className={`flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium rounded-md border transition-colors ${
              showCriticalOnly
                ? 'bg-destructive/10 border-destructive/30 text-destructive'
                : 'bg-card border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            <AlertTriangle className="w-3 h-3" />
            Crítico ({criticalCount})
          </button>
          <div className="flex gap-0.5 bg-secondary rounded-md p-0.5">
            {(['days', 'weeks', 'months'] as ViewMode[]).map(m => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className={`px-2.5 py-1 text-[10px] font-medium rounded transition-colors ${
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
      <div className="flex items-center gap-3 text-[9px] text-muted-foreground flex-wrap">
        <div className="flex items-center gap-1"><div className="w-3 h-1.5 rounded-full bg-primary opacity-85" /> Normal</div>
        <div className="flex items-center gap-1"><div className="w-3 h-1.5 rounded-full bg-success opacity-85" /> Concluído</div>
        <div className="flex items-center gap-1"><div className="w-3 h-1.5 rounded-full bg-destructive opacity-85" /> Atrasado</div>
        <div className="flex items-center gap-1"><div className="w-3 h-1.5 rounded-full" style={{ background: 'hsl(var(--gantt-critical))' }} /> Crítico</div>
        <div className="flex items-center gap-3 ml-2 border-l border-border pl-3">
          <span className="font-medium">Dep:</span>
          <span style={{ color: '#378ADD' }}>TI</span>
          <span style={{ color: '#1D9E75' }}>II</span>
          <span style={{ color: '#BA7517' }}>TT</span>
          <span style={{ color: '#A32D2D' }}>IT</span>
        </div>
      </div>

      <div className="bg-card rounded-lg border border-border shadow-sm overflow-hidden">
        <div className="flex">
          {/* Sidebar table */}
          <div style={{ width: sidebarWidth, minWidth: sidebarWidth }} className="border-r border-border flex-shrink-0">
            {/* Header */}
            <div
              className="border-b border-border bg-secondary/50 grid items-center px-1"
              style={{ height: headerHeightPx, gridTemplateColumns: sidebarCols }}
            >
              <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider text-center">#</span>
              <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider pl-1">Tarefa</span>
              <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider text-center">Dur</span>
              <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider text-center">Início</span>
              <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider text-center">Fim</span>
              <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider text-center">Dep</span>
              <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider text-center">Tipo</span>
            </div>

            {/* Rows */}
            {project.phases.map(phase => (
              <div key={phase.id}>
                <button
                  onClick={() => togglePhase(phase.id)}
                  className="w-full flex items-center gap-1.5 px-2 bg-muted/60 border-b border-border hover:bg-muted transition-colors"
                  style={{ height: ROW_HEIGHT }}
                >
                  {collapsedPhases.has(phase.id) ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  <span className="text-[11px] font-bold text-foreground truncate">{phase.name}</span>
                  <span className="text-[9px] text-muted-foreground ml-auto">{phase.tasks.length}</span>
                </button>
                {!collapsedPhases.has(phase.id) &&
                  phase.tasks
                    .filter(t => !showCriticalOnly || t.isCritical)
                    .map((task, idx) => {
                      const endDate = getEndDate(task.startDate, task.duration);
                      const taskNum = taskNumbering.get(task.id) || 0;
                      const violations = getViolations(task);
                      const hasViolation = violations.length > 0;
                      const depDisplay = getDepDisplay(task);
                      const depTypes = getDepTypes(task);

                      return (
                        <div
                          key={task.id}
                          className={`grid items-center gap-0.5 px-1 border-b border-border hover:bg-muted/30 transition-colors ${
                            idx % 2 === 0 ? 'bg-card' : 'bg-muted/10'
                          } ${task.isCritical ? 'bg-destructive/5' : ''}`}
                          style={{ height: ROW_HEIGHT, gridTemplateColumns: sidebarCols }}
                          title={hasViolation ? violations.join('\n') : undefined}
                        >
                          {/* # */}
                          <div className="text-center">
                            <span className="text-[9px] font-mono text-muted-foreground">{taskNum}</span>
                          </div>
                          {/* Name */}
                          <div className="min-w-0 flex items-center gap-1 pl-1">
                            {task.isCritical && <div className="w-1.5 h-1.5 rounded-full bg-destructive flex-shrink-0" />}
                            {hasViolation && <AlertTriangle className="w-3 h-3 text-destructive flex-shrink-0" />}
                            <p className="text-[11px] font-medium text-foreground line-clamp-2 break-words leading-tight">{task.name}</p>
                          </div>
                          {/* Duration */}
                          <div className="text-center">
                            <span className="text-[10px] font-bold text-foreground">{task.duration}d</span>
                          </div>
                          {/* Start date picker */}
                          <Popover>
                            <PopoverTrigger asChild>
                              <button className="text-[9px] text-foreground hover:text-primary transition-colors text-center w-full">
                                {formatDateFull(task.startDate)}
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={new Date(task.startDate)}
                                onSelect={(d) => handleDateChange(task.id, 'start', d)}
                                className={cn("p-3 pointer-events-auto")}
                              />
                            </PopoverContent>
                          </Popover>
                          {/* End date picker */}
                          <Popover>
                            <PopoverTrigger asChild>
                              <button className="text-[9px] text-foreground hover:text-primary transition-colors text-center w-full">
                                {formatDateFull(endDate)}
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={new Date(endDate)}
                                onSelect={(d) => handleDateChange(task.id, 'end', d)}
                                className={cn("p-3 pointer-events-auto")}
                              />
                            </PopoverContent>
                          </Popover>
                          {/* DEP - line numbers */}
                          <div className="text-center">
                            <input
                              className="w-full text-[9px] bg-transparent border-b border-border/50 text-center text-muted-foreground focus:outline-none focus:border-primary"
                              defaultValue={depDisplay}
                              key={depDisplay} // re-render on external change
                              placeholder="—"
                              onBlur={(e) => handleDepChange(task.id, e.target.value)}
                              title="Nº da tarefa predecessora (ex: 3, 7)"
                            />
                          </div>
                          {/* TIPO - dropdown */}
                          <div className="text-center">
                            {depTypes.length > 0 ? (
                              <Select
                                value={depTypes[0].type}
                                onValueChange={(val) => handleDepTypeChange(task.id, 0, val as DependencyType)}
                              >
                                <SelectTrigger className="h-5 min-h-0 px-1 py-0 text-[9px] border-border/50 bg-transparent">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="TI" className="text-[10px]">TI</SelectItem>
                                  <SelectItem value="II" className="text-[10px]">II</SelectItem>
                                  <SelectItem value="TT" className="text-[10px]">TT</SelectItem>
                                  <SelectItem value="IT" className="text-[10px]">IT</SelectItem>
                                </SelectContent>
                              </Select>
                            ) : (
                              <span className="text-[9px] text-muted-foreground">—</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
              </div>
            ))}
          </div>

          {/* Gantt chart area */}
          <div className="flex-1 overflow-x-auto scrollbar-thin" ref={chartContainerRef}>
            <div style={{ width: chartWidth, minWidth: '100%' }}>
              {/* Header */}
              {viewMode === 'weeks' ? (
                <div className="border-b border-border bg-secondary/50 relative" style={{ height: headerHeightPx }}>
                  {monthGroups.map((g, i) => (
                    <div
                      key={i}
                      className="absolute top-0 flex items-center justify-center text-[9px] text-foreground font-semibold border-r border-b border-border"
                      style={{ left: g.offset, width: g.width, height: headerHeightPx / 2 }}
                    >
                      {g.label}
                    </div>
                  ))}
                  {headerDates.map((d, i) => (
                    <div
                      key={i}
                      className="absolute flex items-center justify-center text-[9px] text-muted-foreground font-medium border-r border-border"
                      style={{ left: d.offset, width: d.width, top: headerHeightPx / 2, height: headerHeightPx / 2 }}
                    >
                      {d.label}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="border-b border-border bg-secondary/50 relative" style={{ height: headerHeightPx }}>
                  {headerDates.map((d, i) => (
                    <div
                      key={i}
                      className="absolute h-full flex items-center justify-center text-[9px] text-muted-foreground font-medium border-r border-border"
                      style={{ left: d.offset, width: d.width }}
                    >
                      {d.label}
                    </div>
                  ))}
                </div>
              )}

              {/* Bars area */}
              <div className="relative">
                {/* Today line */}
                {todayOffset >= 0 && todayOffset <= totalDays && (
                  <div className="absolute top-0 bottom-0 w-px bg-gantt-today z-20" style={{ left: todayOffset * dayWidth }}>
                    <div className="absolute -top-0 -left-1 w-2.5 h-2.5 rounded-full bg-gantt-today" />
                  </div>
                )}

                {/* Vertical grid lines (dashed) */}
                {headerDates.map((d, i) => (
                  <div
                    key={i}
                    className="absolute top-0 bottom-0 border-r border-dashed"
                    style={{ left: d.offset + d.width, borderColor: 'hsl(var(--gantt-grid))' }}
                  />
                ))}

                {/* Dependency arrows SVG */}
                <DependencyArrows
                  flatTasks={flatTasks}
                  projectStart={projectStart}
                  dayWidth={dayWidth}
                  headerHeight={headerHeightPx}
                />

                {project.phases.map(phase => (
                  <div key={phase.id}>
                    {/* Phase header row */}
                    <div className="border-b border-border bg-muted/30" style={{ height: ROW_HEIGHT }} />
                    {!collapsedPhases.has(phase.id) &&
                      phase.tasks
                        .filter(t => !showCriticalOnly || t.isCritical)
                        .map((task, idx) => {
                          const bar = getBarStyle(task);
                          const isDragging = draggingTaskId === task.id;
                          const currentLeft = isDragging ? bar.left + dragOffset : bar.left;
                          const dragDate = getDragDate(task);
                          const violations = getViolations(task);
                          const hasViolation = violations.length > 0;

                          return (
                            <div
                              key={task.id}
                              className={`border-b border-border relative ${idx % 2 === 0 ? 'bg-card' : 'bg-muted/10'}`}
                              style={{ height: ROW_HEIGHT }}
                            >
                              {/* Bar */}
                              <div
                                className={`absolute rounded-md cursor-grab active:cursor-grabbing group ${
                                  bar.isCritical ? 'ring-1 ring-destructive/40' : ''
                                } ${hasViolation ? 'animate-pulse ring-2 ring-destructive' : ''}`}
                                style={{
                                  left: currentLeft,
                                  width: bar.width,
                                  top: (ROW_HEIGHT - 16) / 2,
                                  height: 16,
                                  borderRadius: 6,
                                  background: bar.isDelayed
                                    ? 'hsl(var(--gantt-bar-delayed))'
                                    : bar.isComplete
                                    ? 'hsl(var(--gantt-bar-complete))'
                                    : bar.isCritical
                                    ? 'hsl(var(--gantt-critical))'
                                    : 'hsl(var(--gantt-bar))',
                                  opacity: 0.85,
                                  transition: isDragging ? 'none' : 'left 0.2s ease',
                                }}
                                onMouseDown={(e) => handleMouseDown(e, task.id, bar.left)}
                              >
                                {/* Progress fill */}
                                <div
                                  className="h-full rounded-md opacity-30"
                                  style={{ width: `${task.percentComplete}%`, background: 'white', borderRadius: 6 }}
                                />
                                {/* Tooltip */}
                                <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-foreground text-background text-[9px] px-2 py-1 rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-30">
                                  {isDragging && dragDate
                                    ? `${dragDate.start} → ${dragDate.end}`
                                    : hasViolation
                                    ? violations[0]
                                    : `${task.name} — ${task.percentComplete}% • ${task.duration}d`
                                  }
                                </div>
                              </div>
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
