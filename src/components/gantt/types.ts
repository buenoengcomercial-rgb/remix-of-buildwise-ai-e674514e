import { Task, ViewMode, DependencyType } from '@/types/project';

export interface BarInfo {
  left: number;
  width: number;
  isDelayed: boolean;
  isCritical: boolean;
  isComplete: boolean;
}

export interface FlatTask {
  task: Task;
  phaseId: string;
  phaseName: string;
  rowIndex: number;
}

export const DAY_WIDTH: Record<ViewMode, number> = { days: 28, weeks: 7, months: 2.5 };
export const ROW_HEIGHT = 32;

export const DEP_COLORS: Record<DependencyType, string> = {
  TI: '#378ADD',
  II: '#1D9E75',
  TT: '#BA7517',
  IT: '#A32D2D',
};
