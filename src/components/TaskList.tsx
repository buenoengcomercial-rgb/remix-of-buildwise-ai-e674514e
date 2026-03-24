import { Project, Task } from '@/types/project';
import { useState } from 'react';
import { ChevronDown, ChevronRight, User, Calendar, Clock, Zap, Users, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { calculateRupDuration } from '@/lib/calculations';

interface TaskListProps {
  project: Project;
  onProjectChange: (project: Project) => void;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function StatusBadge({ percent }: { percent: number }) {
  if (percent === 100) return <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-success/15 text-success">Concluído</span>;
  if (percent > 0) return <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-primary/15 text-primary">Em andamento</span>;
  return <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-muted text-muted-foreground">Pendente</span>;
}

export default function TaskList({ project, onProjectChange }: TaskListProps) {
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set(project.phases.map(p => p.id)));
  const [expandedRup, setExpandedRup] = useState<string | null>(null);
  const [simulating, setSimulating] = useState<string | null>(null);

  const togglePhase = (id: string) => {
    setExpandedPhases(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const updateTaskPercent = (phaseId: string, taskId: string, value: number) => {
    const updated = {
      ...project,
      phases: project.phases.map(p =>
        p.id === phaseId
          ? { ...p, tasks: p.tasks.map(t => (t.id === taskId ? { ...t, percentComplete: value } : t)) }
          : p
      ),
    };
    onProjectChange(updated);
  };

  const updateWorkerCount = (phaseId: string, taskId: string, compId: string, count: number) => {
    const updated = {
      ...project,
      phases: project.phases.map(p =>
        p.id === phaseId
          ? {
              ...p,
              tasks: p.tasks.map(t =>
                t.id === taskId
                  ? { ...t, laborCompositions: t.laborCompositions?.map(c => c.id === compId ? { ...c, workerCount: Math.max(1, count) } : c) }
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
    const doubled = {
      ...task,
      laborCompositions: task.laborCompositions.map(c => ({ ...c, workerCount: c.workerCount * 2 })),
    };
    return calculateRupDuration(doubled);
  };

  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Estrutura Analítica (EAP)</h2>
        <p className="text-sm text-muted-foreground mt-1">Tarefas com cálculo RUP e composição de mão de obra</p>
      </div>

      <div className="space-y-3">
        {project.phases.map((phase, pi) => {
          const phaseProgress = Math.round(phase.tasks.reduce((s, t) => s + t.percentComplete, 0) / phase.tasks.length);
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
              <button
                onClick={() => togglePhase(phase.id)}
                className="w-full flex items-center gap-3 px-5 py-4 hover:bg-muted/30 transition-colors"
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

              <AnimatePresence>
                {isExpanded && (
                  <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                    <div className="border-t border-border">
                      <div className="grid grid-cols-12 gap-2 px-5 py-2 bg-secondary/50 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                        <div className="col-span-2">Tarefa</div>
                        <div className="col-span-1">Qtd.</div>
                        <div className="col-span-2">Responsável</div>
                        <div className="col-span-1">Duração</div>
                        <div className="col-span-1">Horas</div>
                        <div className="col-span-1">Gargalo</div>
                        <div className="col-span-1">Folga</div>
                        <div className="col-span-2">Progresso</div>
                        <div className="col-span-1">Status</div>
                      </div>

                      {phase.tasks.map(task => {
                        const endDate = new Date(task.startDate);
                        endDate.setDate(endDate.getDate() + task.duration);
                        const isDelayed = endDate < new Date() && task.percentComplete < 100;
                        const showRup = expandedRup === task.id;
                        const sim = simulating === task.id ? simulateDouble(task) : null;

                        return (
                          <div key={task.id}>
                            <div
                              className={`grid grid-cols-12 gap-2 px-5 py-3 border-t border-border hover:bg-muted/20 transition-colors items-center ${
                                isDelayed ? 'bg-destructive/5' : task.isCritical ? 'bg-destructive/[0.03]' : ''
                              }`}
                            >
                              <div className="col-span-2 flex items-center gap-1.5 min-w-0">
                                {task.isCritical && <div className="w-1.5 h-1.5 rounded-full bg-destructive flex-shrink-0" />}
                                {isDelayed && <div className="w-1.5 h-1.5 rounded-full bg-destructive animate-pulse flex-shrink-0" />}
                                <button onClick={() => setExpandedRup(showRup ? null : task.id)} className="text-xs font-medium text-foreground truncate text-left hover:text-primary transition-colors">
                                  {task.name}
                                </button>
                              </div>
                              <div className="col-span-1 text-[10px] text-muted-foreground">
                                {task.quantity ? `${task.quantity} ${task.unit}` : '—'}
                              </div>
                              <div className="col-span-2 flex items-center gap-1 text-[10px] text-muted-foreground truncate">
                                <User className="w-3 h-3 flex-shrink-0" />
                                {task.responsible}
                              </div>
                              <div className="col-span-1 text-[10px] font-bold text-foreground">
                                {task.duration}d
                              </div>
                              <div className="col-span-1 text-[10px] text-muted-foreground">
                                {task.totalHours ? `${Math.round(task.totalHours)}h` : '—'}
                              </div>
                              <div className="col-span-1">
                                {task.bottleneckRole ? (
                                  <span className="text-[9px] px-1 py-0.5 rounded bg-warning/15 text-warning font-medium truncate block text-center">
                                    {task.bottleneckRole}
                                  </span>
                                ) : <span className="text-[10px] text-muted-foreground">—</span>}
                              </div>
                              <div className="col-span-1">
                                <span className={`text-[10px] font-bold ${task.float === 0 ? 'text-destructive' : 'text-success'}`}>
                                  {task.float !== undefined ? `${task.float}d` : '—'}
                                </span>
                              </div>
                              <div className="col-span-2">
                                <div className="flex items-center gap-2">
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
                                    onChange={e => updateTaskPercent(phase.id, task.id, Number(e.target.value))}
                                    className="w-10 text-[10px] font-bold text-center bg-transparent border border-border rounded px-1 py-0.5"
                                  />
                                </div>
                              </div>
                              <div className="col-span-1">
                                <StatusBadge percent={task.percentComplete} />
                              </div>
                            </div>

                            {/* RUP detail panel */}
                            <AnimatePresence>
                              {showRup && task.laborCompositions?.length && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  className="overflow-hidden border-t border-border bg-muted/20"
                                >
                                  <div className="px-8 py-3 space-y-3">
                                    <div className="flex items-center justify-between">
                                      <h4 className="text-[11px] font-semibold text-foreground flex items-center gap-1.5">
                                        <Zap className="w-3.5 h-3.5 text-warning" />
                                        Composição RUP — {task.quantity} {task.unit}
                                      </h4>
                                      <button
                                        onClick={() => setSimulating(simulating === task.id ? null : task.id)}
                                        className="text-[10px] px-2 py-1 rounded-md bg-info/10 text-info font-medium hover:bg-info/20 transition-colors"
                                      >
                                        {simulating === task.id ? 'Ocultar simulação' : '⚡ E se dobrar equipe?'}
                                      </button>
                                    </div>

                                    <div className="grid grid-cols-5 gap-2 text-[10px] font-semibold text-muted-foreground uppercase">
                                      <div>Profissional</div>
                                      <div className="text-center">RUP (h/{task.unit})</div>
                                      <div className="text-center">Qtd. Trab.</div>
                                      <div className="text-center">Tempo total</div>
                                      <div className="text-center">Tempo efetivo</div>
                                    </div>
                                    {task.laborCompositions.map(comp => {
                                      const totalH = (task.quantity || 0) * comp.rup;
                                      const effectiveH = totalH / comp.workerCount;
                                      const isBottleneck = comp.role === task.bottleneckRole;
                                      return (
                                        <div key={comp.id} className={`grid grid-cols-5 gap-2 text-[11px] items-center py-1 ${isBottleneck ? 'text-warning font-semibold' : 'text-foreground'}`}>
                                          <div className="flex items-center gap-1">
                                            <Users className="w-3 h-3" />
                                            {comp.role}
                                            {isBottleneck && <span className="text-[8px] bg-warning/20 text-warning px-1 rounded">GARGALO</span>}
                                          </div>
                                          <div className="text-center">{comp.rup}</div>
                                          <div className="text-center">
                                            <input
                                              type="number"
                                              min={1}
                                              value={comp.workerCount}
                                              onChange={e => updateWorkerCount(phase.id, task.id, comp.id, Number(e.target.value))}
                                              className="w-12 text-center bg-transparent border border-border rounded px-1 py-0.5 text-[11px]"
                                            />
                                          </div>
                                          <div className="text-center">{Math.round(totalH)}h</div>
                                          <div className="text-center">{Math.round(effectiveH)}h</div>
                                        </div>
                                      );
                                    })}

                                    {sim && (
                                      <div className="mt-2 p-2.5 rounded-lg bg-info/10 border border-info/20">
                                        <p className="text-[11px] text-info font-medium">
                                          ⚡ Simulação: dobrando a equipe → <strong>{sim.duration} dias</strong> ({Math.round(sim.totalHours)}h)
                                          {sim.duration < task.duration && (
                                            <span className="text-success ml-1">
                                              (reduz {task.duration - sim.duration} dias!)
                                            </span>
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
