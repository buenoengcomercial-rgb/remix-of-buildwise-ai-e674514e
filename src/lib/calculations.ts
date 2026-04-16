import { Task, Project, DependencyType, TaskBaseline } from '@/types/project';
import { getAllTasks } from '@/data/sampleProject';

const DAILY_HOURS = 8;

/** Calculate task duration from RUP compositions */
export function calculateRupDuration(task: Task): { duration: number; totalHours: number; bottleneckRole: string } {
  if (!task.laborCompositions?.length || !task.quantity) {
    return { duration: task.duration, totalHours: task.duration * DAILY_HOURS, bottleneckRole: '' };
  }

  let maxHours = 0;
  let bottleneck = '';

  for (const comp of task.laborCompositions) {
    const totalHoursForRole = task.quantity * comp.rup;
    const effectiveHours = totalHoursForRole / comp.workerCount;
    if (effectiveHours > maxHours) {
      maxHours = effectiveHours;
      bottleneck = comp.role;
    }
  }

  const totalHours = maxHours;
  const duration = Math.ceil(totalHours / DAILY_HOURS);
  return { duration, totalHours, bottleneckRole: bottleneck };
}

/** Apply RUP calculations to all tasks, mutating duration */
export function applyRupToProject(project: Project): Project {
  return {
    ...project,
    phases: project.phases.map(p => ({
      ...p,
      tasks: p.tasks.map(t => {
        // Respect manual override — don't overwrite duration
        if (t.isManual) {
          return t;
        }
        const { duration, totalHours, bottleneckRole } = calculateRupDuration(t);
        return { ...t, duration, totalHours, bottleneckRole, calculatedDuration: duration };
      }),
    })),
  };
}

/** Capture baseline (linha de base fixa) for tasks that don't yet have one.
 * Runs once on first load — baseline never changes after capture. */
export function captureBaseline(project: Project): Project {
  const now = new Date().toISOString();
  return {
    ...project,
    phases: project.phases.map(p => ({
      ...p,
      tasks: p.tasks.map(t => {
        if (t.baseline) return t;
        const start = new Date(t.startDate);
        const end = new Date(start);
        end.setDate(end.getDate() + t.duration);
        const baseline: TaskBaseline = {
          startDate: t.startDate,
          duration: t.duration,
          endDate: end.toISOString().split('T')[0],
          plannedDailyProduction: t.quantity && t.duration > 0 ? t.quantity / t.duration : undefined,
          quantity: t.quantity,
          capturedAt: now,
        };
        return { ...t, baseline };
      }),
    })),
  };
}

/** Apply daily production logs: recompute remaining duration, forecast date, physical progress.
 * Logs override `duration` (unless task.isManual), so CPM downstream propagates automatically.
 * Also populates `task.current` (cronograma variável). */
export function applyDailyLogsToProject(project: Project): Project {
  return {
    ...project,
    phases: project.phases.map(p => ({
      ...p,
      tasks: p.tasks.map(t => {
        const logs = t.dailyLogs || [];

        // Build "current" mirror of baseline by default
        const buildCurrent = (overrides: Partial<NonNullable<Task['current']>> = {}): NonNullable<Task['current']> => {
          const start = new Date(t.startDate);
          const end = new Date(start);
          end.setDate(end.getDate() + t.duration);
          return {
            startDate: t.startDate,
            duration: t.duration,
            endDate: end.toISOString().split('T')[0],
            ...overrides,
          };
        };

        if (!t.quantity || t.quantity <= 0 || t.duration <= 0) {
          return { ...t, current: buildCurrent() };
        }
        const baseDuration = t.baseline?.duration ?? t.originalDuration ?? t.duration;
        const plannedDailyProduction = t.baseline?.plannedDailyProduction ?? (t.quantity / baseDuration);

        if (logs.length === 0) {
          return {
            ...t,
            executedQuantityTotal: 0,
            remainingQuantity: t.quantity,
            accumulatedDelayQuantity: 0,
            recalculatedDuration: baseDuration,
            physicalProgress: t.percentComplete,
            current: buildCurrent({
              executedQuantityTotal: 0,
              remainingQuantity: t.quantity,
              accumulatedDelayQuantity: 0,
              physicalProgress: t.percentComplete,
            }),
          };
        }

        const executedQuantityTotal = logs.reduce((s, l) => s + (l.actualQuantity || 0), 0);
        const remainingQuantity = Math.max(0, t.quantity - executedQuantityTotal);
        const accumulatedDelayQuantity = logs.reduce(
          (s, l) => s + ((l.plannedQuantity || 0) - (l.actualQuantity || 0)),
          0
        );
        const remainingDuration = plannedDailyProduction > 0
          ? Math.ceil(remainingQuantity / plannedDailyProduction)
          : 0;

        const sortedLogs = [...logs].sort((a, b) => a.date.localeCompare(b.date));
        const firstLogDate = new Date(sortedLogs[0].date);
        const lastLogDate = new Date(sortedLogs[sortedLogs.length - 1].date);

        const projectedForecastEnd = new Date(lastLogDate);
        if (remainingQuantity > 0) {
          projectedForecastEnd.setDate(projectedForecastEnd.getDate() + remainingDuration);
        }

        const baselineEndTime = t.baseline ? new Date(t.baseline.endDate).getTime() : null;
        const projectedEndTime = projectedForecastEnd.getTime();
        const resolvedForecastTime = baselineEndTime === null
          ? projectedEndTime
          : Math.max(baselineEndTime, projectedEndTime, lastLogDate.getTime());
        const forecastEnd = new Date(resolvedForecastTime);
        const forecastEndDate = forecastEnd.toISOString().split('T')[0];

        const startDate = new Date(t.startDate);
        const currentStartDate = firstLogDate;
        const recalculatedDuration = Math.max(
          1,
          Math.ceil((forecastEnd.getTime() - startDate.getTime()) / 86400000)
        );
        const currentDuration = Math.max(
          1,
          Math.ceil((forecastEnd.getTime() - currentStartDate.getTime()) / 86400000)
        );

        const physicalProgress = Math.min(100, Math.round((executedQuantityTotal / t.quantity) * 1000) / 10);

        const shouldOverrideDuration = !t.isManual;
        const newDuration = shouldOverrideDuration ? recalculatedDuration : t.duration;

        return {
          ...t,
          originalDuration: baseDuration,
          duration: newDuration,
          executedQuantityTotal,
          remainingQuantity,
          accumulatedDelayQuantity,
          recalculatedDuration,
          forecastEndDate,
          physicalProgress,
          percentComplete: Math.max(t.percentComplete, Math.round(physicalProgress)),
          current: {
            startDate: firstLogDate.toISOString().split('T')[0],
            duration: currentDuration,
            // Sync end with forecast so Gantt + panel show same date
            endDate: forecastEndDate,
            forecastEndDate,
            executedQuantityTotal,
            remainingQuantity,
            accumulatedDelayQuantity,
            physicalProgress,
          },
        };
      }),
    })),
  };
}

/** CPM Forward + Backward pass */
export function calculateCPM(project: Project): Project {
  const allTasks = getAllTasks(project);
  const taskMap = new Map<string, Task>();
  allTasks.forEach(t => taskMap.set(t.id, { ...t }));

  // Build successor map
  const successors = new Map<string, string[]>();
  allTasks.forEach(t => {
    t.dependencies.forEach(depId => {
      if (!successors.has(depId)) successors.set(depId, []);
      successors.get(depId)!.push(t.id);
    });
  });

  // Forward pass
  const visited = new Set<string>();
  function forwardPass(id: string): number {
    const task = taskMap.get(id);
    if (!task) return 0;
    if (visited.has(id)) return task.ef!;
    visited.add(id);

    const validDeps = task.dependencies.filter(depId => taskMap.has(depId));
    if (validDeps.length === 0) {
      task.es = 0;
    } else {
      task.es = Math.max(...validDeps.map(depId => forwardPass(depId)));
    }
    task.ef = task.es + task.duration;
    taskMap.set(id, task);
    return task.ef;
  }

  allTasks.forEach(t => forwardPass(t.id));

  // Project end
  const projectEnd = Math.max(...Array.from(taskMap.values()).map(t => t.ef!));

  // Backward pass
  const visitedBack = new Set<string>();
  function backwardPass(id: string): number {
    const task = taskMap.get(id)!;
    if (visitedBack.has(id)) return task.ls!;
    visitedBack.add(id);

    const succs = successors.get(id);
    if (!succs || succs.length === 0) {
      task.lf = projectEnd;
    } else {
      task.lf = Math.min(...succs.map(sId => backwardPass(sId)));
    }
    task.ls = task.lf - task.duration;
    task.float = task.ls - task.es!;
    task.isCritical = task.float === 0;
    taskMap.set(id, task);
    return task.ls;
  }

  allTasks.forEach(t => backwardPass(t.id));

  // Write back
  return {
    ...project,
    phases: project.phases.map(p => ({
      ...p,
      tasks: p.tasks.map(t => taskMap.get(t.id)!),
    })),
  };
}

/** Generate real Curva S data based on task weights and progress */
export function generateCurvaS(project: Project): { day: string; planejado: number; realizado: number }[] {
  const tasks = getAllTasks(project);
  if (tasks.length === 0) return [];

  const validTasks = tasks.filter(t => t.startDate && !isNaN(new Date(t.startDate).getTime()));
  if (validTasks.length === 0) return [];

  const projectStart = new Date(Math.min(...validTasks.map(t => new Date(t.startDate).getTime())));
  const projectEnd = new Date(Math.max(...validTasks.map(t => {
    const d = new Date(t.startDate);
    d.setDate(d.getDate() + t.duration);
    return d.getTime();
  })));

  const totalDays = Math.max(1, Math.ceil((projectEnd.getTime() - projectStart.getTime()) / 86400000) + 1);
  const totalWeight = validTasks.reduce((s, t) => s + t.duration, 0);
  if (totalWeight === 0) return [];

  // Distribute weight per day
  const plannedPerDay = new Array(totalDays).fill(0);
  const actualPerDay = new Array(totalDays).fill(0);

  tasks.forEach(t => {
    const taskStart = Math.ceil((new Date(t.startDate).getTime() - projectStart.getTime()) / 86400000);
    const weight = t.duration / totalWeight;
    const dailyWeight = weight / t.duration;

    for (let d = 0; d < t.duration; d++) {
      const dayIndex = taskStart + d;
      if (dayIndex >= 0 && dayIndex < totalDays) {
        plannedPerDay[dayIndex] += dailyWeight;
        actualPerDay[dayIndex] += dailyWeight * (t.percentComplete / 100);
      }
    }
  });

  // Accumulate - sample weekly
  const result: { day: string; planejado: number; realizado: number }[] = [];
  let cumPlanned = 0;
  let cumActual = 0;
  const step = Math.max(1, Math.floor(totalDays / 12));

  for (let i = 0; i < totalDays; i++) {
    cumPlanned += plannedPerDay[i];
    cumActual += actualPerDay[i];
    if (i % step === 0 || i === totalDays - 1) {
      const date = new Date(projectStart);
      date.setDate(date.getDate() + i);
      result.push({
        day: date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
        planejado: Math.round(cumPlanned * 1000) / 10,
        realizado: Math.round(cumActual * 1000) / 10,
      });
    }
  }

  return result;
}

/** Suggest optimization: identify critical tasks where adding workers reduces duration */
export function suggestOptimizations(project: Project): { taskId: string; taskName: string; currentDuration: number; bottleneck: string; suggestedWorkers: number; newDuration: number }[] {
  const tasks = getAllTasks(project);
  const suggestions: { taskId: string; taskName: string; currentDuration: number; bottleneck: string; suggestedWorkers: number; newDuration: number }[] = [];

  tasks.forEach(t => {
    if (!t.isCritical || !t.laborCompositions?.length || !t.quantity || t.percentComplete === 100) return;

    const { bottleneckRole, duration } = calculateRupDuration(t);
    const bottleneckComp = t.laborCompositions.find(c => c.role === bottleneckRole);
    if (!bottleneckComp) return;

    const doubled = { ...bottleneckComp, workerCount: bottleneckComp.workerCount * 2 };
    const simTask = { ...t, laborCompositions: t.laborCompositions.map(c => c.role === bottleneckRole ? doubled : c) };
    const newCalc = calculateRupDuration(simTask);

    if (newCalc.duration < duration) {
      suggestions.push({
        taskId: t.id,
        taskName: t.name,
        currentDuration: duration,
        bottleneck: bottleneckRole,
        suggestedWorkers: doubled.workerCount,
        newDuration: newCalc.duration,
      });
    }
  });

  return suggestions;
}

// ─── Dependency Propagation Engine ───────────────────────────────────

function dateToISO(d: Date): string {
  return d.toISOString().split('T')[0];
}

function addDaysCalc(date: Date, days: number): Date {
  const r = new Date(date);
  r.setDate(r.getDate() + days);
  return r;
}

/**
 * Central dependency propagation engine.
 * Given a list of tasks and the ID of a task that changed,
 * cascades date adjustments through all successor tasks.
 * Returns a new array with all dates updated.
 */
export function propagateAllDependencies(
  tasks: Task[],
  changedTaskId: string,
): { tasks: Task[]; changed: boolean; adjustedTypes: Set<DependencyType> } {
  const taskMap = new Map(tasks.map(t => [t.id, { ...t }]));
  const visited = new Set<string>();
  let anyChanged = false;
  const adjustedTypes = new Set<DependencyType>();

  // Build successor index: predId -> [{successorId, type}]
  const successorIndex = new Map<string, { successorId: string; type: DependencyType }[]>();
  tasks.forEach(t => {
    const details = t.dependencyDetails || [];
    details.forEach(dep => {
      if (!successorIndex.has(dep.taskId)) successorIndex.set(dep.taskId, []);
      successorIndex.get(dep.taskId)!.push({ successorId: t.id, type: dep.type });
    });
  });

  function propagate(predId: string, depth: number) {
    if (depth > 50 || visited.has(predId)) return;
    visited.add(predId);

    const succs = successorIndex.get(predId);
    if (!succs) return;

    for (const { successorId, type } of succs) {
      const pred = taskMap.get(predId)!;
      const succ = taskMap.get(successorId)!;
      if (!pred || !succ) continue;

      const predStart = new Date(pred.startDate);
      const predEnd = addDaysCalc(predStart, pred.duration);
      const succStart = new Date(succ.startDate);
      const succEnd = addDaysCalc(succStart, succ.duration);

      let newStartDate: Date | null = null;

      switch (type) {
        case 'TI':
          // Successor start must be >= predecessor end
          if (succStart < predEnd) {
            newStartDate = predEnd;
          }
          break;
        case 'II':
          // Successor start must be >= predecessor start
          if (succStart < predStart) {
            newStartDate = predStart;
          }
          break;
        case 'TT':
          // Successor end must be >= predecessor end
          if (succEnd < predEnd) {
            newStartDate = addDaysCalc(predEnd, -succ.duration);
          }
          break;
        case 'IT':
          // Successor end must be >= predecessor start
          if (succEnd < predStart) {
            newStartDate = addDaysCalc(predStart, -succ.duration);
          }
          break;
      }

      if (newStartDate) {
        taskMap.set(successorId, { ...succ, startDate: dateToISO(newStartDate) });
        anyChanged = true;
        adjustedTypes.add(type);
        propagate(successorId, depth + 1);
      }
    }
  }

  propagate(changedTaskId, 0);

  return {
    tasks: tasks.map(t => taskMap.get(t.id) || t),
    changed: anyChanged,
    adjustedTypes,
  };
}

/**
 * Check if dragging a successor to a position violates its dependency.
 * Returns the violated dependency info or null.
 */
export function checkDependencyViolation(
  task: Task,
  newStartDate: string,
  allTasks: Task[],
): { predName: string; predId: string; type: DependencyType } | null {
  const details = task.dependencyDetails || [];
  const taskMap = new Map(allTasks.map(t => [t.id, t]));

  for (const dep of details) {
    const pred = taskMap.get(dep.taskId);
    if (!pred) continue;

    const predStart = new Date(pred.startDate);
    const predEnd = addDaysCalc(predStart, pred.duration);
    const newStart = new Date(newStartDate);
    const newEnd = addDaysCalc(newStart, task.duration);

    let violated = false;
    switch (dep.type) {
      case 'TI': violated = newStart < predEnd; break;
      case 'II': violated = newStart < predStart; break;
      case 'TT': violated = newEnd < predEnd; break;
      case 'IT': violated = newEnd < predStart; break;
    }

    if (violated) {
      return { predName: pred.name, predId: pred.id, type: dep.type };
    }
  }
  return null;
}
