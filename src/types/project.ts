export interface LaborComposition {
  id: string;
  role: string; // e.g. "Encanador", "Ajudante"
  rup: number; // hours per unit (h/un)
  workerCount: number;
  hourlyRate?: number;
}

export type DependencyType = 'TI' | 'II' | 'TT' | 'IT';
export type TeamCode = 'alpha' | 'bravo';

export interface TaskDependency {
  taskId: string;
  type: DependencyType;
}

export interface TaskLocation {
  torre?: string;
  pavimento?: number;
  bloco?: string;
  ambiente?: string;
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
  // Location & organization
  location?: TaskLocation;
  team?: TeamCode;
  frenteServico?: string;
  disciplina?: string;
  ordemExecucao?: number;
  observations?: string;
  // Duration mode
  durationMode?: 'manual' | 'rup';
  isManual?: boolean;
  manualDuration?: number;
  // RUP fields
  quantity?: number;
  unit?: string;
  laborCompositions?: LaborComposition[];
  // CPM fields (computed)
  es?: number;
  ef?: number;
  ls?: number;
  lf?: number;
  float?: number;
  isCritical?: boolean;
  bottleneckRole?: string;
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
