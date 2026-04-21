import { Project } from '@/types/project';
import { sampleProject } from '@/data/sampleProject';

const PROJECTS_INDEX_KEY = 'obraplanner-projects-index';
const PROJECT_KEY_PREFIX = 'obraplanner-project-';
const ACTIVE_PROJECT_KEY = 'obraplanner-active-project';
const LEGACY_KEY = 'obra-project-data';

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export function listProjects(): ProjectMeta[] {
  try {
    const raw = localStorage.getItem(PROJECTS_INDEX_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveIndex(index: ProjectMeta[]) {
  localStorage.setItem(PROJECTS_INDEX_KEY, JSON.stringify(index));
}

export function loadProject(id: string): Project | null {
  try {
    const raw = localStorage.getItem(`${PROJECT_KEY_PREFIX}${id}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveProject(project: Project) {
  localStorage.setItem(`${PROJECT_KEY_PREFIX}${project.id}`, JSON.stringify(project));
  const index = listProjects();
  const existing = index.findIndex(p => p.id === project.id);
  const now = new Date().toISOString();
  const meta: ProjectMeta = {
    id: project.id,
    name: project.name,
    createdAt: existing >= 0 ? index[existing].createdAt : now,
    updatedAt: now,
  };
  if (existing >= 0) {
    index[existing] = meta;
  } else {
    index.push(meta);
  }
  saveIndex(index);
}

export function deleteProject(id: string) {
  localStorage.removeItem(`${PROJECT_KEY_PREFIX}${id}`);
  saveIndex(listProjects().filter(p => p.id !== id));
}

export function getActiveProjectId(): string | null {
  return localStorage.getItem(ACTIVE_PROJECT_KEY);
}

export function setActiveProjectId(id: string) {
  localStorage.setItem(ACTIVE_PROJECT_KEY, id);
}

export function createNewProject(name: string): Project {
  const id = `project-${Date.now()}`;
  const today = new Date().toISOString().split('T')[0];
  const newProject: Project = {
    id,
    name,
    startDate: today,
    endDate: today,
    phases: [],
    totalBudget: 0,
  };
  saveProject(newProject);
  return newProject;
}

export function initProjects(): Project {
  let index = listProjects();

  if (index.length === 0) {
    const oldRaw = localStorage.getItem(LEGACY_KEY);
    let baseProject: Project;
    try {
      baseProject = oldRaw ? JSON.parse(oldRaw) : sampleProject;
    } catch {
      baseProject = sampleProject;
    }
    if (!baseProject.id) baseProject.id = `project-${Date.now()}`;
    saveProject(baseProject);
    setActiveProjectId(baseProject.id);
    index = listProjects();
  }

  const activeId = getActiveProjectId();
  if (activeId) {
    const active = loadProject(activeId);
    if (active) return active;
  }

  const first = loadProject(index[0].id);
  if (first) {
    setActiveProjectId(first.id);
    return first;
  }

  return sampleProject;
}
