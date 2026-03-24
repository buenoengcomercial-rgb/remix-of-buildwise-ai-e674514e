import { Task, Project } from '@/types/project';
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
        const { duration, totalHours, bottleneckRole } = calculateRupDuration(t);
        return { ...t, duration, totalHours, bottleneckRole, calculatedDuration: duration };
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
  const projectStart = new Date(Math.min(...tasks.map(t => new Date(t.startDate).getTime())));
  const projectEnd = new Date(Math.max(...tasks.map(t => {
    const d = new Date(t.startDate);
    d.setDate(d.getDate() + t.duration);
    return d.getTime();
  })));

  const totalDays = Math.ceil((projectEnd.getTime() - projectStart.getTime()) / 86400000) + 1;
  const totalWeight = tasks.reduce((s, t) => s + t.duration, 0);

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
