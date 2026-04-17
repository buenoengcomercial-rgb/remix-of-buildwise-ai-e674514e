import { Project, Task, LaborComposition, DailyProductionLog } from '@/types/project';
import { getTeamDefinition, TEAM_CODES, TeamCode } from '@/lib/teams';
import { useState, useRef, useCallback } from 'react';
import { ChevronDown, ChevronRight, User, Zap, Users, AlertTriangle, Plus, Copy, Trash2, Edit3, Check, X, Upload, FolderPlus, GripVertical, ClipboardList } from 'lucide-react';
import ImportTasksDialog from '@/components/ImportTasksDialog';
import DailyLogsPanel from '@/components/DailyLogsPanel';
import { motion, AnimatePresence } from 'framer-motion';
import { calculateRupDuration } from '@/lib/calculations';
import { formatISODateBR } from '@/components/gantt/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** Encurta o nome da tarefa para no máximo `maxWords` palavras, adicionando "…" no final. */
function truncateWords(text: string, maxWords = 4): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(' ') + '…';
}

interface TaskListProps {
  project: Project;
  onProjectChange: (project: Project) => void;
}

const DAILY_HOURS = 8;

/** Encurta nomes de cargos longos (ex: SINAPI) para caber na coluna de gargalo. */
/** Calcula a produção diária de uma tarefa: quantidade total / duração. */
function getDailyProduction(task: Task): string {
  if (!task.quantity || !task.duration || task.duration <= 0) return '—';
  const value = task.quantity / task.duration;
  const formatted = Number.isInteger(value) ? value.toString() : value.toFixed(1);
  return `${formatted} ${task.unit || ''}/dia`.trim();
}

function abbreviateRole(role: string): string {
  if (!role) return '';
  const cleaned = role
    .replace(/COM ENCARGOS COMPLEMENTARES/gi, '')
    .replace(/\(.*?\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Mapeamentos comuns
  const map: Array<[RegExp, string]> = [
    [/AUXILIAR DE ENCANADOR|AUXILIAR HIDR[ÁA]ULICO|AUXILIAR DE BOMBEIRO/i, 'Aux. Encanador'],
    [/ENCANADOR|BOMBEIRO HIDR[ÁA]ULICO/i, 'Encanador'],
    [/AUXILIAR DE ELETRICISTA/i, 'Aux. Eletricista'],
    [/ELETRICISTA/i, 'Eletricista'],
    [/AJUDANTE/i, 'Ajudante'],
    [/PEDREIRO/i, 'Pedreiro'],
    [/SERVENTE/i, 'Servente'],
    [/GESSEIRO|GESSO/i, 'Gesseiro'],
    [/CARPINTEIRO/i, 'Carpinteiro'],
    [/ARMADOR/i, 'Armador'],
    [/PINTOR/i, 'Pintor'],
    [/AUXILIAR/i, 'Auxiliar'],
  ];
  for (const [re, label] of map) {
    if (re.test(cleaned)) return label;
  }
  // Fallback: pega as 2 primeiras palavras significativas
  const words = cleaned.split(' ').filter(w => w.length > 2 && !/^(DE|DO|DA|OU|COM|E)$/i.test(w));
  return words.slice(0, 2).join(' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function StatusBadge({ percent }: { percent: number }) {
  if (percent === 100) return <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-success/15 text-success">Concluído</span>;
  if (percent > 0) return <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-primary/15 text-primary">Em andamento</span>;
  return <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-muted text-muted-foreground">Pendente</span>;
}

function InlineInput({ value, onChange, type = 'text', className = '', min, max, step }: {
  value: string | number; onChange: (v: string) => void; type?: string; className?: string; min?: number; max?: number; step?: number;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      min={min}
      max={max}
      step={step}
      className={`bg-transparent border border-current/30 rounded px-1.5 py-0.5 text-[11px] focus:border-primary focus:outline-none transition-colors ${className}`}
    />
  );
}

export default function TaskList({ project, onProjectChange }: TaskListProps) {
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set(project.phases.map(p => p.id)));
  const [expandedRup, setExpandedRup] = useState<string | null>(null);
  const [expandedDaily, setExpandedDaily] = useState<string | null>(null);
  const [simulating, setSimulating] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [editingPhase, setEditingPhase] = useState<string | null>(null);
  const [phaseNameDraft, setPhaseNameDraft] = useState('');

  // Drag-and-drop state
  const [dragPhaseId, setDragPhaseId] = useState<string | null>(null);
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const handleDragStart = useCallback((phaseId: string, taskId: string) => {
    setDragPhaseId(phaseId);
    setDragTaskId(taskId);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, targetTaskId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTargetId(targetTaskId);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetPhaseId: string, targetTaskId: string) => {
    e.preventDefault();
    if (!dragPhaseId || !dragTaskId || dragTaskId === targetTaskId) {
      setDragPhaseId(null);
      setDragTaskId(null);
      setDropTargetId(null);
      return;
    }

    const newPhases = [...project.phases];
    const srcPhase = newPhases.find(p => p.id === dragPhaseId);
    const dstPhase = newPhases.find(p => p.id === targetPhaseId);
    if (!srcPhase || !dstPhase) return;

    const srcIdx = srcPhase.tasks.findIndex(t => t.id === dragTaskId);
    if (srcIdx === -1) return;
    const [movedTask] = srcPhase.tasks.splice(srcIdx, 1);

    const dstIdx = dstPhase.tasks.findIndex(t => t.id === targetTaskId);
    dstPhase.tasks.splice(dstIdx, 0, movedTask);

    onProjectChange({ ...project, phases: newPhases });
    setDragPhaseId(null);
    setDragTaskId(null);
    setDropTargetId(null);
  }, [dragPhaseId, dragTaskId, project, onProjectChange]);

  const handleDragEnd = useCallback(() => {
    setDragPhaseId(null);
    setDragTaskId(null);
    setDropTargetId(null);
  }, []);

  const PHASE_COLORS = [
    'hsl(var(--primary))', 'hsl(var(--info))', 'hsl(var(--warning))',
    'hsl(var(--success))', 'hsl(var(--destructive))', 'hsl(210, 60%, 50%)',
    'hsl(280, 50%, 55%)', 'hsl(160, 50%, 45%)',
  ];

  const addPhase = () => {
    const newId = `phase-${Date.now()}`;
    const colorIdx = project.phases.length % PHASE_COLORS.length;
    onProjectChange({
      ...project,
      phases: [...project.phases, { id: newId, name: 'Novo Capítulo', color: PHASE_COLORS[colorIdx], tasks: [] }],
    });
    setExpandedPhases(prev => new Set([...prev, newId]));
    setEditingPhase(newId);
    setPhaseNameDraft('Novo Capítulo');
  };

  const renamePhase = (phaseId: string) => {
    if (!phaseNameDraft.trim()) return;
    onProjectChange({
      ...project,
      phases: project.phases.map(p => p.id === phaseId ? { ...p, name: phaseNameDraft.trim() } : p),
    });
    setEditingPhase(null);
  };

  const deletePhase = (phaseId: string) => {
    onProjectChange({
      ...project,
      phases: project.phases.filter(p => p.id !== phaseId),
    });
  };

  const togglePhase = (id: string) => {
    setExpandedPhases(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const updateTask = (phaseId: string, taskId: string, updates: Partial<Task>) => {
    const updated = {
      ...project,
      phases: project.phases.map(p =>
        p.id === phaseId
          ? { ...p, tasks: p.tasks.map(t => t.id === taskId ? { ...t, ...updates } : t) }
          : p
      ),
    };
    onProjectChange(updated);
  };

  const updateLaborComp = (phaseId: string, taskId: string, compId: string, updates: Partial<LaborComposition>) => {
    const updated = {
      ...project,
      phases: project.phases.map(p =>
        p.id === phaseId
          ? {
              ...p,
              tasks: p.tasks.map(t =>
                t.id === taskId
                  ? { ...t, laborCompositions: t.laborCompositions?.map(c => c.id === compId ? { ...c, ...updates } : c) }
                  : t
              ),
            }
          : p
      ),
    };
    onProjectChange(updated);
  };

  const addTask = (phaseId: string) => {
    const phase = project.phases.find(p => p.id === phaseId);
    if (!phase) return;
    const nextId = `t${Date.now()}`;
    const lastTask = phase.tasks[phase.tasks.length - 1];
    const lastEnd = lastTask ? new Date(lastTask.startDate) : new Date(project.startDate);
    if (lastTask) lastEnd.setDate(lastEnd.getDate() + lastTask.duration);

    const newTask: Task = {
      id: nextId,
      name: 'Nova atividade',
      phase: phase.name,
      startDate: lastEnd.toISOString().split('T')[0],
      duration: 5,
      dependencies: lastTask ? [lastTask.id] : [],
      responsible: '',
      percentComplete: 0,
      level: 0,
      quantity: 100,
      unit: 'un',
      materials: [],
      laborCompositions: [
        { id: `lc-${Date.now()}`, role: 'Servente', rup: 0.5, workerCount: 1 },
      ],
    };

    onProjectChange({
      ...project,
      phases: project.phases.map(p =>
        p.id === phaseId ? { ...p, tasks: [...p.tasks, newTask] } : p
      ),
    });
    setEditingTask(nextId);
  };

  const duplicateTask = (phaseId: string, task: Task) => {
    const newId = `t${Date.now()}`;
    const dup: Task = {
      ...task,
      id: newId,
      name: `${task.name} (cópia)`,
      percentComplete: 0,
      laborCompositions: task.laborCompositions?.map(c => ({ ...c, id: `lc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` })),
      materials: task.materials.map(m => ({ ...m, id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, status: 'pendente' as const })),
    };
    onProjectChange({
      ...project,
      phases: project.phases.map(p =>
        p.id === phaseId ? { ...p, tasks: [...p.tasks, dup] } : p
      ),
    });
  };

  const deleteTask = (phaseId: string, taskId: string) => {
    onProjectChange({
      ...project,
      phases: project.phases.map(p =>
        p.id === phaseId
          ? {
              ...p,
              tasks: p.tasks.filter(t => t.id !== taskId).map(t => ({
                ...t,
                dependencies: t.dependencies.filter(d => d !== taskId),
              })),
            }
          : p
      ),
    });
    if (expandedRup === taskId) setExpandedRup(null);
    if (editingTask === taskId) setEditingTask(null);
  };

  const addLabor = (phaseId: string, taskId: string) => {
    const newComp: LaborComposition = {
      id: `lc-${Date.now()}`,
      role: 'Servente',
      rup: 0.5,
      workerCount: 1,
    };
    const updated = {
      ...project,
      phases: project.phases.map(p =>
        p.id === phaseId
          ? { ...p, tasks: p.tasks.map(t => t.id === taskId ? { ...t, laborCompositions: [...(t.laborCompositions || []), newComp] } : t) }
          : p
      ),
    };
    onProjectChange(updated);
  };

  const removeLabor = (phaseId: string, taskId: string, compId: string) => {
    const updated = {
      ...project,
      phases: project.phases.map(p =>
        p.id === phaseId
          ? { ...p, tasks: p.tasks.map(t => t.id === taskId ? { ...t, laborCompositions: t.laborCompositions?.filter(c => c.id !== compId) } : t) }
          : p
      ),
    };
    onProjectChange(updated);
  };

  const doubleTeam = (phaseId: string, taskId: string) => {
    const updated = {
      ...project,
      phases: project.phases.map(p =>
        p.id === phaseId
          ? {
              ...p,
              tasks: p.tasks.map(t =>
                t.id === taskId
                  ? { ...t, laborCompositions: t.laborCompositions?.map(c => ({ ...c, workerCount: c.workerCount * 2 })) }
                  : t
              ),
            }
          : p
      ),
    };
    onProjectChange(updated);
  };

  const simulateDouble = (task: Task) => {
    if (!task.laborCompositions?.length || !task.quantity) return null;
    const doubled = { ...task, laborCompositions: task.laborCompositions.map(c => ({ ...c, workerCount: c.workerCount * 2 })) };
    return calculateRupDuration(doubled);
  };

  // Get all task IDs for dependency dropdown
  const allTasks = project.phases.flatMap(p => p.tasks);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Estrutura Analítica (EAP)</h2>
          <p className="text-sm text-muted-foreground mt-1">Tarefas com cálculo RUP e composição de mão de obra</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setImportOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors shadow-sm"
          >
            <Upload className="w-4 h-4" /> Importar PDF/Excel
          </button>
          <button
            onClick={addPhase}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border bg-card text-foreground font-medium text-sm hover:bg-muted/50 transition-colors shadow-sm"
          >
            <FolderPlus className="w-4 h-4" /> Novo Capítulo
          </button>
        </div>
      </div>

      <ImportTasksDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        project={project}
        onProjectChange={onProjectChange}
      />

      {/* Legenda de equipes */}
      <div className="flex flex-wrap items-center gap-3 px-2 py-2 bg-card rounded-lg border border-border">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mr-1">Equipes:</span>
        {TEAM_CODES.map(code => {
          const def = getTeamDefinition(code)!;
          return (
            <div key={code} className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: def.bgColor, border: `1px solid ${def.borderColor}` }} />
              <span className="text-[10px] font-medium text-foreground">{def.label}</span>
              <span className="text-[9px] text-muted-foreground">({def.composition})</span>
            </div>
          );
        })}
      </div>

      <div className="space-y-3">
        {project.phases.map((phase, pi) => {
          const phaseProgress = phase.tasks.length ? Math.round(phase.tasks.reduce((s, t) => s + t.percentComplete, 0) / phase.tasks.length) : 0;
          const isExpanded = expandedPhases.has(phase.id);
          const hasCritical = phase.tasks.some(t => t.isCritical);

          return (
            <motion.div
              key={phase.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: pi * 0.05 }}
              className="bg-card rounded-xl border border-border shadow-sm overflow-hidden"
            >
              <div className="flex items-center">
                <button
                  onClick={() => togglePhase(phase.id)}
                  className="flex-1 flex items-center gap-3 px-5 py-4 hover:bg-muted/30 transition-colors"
                >
                  {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                  <div className="w-3 h-3 rounded-full" style={{ background: phase.color }} />
                  {editingPhase === phase.id ? (
                    <input
                      autoFocus
                      value={phaseNameDraft}
                      onChange={e => setPhaseNameDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') renamePhase(phase.id); if (e.key === 'Escape') setEditingPhase(null); }}
                      onClick={e => e.stopPropagation()}
                      className="text-sm font-bold text-foreground bg-transparent border border-primary rounded px-1.5 py-0.5 focus:outline-none w-40"
                    />
                  ) : (
                    <span className="text-sm font-bold text-foreground">{phase.name}</span>
                  )}
                  {hasCritical && <AlertTriangle className="w-3.5 h-3.5 text-destructive" />}
                  <span className="text-xs text-muted-foreground ml-1">({phase.tasks.length} tarefas)</span>
                  <div className="ml-auto flex items-center gap-3">
                    <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${phaseProgress}%` }} />
                    </div>
                    <span className="text-xs font-bold text-muted-foreground w-8 text-right">{phaseProgress}%</span>
                  </div>
                </button>

                {/* Phase actions */}
                <div className="flex items-center gap-1 mr-2">
                  {editingPhase === phase.id ? (
                    <button onClick={() => renamePhase(phase.id)} className="p-1.5 rounded hover:bg-success/20 text-success transition-colors" title="Salvar nome">
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      onClick={() => { setEditingPhase(phase.id); setPhaseNameDraft(phase.name); }}
                      className="p-1.5 rounded hover:bg-primary/20 text-muted-foreground hover:text-primary transition-colors"
                      title="Renomear capítulo"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => deletePhase(phase.id)}
                    className="p-1.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
                    title="Excluir capítulo"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <button
                  onClick={() => addTask(phase.id)}
                  className="mr-4 flex items-center gap-1 text-[10px] px-2.5 py-1.5 rounded-md bg-primary/10 text-primary font-medium hover:bg-primary/20 transition-colors"
                  title="Adicionar tarefa"
                >
                  <Plus className="w-3 h-3" /> Tarefa
                </button>
              </div>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                    <div className="border-t border-border">
                      <div className="grid gap-2 px-5 py-2 bg-secondary/50 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider" style={{ gridTemplateColumns: '36px 2fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr' }}>
                        <div>Eq.</div>
                        <div>Tarefa</div>
                        <div>Qtd.</div>
                        <div className="text-center">Prod. Diária</div>
                        <div>Responsável</div>
                        <div>Duração</div>
                        <div>Horas</div>
                        <div>Gargalo</div>
                        <div>Folga</div>
                        <div>Depend.</div>
                        <div>Progresso</div>
                        <div>Status</div>
                        <div>Ações</div>
                      </div>

                      {phase.tasks.map(task => {
                        const endDate = new Date(task.startDate);
                        endDate.setDate(endDate.getDate() + task.duration);
                        const isDelayed = endDate < new Date() && task.percentComplete < 100;
                        const showRup = expandedRup === task.id;
                        const sim = simulating === task.id ? simulateDouble(task) : null;
                        const isEditing = editingTask === task.id;

                        return (
                          <div
                            key={task.id}
                            draggable
                            onDragStart={() => handleDragStart(phase.id, task.id)}
                            onDragOver={(e) => handleDragOver(e, task.id)}
                            onDrop={(e) => handleDrop(e, phase.id, task.id)}
                            onDragEnd={handleDragEnd}
                            className={`${dropTargetId === task.id && dragTaskId !== task.id ? 'border-t-2 border-t-primary' : ''} ${dragTaskId === task.id ? 'opacity-40' : ''}`}
                          >
                            {(() => {
                              const rowTeam = getTeamDefinition(task.team);
                              return (
                            <div
                              className={`grid gap-2 px-5 py-3 border-t border-border hover:brightness-110 transition-colors items-center ${
                                !rowTeam ? (isDelayed ? 'bg-destructive/5' : task.isCritical ? 'bg-destructive/[0.03]' : '') : ''
                              }`}
                              style={{ gridTemplateColumns: '36px 2fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr', ...(rowTeam ? { backgroundColor: rowTeam.bgColor, color: rowTeam.textColor } : {}) }}
                            >
                              {/* Equipe inicial */}
                              <div className="flex items-center justify-center">
                                <select
                                  value={task.team || ''}
                                  onChange={e => updateTask(phase.id, task.id, { team: (e.target.value || undefined) as TeamCode | undefined })}
                                  className="w-8 h-7 text-[10px] font-bold text-center rounded cursor-pointer border-0 appearance-none"
                                  style={rowTeam
                                    ? { backgroundColor: rowTeam.bgColor, color: rowTeam.textColor, border: `2px solid ${rowTeam.borderColor}` }
                                    : { backgroundColor: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }
                                  }
                                  title="Selecionar equipe"
                                >
                                  <option value="">—</option>
                                  {TEAM_CODES.map(code => (
                                    <option key={code} value={code}>{getTeamDefinition(code)!.label.charAt(0)}</option>
                                  ))}
                                </select>
                              </div>
                              {/* Nome */}
                              <div className="flex items-center gap-1 min-w-0">
                                <GripVertical className={`w-3.5 h-3.5 cursor-grab active:cursor-grabbing flex-shrink-0 ${rowTeam ? 'opacity-50' : 'text-muted-foreground/50'}`} />
                                {task.isCritical && <div className="w-1.5 h-1.5 rounded-full bg-destructive flex-shrink-0" />}
                                {isEditing ? (
                                  <InlineInput
                                    value={task.name}
                                    onChange={v => updateTask(phase.id, task.id, { name: v })}
                                    className="flex-1 min-w-0"
                                  />
                                ) : (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button onClick={() => setExpandedRup(showRup ? null : task.id)} className={`text-xs font-medium truncate text-left transition-colors ${rowTeam ? 'hover:opacity-70' : 'text-foreground hover:text-primary'}`}>
                                        {truncateWords(task.name, 4)}
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="max-w-md whitespace-normal break-words">
                                      {task.name}
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                              </div>

                              {/* Quantidade + Unidade */}
                              <div className="flex items-center gap-0.5">
                                {isEditing ? (
                                  <>
                                    <InlineInput
                                      value={task.quantity || 0}
                                      onChange={v => updateTask(phase.id, task.id, { quantity: Number(v) })}
                                      type="number"
                                      min={0}
                                      className="w-12"
                                    />
                                    <InlineInput
                                      value={task.unit || ''}
                                      onChange={v => updateTask(phase.id, task.id, { unit: v })}
                                      className="w-8"
                                    />
                                  </>
                                ) : (
                                  <span className={`text-[10px] ${rowTeam ? 'opacity-70' : 'text-muted-foreground'}`}>{task.quantity ? `${task.quantity} ${task.unit}` : '—'}</span>
                                )}
                              </div>

                              {/* Produção Diária (auto) */}
                              <div className={`text-[10px] font-medium text-center ${rowTeam ? 'opacity-90' : 'text-foreground'}`}>
                                {getDailyProduction(task)}
                              </div>

                              {/* Responsável */}
                              <div className="">
                                {isEditing ? (
                                  <InlineInput
                                    value={task.responsible}
                                    onChange={v => updateTask(phase.id, task.id, { responsible: v })}
                                    className="w-full"
                                  />
                                ) : (
                                  <div className={`flex items-center gap-1 text-[10px] truncate ${rowTeam ? 'opacity-80' : 'text-muted-foreground'}`}>
                                    <User className="w-3 h-3 flex-shrink-0" />
                                    {task.responsible || '—'}
                                  </div>
                                )}
                              </div>

                              {/* Duração (auto) */}
                              <div className={`col-span-1 text-[10px] font-bold flex items-center gap-1 ${rowTeam ? '' : 'text-foreground'}`}>
                                <span>{task.duration}d</span>
                                <span className={`text-[8px] ${rowTeam ? 'opacity-60' : 'text-muted-foreground'}`}>🔒</span>
                                {task.baseline && task.baseline.duration !== task.duration && (() => {
                                  const dev = task.duration - task.baseline.duration;
                                  const cls = dev <= 0
                                    ? 'bg-success/15 text-success'
                                    : dev <= 2
                                      ? 'bg-warning/15 text-warning'
                                      : 'bg-destructive/15 text-destructive';
                                  return (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className={`text-[9px] px-1 py-0.5 rounded font-bold ${cls}`}>
                                          Δ {dev > 0 ? '+' : ''}{dev}d
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent side="top" className="text-[10px] space-y-0.5">
                                        <div><strong>Base:</strong> {formatISODateBR(task.baseline.startDate)} → {formatISODateBR(task.baseline.endDate)} ({task.baseline.duration}d)</div>
                                        <div><strong>Previsto:</strong> {formatISODateBR(task.current?.startDate ?? task.startDate)} → {formatISODateBR(task.current?.forecastEndDate ?? task.current?.endDate ?? task.startDate)} ({task.current?.duration ?? task.duration}d)</div>
                                        <div><strong>Desvio:</strong> {dev > 0 ? '+' : ''}{dev} dias</div>
                                        {task.accumulatedDelayQuantity !== undefined && (
                                          <div><strong>Saldo acumulado:</strong> {task.accumulatedDelayQuantity.toFixed(1)} {task.unit || 'un'}</div>
                                        )}
                                        {task.executedQuantityTotal !== undefined && (
                                          <div><strong>Executado:</strong> {task.executedQuantityTotal.toFixed(1)} {task.unit || 'un'}</div>
                                        )}
                                      </TooltipContent>
                                    </Tooltip>
                                  );
                                })()}
                              </div>

                              {/* Horas (auto) */}
                              <div className={`col-span-1 text-[10px] ${rowTeam ? 'opacity-80' : 'text-muted-foreground'}`}>
                                {task.totalHours ? `${Math.round(task.totalHours)}h` : `${task.duration * DAILY_HOURS}h`}
                              </div>

                              {/* Gargalo */}
                              <div className="">
                                {task.bottleneckRole ? (
                                  <span
                                    title={task.bottleneckRole}
                                    className={`text-[9px] px-1 py-0.5 rounded font-medium truncate block text-center ${rowTeam ? 'bg-white/20' : 'bg-warning/15 text-warning'}`}
                                  >
                                    {abbreviateRole(task.bottleneckRole)}
                                  </span>
                                ) : <span className={`text-[10px] ${rowTeam ? 'opacity-60' : 'text-muted-foreground'}`}>—</span>}
                              </div>

                              {/* Folga */}
                              <div className="">
                                <span className={`text-[10px] font-bold ${rowTeam ? '' : (task.float === 0 ? 'text-destructive' : 'text-success')}`}>
                                  {task.float !== undefined ? `${task.float}d` : '—'}
                                </span>
                              </div>

                              {/* Dependências */}
                              <div className="">
                                {isEditing ? (
                                  <select
                                    multiple
                                    value={task.dependencies}
                                    onChange={e => {
                                      const selected = Array.from(e.target.selectedOptions, o => o.value);
                                      updateTask(phase.id, task.id, { dependencies: selected });
                                    }}
                                    className="w-full text-[9px] bg-transparent border border-current/30 rounded px-1 py-0.5"
                                    style={rowTeam ? { color: 'inherit' } : undefined}
                                  >
                                    {allTasks.filter(t => t.id !== task.id).map(t => (
                                      <option key={t.id} value={t.id}>{t.name}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <span className={`text-[9px] ${rowTeam ? 'opacity-70' : 'text-muted-foreground'}`}>
                                    {task.dependencies.length > 0
                                      ? task.dependencies.map(d => allTasks.find(t => t.id === d)?.name?.slice(0, 8) || d).join(', ')
                                      : '—'}
                                  </span>
                                )}
                              </div>

                              {/* Progresso */}
                              <div className="">
                                <div className="flex items-center gap-1">
                                  <div className={`flex-1 h-1.5 rounded-full overflow-hidden ${rowTeam ? 'bg-white/20' : 'bg-muted'}`}>
                                    <div
                                      className={`h-full rounded-full transition-all ${rowTeam ? 'bg-white/70' : (isDelayed ? 'bg-destructive' : 'bg-primary')}`}
                                      style={{ width: `${task.percentComplete}%` }}
                                    />
                                  </div>
                                  <input
                                    type="number"
                                    min={0}
                                    max={100}
                                    value={task.percentComplete}
                                    onChange={e => updateTask(phase.id, task.id, { percentComplete: Math.min(100, Math.max(0, Number(e.target.value))) })}
                                    className={`w-9 text-[10px] font-bold text-center bg-transparent border rounded px-0.5 py-0.5 ${rowTeam ? 'border-current/30' : 'border-border'}`}
                                    style={rowTeam ? { color: 'inherit' } : undefined}
                                  />
                                </div>
                              </div>

                              {/* Status (auto) */}
                              <div className="">
                                <StatusBadge percent={task.percentComplete} />
                              </div>

                              {/* Ações */}
                              <div className="flex items-center gap-1">
                                {isEditing ? (
                                  <button onClick={() => setEditingTask(null)} className="p-1 rounded hover:bg-success/20 text-success transition-colors" title="Salvar">
                                    <Check className="w-3 h-3" />
                                  </button>
                                ) : (
                                  <button onClick={() => { setEditingTask(task.id); setExpandedRup(task.id); }} className="p-1 rounded hover:bg-primary/20 text-primary transition-colors" title="Editar">
                                    <Edit3 className="w-3 h-3" />
                                  </button>
                                )}
                                <button
                                  onClick={() => setExpandedDaily(expandedDaily === task.id ? null : task.id)}
                                  className={`p-1 rounded transition-colors ${expandedDaily === task.id ? 'bg-info/30 text-info' : 'hover:bg-info/20 text-info'}`}
                                  title="Apontamento diário de produção"
                                >
                                  <ClipboardList className="w-3 h-3" />
                                </button>
                                <button onClick={() => duplicateTask(phase.id, task)} className="p-1 rounded hover:bg-info/20 text-info transition-colors" title="Duplicar">
                                  <Copy className="w-3 h-3" />
                                </button>
                                <button onClick={() => deleteTask(phase.id, task.id)} className="p-1 rounded hover:bg-destructive/20 text-destructive transition-colors" title="Excluir">
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                              );
                            })()}

                            {/* RUP detail panel */}
                            <AnimatePresence>
                              {showRup && task.laborCompositions?.length !== undefined && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  className="overflow-hidden border-t border-border bg-muted/20"
                                >
                                  <div className="px-8 py-3 space-y-3">
                                    <div className="flex items-center justify-between flex-wrap gap-2">
                                      <h4 className="text-[11px] font-semibold text-foreground flex items-center gap-1.5">
                                        <Zap className="w-3.5 h-3.5 text-warning" />
                                        Composição RUP — {task.quantity} {task.unit}
                                      </h4>
                                      <div className="flex items-center gap-2">
                                        <button
                                          onClick={() => addLabor(phase.id, task.id)}
                                          className="text-[10px] px-2 py-1 rounded-md bg-primary/10 text-primary font-medium hover:bg-primary/20 transition-colors flex items-center gap-1"
                                        >
                                          <Plus className="w-3 h-3" /> Profissional
                                        </button>
                                        <button
                                          onClick={() => doubleTeam(phase.id, task.id)}
                                          className="text-[10px] px-2 py-1 rounded-md bg-warning/10 text-warning font-medium hover:bg-warning/20 transition-colors"
                                        >
                                          ⚡ Dobrar equipe
                                        </button>
                                        <button
                                          onClick={() => setSimulating(simulating === task.id ? null : task.id)}
                                          className="text-[10px] px-2 py-1 rounded-md bg-info/10 text-info font-medium hover:bg-info/20 transition-colors"
                                        >
                                          {simulating === task.id ? 'Ocultar simulação' : '📊 Simular'}
                                        </button>
                                      </div>
                                    </div>

                                    <div className="grid grid-cols-6 gap-2 text-[10px] font-semibold text-muted-foreground uppercase">
                                      <div>Profissional</div>
                                      <div className="text-center">RUP (h/{task.unit})</div>
                                      <div className="text-center">Qtd. Trab.</div>
                                      <div className="text-center">Tempo total</div>
                                      <div className="text-center">Tempo efetivo</div>
                                      <div className="text-center">Ação</div>
                                    </div>

                                    {(task.laborCompositions || []).map(comp => {
                                      const totalH = (task.quantity || 0) * comp.rup;
                                      const effectiveH = totalH / comp.workerCount;
                                      const isBottleneck = comp.role === task.bottleneckRole;
                                      return (
                                        <div key={comp.id} className={`grid grid-cols-6 gap-2 text-[11px] items-center py-1 ${isBottleneck ? 'text-warning font-semibold' : 'text-foreground'}`}>
                                          <div className="flex items-center gap-1">
                                            <Users className="w-3 h-3" />
                                            {isEditing ? (
                                              <InlineInput
                                                value={comp.role}
                                                onChange={v => updateLaborComp(phase.id, task.id, comp.id, { role: v })}
                                                className="w-24"
                                              />
                                            ) : (
                                              <>
                                                {comp.role}
                                                {isBottleneck && <span className="text-[8px] bg-warning/20 text-warning px-1 rounded">GARGALO</span>}
                                              </>
                                            )}
                                          </div>
                                          <div className="text-center">
                                            {isEditing ? (
                                              <InlineInput
                                                value={comp.rup}
                                                onChange={v => updateLaborComp(phase.id, task.id, comp.id, { rup: Math.max(0.01, Number(v)) })}
                                                type="number"
                                                step={0.01}
                                                min={0.01}
                                                className="w-14 text-center"
                                              />
                                            ) : comp.rup}
                                          </div>
                                          <div className="text-center">
                                            <input
                                              type="number"
                                              min={1}
                                              value={comp.workerCount}
                                              onChange={e => updateLaborComp(phase.id, task.id, comp.id, { workerCount: Math.max(1, Number(e.target.value)) })}
                                              className="w-12 text-center bg-transparent border border-border rounded px-1 py-0.5 text-[11px]"
                                            />
                                          </div>
                                          <div className="text-center">{Math.round(totalH)}h</div>
                                          <div className="text-center">{Math.round(effectiveH)}h</div>
                                          <div className="text-center">
                                            {(task.laborCompositions?.length || 0) > 1 && (
                                              <button
                                                onClick={() => removeLabor(phase.id, task.id, comp.id)}
                                                className="p-1 rounded hover:bg-destructive/20 text-destructive transition-colors"
                                                title="Remover"
                                              >
                                                <X className="w-3 h-3" />
                                              </button>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })}

                                    {sim && (
                                      <div className="mt-2 p-2.5 rounded-lg bg-info/10 border border-info/20">
                                        <p className="text-[11px] text-info font-medium">
                                          ⚡ Simulação: dobrando a equipe → <strong>{sim.duration} dias</strong> ({Math.round(sim.totalHours)}h)
                                          {sim.duration < task.duration && (
                                            <span className="text-success ml-1">(reduz {task.duration - sim.duration} dias!)</span>
                                          )}
                                        </p>
                                      </div>
                                    )}

                                    {task.isCritical && (
                                      <div className="p-2.5 rounded-lg bg-destructive/10 border border-destructive/20 flex items-start gap-2">
                                        <AlertTriangle className="w-3.5 h-3.5 text-destructive flex-shrink-0 mt-0.5" />
                                        <p className="text-[10px] text-destructive">
                                          Esta tarefa está no <strong>Caminho Crítico</strong> — qualquer atraso impacta o prazo final. Considere aumentar a equipe de <strong>{task.bottleneckRole}</strong>.
                                        </p>
                                      </div>
                                    )}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>

                            {/* Daily production log panel */}
                            <AnimatePresence>
                              {expandedDaily === task.id && (
                                <DailyLogsPanel
                                  task={task}
                                  onChange={(logs: DailyProductionLog[]) => {
                                    if (logs.length === 0) {
                                      updateTask(phase.id, task.id, {
                                        dailyLogs: logs,
                                        current: undefined,
                                        executedQuantityTotal: 0,
                                        remainingQuantity: task.quantity,
                                        physicalProgress: 0,
                                        percentComplete: 0,
                                      });
                                      return;
                                    }

                                    const logsComQty = logs.filter(l => (l.actualQuantity ?? 0) > 0);
                                    if (logsComQty.length === 0) {
                                      updateTask(phase.id, task.id, { dailyLogs: logs });
                                      return;
                                    }

                                    const sorted = [...logsComQty].sort((a, b) => a.date.localeCompare(b.date));
                                    const realStartDate = sorted[0].date;
                                    const lastLogDate = sorted[sorted.length - 1].date;

                                    const executedTotal = logsComQty.reduce((s, l) => s + l.actualQuantity, 0);
                                    const remaining = Math.max(0, (task.quantity || 0) - executedTotal);
                                    const physicalProgress = task.quantity
                                      ? Math.min(100, (executedTotal / task.quantity) * 100)
                                      : 0;

                                    const avgDaily = executedTotal / logsComQty.length;
                                    const daysRemaining = avgDaily > 0 ? Math.ceil(remaining / avgDaily) : 0;

                                    const [ly, lm, ld] = lastLogDate.split('-').map(Number);
                                    const forecastDate = new Date(ly, lm - 1, ld + daysRemaining);
                                    const forecastEndDate = `${forecastDate.getFullYear()}-${String(forecastDate.getMonth() + 1).padStart(2, '0')}-${String(forecastDate.getDate()).padStart(2, '0')}`;

                                    const [ry, rm, rd] = realStartDate.split('-').map(Number);
                                    const startMs = new Date(ry, rm - 1, rd).getTime();
                                    const lastMs = new Date(ly, lm - 1, ld).getTime();
                                    const currentDuration = Math.max(1, Math.round((lastMs - startMs) / 86400000) + 1);

                                    updateTask(phase.id, task.id, {
                                      dailyLogs: logs,
                                      executedQuantityTotal: executedTotal,
                                      remainingQuantity: remaining,
                                      physicalProgress,
                                      percentComplete: Math.round(physicalProgress),
                                      current: {
                                        startDate: realStartDate,
                                        duration: currentDuration,
                                        endDate: lastLogDate,
                                        forecastEndDate,
                                        executedQuantityTotal: executedTotal,
                                        remainingQuantity: remaining,
                                        physicalProgress,
                                      },
                                    });
                                  }}
                                />
                              )}
                            </AnimatePresence>
                          </div>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
