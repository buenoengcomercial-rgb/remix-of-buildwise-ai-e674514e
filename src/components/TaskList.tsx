import { Project, Task, LaborComposition } from '@/types/project';
import { useState } from 'react';
import { ChevronDown, ChevronRight, User, Zap, Users, AlertTriangle, Plus, Copy, Trash2, Edit3, Check, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { calculateRupDuration } from '@/lib/calculations';

interface TaskListProps {
  project: Project;
  onProjectChange: (project: Project) => void;
}

const DAILY_HOURS = 8;

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
      className={`bg-transparent border border-border rounded px-1.5 py-0.5 text-[11px] focus:border-primary focus:outline-none transition-colors ${className}`}
    />
  );
}

export default function TaskList({ project, onProjectChange }: TaskListProps) {
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set(project.phases.map(p => p.id)));
  const [expandedRup, setExpandedRup] = useState<string | null>(null);
  const [simulating, setSimulating] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<string | null>(null);

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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Estrutura Analítica (EAP)</h2>
          <p className="text-sm text-muted-foreground mt-1">Tarefas com cálculo RUP e composição de mão de obra</p>
        </div>
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
                  <span className="text-sm font-bold text-foreground">{phase.name}</span>
                  {hasCritical && <AlertTriangle className="w-3.5 h-3.5 text-destructive" />}
                  <span className="text-xs text-muted-foreground ml-1">({phase.tasks.length} tarefas)</span>
                  <div className="ml-auto flex items-center gap-3">
                    <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${phaseProgress}%` }} />
                    </div>
                    <span className="text-xs font-bold text-muted-foreground w-8 text-right">{phaseProgress}%</span>
                  </div>
                </button>
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
                      <div className="grid grid-cols-12 gap-2 px-5 py-2 bg-secondary/50 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                        <div className="col-span-2">Tarefa</div>
                        <div className="col-span-1">Qtd.</div>
                        <div className="col-span-1">Responsável</div>
                        <div className="col-span-1">Duração</div>
                        <div className="col-span-1">Horas</div>
                        <div className="col-span-1">Gargalo</div>
                        <div className="col-span-1">Folga</div>
                        <div className="col-span-1">Depend.</div>
                        <div className="col-span-1">Progresso</div>
                        <div className="col-span-1">Status</div>
                        <div className="col-span-1">Ações</div>
                      </div>

                      {phase.tasks.map(task => {
                        const endDate = new Date(task.startDate);
                        endDate.setDate(endDate.getDate() + task.duration);
                        const isDelayed = endDate < new Date() && task.percentComplete < 100;
                        const showRup = expandedRup === task.id;
                        const sim = simulating === task.id ? simulateDouble(task) : null;
                        const isEditing = editingTask === task.id;

                        return (
                          <div key={task.id}>
                            <div
                              className={`grid grid-cols-12 gap-2 px-5 py-3 border-t border-border hover:bg-muted/20 transition-colors items-center ${
                                isDelayed ? 'bg-destructive/5' : task.isCritical ? 'bg-destructive/[0.03]' : ''
                              }`}
                            >
                              {/* Nome */}
                              <div className="col-span-2 flex items-center gap-1 min-w-0">
                                {task.isCritical && <div className="w-1.5 h-1.5 rounded-full bg-destructive flex-shrink-0" />}
                                {isEditing ? (
                                  <InlineInput
                                    value={task.name}
                                    onChange={v => updateTask(phase.id, task.id, { name: v })}
                                    className="w-full"
                                  />
                                ) : (
                                  <button onClick={() => setExpandedRup(showRup ? null : task.id)} className="text-xs font-medium text-foreground truncate text-left hover:text-primary transition-colors">
                                    {task.name}
                                  </button>
                                )}
                              </div>

                              {/* Quantidade + Unidade */}
                              <div className="col-span-1 flex items-center gap-0.5">
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
                                  <span className="text-[10px] text-muted-foreground">{task.quantity ? `${task.quantity} ${task.unit}` : '—'}</span>
                                )}
                              </div>

                              {/* Responsável */}
                              <div className="col-span-1">
                                {isEditing ? (
                                  <InlineInput
                                    value={task.responsible}
                                    onChange={v => updateTask(phase.id, task.id, { responsible: v })}
                                    className="w-full"
                                  />
                                ) : (
                                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground truncate">
                                    <User className="w-3 h-3 flex-shrink-0" />
                                    {task.responsible || '—'}
                                  </div>
                                )}
                              </div>

                              {/* Duração (auto) */}
                              <div className="col-span-1 text-[10px] font-bold text-foreground">
                                {task.duration}d
                                <span className="text-[8px] text-muted-foreground ml-0.5">🔒</span>
                              </div>

                              {/* Horas (auto) */}
                              <div className="col-span-1 text-[10px] text-muted-foreground">
                                {task.totalHours ? `${Math.round(task.totalHours)}h` : `${task.duration * DAILY_HOURS}h`}
                              </div>

                              {/* Gargalo */}
                              <div className="col-span-1">
                                {task.bottleneckRole ? (
                                  <span className="text-[9px] px-1 py-0.5 rounded bg-warning/15 text-warning font-medium truncate block text-center">
                                    {task.bottleneckRole}
                                  </span>
                                ) : <span className="text-[10px] text-muted-foreground">—</span>}
                              </div>

                              {/* Folga */}
                              <div className="col-span-1">
                                <span className={`text-[10px] font-bold ${task.float === 0 ? 'text-destructive' : 'text-success'}`}>
                                  {task.float !== undefined ? `${task.float}d` : '—'}
                                </span>
                              </div>

                              {/* Dependências */}
                              <div className="col-span-1">
                                {isEditing ? (
                                  <select
                                    multiple
                                    value={task.dependencies}
                                    onChange={e => {
                                      const selected = Array.from(e.target.selectedOptions, o => o.value);
                                      updateTask(phase.id, task.id, { dependencies: selected });
                                    }}
                                    className="w-full text-[9px] bg-transparent border border-border rounded px-1 py-0.5"
                                  >
                                    {allTasks.filter(t => t.id !== task.id).map(t => (
                                      <option key={t.id} value={t.id}>{t.name}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <span className="text-[9px] text-muted-foreground">
                                    {task.dependencies.length > 0
                                      ? task.dependencies.map(d => allTasks.find(t => t.id === d)?.name?.slice(0, 8) || d).join(', ')
                                      : '—'}
                                  </span>
                                )}
                              </div>

                              {/* Progresso */}
                              <div className="col-span-1">
                                <div className="flex items-center gap-1">
                                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full transition-all ${isDelayed ? 'bg-destructive' : 'bg-primary'}`}
                                      style={{ width: `${task.percentComplete}%` }}
                                    />
                                  </div>
                                  <input
                                    type="number"
                                    min={0}
                                    max={100}
                                    value={task.percentComplete}
                                    onChange={e => updateTask(phase.id, task.id, { percentComplete: Math.min(100, Math.max(0, Number(e.target.value))) })}
                                    className="w-9 text-[10px] font-bold text-center bg-transparent border border-border rounded px-0.5 py-0.5"
                                  />
                                </div>
                              </div>

                              {/* Status (auto) */}
                              <div className="col-span-1">
                                <StatusBadge percent={task.percentComplete} />
                              </div>

                              {/* Ações */}
                              <div className="col-span-1 flex items-center gap-1">
                                {isEditing ? (
                                  <button onClick={() => setEditingTask(null)} className="p-1 rounded hover:bg-success/20 text-success transition-colors" title="Salvar">
                                    <Check className="w-3 h-3" />
                                  </button>
                                ) : (
                                  <button onClick={() => { setEditingTask(task.id); setExpandedRup(task.id); }} className="p-1 rounded hover:bg-primary/20 text-primary transition-colors" title="Editar">
                                    <Edit3 className="w-3 h-3" />
                                  </button>
                                )}
                                <button onClick={() => duplicateTask(phase.id, task)} className="p-1 rounded hover:bg-info/20 text-info transition-colors" title="Duplicar">
                                  <Copy className="w-3 h-3" />
                                </button>
                                <button onClick={() => deleteTask(phase.id, task.id)} className="p-1 rounded hover:bg-destructive/20 text-destructive transition-colors" title="Excluir">
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>

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
