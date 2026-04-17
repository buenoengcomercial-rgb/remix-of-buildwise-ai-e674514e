import { Project, Task, ViewMode, DependencyType, TaskDependency } from '@/types/project';
import { getTeamDefinition, TEAM_DEFINITIONS, TEAM_CODES, TeamCode } from '@/lib/teams';
import { getAllTasks } from '@/data/sampleProject';
import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle, Flag } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import DependencyArrows from './gantt/DependencyArrows';
import ConfiguracaoObra, { ObraConfig, loadObraConfig } from './ConfiguracaoObra';
import { DAY_WIDTH, ROW_HEIGHT, FlatTask } from './gantt/types';
import { addDays, diffDays, formatDateFull, formatDateShort, getEndDate, MONTH_NAMES_PT, dateToISO, toISODateLocal, parseISODateLocal } from './gantt/utils';
import { getFeriadosMap, FeriadoInfo, calcularDiasUteis, isDiaUtil } from '@/lib/feriados';
import { calculateRupDuration, propagateAllDependencies, checkDependencyViolation } from '@/lib/calculations';
import { toast } from 'sonner';

interface GanttChartProps {
  project: Project;
  onProjectChange?: (project: Project) => void;
}

export default function GanttChart({ project, onProjectChange }: GanttChartProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('weeks');
  const [collapsedPhases, setCollapsedPhases] = useState<Set<string>>(new Set());
  const [showCriticalOnly, setShowCriticalOnly] = useState(false);
  const [obraConfig, setObraConfig] = useState<ObraConfig>(loadObraConfig);

  // Drag state
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const dragStartX = useRef(0);
  const dragStartLeft = useRef(0);
  const chartContainerRef = useRef<HTMLDivElement>(null);

  // Resize state
  const [resizingTaskId, setResizingTaskId] = useState<string | null>(null);
  const [resizeSide, setResizeSide] = useState<'left' | 'right' | null>(null);
  const [resizeDelta, setResizeDelta] = useState(0);
  const resizeStartX = useRef(0);

  // Local duration edit state
  const [editingDurationTaskId, setEditingDurationTaskId] = useState<string | null>(null);
  const [localDuration, setLocalDuration] = useState<string>('');

  // Real-time drag propagation: temporary task overrides during drag
  const [dragTempTasks, setDragTempTasks] = useState<Map<string, { startDate: string }>>(new Map());

  const tasks = getAllTasks(project);
  const criticalCount = tasks.filter(t => t.isCritical).length;
  const projectStart = new Date(Math.min(...tasks.map(t => parseISODateLocal(t.startDate).getTime())));
  const projectEnd = new Date(Math.max(...tasks.map(t => addDays(parseISODateLocal(t.startDate), Math.max(0, t.duration - 1)).getTime())));
  const totalDays = diffDays(projectStart, projectEnd) + 10;
  const dayWidth = DAY_WIDTH[viewMode];
  const chartWidth = totalDays * dayWidth;

  const today = new Date();
  const todayOffset = diffDays(projectStart, today);

  // Holiday map for the project range
  const feriadoMap = useMemo(() => {
    return getFeriadosMap(projectStart, projectEnd, obraConfig.uf, obraConfig.municipio);
  }, [projectStart, projectEnd, obraConfig.uf, obraConfig.municipio]);

  // Day info for visual highlighting
  const dayInfos = useMemo(() => {
    const infos: { date: Date; dow: number; feriado?: FeriadoInfo }[] = [];
    for (let i = 0; i < totalDays; i++) {
      const d = addDays(projectStart, i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      infos.push({ date: d, dow: d.getDay(), feriado: feriadoMap.get(key) });
    }
    return infos;
  }, [projectStart, totalDays, feriadoMap]);

  // Chapter business days
  const getChapterDiasUteis = useCallback((phase: typeof project.phases[0]) => {
    if (phase.tasks.length === 0) return { dias: 0, horas: 0 };
    const starts = phase.tasks.map(t => parseISODateLocal(t.startDate).getTime());
    const ends = phase.tasks.map(t => addDays(parseISODateLocal(t.startDate), Math.max(0, t.duration - 1)).getTime());
    const inicio = new Date(Math.min(...starts));
    const fim = new Date(Math.max(...ends));
    return calcularDiasUteis(inicio, fim, obraConfig.uf, obraConfig.municipio, obraConfig.trabalhaSabado, obraConfig.jornadaDiaria);
  }, [obraConfig]);

  const getPhaseRange = (phase: typeof project.phases[0]) => {
    if (phase.tasks.length === 0) return { start: '', end: '' };
    const starts = phase.tasks.map(t => parseISODateLocal(t.startDate).getTime());
    const ends = phase.tasks.map(t => addDays(parseISODateLocal(t.startDate), Math.max(0, t.duration - 1)).getTime());
    return {
      start: dateToISO(new Date(Math.min(...starts))),
      end: dateToISO(new Date(Math.max(...ends))),
    };
  };

  const togglePhase = (id: string) => {
    setCollapsedPhases(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

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

  const numberToTaskId = useMemo(() => {
    const map = new Map<number, string>();
    taskNumbering.forEach((num, id) => map.set(num, id));
    return map;
  }, [taskNumbering]);

  const flatTasks = useMemo(() => {
    const result: FlatTask[] = [];
    let rowIdx = 0;
    project.phases.forEach(phase => {
      rowIdx++;
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

  // Compute Y positions for dependency arrows (relative to bars area)
  const taskYPositions = useMemo(() => {
    const map = new Map<string, number>();
    const PHASE_HEADER_HEIGHT = ROW_HEIGHT + 20;
    let y = 0;
    project.phases.forEach(phase => {
      y += PHASE_HEADER_HEIGHT;
      if (!collapsedPhases.has(phase.id)) {
        phase.tasks
          .filter(t => !showCriticalOnly || t.isCritical)
          .forEach(task => {
            map.set(task.id, y + ROW_HEIGHT / 2);
            y += ROW_HEIGHT;
          });
      }
    });
    return map;
  }, [project, collapsedPhases, showCriticalOnly]);

  // Compute violation map for dependency arrows
  const violationMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    tasks.forEach(task => {
      const details = task.dependencyDetails || [];
      details.forEach(dep => {
        const pred = tasks.find(t => t.id === dep.taskId);
        if (!pred) return;
        const predStart = parseISODateLocal(pred.startDate);
        const predEnd = addDays(predStart, pred.duration);
        const taskStart = parseISODateLocal(task.startDate);
        const taskEnd = addDays(taskStart, task.duration);
        let violated = false;
        switch (dep.type) {
          case 'TI': violated = taskStart < predEnd; break;
          case 'II': violated = taskStart < predStart; break;
          case 'TT': violated = taskEnd < predEnd; break;
          case 'IT': violated = taskEnd < predStart; break;
        }
        if (violated) {
          if (!map.has(task.id)) map.set(task.id, new Set());
          map.get(task.id)!.add(dep.taskId);
        }
      });
    });
    return map;
  }, [tasks]);

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
    const start = diffDays(projectStart, parseISODateLocal(task.startDate));
    const width = task.duration * dayWidth;
    const isDelayed = addDays(parseISODateLocal(task.startDate), Math.max(0, task.duration - 1)) < today && task.percentComplete < 100;
    const isCritical = !!task.isCritical && !isDelayed && task.percentComplete < 100;
    const isComplete = task.percentComplete === 100;
    return { left: start * dayWidth, width, isDelayed, isCritical, isComplete };
  };

  // Helper: team production info for a task
  const getTaskTeamInfo = (task: Task) => {
    const totalWorkers = (task.laborCompositions || []).reduce((sum, c) => sum + (c.workerCount || 0), 0);
    const bottleneckComp = task.bottleneckRole
      ? (task.laborCompositions || []).find(c => c.role === task.bottleneckRole)
      : undefined;
    const mainRole = task.bottleneckRole || bottleneckComp?.role || task.responsible || 'Equipe';
    const mainWorkers = bottleneckComp ? bottleneckComp.workerCount : (totalWorkers || 0);
    const totalHours = task.totalHours || 0;
    const hoursPerDay = task.duration > 0 ? totalHours / task.duration : 0;
    return { mainRole, mainWorkers, totalWorkers, totalHours, hoursPerDay };
  };

  const formatTeamLabel = (task: Task) => {
    const info = getTaskTeamInfo(task);
    if (info.totalHours === 0 && info.mainWorkers === 0) return '';
    return `${info.mainRole} (${info.mainWorkers}) • ${Math.round(info.totalHours)}h • ${info.hoursPerDay.toFixed(1)}h/dia`;
  };

  const updateTask = useCallback((taskId: string, updates: Partial<Task>) => {
    if (!onProjectChange) return;
    const newProject = {
      ...project,
      phases: project.phases.map(phase => ({
        ...phase,
        tasks: phase.tasks.map(t => t.id === taskId ? { ...t, ...updates } : t),
      })),
    };
    onProjectChange(newProject);
  }, [project, onProjectChange]);

  const getViolations = useCallback((task: Task): string[] => {
    const violations: string[] = [];
    const details = task.dependencyDetails || [];
    details.forEach(dep => {
      const predTask = tasks.find(t => t.id === dep.taskId);
      if (!predTask) return;
      const predNum = taskNumbering.get(dep.taskId);
      const predStart = parseISODateLocal(predTask.startDate);
      const predEnd = addDays(predStart, predTask.duration);
      const taskStart = parseISODateLocal(task.startDate);
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

  const handleDateChange = (taskId: string, field: 'start' | 'end', date: Date | undefined) => {
    if (!date) return;
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    if (field === 'start') {
      if ((task.durationMode || 'manual') === 'manual') {
        // Manual mode: keep duration, shift end date
        updateTask(taskId, { startDate: dateToISO(date) });
      } else {
        // Inclusive end-date convention: end = start + duration - 1
        const oldEnd = addDays(parseISODateLocal(task.startDate), Math.max(0, task.duration - 1));
        const newDuration = Math.max(1, diffDays(date, oldEnd) + 1);
        updateTask(taskId, { startDate: dateToISO(date), duration: newDuration });
      }
    } else {
      const start = parseISODateLocal(task.startDate);
      // Inclusive end-date: chosen `date` is the last working day
      const newDuration = Math.max(1, diffDays(start, date) + 1);
      updateTask(taskId, { duration: newDuration, durationMode: 'manual' });
    }
    setTimeout(() => runPropagation(taskId), 0);
  };

  // Edit baseline (Plan) dates — respects RUP duration mode
  const handleBaselineDateChange = (taskId: string, field: 'start' | 'end', date: Date | undefined) => {
    if (!date || !onProjectChange) return;
    const task = tasks.find(t => t.id === taskId);
    if (!task || !task.baseline) return;

    const isRup = (task.durationMode || 'manual') === 'rup';
    const rupDuration = isRup ? calculateRupDuration(task, obraConfig).duration : task.baseline.duration;

    let newStart: Date;
    let newDuration: number;
    let newEnd: Date;

    if (field === 'start') {
      newStart = date;
      if (isRup) {
        newDuration = rupDuration;
        newEnd = addDays(newStart, newDuration);
      } else {
        // Manual: keep duration, shift end
        newDuration = task.baseline.duration;
        newEnd = addDays(newStart, newDuration);
      }
    } else {
      newEnd = date;
      if (isRup) {
        // RUP: keep duration, shift start backward
        newDuration = rupDuration;
        newStart = addDays(newEnd, -newDuration);
      } else {
        // Manual: keep start, recalc duration
        newStart = parseISODateLocal(task.baseline.startDate);
        newDuration = Math.max(1, diffDays(newStart, newEnd));
        newEnd = addDays(newStart, newDuration);
      }
    }

    const newBaseline = {
      ...task.baseline,
      startDate: dateToISO(newStart),
      duration: newDuration,
      endDate: dateToISO(newEnd),
      plannedDailyProduction: task.quantity && newDuration > 0 ? task.quantity / newDuration : task.baseline.plannedDailyProduction,
    };

    updateTask(taskId, { baseline: newBaseline });
  };
  const handleChapterDateChange = (phaseId: string, field: 'start' | 'end', date: Date | undefined) => {
    if (!date || !onProjectChange) return;
    const phase = project.phases.find(p => p.id === phaseId);
    if (!phase || phase.tasks.length === 0) return;

    const range = getPhaseRange(phase);
    const oldStart = new Date(range.start);
    const oldEnd = new Date(range.end);
    const oldSpan = diffDays(oldStart, oldEnd) || 1;

    let newStart: Date, newEnd: Date;
    if (field === 'start') {
      newStart = date;
      newEnd = oldEnd;
      if (newStart >= newEnd) newEnd = addDays(newStart, oldSpan);
    } else {
      newStart = oldStart;
      newEnd = date;
      if (newEnd <= newStart) newStart = addDays(newEnd, -oldSpan);
    }
    const newSpan = diffDays(newStart, newEnd) || 1;
    const ratio = newSpan / oldSpan;

    const newProject = {
      ...project,
      phases: project.phases.map(p => {
        if (p.id !== phaseId) return p;
        return {
          ...p,
          tasks: p.tasks.map(t => {
            const tStart = parseISODateLocal(t.startDate);
            const offsetFromOldStart = diffDays(oldStart, tStart);
            const newTaskStart = addDays(newStart, Math.round(offsetFromOldStart * ratio));
            const newDuration = Math.max(1, Math.round(t.duration * ratio));
            return { ...t, startDate: dateToISO(newTaskStart), duration: newDuration };
          }),
        };
      }),
    };
    onProjectChange(newProject);
  };

  // Central propagation helper that uses the engine from calculations.ts
  const runPropagation = useCallback((taskId: string, projectToUse?: Project) => {
    if (!onProjectChange) return;
    const proj = projectToUse || project;
    const allTasks = getAllTasks(proj);
    const result = propagateAllDependencies(allTasks, taskId);

    if (result.changed) {
      const newProject = {
        ...proj,
        phases: proj.phases.map(phase => ({
          ...phase,
          tasks: phase.tasks.map(t => {
            const updated = result.tasks.find(rt => rt.id === t.id);
            return updated || t;
          }),
        })),
      };
      onProjectChange(newProject);
      const types = Array.from(result.adjustedTypes).join(', ');
      toast.info(`Datas ajustadas automaticamente por dependência [${types}]`);
    }
  }, [project, onProjectChange]);

  // Compute temporary propagation for real-time drag preview
  const computeDragPropagation = useCallback((taskId: string, newStartDate: string) => {
    const allTasks = getAllTasks(project).map(t =>
      t.id === taskId ? { ...t, startDate: newStartDate } : t
    );
    const result = propagateAllDependencies(allTasks, taskId);
    const tempMap = new Map<string, { startDate: string }>();
    result.tasks.forEach(t => {
      if (t.id !== taskId) {
        tempMap.set(t.id, { startDate: t.startDate });
      }
    });
    return tempMap;
  }, [project]);

  const handleMouseDown = (e: React.MouseEvent, taskId: string, barLeft: number) => {
    e.preventDefault();
    setDraggingTaskId(taskId);
    dragStartX.current = e.clientX;
    dragStartLeft.current = barLeft;
    setDragOffset(0);
    setDragTempTasks(new Map());

    const handleMove = (ev: MouseEvent) => {
      const dx = ev.clientX - dragStartX.current;
      setDragOffset(dx);

      // Real-time propagation preview
      const daysMoved = Math.round(dx / dayWidth);
      const task = tasks.find(t => t.id === taskId);
      if (task) {
        const newStart = addDays(parseISODateLocal(task.startDate), daysMoved);
        const tempMap = computeDragPropagation(taskId, dateToISO(newStart));
        setDragTempTasks(tempMap);
      }
    };
    const handleUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      const dx = ev.clientX - dragStartX.current;
      const daysMoved = Math.round(dx / dayWidth);
      if (daysMoved !== 0) {
        const task = tasks.find(t => t.id === taskId);
        if (task) {
          const newStart = addDays(parseISODateLocal(task.startDate), daysMoved);
          const newStartISO = dateToISO(newStart);

          // Check precedence violation (if this task is a successor)
          const violation = checkDependencyViolation(task, newStartISO, tasks);
          if (violation) {
            toast.error(`Não é possível: a tarefa depende do término da tarefa "${violation.predName}" (${violation.type})`, {
              action: {
                label: 'Forçar mesmo assim',
                onClick: () => {
                  // Remove the violating dependency and move
                  const newDetails = (task.dependencyDetails || []).filter(d => d.taskId !== violation.predId);
                  const newDeps = newDetails.map(d => d.taskId);
                  const updatedProject = {
                    ...project,
                    phases: project.phases.map(phase => ({
                      ...phase,
                      tasks: phase.tasks.map(t => t.id === taskId
                        ? { ...t, startDate: newStartISO, dependencies: newDeps, dependencyDetails: newDetails }
                        : t),
                    })),
                  };
                  onProjectChange?.(updatedProject);
                  toast.info('Dependência removida e tarefa movida');
                },
              },
            });
          } else {
            // Apply the move and propagate
            const updatedProject = {
              ...project,
              phases: project.phases.map(phase => ({
                ...phase,
                tasks: phase.tasks.map(t => t.id === taskId ? { ...t, startDate: newStartISO } : t),
              })),
            };
            onProjectChange?.(updatedProject);
            setTimeout(() => runPropagation(taskId, updatedProject), 0);
          }
        }
      }
      setDraggingTaskId(null);
      setDragOffset(0);
      setDragTempTasks(new Map());
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  };

  const handleDepChange = (taskId: string, value: string) => {
    if (!onProjectChange) return;
    const nums = value.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const existingDetails = task.dependencyDetails || [];
    const existingByTaskId = new Map(existingDetails.map(d => [d.taskId, d.type]));
    const deps: TaskDependency[] = nums.map(num => {
      const depTaskId = numberToTaskId.get(num);
      if (!depTaskId) return null;
      return { taskId: depTaskId, type: existingByTaskId.get(depTaskId) || 'TI' };
    }).filter(Boolean) as TaskDependency[];
    const updatedProject = {
      ...project,
      phases: project.phases.map(phase => ({
        ...phase,
        tasks: phase.tasks.map(t => t.id === taskId
          ? { ...t, dependencies: deps.map(d => d.taskId), dependencyDetails: deps }
          : t),
      })),
    };
    onProjectChange(updatedProject);
    setTimeout(() => runPropagation(taskId, updatedProject), 0);
  };

  const handleDepTypeChange = (taskId: string, depIndex: number, newType: DependencyType) => {
    if (!onProjectChange) return;
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const details = [...(task.dependencyDetails || [])];
    if (depIndex < details.length) {
      details[depIndex] = { ...details[depIndex], type: newType };
      const updatedProject = {
        ...project,
        phases: project.phases.map(phase => ({
          ...phase,
          tasks: phase.tasks.map(t => t.id === taskId
            ? { ...t, dependencies: details.map(d => d.taskId), dependencyDetails: details }
            : t),
        })),
      };
      onProjectChange(updatedProject);
      setTimeout(() => runPropagation(taskId, updatedProject), 0);
    }
  };

  const getDepDisplay = (task: Task): string => {
    return (task.dependencyDetails || []).map(d => {
      const num = taskNumbering.get(d.taskId);
      return num ? String(num) : '';
    }).filter(Boolean).join(', ');
  };

  const getDepTypes = (task: Task) => {
    return (task.dependencyDetails || []).map(d => ({
      taskId: d.taskId, type: d.type, num: taskNumbering.get(d.taskId) || 0,
    })).filter(d => d.num > 0);
  };

  const headerHeightPx = viewMode === 'weeks' ? 52 : 32;

  const getDragDate = (task: Task) => {
    if (draggingTaskId !== task.id) return null;
    const daysMoved = Math.round(dragOffset / dayWidth);
    const newStart = addDays(parseISODateLocal(task.startDate), daysMoved);
    const newEnd = addDays(newStart, Math.max(0, task.duration - 1));
    return { start: formatDateFull(dateToISO(newStart)), end: formatDateFull(dateToISO(newEnd)) };
  };

  // Check if task has zero working days
  const hasNoWorkingDays = useCallback((task: Task) => {
    const start = parseISODateLocal(task.startDate);
    const end = addDays(start, task.duration);
    const result = calcularDiasUteis(start, end, obraConfig.uf, obraConfig.municipio, obraConfig.trabalhaSabado, obraConfig.jornadaDiaria);
    return result.dias === 0;
  }, [obraConfig]);

  const sidebarCols = '24px 1fr 58px 20px 88px 88px 48px 48px 48px 56px';
  const sidebarWidth = 620;

  // Toggle duration mode and recalculate if switching to RUP
  const toggleDurationMode = (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const currentMode = task.durationMode || 'manual';
    const newMode = currentMode === 'manual' ? 'rup' : 'manual';
    const updates: Partial<Task> = { durationMode: newMode };
    if (newMode === 'rup' && task.laborCompositions?.length && task.quantity) {
      const { duration, totalHours, bottleneckRole } = calculateRupDuration(task, obraConfig);
      updates.duration = duration;
      updates.totalHours = totalHours;
      updates.bottleneckRole = bottleneckRole;
      updates.calculatedDuration = duration;
    }
    updateTask(taskId, updates);
  };

  const handleManualDurationChange = (taskId: string, value: number) => {
    if (value < 1) return;
    const updatedProject = {
      ...project,
      phases: project.phases.map(phase => ({
        ...phase,
        tasks: phase.tasks.map(t => t.id === taskId
          ? { ...t, duration: value, durationMode: 'manual' as const, isManual: true, manualDuration: value }
          : t),
      })),
    };
    onProjectChange?.(updatedProject);
    setTimeout(() => runPropagation(taskId, updatedProject), 0);
  };

  // Resize handlers
  const handleResizeMouseDown = (e: React.MouseEvent, taskId: string, side: 'left' | 'right') => {
    e.preventDefault();
    e.stopPropagation();
    setResizingTaskId(taskId);
    setResizeSide(side);
    setResizeDelta(0);
    resizeStartX.current = e.clientX;

    const handleMove = (ev: MouseEvent) => {
      setResizeDelta(ev.clientX - resizeStartX.current);
    };
    const handleUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      const dx = ev.clientX - resizeStartX.current;
      const daysDelta = Math.round(dx / dayWidth);
      const task = tasks.find(t => t.id === taskId);
      if (task && daysDelta !== 0) {
        let updates: Partial<Task>;
        if (side === 'right') {
          const newDuration = Math.max(1, task.duration + daysDelta);
          updates = { duration: newDuration, durationMode: 'manual', isManual: true, manualDuration: newDuration };
        } else {
          const newDuration = Math.max(1, task.duration - daysDelta);
          const newStart = addDays(parseISODateLocal(task.startDate), daysDelta);
          updates = { startDate: dateToISO(newStart), duration: newDuration, durationMode: 'manual', isManual: true, manualDuration: newDuration };
        }
        const updatedProject = {
          ...project,
          phases: project.phases.map(phase => ({
            ...phase,
            tasks: phase.tasks.map(t => t.id === taskId ? { ...t, ...updates } : t),
          })),
        };
        onProjectChange?.(updatedProject);
        setTimeout(() => runPropagation(taskId, updatedProject), 0);
      }
      setResizingTaskId(null);
      setResizeSide(null);
      setResizeDelta(0);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  };

  // Helper: get 3 first words of a name
  const getShortLabel = (name: string) => {
    const words = name.split(/\s+/);
    return words.length > 3 ? words.slice(0, 3).join(' ') + '…' : name;
  };

  // Get chapter bar info for milestones
  const getChapterBarInfo = (phase: typeof project.phases[0]) => {
    if (phase.tasks.length === 0) return null;
    const starts = phase.tasks.map(t => parseISODateLocal(t.startDate).getTime());
    const ends = phase.tasks.map(t => addDays(parseISODateLocal(t.startDate), t.duration).getTime());
    const minStart = new Date(Math.min(...starts));
    const maxEnd = new Date(Math.max(...ends));
    const left = diffDays(projectStart, minStart) * dayWidth;
    const right = diffDays(projectStart, maxEnd) * dayWidth;
    return { left, right, width: Math.max(dayWidth, right - left) };
  };

  // Get day column background color
  const getDayBg = (dayIndex: number): string | undefined => {
    if (dayIndex < 0 || dayIndex >= dayInfos.length) return undefined;
    const info = dayInfos[dayIndex];
    if (info.feriado) {
      return info.feriado.tipo === 'nacional'
        ? 'hsl(var(--gantt-holiday-national))'
        : 'hsl(var(--gantt-holiday-local))';
    }
    if (info.dow === 0) return 'hsl(var(--gantt-sunday))';
    if (info.dow === 6) return 'hsl(var(--gantt-saturday))';
    return undefined;
  };

  return (
    <TooltipProvider>
      <div className="p-4 space-y-3">
        {/* Toolbar */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-lg font-bold text-foreground">Cronograma</h2>
            <p className="text-[10px] text-muted-foreground">Gantt Interativo com CPM</p>
          </div>
          <div className="flex items-center gap-2">
            <ConfiguracaoObra config={obraConfig} onConfigChange={setObraConfig} />
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
          <div className="flex items-center gap-2 mr-2 border-r border-border pr-3">
            <span className="font-medium">Elementos:</span>
            <div className="flex items-center gap-1"><div className="w-4 h-2 rounded" style={{ background: 'hsl(var(--gantt-bar))', border: '1px solid hsl(var(--gantt-bar))' }} /> <span>Planejado — cor da equipe ou status</span></div>
          </div>
          <div className="flex items-center gap-3 ml-2 border-l border-border pl-3">
            <span className="font-medium">Dep:</span>
            <span style={{ color: '#378ADD' }}>TI</span>
            <span style={{ color: '#1D9E75' }}>II</span>
            <span style={{ color: '#BA7517' }}>TT</span>
            <span style={{ color: '#A32D2D' }}>IT</span>
          </div>
          <div className="flex items-center gap-2 ml-2 border-l border-border pl-3">
            <div className="w-3 h-3 rounded" style={{ background: 'hsl(var(--gantt-sunday))' }} /><span>Dom</span>
            <div className="w-3 h-3 rounded" style={{ background: 'hsl(var(--gantt-saturday))' }} /><span>Sáb</span>
            <div className="w-3 h-3 rounded" style={{ background: 'hsl(var(--gantt-holiday-national))' }} /><span>Feriado Nac.</span>
            <div className="w-3 h-3 rounded" style={{ background: 'hsl(var(--gantt-holiday-local))' }} /><span>Feriado Local</span>
          </div>
          <div className="flex items-center gap-3 text-[9px] text-muted-foreground flex-wrap">
            <span className="font-medium">Equipes:</span>
            {TEAM_CODES.map(code => {
              const def = TEAM_DEFINITIONS[code];
              return (
                <div key={code} className="flex items-center gap-1">
                  <div className="w-3 h-1.5 rounded-full" style={{ background: def.bgColor, border: `1px solid ${def.borderColor}` }} />
                  <span>{def.label}</span>
                  <span className="text-muted-foreground/70">({def.composition})</span>
                </div>
              );
            })}
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
                <span className="text-[8px] font-semibold text-muted-foreground uppercase tracking-wider text-center" title="Modo: RUP ou Manual">M</span>
                <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider text-center">Início</span>
                <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider text-center">Fim</span>
                <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider text-center" title="Percentual concluído">% Concl.</span>
                <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider text-center">Dep</span>
                <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider text-center">Tipo</span>
                <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider text-center">Equipe</span>
              </div>

              {/* Rows */}
              {project.phases.map(phase => {
                const phaseRange = getPhaseRange(phase);
                const diasUteis = getChapterDiasUteis(phase);

                return (
                  <div key={phase.id}>
                    {/* Phase header with dates */}
                    <div className="border-b border-border bg-muted/60">
                      <button
                        onClick={() => togglePhase(phase.id)}
                        className="w-full flex items-center gap-1.5 px-2 hover:bg-muted transition-colors"
                        style={{ height: ROW_HEIGHT }}
                      >
                        {collapsedPhases.has(phase.id) ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        <span className="text-[11px] font-bold text-foreground truncate">{phase.name}</span>
                        <span className="text-[9px] text-muted-foreground ml-auto">{phase.tasks.length}</span>
                      </button>
                      {/* Chapter dates row */}
                      <div className="flex items-center gap-2 px-2 pb-1 text-[9px]">
                        <Popover>
                          <PopoverTrigger asChild>
                            <button className="text-muted-foreground hover:text-primary transition-colors">
                              Início: <span className="font-medium text-foreground">{phaseRange.start ? formatDateFull(phaseRange.start) : '—'}</span>
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={phaseRange.start ? new Date(phaseRange.start) : undefined}
                              onSelect={(d) => handleChapterDateChange(phase.id, 'start', d)}
                              className={cn("p-3 pointer-events-auto")}
                            />
                          </PopoverContent>
                        </Popover>
                        <Popover>
                          <PopoverTrigger asChild>
                            <button className="text-muted-foreground hover:text-primary transition-colors">
                              Fim: <span className="font-medium text-foreground">{phaseRange.end ? formatDateFull(phaseRange.end) : '—'}</span>
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={phaseRange.end ? new Date(phaseRange.end) : undefined}
                              onSelect={(d) => handleChapterDateChange(phase.id, 'end', d)}
                              className={cn("p-3 pointer-events-auto")}
                            />
                          </PopoverContent>
                        </Popover>
                        <span className="text-muted-foreground ml-auto flex items-center gap-2">
                          {(() => {
                            const items = phase.tasks;
                            if (items.length === 0) return null;
                            const totalDur = items.reduce((s, t) => s + Math.max(1, t.duration), 0) || 1;
                            const weighted = items.reduce((s, t) => s + (t.physicalProgress ?? t.percentComplete ?? 0) * Math.max(1, t.duration), 0);
                            const pct = Math.round(weighted / totalDur);
                            return (
                              <span className="font-bold" style={{ color: pct >= 100 ? '#166534' : '#1e40af' }} title="Percentual concluído do capítulo (média ponderada por duração)">
                                {pct}%
                              </span>
                            );
                          })()}
                          <span><span className="font-medium text-foreground">{diasUteis.dias}d</span> / <span className="font-medium text-foreground">{diasUteis.horas}h</span> úteis</span>
                        </span>
                      </div>
                    </div>
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
                          const noWorkDays = hasNoWorkingDays(task);

                          const rowTeamDef = getTeamDefinition(task.team);
                          return (
                            <div
                              key={task.id}
                              className={`grid items-center gap-0.5 px-1 border-b border-border hover:brightness-110 transition-colors ${
                                !rowTeamDef ? (idx % 2 === 0 ? 'bg-card' : 'bg-muted/10') : ''
                              } ${task.isCritical && !rowTeamDef ? 'bg-destructive/5' : ''} ${noWorkDays && !rowTeamDef ? 'bg-warning/10' : ''}`}
                              style={{
                                height: ROW_HEIGHT,
                                gridTemplateColumns: sidebarCols,
                                ...(rowTeamDef ? {
                                  backgroundColor: rowTeamDef.bgColor,
                                  color: rowTeamDef.textColor,
                                } : {}),
                              }}
                            >
                              <div className="text-center">
                                <span className={`text-[9px] font-mono ${rowTeamDef ? 'opacity-70' : 'text-muted-foreground'}`}>{taskNum}</span>
                              </div>
                              <div className="min-w-0 flex items-center gap-1 pl-1">
                                {task.isCritical && <div className="w-1.5 h-1.5 rounded-full bg-destructive flex-shrink-0" />}
                                {hasViolation && <AlertTriangle className="w-3 h-3 flex-shrink-0" style={{ color: 'hsl(0, 75%, 38%)', filter: 'drop-shadow(0 0 1px white)' }} />}
                                {noWorkDays && <AlertTriangle className="w-3 h-3 flex-shrink-0" style={{ color: '#b45309', filter: 'drop-shadow(0 0 1px white)' }} />}
                                <p className={`text-[11px] font-medium line-clamp-2 break-words leading-tight ${rowTeamDef ? '' : 'text-foreground'}`}>{task.name}</p>
                              </div>
                              <div className="text-center relative">
                                <input
                                  className={`w-full text-[10px] font-bold bg-transparent text-left pl-1 pr-3.5 focus:outline-none focus:ring-1 focus:ring-primary rounded ${
                                    rowTeamDef ? '' : ((task.durationMode || 'manual') === 'rup' ? 'text-primary' : 'text-foreground')
                                  }`}
                                  style={rowTeamDef ? { color: rowTeamDef.textColor } : undefined}
                                  value={editingDurationTaskId === task.id ? localDuration : task.duration}
                                  type="number"
                                  min={1}
                                  onFocus={() => {
                                    setEditingDurationTaskId(task.id);
                                    setLocalDuration(String(task.duration));
                                  }}
                                  onChange={(e) => {
                                    setLocalDuration(e.target.value);
                                    // Live preview: update bar width in real-time
                                    const val = parseInt(e.target.value);
                                    if (!isNaN(val) && val >= 1) {
                                      handleManualDurationChange(task.id, val);
                                    }
                                  }}
                                  onBlur={() => {
                                    const val = parseInt(localDuration);
                                    if (!isNaN(val) && val >= 1) {
                                      handleManualDurationChange(task.id, val);
                                    }
                                    setEditingDurationTaskId(null);
                                  }}
                                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                  title={(task.durationMode || 'manual') === 'rup'
                                    ? `RUP: ${task.bottleneckRole || '—'} — edite para desvincular`
                                    : 'Duração manual (dias)'}
                                />
                                <span
                                  className="absolute right-1 top-1/2 -translate-y-1/2 text-[9px] font-semibold opacity-70 pointer-events-none"
                                  style={rowTeamDef ? { color: rowTeamDef.textColor } : undefined}
                                >d</span>
                              </div>
                              <div className="text-center">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      onClick={() => toggleDurationMode(task.id)}
                                      className={`text-[8px] font-bold rounded px-0.5 py-0 transition-colors ${
                                        rowTeamDef
                                          ? 'bg-white/20'
                                          : ((task.durationMode || 'manual') === 'rup'
                                            ? 'bg-primary/20 text-primary'
                                            : 'bg-muted text-muted-foreground hover:text-foreground')
                                      }`}
                                      title={(task.durationMode || 'manual') === 'rup' ? 'Modo RUP (clique para manual)' : 'Modo Manual (clique para RUP)'}
                                    >
                                      {(task.durationMode || 'manual') === 'rup' ? 'R' : 'M'}
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p className="text-xs">
                                      {(task.durationMode || 'manual') === 'rup'
                                        ? 'Duração via RUP — clique para editar manualmente'
                                        : 'Duração manual — clique para calcular via RUP'}
                                    </p>
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                              <div className="flex flex-col gap-0.5">
                                {(() => {
                                  const hasLogs = (task.dailyLogs?.length ?? 0) > 0;
                                  const hasRealData = (task.dailyLogs || []).some(l => (l.actualQuantity ?? 0) > 0) && !!task.current?.startDate;
                                  const startNonUtil = !isDiaUtil(parseISODateLocal(task.startDate), obraConfig.uf, obraConfig.municipio, obraConfig.trabalhaSabado);
                                  const labelEl = (
                                    <span className={`text-[9px] ${rowTeamDef ? '' : 'text-foreground'} font-medium inline-flex items-center justify-center gap-0.5`}>
                                      {startNonUtil && <AlertTriangle className="w-2.5 h-2.5 flex-shrink-0" style={{ color: '#b45309', filter: 'drop-shadow(0 0 1px white)' }} aria-label="Início em dia não útil" />}
                                      {formatDateFull(task.startDate)}
                                    </span>
                                  );
                                  const realLine = hasRealData ? (
                                    <span
                                      className="text-[9px] font-medium leading-none"
                                      style={{ color: '#1e40af', filter: 'drop-shadow(0 0 1px white)' }}
                                    >
                                      Real: {formatDateFull(task.current!.startDate)}
                                    </span>
                                  ) : null;
                                  if (hasLogs) {
                                    return (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <button disabled className="text-center w-full leading-tight cursor-not-allowed opacity-90 flex flex-col items-center gap-0.5">
                                            {labelEl}
                                            {realLine}
                                          </button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          <p className="text-xs">Datas reais vêm do apontamento diário</p>
                                        </TooltipContent>
                                      </Tooltip>
                                    );
                                  }
                                  return (
                                    <Popover>
                                      <PopoverTrigger asChild>
                                        <button className={`text-center w-full leading-tight transition-colors ${rowTeamDef ? 'hover:opacity-70' : 'hover:text-primary'}`}>
                                          {labelEl}
                                        </button>
                                      </PopoverTrigger>
                                      <PopoverContent className="w-auto p-0" align="start">
                                        <Calendar
                                          mode="single"
                                          selected={parseISODateLocal(task.startDate)}
                                          onSelect={(d) => handleDateChange(task.id, 'start', d)}
                                          className={cn("p-3 pointer-events-auto")}
                                        />
                                      </PopoverContent>
                                    </Popover>
                                  );
                                })()}
                              </div>
                              <div className="flex flex-col gap-0.5">
                                {(() => {
                                  const hasLogs = (task.dailyLogs?.length ?? 0) > 0;
                                  const hasRealData = (task.dailyLogs || []).some(l => (l.actualQuantity ?? 0) > 0) && !!task.current?.startDate;
                                  const endNonUtil = !isDiaUtil(parseISODateLocal(endDate), obraConfig.uf, obraConfig.municipio, obraConfig.trabalhaSabado);
                                  const labelEl = (
                                    <span className={`text-[9px] ${rowTeamDef ? '' : 'text-foreground'} font-medium inline-flex items-center justify-center gap-0.5`}>
                                      {endNonUtil && <AlertTriangle className="w-2.5 h-2.5 flex-shrink-0" style={{ color: '#b45309', filter: 'drop-shadow(0 0 1px white)' }} aria-label="Fim em dia não útil" />}
                                      {formatDateFull(endDate)}
                                    </span>
                                  );
                                  const previsto = task.current?.forecastEndDate || task.current?.endDate;
                                  const isLate = !!previsto && previsto > endDate;
                                  const prevLine = hasRealData && previsto ? (
                                    <span
                                      className="text-[9px] font-medium leading-none"
                                      style={{
                                        color: isLate ? '#991b1b' : '#166534',
                                        filter: 'drop-shadow(0 0 1px white)',
                                      }}
                                    >
                                      Prev: {formatDateFull(previsto)}
                                    </span>
                                  ) : null;
                                  if (hasLogs) {
                                    return (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <button disabled className="text-center w-full leading-tight cursor-not-allowed opacity-90 flex flex-col items-center gap-0.5">
                                            {labelEl}
                                            {prevLine}
                                          </button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          <p className="text-xs">Datas reais vêm do apontamento diário</p>
                                        </TooltipContent>
                                      </Tooltip>
                                    );
                                  }
                                  return (
                                    <Popover>
                                      <PopoverTrigger asChild>
                                        <button className={`text-center w-full leading-tight transition-colors ${rowTeamDef ? 'hover:opacity-70' : 'hover:text-primary'}`}>
                                          {labelEl}
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
                                  );
                                })()}
                              </div>
                              {/* % Concluído */}
                              <div className="text-center">
                                {(() => {
                                  const pct = Math.round(task.physicalProgress ?? task.percentComplete ?? 0);
                                  // Esperado pelo tempo decorrido
                                  const start = parseISODateLocal(task.startDate);
                                  const totalDays = Math.max(1, task.duration);
                                  const elapsed = Math.max(0, Math.min(totalDays, diffDays(start, today) + 1));
                                  const expected = Math.round((elapsed / totalDays) * 100);
                                  const hasData = (task.percentComplete ?? 0) > 0 || (task.physicalProgress ?? 0) > 0 || (task.dailyLogs?.length ?? 0) > 0;
                                  const color = !hasData
                                    ? '#6b7280'
                                    : pct >= expected ? '#166534' : '#991b1b';
                                  return (
                                    <span
                                      className="text-[10px] font-bold"
                                      style={{ color, filter: 'drop-shadow(0 0 1px white)' }}
                                      title={`Concluído: ${pct}% • Esperado: ${expected}%`}
                                    >
                                      {pct}%
                                    </span>
                                  );
                                })()}
                              </div>
                              <div className="text-center">
                                <input
                                  className={`w-full text-[9px] bg-transparent border-b border-border/50 text-center focus:outline-none focus:border-primary ${rowTeamDef ? 'opacity-80' : 'text-muted-foreground'}`}
                                  style={rowTeamDef ? { color: rowTeamDef.textColor } : undefined}
                                  defaultValue={depDisplay}
                                  key={depDisplay}
                                  placeholder="—"
                                  onBlur={(e) => handleDepChange(task.id, e.target.value)}
                                  title="Nº da tarefa predecessora (ex: 3, 7)"
                                />
                              </div>
                              <div className="text-center">
                                {depTypes.length > 0 ? (
                                  <Select
                                    value={depTypes[0].type}
                                    onValueChange={(val) => handleDepTypeChange(task.id, 0, val as DependencyType)}
                                  >
                                    <SelectTrigger className="h-5 min-h-0 px-1 py-0 text-[9px] border-border/50 bg-transparent" style={rowTeamDef ? { color: rowTeamDef.textColor } : undefined}>
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
                                  <span className={`text-[9px] ${rowTeamDef ? 'opacity-60' : 'text-muted-foreground'}`}>—</span>
                                )}
                              </div>
                              <div className="text-center">
                                <Select
                                  value={task.team || '_none'}
                                  onValueChange={(val) => {
                                    const newTeam = val === '_none' ? undefined : val as TeamCode;
                                    const updated = { ...project };
                                    updated.phases = updated.phases.map(p => ({
                                      ...p,
                                      tasks: p.tasks.map(t => t.id === task.id ? { ...t, team: newTeam } : t)
                                    }));
                                    onProjectChange(updated);
                                  }}
                                >
                                  <SelectTrigger className="h-5 min-h-0 px-1 py-0 text-[9px] border-border/50 bg-transparent" style={rowTeamDef ? { color: rowTeamDef.textColor } : undefined}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="_none" className="text-[10px]">—</SelectItem>
                                    {TEAM_CODES.map(code => {
                                      const def = TEAM_DEFINITIONS[code];
                                      return (
                                        <SelectItem key={code} value={code} className="text-[10px]">
                                          <span className="flex items-center gap-1">
                                            <span className="w-2 h-2 rounded-full inline-block flex-shrink-0" style={{ background: def.bgColor, border: `1px solid ${def.borderColor}` }} />
                                            {def.label}
                                          </span>
                                        </SelectItem>
                                      );
                                    })}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          );
                        })}
                  </div>
                );
              })}
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
                  {/* Day column backgrounds for holidays/weekends (only in day view for performance) */}
                  {viewMode === 'days' && dayInfos.map((info, i) => {
                    const bg = getDayBg(i);
                    if (!bg) return null;
                    return (
                      <Tooltip key={`bg-${i}`}>
                        <TooltipTrigger asChild>
                          <div
                            className="absolute top-0 bottom-0"
                            style={{ left: i * dayWidth, width: dayWidth, background: bg, zIndex: 1 }}
                          />
                        </TooltipTrigger>
                        {info.feriado && (
                          <TooltipContent>
                            <p className="text-xs font-medium">{info.feriado.nome}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {info.feriado.tipo === 'nacional' ? 'Feriado Nacional' : info.feriado.tipo === 'estadual' ? 'Feriado Estadual' : 'Feriado Municipal'}
                            </p>
                          </TooltipContent>
                        )}
                      </Tooltip>
                    );
                  })}

                  {/* Holiday indicators in header (days view) */}
                  {viewMode === 'days' && dayInfos.map((info, i) => {
                    if (!info.feriado) return null;
                    return (
                      <div
                        key={`flag-${i}`}
                        className="absolute flex items-center justify-center z-10"
                        style={{ left: i * dayWidth, width: dayWidth, top: -headerHeightPx + 4, height: 16 }}
                      >
                        <Flag className="w-2.5 h-2.5" style={{ color: info.feriado.tipo === 'nacional' ? 'hsl(var(--accent))' : 'hsl(280, 50%, 60%)' }} />
                      </div>
                    );
                  })}

                  {/* Today line */}
                  {todayOffset >= 0 && todayOffset <= totalDays && (
                    <div className="absolute top-0 bottom-0 w-px bg-gantt-today z-20" style={{ left: todayOffset * dayWidth }}>
                      <div className="absolute -top-0 -left-1 w-2.5 h-2.5 rounded-full bg-gantt-today" />
                    </div>
                  )}

                  {/* Vertical grid lines */}
                  {headerDates.map((d, i) => (
                    <div
                      key={i}
                      className="absolute top-0 bottom-0 border-r border-dashed"
                      style={{ left: d.offset + d.width, borderColor: 'hsl(var(--gantt-grid))' }}
                    />
                  ))}

                  {/* Dependency arrows */}
                  {(() => {
                    // During drag, provide tasks with temporary positions for arrows
                    let arrowTasks = tasks;
                    if (draggingTaskId && (dragOffset !== 0 || dragTempTasks.size > 0)) {
                      const daysMoved = Math.round(dragOffset / dayWidth);
                      arrowTasks = tasks.map(t => {
                        if (t.id === draggingTaskId) {
                          const newStart = addDays(parseISODateLocal(t.startDate), daysMoved);
                          return { ...t, startDate: dateToISO(newStart) };
                        }
                        const temp = dragTempTasks.get(t.id);
                        if (temp) return { ...t, startDate: temp.startDate };
                        return t;
                      });
                    }
                    return (
                      <DependencyArrows
                        tasks={arrowTasks}
                        taskYPositions={taskYPositions}
                        projectStart={projectStart}
                        dayWidth={dayWidth}
                        violations={violationMap}
                      />
                    );
                  })()}

                  {project.phases.map(phase => (
                    <div key={phase.id}>
                      {/* Phase header row with milestone markers */}
                      <div className="border-b border-border bg-muted/30 relative" style={{ height: ROW_HEIGHT + 20 }}>
                        {(() => {
                          const chapterBar = getChapterBarInfo(phase);
                          if (!chapterBar) return null;
                          const diamondSize = 10;
                          const midY = (ROW_HEIGHT + 20) / 2;
                          return (
                            <>
                              {/* Chapter span line */}
                              <div
                                className="absolute"
                                style={{
                                  left: chapterBar.left,
                                  width: chapterBar.width,
                                  top: midY - 1,
                                  height: 2,
                                  background: phase.color || 'hsl(var(--primary))',
                                  opacity: 0.5,
                                  zIndex: 5,
                                }}
                              />
                              {/* Start milestone diamond */}
                              <div
                                className="absolute z-10"
                                style={{
                                  left: chapterBar.left - diamondSize / 2,
                                  top: midY - diamondSize / 2,
                                  width: diamondSize,
                                  height: diamondSize,
                                  background: phase.color || 'hsl(var(--primary))',
                                  transform: 'rotate(45deg)',
                                  borderRadius: 2,
                                }}
                                title={`Início: ${getPhaseRange(phase).start ? formatDateFull(getPhaseRange(phase).start) : '—'}`}
                              />
                              {/* End milestone diamond */}
                              <div
                                className="absolute z-10"
                                style={{
                                  left: chapterBar.right - diamondSize / 2,
                                  top: midY - diamondSize / 2,
                                  width: diamondSize,
                                  height: diamondSize,
                                  background: phase.color || 'hsl(var(--primary))',
                                  transform: 'rotate(45deg)',
                                  borderRadius: 2,
                                }}
                                title={`Fim: ${getPhaseRange(phase).end ? formatDateFull(getPhaseRange(phase).end) : '—'}`}
                              />
                              {/* Chapter name label */}
                              <div
                                className="absolute text-[9px] font-bold z-10 whitespace-nowrap"
                                style={{
                                  left: chapterBar.left + diamondSize + 4,
                                  top: midY - 14,
                                  color: phase.color || 'hsl(var(--primary))',
                                }}
                              >
                                {phase.name}
                              </div>
                            </>
                          );
                        })()}
                      </div>
                      {!collapsedPhases.has(phase.id) &&
                        phase.tasks
                          .filter(t => !showCriticalOnly || t.isCritical)
                          .map((task, idx) => {
                            const bar = getBarStyle(task);
                            const isDragging = draggingTaskId === task.id;
                            const isResizing = resizingTaskId === task.id;
                            const violations = getViolations(task);
                            const hasViolation = violations.length > 0;
                            const noWorkDays = hasNoWorkingDays(task);

                            // Compute current bar position with drag/resize/propagation
                            let currentLeft = bar.left;
                            let currentWidth = bar.width;
                            const isDragPropagated = dragTempTasks.has(task.id);
                            if (isDragging) {
                              currentLeft = bar.left + dragOffset;
                            } else if (isResizing) {
                              if (resizeSide === 'right') {
                                currentWidth = Math.max(dayWidth, bar.width + resizeDelta);
                              } else if (resizeSide === 'left') {
                                const delta = Math.min(resizeDelta, bar.width - dayWidth);
                                currentLeft = bar.left + delta;
                                currentWidth = bar.width - delta;
                              }
                            } else if (isDragPropagated) {
                              // Real-time propagation: move successor bar
                              const tempData = dragTempTasks.get(task.id)!;
                              const tempStart = diffDays(projectStart, parseISODateLocal(tempData.startDate));
                              currentLeft = tempStart * dayWidth;
                            }

                            const dragDate = getDragDate(task);

                            // Resize tooltip info
                            const getResizeInfo = () => {
                              if (!isResizing) return null;
                              const newDuration = Math.max(1, Math.round(currentWidth / dayWidth));
                              const newStart = addDays(projectStart, Math.round(currentLeft / dayWidth));
                              const newEnd = addDays(newStart, Math.max(0, newDuration - 1));
                              return {
                                start: formatDateFull(dateToISO(newStart)),
                                end: formatDateFull(dateToISO(newEnd)),
                                duration: newDuration,
                              };
                            };
                            const resizeInfo = getResizeInfo();

                            return (
                              <div
                                key={task.id}
                                className={`border-b border-border relative ${idx % 2 === 0 ? 'bg-card' : 'bg-muted/10'}`}
                                style={{ height: ROW_HEIGHT }}
                              >
                                {/* Barra planejada = task.startDate + task.duration (Manual ou RUP) */}
                                {(() => {
                                  const barLeft = currentLeft;
                                  const barWidth = currentWidth;
                                  return (
                                <div
                                  className={`absolute rounded-md ${hasViolation ? 'animate-pulse ring-2 ring-destructive' : ''} ${noWorkDays ? 'ring-2 ring-warning' : ''}`}
                                  style={{
                                    left: barLeft,
                                    width: barWidth,
                                    top: 9,
                                    height: 20,
                                    borderRadius: 6,
                                    background: (() => {
                                      const teamDef = getTeamDefinition(task.team);
                                      if (teamDef) return teamDef.barColor;
                                      if (bar.isDelayed) return 'hsl(var(--gantt-bar-delayed))';
                                      if (bar.isComplete) return 'hsl(var(--gantt-bar-complete))';
                                      if (bar.isCritical) return 'hsl(var(--gantt-critical))';
                                      return 'hsl(var(--gantt-bar))';
                                    })(),
                                    border: (() => {
                                      const teamDef = getTeamDefinition(task.team);
                                      return teamDef ? `1.5px solid ${teamDef.borderColor}` : 'none';
                                    })(),
                                    opacity: isDragPropagated ? 0.85 : 0.95,
                                    transition: (isDragging || isResizing || isDragPropagated) ? 'none' : 'left 0.2s ease, width 0.2s ease',
                                    zIndex: 10,
                                    cursor: 'grab',
                                  }}
                                  onMouseDown={(e) => {
                                    // Check if near edges for resize
                                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                    const relX = e.clientX - rect.left;
                                    if (relX <= 8 && currentWidth > dayWidth) {
                                      handleResizeMouseDown(e, task.id, 'left');
                                    } else if (relX >= rect.width - 8) {
                                      handleResizeMouseDown(e, task.id, 'right');
                                    } else {
                                      handleMouseDown(e, task.id, bar.left);
                                    }
                                  }}
                                  onMouseMove={(e) => {
                                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                    const relX = e.clientX - rect.left;
                                    if (relX <= 8 || relX >= rect.width - 8) {
                                      (e.currentTarget as HTMLElement).style.cursor = 'col-resize';
                                    } else {
                                      (e.currentTarget as HTMLElement).style.cursor = 'grab';
                                    }
                                  }}
                                >
                                  {/* Progress fill */}
                                  <div
                                    className="h-full rounded-md opacity-30"
                                    style={{ width: `${task.percentComplete}%`, background: 'white', borderRadius: 6 }}
                                  />

                                </div>
                                  );
                                })()}

                                {/* Linha tracejada: intervalo Real → Previsto (apontamento diário) */}
                                {(() => {
                                  const hasRealData = (task.dailyLogs || []).some(l => (l.actualQuantity ?? 0) > 0) && !!task.current?.startDate;
                                  if (!hasRealData) return null;
                                  const realStartISO = task.current!.startDate;
                                  const previstoISO = task.current!.forecastEndDate || task.current!.endDate;
                                  if (!previstoISO) return null;
                                  const realStart = parseISODateLocal(realStartISO);
                                  const previsto = parseISODateLocal(previstoISO);
                                  const leftDays = diffDays(projectStart, realStart);
                                  const spanDays = Math.max(1, diffDays(realStart, previsto) + 1);
                                  const left = leftDays * dayWidth;
                                  const width = spanDays * dayWidth;
                                  const plannedEndISO = dateToISO(addDays(parseISODateLocal(task.startDate), task.duration));
                                  const isLate = previstoISO > plannedEndISO;
                                  // Cor de alto contraste: azul-marinho forte (visível sobre fundos claros e escuros)
                                  // Tom muda para vermelho/verde escuros conforme atrasado/no prazo
                                  const color = isLate ? '#991b1b' : '#1e3a8a';
                                  // Centralizar verticalmente na barra (top:9, height:20 → centro = 19)
                                  // Usa traço branco com contorno escuro para contraste sobre qualquer cor de barra
                                  const BAR_TOP = 9;
                                  const BAR_HEIGHT = 20;
                                  const lineCenter = BAR_TOP + BAR_HEIGHT / 2; // 19
                                  const overlayHeight = 12;
                                  const overlayTop = lineCenter - overlayHeight / 2; // 13
                                  return (
                                    <div
                                      className="absolute pointer-events-none"
                                      style={{ left, width, top: overlayTop, height: overlayHeight, zIndex: 20 }}
                                      title={`Real: ${formatDateFull(realStartISO)} → Previsto: ${formatDateFull(previstoISO)}`}
                                    >
                                      {/* Halo escuro para contraste sobre barras claras */}
                                      <div
                                        style={{
                                          position: 'absolute',
                                          top: overlayHeight / 2 - 2,
                                          left: 0,
                                          right: 0,
                                          height: 4,
                                          borderRadius: 2,
                                          background: 'hsl(var(--background) / 0.55)',
                                          boxShadow: '0 0 0 1px hsl(var(--foreground) / 0.35)',
                                        }}
                                      />
                                      {/* Linha tracejada principal (cor status: vermelho/verde) */}
                                      <div
                                        style={{
                                          position: 'absolute',
                                          top: overlayHeight / 2 - 1,
                                          left: 2,
                                          right: 2,
                                          borderTop: `3px dashed ${color}`,
                                          filter: 'drop-shadow(0 1px 0 white) drop-shadow(0 -1px 0 white)',
                                        }}
                                      />
                                      {/* Marcador início (Real) */}
                                      <div
                                        style={{
                                          position: 'absolute',
                                          left: 0,
                                          top: 0,
                                          width: 3,
                                          height: overlayHeight,
                                          background: color,
                                          borderRadius: 1,
                                          boxShadow: '0 0 0 1px hsl(var(--background))',
                                        }}
                                      />
                                      {/* Marcador fim (Previsto) */}
                                      <div
                                        style={{
                                          position: 'absolute',
                                          right: 0,
                                          top: 0,
                                          width: 3,
                                          height: overlayHeight,
                                          background: color,
                                          borderRadius: 1,
                                          boxShadow: '0 0 0 1px hsl(var(--background))',
                                        }}
                                      />
                                      {/* Badge % concluído ancorado no fim do último apontamento (Real → Projeção) */}
                                      {(() => {
                                        const logs = (task.dailyLogs || []).filter(l => (l.actualQuantity ?? 0) > 0);
                                        if (logs.length === 0) return null;
                                        const lastLogISO = logs.reduce((max, l) => l.date > max ? l.date : max, logs[0].date);
                                        const lastLog = parseISODateLocal(lastLogISO);
                                        const offsetDays = Math.max(0, diffDays(realStart, lastLog));
                                        const offsetPx = Math.min(width, offsetDays * dayWidth);
                                        const pct = Math.round(task.physicalProgress ?? task.percentComplete ?? 0);
                                        return (
                                          <span
                                            className="absolute text-[9px] font-bold px-1 rounded leading-none whitespace-nowrap"
                                            style={{
                                              left: offsetPx,
                                              top: '50%',
                                              transform: 'translate(-50%, -50%)',
                                              color,
                                              background: 'white',
                                              boxShadow: `0 0 0 1px ${color}`,
                                              filter: 'drop-shadow(0 0 1px white)',
                                            }}
                                            title={`Concluído: ${pct}% • Último apontamento: ${formatDateFull(lastLogISO)}`}
                                          >
                                            {pct}%
                                          </span>
                                        );
                                      })()}
                                    </div>
                                  );
                                })()}
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
    </TooltipProvider>
  );
}
