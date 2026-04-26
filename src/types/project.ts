export interface LaborComposition {
  id: string;
  role: string; // e.g. "Encanador", "Ajudante"
  rup: number; // hours per unit (h/un)
  workerCount: number;
  hourlyRate?: number;
}

export type DependencyType = 'TI' | 'II' | 'TT' | 'IT';
import type { TeamCode, TeamDefinition } from '@/lib/teams';
export type { TeamCode, TeamDefinition } from '@/lib/teams';

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
  /** Preço unitário contratado (R$/unidade). Usado na Planilha de Medição. */
  unitPrice?: number;
  /** Preço unitário SEM BDI (R$/unidade). Se ausente, deriva-se de unitPrice/(1+BDI). */
  unitPriceNoBDI?: number;
  /** Código do item (referência SINAPI/orçamento). */
  itemCode?: string;
  /** Banco de referência do preço (ex.: SINAPI, SBC, próprio). */
  priceBank?: string;
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
  /**
   * Hierarquia de capítulos:
   * - parentId === undefined  → capítulo principal
   * - parentId === string     → subcapítulo, filho do capítulo principal indicado
   */
  parentId?: string;
  /** Ordem manual dentro do mesmo nível. */
  order?: number;
  /** Numeração customizada do capítulo (sobrescreve o automático "1", "1.1", etc). */
  customNumber?: string;
}

export interface ProjectUiState {
  /** IDs de capítulos/subcapítulos atualmente recolhidos na aba Tarefas (EAP). */
  collapsedPhaseIds?: string[];
  /** IDs de capítulos/subcapítulos atualmente recolhidos na aba Cronograma (Gantt). */
  ganttCollapsedPhaseIds?: string[];
}

export interface ContractInfo {
  contractor?: string;     // Contratante
  contracted?: string;     // Contratada
  contractNumber?: string;
  nextMeasurementNumber?: number;
  /** Objeto do contrato (escopo resumido). */
  contractObject?: string;
  /** Local / município da obra. */
  location?: string;
  /** Fonte de orçamento (ex.: SINAPI 07/2024). */
  budgetSource?: string;
  /** BDI em % (ex.: 25 representa 25%). */
  bdiPercent?: number;
}

export type MeasurementStatus =
  | 'draft'         // Rascunho — totalmente editável
  | 'generated'     // Gerada — bloqueada para edição
  | 'in_review'     // Em análise fiscal — bloqueada
  | 'approved'      // Aprovada — bloqueada
  | 'rejected';     // Reprovada / Ajustar — destrava edição limitada

export interface MeasurementSnapshotItem {
  item: string;
  phaseId: string;
  phaseChain: string;
  taskId: string;
  description: string;
  unit: string;
  itemCode: string;
  priceBank: string;
  qtyContracted: number;
  unitPriceNoBDI: number;
  unitPriceWithBDI: number;
  /** Quantidade originalmente proposta na geração da medição. */
  qtyProposed: number;
  /** Quantidade aprovada pelo fiscal (opcional). Quando preenchida, prevalece nos cálculos. */
  qtyApproved?: number;
  /** Acumulado anterior (somatório fora do período). */
  qtyPriorAccum: number;
  /** Observação livre por item. */
  notes?: string;
}

export interface MeasurementChangeLog {
  at: string;          // ISO
  field: string;
  itemId?: string;     // taskId quando aplicável
  previous: string;
  next: string;
  reason?: string;
}

export interface DailyReportSnapshotData {
  startDate: string;
  endDate: string;
  totalDays: number;
  filledReports: number;
  missingReports: number;
  productionDays: number;
  noProductionDays: number;
  impedimentDays: number;
  reportDates: string[];
}

export interface SavedMeasurement {
  id: string;
  number: number;
  startDate: string;
  endDate: string;
  issueDate: string;
  status: MeasurementStatus;
  bdiPercent: number;
  notes?: string;
  items: MeasurementSnapshotItem[];
  /** Histórico de alterações após a geração. */
  history?: MeasurementChangeLog[];
  /** Capturado no momento da geração para o cabeçalho do boletim. */
  contractSnapshot?: ContractInfo;
  /** Carimbo de geração. */
  generatedAt?: string;
  /** Resumo dos Diários de Obra do período da medição (capturado na geração). */
  dailyReportSnapshot?: DailyReportSnapshotData;
}

/** Rascunho da medição em preparação (filtros não-persistidos em snapshot). */
export interface MeasurementDraft {
  /** Número da medição em preparação a que estes filtros se referem. */
  number: number;
  startDate?: string;
  endDate?: string;
  chapterFilter?: string;
  search?: string;
}

export type WeatherCondition = 'ensolarado' | 'nublado' | 'chuvoso' | 'parcialmente_nublado' | 'outro';
export type WorkCondition = 'normal' | 'parcialmente_prejudicada' | 'paralisada' | 'outro';

export interface DailyReportTeamRow {
  id: string;
  /** Código da equipe cadastrada no projeto (preferencial). */
  teamCode?: string;
  /** Nome livre — fallback para diários antigos sem teamCode. */
  name: string;
  role?: string;
  count?: number;
  notes?: string;
}

export interface DailyReportEquipmentRow {
  id: string;
  name: string;
  count?: number;
  notes?: string;
}

export interface DailyReportAttachment {
  id: string;
  name: string;
  /** dataURL ou referência local; opcional. */
  dataUrl?: string;
}

export interface DailyReport {
  id: string;
  /** ISO yyyy-mm-dd — chave por data. */
  date: string;
  responsible?: string;
  weather?: WeatherCondition;
  weatherOther?: string;
  workCondition?: WorkCondition;
  workConditionOther?: string;
  teamsPresent?: DailyReportTeamRow[];
  equipment?: DailyReportEquipmentRow[];
  occurrences?: string;
  impediments?: string;
  observations?: string;
  attachments?: DailyReportAttachment[];
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  phases: Phase[];
  totalBudget: number;
  /** Equipes do projeto. Quando undefined, usa-se DEFAULT_TEAMS. */
  teams?: TeamDefinition[];
  /** Estado visual persistido da UI (ex.: capítulos minimizados na EAP). */
  uiState?: ProjectUiState;
  /** Dados contratuais usados no boletim de medição. */
  contractInfo?: ContractInfo;
  /** Medições geradas e salvas (snapshots). */
  measurements?: SavedMeasurement[];
  /** Rascunho de filtros da medição em preparação (datas, capítulo, busca). */
  measurementDraft?: MeasurementDraft;
  /** Diários de obra registrados, indexados por data. */
  dailyReports?: DailyReport[];
}

export type ViewMode = 'days' | 'weeks' | 'months';
export type AppView = 'dashboard' | 'gantt' | 'tasks' | 'measurement' | 'dailyReport';
