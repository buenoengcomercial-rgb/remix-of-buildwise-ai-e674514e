import { Phase, Project, Task, DependencyType } from '@/types/project';
import { checkDependencyViolation } from '@/lib/calculations';

/**
 * Hierarquia de capítulos
 * --------------------------------------------------------------
 * Cada `Phase` representa um capítulo ou subcapítulo da EAP.
 *  - `parentId` undefined → capítulo principal
 *  - `parentId` string    → subcapítulo daquele capítulo principal
 *
 * As tarefas continuam vivendo dentro de cada Phase. Um capítulo
 * principal NÃO contém tarefas próprias — apenas subcapítulos que
 * contêm as tarefas. Capítulos sem `parentId` e sem filhos também
 * podem conter tarefas (legado / lista plana).
 */

export interface ChapterNode {
  phase: Phase;
  children: Phase[]; // subcapítulos diretos
}

/** Agrupa as phases do projeto em árvore (capítulo → subcapítulos). */
export function getChapterTree(project: Project): ChapterNode[] {
  const phases = [...project.phases];
  const sortFn = (a: Phase, b: Phase) =>
    (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);

  const roots = phases.filter(p => !p.parentId).sort(sortFn);
  const childrenByParent = new Map<string, Phase[]>();
  phases.forEach(p => {
    if (p.parentId) {
      if (!childrenByParent.has(p.parentId)) childrenByParent.set(p.parentId, []);
      childrenByParent.get(p.parentId)!.push(p);
    }
  });
  childrenByParent.forEach(arr => arr.sort(sortFn));

  return roots.map(root => ({
    phase: root,
    children: childrenByParent.get(root.id) ?? [],
  }));
}

/**
 * Reordena `project.phases` para que cada capítulo principal apareça
 * imediatamente seguido por seus subcapítulos. Mantém compatibilidade
 * com componentes que iteram `project.phases` linearmente (Gantt).
 */
export function flattenPhasesByChapter(project: Project): Phase[] {
  const tree = getChapterTree(project);
  const out: Phase[] = [];
  tree.forEach(node => {
    out.push(node.phase);
    node.children.forEach(child => out.push(child));
  });
  // Inclui phases órfãs (parentId apontando para alguém inexistente)
  const ids = new Set(out.map(p => p.id));
  project.phases.forEach(p => {
    if (!ids.has(p.id)) out.push(p);
  });
  return out;
}

/** Retorna true se a phase é capítulo principal. */
export function isMainChapter(phase: Phase): boolean {
  return !phase.parentId;
}

/** Move uma phase para virar subcapítulo de outra (ou promove a capítulo principal). */
export function moveChapter(
  project: Project,
  chapterId: string,
  newParentId: string | null,
): Project {
  if (chapterId === newParentId) return project;
  // Impede ciclo: não pode virar filho de um descendente próprio.
  if (newParentId && isDescendant(project, newParentId, chapterId)) return project;

  return {
    ...project,
    phases: project.phases.map(p =>
      p.id === chapterId ? { ...p, parentId: newParentId ?? undefined } : p,
    ),
  };
}

/** Verifica se `candidateId` é descendente de `ancestorId` na árvore atual. */
function isDescendant(project: Project, candidateId: string, ancestorId: string): boolean {
  const map = new Map(project.phases.map(p => [p.id, p] as const));
  let current = map.get(candidateId);
  const visited = new Set<string>();
  while (current?.parentId) {
    if (visited.has(current.id)) return false; // proteção
    visited.add(current.id);
    if (current.parentId === ancestorId) return true;
    current = map.get(current.parentId);
  }
  return false;
}

/** Coleta todas as tarefas de um capítulo (incluindo seus subcapítulos). */
export function getChapterTasks(project: Project, chapterId: string): Task[] {
  const direct = project.phases.find(p => p.id === chapterId)?.tasks ?? [];
  const subs = project.phases.filter(p => p.parentId === chapterId);
  const subTasks = subs.flatMap(s => s.tasks);
  return [...direct, ...subTasks];
}

/** Numeração hierárquica: { phaseId → "1", "1.1", "1.2", "2", ... } */
export function getChapterNumbering(project: Project): Map<string, string> {
  const tree = getChapterTree(project);
  const map = new Map<string, string>();
  tree.forEach((node, idx) => {
    const chapterNum = node.phase.customNumber?.trim() || String(idx + 1);
    map.set(node.phase.id, chapterNum);
    node.children.forEach((child, cIdx) => {
      const childNum = child.customNumber?.trim() || `${chapterNum}.${cIdx + 1}`;
      map.set(child.id, childNum);
    });
  });
  // Phases legadas não enumeradas: numera na sequência
  let next = tree.length + 1;
  project.phases.forEach(p => {
    if (!map.has(p.id)) {
      map.set(p.id, p.customNumber?.trim() || String(next++));
    }
  });
  return map;
}

// ─── Validação de movimentação de capítulo ────────────────────────────

export interface ChapterMoveValidation {
  blocked: boolean;
  warnings: string[];
  violations: Array<{ taskId: string; taskName: string; predId: string; predName: string; type: DependencyType }>;
}

/** Coleta todas as tarefas do projeto. */
function getAllProjectTasks(project: Project): Task[] {
  return project.phases.flatMap(p => p.tasks);
}

/**
 * Valida se mover um capítulo causaria violações de dependência.
 * Como mover um capítulo não altera datas de tarefas (apenas seu agrupamento
 * visual via parentId), violações "duras" só ocorrem se já houver dependências
 * inconsistentes ou se a movimentação criar ciclo. Geramos avisos quando
 * existem dependências cruzadas com o pai antigo / dentro do novo destino.
 */
export function validateChapterMove(
  project: Project,
  chapterId: string,
  newParentId: string | null,
): ChapterMoveValidation {
  const result: ChapterMoveValidation = { blocked: false, warnings: [], violations: [] };

  // Ciclo
  if (newParentId && (chapterId === newParentId || isDescendant(project, newParentId, chapterId))) {
    result.blocked = true;
    result.warnings.push('Movimentação criaria um ciclo na hierarquia.');
    return result;
  }

  const allTasks = getAllProjectTasks(project);
  const movedTasks = getChapterTasks(project, chapterId);
  const movedIds = new Set(movedTasks.map(t => t.id));

  // Verifica violações duras: se alguma tarefa do capítulo já tem violação
  // ativa com suas dependências (pré-existente, mas exposta ao reorganizar).
  for (const task of movedTasks) {
    const v = checkDependencyViolation(task, task.startDate, allTasks);
    if (v) {
      result.violations.push({
        taskId: task.id,
        taskName: task.name,
        predId: v.predId,
        predName: v.predName,
        type: v.type,
      });
    }
  }

  // Avisos: dependências cruzadas com o pai antigo
  const oldParent = project.phases.find(p => p.id === chapterId)?.parentId;
  if (oldParent && oldParent !== newParentId) {
    const oldParentTasks = getChapterTasks(project, oldParent);
    const oldParentIds = new Set(oldParentTasks.map(t => t.id));
    for (const task of movedTasks) {
      const crosses = (task.dependencyDetails || []).some(d => oldParentIds.has(d.taskId) && !movedIds.has(d.taskId));
      if (crosses) {
        result.warnings.push(`Tarefa "${task.name}" mantém dependência com o capítulo de origem.`);
        break;
      }
    }
  }

  if (result.violations.length > 0) result.blocked = true;
  return result;
}

/**
 * Aplica a movimentação. Se houver violações e `force` for true, remove
 * as dependências conflitantes antes de mover.
 */
export function safeMoveChapter(
  project: Project,
  chapterId: string,
  newParentId: string | null,
  options: { force?: boolean } = {},
): { project: Project; validation: ChapterMoveValidation; applied: boolean } {
  const validation = validateChapterMove(project, chapterId, newParentId);

  if (validation.blocked && !options.force) {
    return { project, validation, applied: false };
  }

  let next = project;
  if (validation.violations.length > 0 && options.force) {
    // Remove dependências conflitantes
    const conflictPairs = new Set(validation.violations.map(v => `${v.taskId}::${v.predId}`));
    next = {
      ...next,
      phases: next.phases.map(p => ({
        ...p,
        tasks: p.tasks.map(t => {
          const hasConflict = (t.dependencies || []).some(d => conflictPairs.has(`${t.id}::${d}`));
          if (!hasConflict) return t;
          return {
            ...t,
            dependencies: (t.dependencies || []).filter(d => !conflictPairs.has(`${t.id}::${d}`)),
            dependencyDetails: (t.dependencyDetails || []).filter(d => !conflictPairs.has(`${t.id}::${d.taskId}`)),
          };
        }),
      })),
    };
  }

  next = moveChapter(next, chapterId, newParentId);
  return { project: next, validation, applied: true };
}
