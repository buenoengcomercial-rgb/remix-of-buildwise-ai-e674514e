export interface LaborComposition {
  id: string;
  role: string; // e.g. "Encanador", "Ajudante"
  rup: number; // hours per unit (h/un)
  workerCount: number;
  hourlyRate?: number;
}

export type DependencyType = 'TI' | 'II' | 'TT' | 'IT';

export interface TaskDependency {
  taskId: string;
  type: DependencyType;
}

export interface Task {
  id: string;
  name: string;
  phase: string;
  startDate: string;
  duration: number;
  dependencies: string[];
  dependencyDetails?: TaskDependency[];
  responsible: string;
  percentComplete: number;
  materials: Material[];
  children?: Task[];
  isExpanded?: boolean;
  level: number;
  observations?: string;
  durationMode?: 'manual' | 'rup'; // how duration is determined
  // RUP fields
  quantity?: number;
  unit?: string;
  laborCompositions?: LaborComposition[];
  // CPM fields (computed)
  es?: number; // Early Start (day offset from project start)
  ef?: number; // Early Finish
  ls?: number; // Late Start
  lf?: number; // Late Finish
  float?: number; // Total float
  isCritical?: boolean;
  bottleneckRole?: string; // role that defines duration
  calculatedDuration?: number;
  totalHours?: number;
}

export interface Material {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  category: string;
  status: 'pendente' | 'comprado';
  estimatedCost?: number;
}

export interface Phase {
  id: string;
  name: string;
  color: string;
  tasks: Task[];
}

export interface Project {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  phases: Phase[];
  totalBudget: number;
}

export type ViewMode = 'days' | 'weeks' | 'months';
export type AppView = 'dashboard' | 'gantt' | 'tasks' | 'purchases';
