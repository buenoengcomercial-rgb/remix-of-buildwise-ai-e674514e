import { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Project, Phase } from '@/types/project';
import { Upload, FileSpreadsheet, FileText, AlertTriangle, Check, X, Loader2, Wand2, Eye, ChevronDown, ChevronRight, Users } from 'lucide-react';
import { ParsedTask, parseExcel, parsePDF, convertToProjectTasks, standardizeSinapi } from '@/lib/importParser';
import { motion, AnimatePresence } from 'framer-motion';

interface ImportTasksDialogProps {
  open: boolean;
  onClose: () => void;
  project: Project;
  onProjectChange: (project: Project) => void;
}

type Step = 'upload' | 'preview' | 'mapping';

const PHASE_COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--info))',
  'hsl(var(--warning))',
  'hsl(var(--success))',
  'hsl(var(--destructive))',
  'hsl(210, 60%, 50%)',
  'hsl(280, 50%, 55%)',
  'hsl(160, 50%, 45%)',
];

export default function ImportTasksDialog({ open, onClose, project, onProjectChange }: ImportTasksDialogProps) {
  const [step, setStep] = useState<Step>('upload');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [parsedTasks, setParsedTasks] = useState<ParsedTask[]>([]);
  const [selectedTasks, setSelectedTasks] = useState<Set<number>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const reset = () => {
    setStep('upload');
    setLoading(false);
    setError('');
    setFileName('');
    setParsedTasks([]);
    setSelectedTasks(new Set());
    setExpandedGroups(new Set());
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFile = useCallback(async (file: File) => {
    setLoading(true);
    setError('');
    setFileName(file.name);

    try {
      const buffer = await file.arrayBuffer();
      let tasks: ParsedTask[];

      if (file.name.endsWith('.pdf')) {
        tasks = await parsePDF(buffer);
      } else {
        tasks = parseExcel(buffer);
      }

      if (tasks.length === 0) {
        setError('Nenhuma composição foi encontrada no arquivo. Verifique o formato.');
        setLoading(false);
        return;
      }

      setParsedTasks(tasks);
      setSelectedTasks(new Set(tasks.map((_, i) => i)));
      setExpandedGroups(new Set([...new Set(tasks.map(t => t.group))]));
      setStep('preview');
    } catch (err: any) {
      setError(`Erro ao processar arquivo: ${err.message || 'formato não reconhecido'}`);
    }
    setLoading(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleStandardize = () => {
    setParsedTasks(standardizeSinapi(parsedTasks));
  };

  const toggleTask = (idx: number) => {
    setSelectedTasks(prev => {
      const n = new Set(prev);
      n.has(idx) ? n.delete(idx) : n.add(idx);
      return n;
    });
  };

  const toggleGroup = (group: string) => {
    setExpandedGroups(prev => {
      const n = new Set(prev);
      n.has(group) ? n.delete(group) : n.add(group);
      return n;
    });
  };

  const selectAllInGroup = (group: string, select: boolean) => {
    setSelectedTasks(prev => {
      const n = new Set(prev);
      parsedTasks.forEach((t, i) => {
        if (t.group === group) select ? n.add(i) : n.delete(i);
      });
      return n;
    });
  };

  const confirmImport = () => {
    const selected = parsedTasks.filter((_, i) => selectedTasks.has(i));
    if (selected.length === 0) return;

    const { groups } = convertToProjectTasks(selected, project.startDate);
    let colorIdx = project.phases.length;

    const updatedPhases = [...project.phases];

    groups.forEach((tasks, groupName) => {
      // Check if phase already exists
      const existingPhase = updatedPhases.find(p => p.name.toLowerCase() === groupName.toLowerCase());
      if (existingPhase) {
        existingPhase.tasks = [...existingPhase.tasks, ...tasks];
      } else {
        const newPhase: Phase = {
          id: `phase-imp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: groupName,
          color: PHASE_COLORS[colorIdx % PHASE_COLORS.length],
          tasks,
        };
        updatedPhases.push(newPhase);
        colorIdx++;
      }
    });

    onProjectChange({ ...project, phases: updatedPhases });
    handleClose();
  };

  // Group tasks for preview
  const groupedTasks = new Map<string, { tasks: ParsedTask[]; indices: number[] }>();
  parsedTasks.forEach((t, i) => {
    if (!groupedTasks.has(t.group)) groupedTasks.set(t.group, { tasks: [], indices: [] });
    groupedTasks.get(t.group)!.tasks.push(t);
    groupedTasks.get(t.group)!.indices.push(i);
  });

  const reviewCount = parsedTasks.filter(t => t.needsReview).length;
  const selectedCount = selectedTasks.size;

  return (
    <Dialog open={open} onOpenChange={v => !v && handleClose()}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <Upload className="w-5 h-5 text-primary" />
            Importar Tarefas (PDF / Excel)
          </DialogTitle>
          <DialogDescription>
            {step === 'upload' && 'Envie um arquivo PDF (SINAPI) ou Excel com composições de serviços.'}
            {step === 'preview' && `${parsedTasks.length} composições detectadas — revise e confirme a importação.`}
          </DialogDescription>
        </DialogHeader>

        {/* ── Upload step ── */}
        {step === 'upload' && (
          <div className="flex-1 flex flex-col items-center justify-center py-8">
            <div
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
              className="w-full border-2 border-dashed border-border rounded-xl p-12 flex flex-col items-center gap-4 hover:border-primary/50 hover:bg-primary/5 transition-colors cursor-pointer"
              onClick={() => document.getElementById('import-file-input')?.click()}
            >
              {loading ? (
                <Loader2 className="w-10 h-10 text-primary animate-spin" />
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <FileText className="w-8 h-8 text-destructive/60" />
                    <FileSpreadsheet className="w-8 h-8 text-success/60" />
                  </div>
                  <p className="text-sm font-medium text-foreground">Arraste e solte ou clique para selecionar</p>
                  <p className="text-xs text-muted-foreground">PDF (SINAPI / relatórios RUP) • Excel (.xlsx) • CSV</p>
                </>
              )}
            </div>
            <input
              id="import-file-input"
              type="file"
              accept=".pdf,.xlsx,.xls,.csv"
              className="hidden"
              onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
            />

            {error && (
              <div className="mt-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 flex items-start gap-2 w-full">
                <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                <p className="text-xs text-destructive">{error}</p>
              </div>
            )}
          </div>
        )}

        {/* ── Preview step ── */}
        {step === 'preview' && (
          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {/* Summary bar */}
            <div className="flex items-center justify-between flex-wrap gap-2 px-1">
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  📄 {fileName}
                </span>
                <span className="text-xs font-bold text-foreground">
                  {selectedCount}/{parsedTasks.length} selecionadas
                </span>
                {reviewCount > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-warning/15 text-warning font-medium flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> {reviewCount} para revisar
                  </span>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={handleStandardize} className="text-xs gap-1">
                <Wand2 className="w-3 h-3" /> Padronizar SINAPI
              </Button>
            </div>

            {/* Grouped tasks */}
            {Array.from(groupedTasks.entries()).map(([group, { tasks, indices }]) => {
              const isExpanded = expandedGroups.has(group);
              const allSelected = indices.every(i => selectedTasks.has(i));

              return (
                <div key={group} className="border border-border rounded-lg overflow-hidden bg-card">
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-secondary/30">
                    <button onClick={() => toggleGroup(group)} className="text-muted-foreground hover:text-foreground transition-colors">
                      {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={e => selectAllInGroup(group, e.target.checked)}
                      className="rounded border-border"
                    />
                    <span className="text-xs font-bold text-foreground">{group}</span>
                    <span className="text-[10px] text-muted-foreground">({tasks.length} tarefas)</span>
                  </div>

                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                        <div className="divide-y divide-border">
                          {tasks.map((task, ti) => {
                            const globalIdx = indices[ti];
                            const isSelected = selectedTasks.has(globalIdx);

                            return (
                              <div key={globalIdx} className={`px-4 py-2 ${task.needsReview ? 'bg-warning/5' : ''}`}>
                                <div className="flex items-start gap-2">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => toggleTask(globalIdx)}
                                    className="mt-1 rounded border-border"
                                  />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      {task.code && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">{task.code}</span>
                                      )}
                                      <span className="text-xs font-medium text-foreground truncate">{task.name}</span>
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">{task.quantity} {task.unit}</span>
                                      {task.needsReview && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/15 text-warning flex items-center gap-0.5">
                                          <AlertTriangle className="w-2.5 h-2.5" /> Revisar
                                        </span>
                                      )}
                                    </div>

                                    {task.labor.length > 0 && (
                                      <div className="mt-1.5 flex items-center gap-3 flex-wrap">
                                        {task.labor.map((l, li) => (
                                          <span key={li} className="text-[10px] text-muted-foreground flex items-center gap-1">
                                            <Users className="w-2.5 h-2.5" />
                                            {l.role}: <strong className="text-foreground">{l.rup} h/{task.unit}</strong>
                                            <span className="text-muted-foreground/60">× {l.workerCount} trab.</span>
                                          </span>
                                        ))}
                                      </div>
                                    )}

                                    {task.needsReview && task.reviewReason && (
                                      <p className="text-[10px] text-warning mt-1">{task.reviewReason}</p>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter className="border-t border-border pt-3">
          {step === 'preview' && (
            <div className="flex items-center gap-2 w-full justify-between">
              <Button variant="ghost" size="sm" onClick={() => { reset(); setStep('upload'); }}>
                <X className="w-3 h-3 mr-1" /> Voltar
              </Button>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{selectedCount} tarefas serão importadas</span>
                <Button onClick={confirmImport} disabled={selectedCount === 0} size="sm" className="gap-1">
                  <Check className="w-3 h-3" /> Confirmar Importação
                </Button>
              </div>
            </div>
          )}
          {step === 'upload' && (
            <Button variant="ghost" size="sm" onClick={handleClose}>
              Cancelar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
