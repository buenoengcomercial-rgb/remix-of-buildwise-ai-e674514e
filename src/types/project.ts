export interface LaborComposition {
  id: string;
  role: string; // e.g. "Encanador", "Ajudante"
  rup: number; // hours per unit (h/un)
  workerCount: number;
  hourlyRate?: number;
}

export type DependencyType = 'TI' | 'II' | 'TT' | 'IT';
import type { TeamCode } from '@/lib/teams';
export type { TeamCode } from '@/lib/teams';

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
  // Daily production tracking
  dailyLogs?: DailyProductionLog[];
  executedQuantityTotal?: number;
  remainingQuantity?: number;
  accumulatedDelayQuantity?: number;
  recalculatedDuration?: number;
  forecastEndDate?: string;
  physicalProgress?: number;
  originalDuration?: number; // snapshot before daily-log adjustment
  // Baseline (linha de base fixa) e Current (cronograma variável)
  baseline?: TaskBaseline;
  current?: TaskCurrent;
}

export interface TaskBaseline {
  startDate: string;
  duration: number;
  endDate: string;
  plannedDailyProduction?: number;
  quantity?: number;
  capturedAt: string;
}

export interface TaskCurrent {
  startDate: string;
  duration: number;
  endDate: string;
  forecastEndDate?: string;
  executedQuantityTotal?: number;
  remainingQuantity?: number;
  accumulatedDelayQuantity?: number;
  physicalProgress?: number;
}

export interface DailyProductionLog {
  id: string;
  date: string;            // ISO yyyy-mm-dd
  plannedQuantity: number;
  actualQuantity: number;
  notes?: string;
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
