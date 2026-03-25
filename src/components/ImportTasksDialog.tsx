import { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Project, Phase } from '@/types/project';
import { Upload, FileSpreadsheet, FileText, AlertTriangle, Check, X, Loader2, Wand2, ChevronDown, ChevronRight, Users, FolderOpen, Wrench, Info } from 'lucide-react';
import { ParsedTask, ParsedChapter, ParsedComposition, ParseResult, parseExcel, parsePDF, parseStructuredExcel, detectExcelFormat, convertStructuredToProject, convertToProjectTasks, standardizeSinapi } from '@/lib/importParser';
import { motion, AnimatePresence } from 'framer-motion';

interface ImportTasksDialogProps {
  open: boolean;
  onClose: () => void;
  project: Project;
  onProjectChange: (project: Project) => void;
}

type Step = 'upload' | 'preview';

const PHASE_COLORS = [
  'hsl(var(--primary))', 'hsl(var(--info))', 'hsl(var(--warning))',
  'hsl(var(--success))', 'hsl(var(--destructive))', 'hsl(210, 60%, 50%)',
  'hsl(280, 50%, 55%)', 'hsl(160, 50%, 45%)',
];

export default function ImportTasksDialog({ open, onClose, project, onProjectChange }: ImportTasksDialogProps) {
  const [step, setStep] = useState<Step>('upload');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [format, setFormat] = useState<'structured' | 'flat' | 'pdf'>('flat');

  // Structured data
  const [structuredResult, setStructuredResult] = useState<ParseResult | null>(null);
  const [selectedComps, setSelectedComps] = useState<Set<string>>(new Set());
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set());
  const [expandedComps, setExpandedComps] = useState<Set<string>>(new Set());

  // Flat data (legacy)
  const [parsedTasks, setParsedTasks] = useState<ParsedTask[]>([]);
  const [selectedTasks, setSelectedTasks] = useState<Set<number>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const reset = () => {
    setStep('upload');
    setLoading(false);
    setError('');
    setFileName('');
    setFormat('flat');
    setStructuredResult(null);
    setSelectedComps(new Set());
    setExpandedChapters(new Set());
    setExpandedComps(new Set());
    setParsedTasks([]);
    setSelectedTasks(new Set());
    setExpandedGroups(new Set());
  };

  const handleClose = () => { reset(); onClose(); };

  const handleFile = useCallback(async (file: File) => {
    setLoading(true);
    setError('');
    setFileName(file.name);

    try {
      const buffer = await file.arrayBuffer();

      if (file.name.endsWith('.pdf')) {
        setFormat('pdf');
        const tasks = await parsePDF(buffer);
        if (tasks.length === 0) { setError('Nenhuma composição encontrada no PDF.'); setLoading(false); return; }
        setParsedTasks(tasks);
        setSelectedTasks(new Set(tasks.map((_, i) => i)));
        setExpandedGroups(new Set([...new Set(tasks.map(t => t.group))]));
        setStep('preview');
      } else {
        // Auto-detect Excel format
        const detected = detectExcelFormat(buffer);
        setFormat(detected);

        if (detected === 'structured') {
          const result = parseStructuredExcel(buffer);
          if (result.flatCompositions.length === 0) { setError('Nenhuma composição encontrada na planilha.'); setLoading(false); return; }
          setStructuredResult(result);
          // Select all compositions
          const allKeys = new Set<string>();
          const allChapterKeys = new Set<string>();
          function collectKeys(chapters: ParsedChapter[], prefix = '') {
            chapters.forEach((ch, i) => {
              const key = prefix + i;
              allChapterKeys.add(key);
              ch.compositions.forEach((_, ci) => allKeys.add(`${key}-${ci}`));
              collectKeys(ch.children, `${key}-c`);
            });
          }
          collectKeys(result.chapters);
          setSelectedComps(allKeys);
          setExpandedChapters(allChapterKeys);
          setStep('preview');
        } else {
          const tasks = parseExcel(buffer);
          if (tasks.length === 0) { setError('Nenhuma composição encontrada.'); setLoading(false); return; }
          setParsedTasks(tasks);
          setSelectedTasks(new Set(tasks.map((_, i) => i)));
          setExpandedGroups(new Set([...new Set(tasks.map(t => t.group))]));
          setStep('preview');
        }
      }
    } catch (err: any) {
      setError(`Erro ao processar: ${err.message || 'formato não reconhecido'}`);
    }
    setLoading(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleStandardize = () => { setParsedTasks(standardizeSinapi(parsedTasks)); };

  const toggleTask = (idx: number) => {
    setSelectedTasks(prev => { const n = new Set(prev); n.has(idx) ? n.delete(idx) : n.add(idx); return n; });
  };

  const toggleGroup = (group: string) => {
    setExpandedGroups(prev => { const n = new Set(prev); n.has(group) ? n.delete(group) : n.add(group); return n; });
  };

  const selectAllInGroup = (group: string, select: boolean) => {
    setSelectedTasks(prev => {
      const n = new Set(prev);
      parsedTasks.forEach((t, i) => { if (t.group === group) select ? n.add(i) : n.delete(i); });
      return n;
    });
  };

  // ── Structured import confirm ──
  const confirmStructuredImport = () => {
    if (!structuredResult) return;

    // Filter only selected compositions
    const filteredResult: ParseResult = {
      ...structuredResult,
      chapters: filterSelectedChapters(structuredResult.chapters, '', selectedComps),
      flatCompositions: [],
      warnings: structuredResult.warnings,
    };

    // Rebuild flat list
    function collectComps(chapters: ParsedChapter[]) {
      for (const ch of chapters) {
        filteredResult.flatCompositions.push(...ch.compositions);
        collectComps(ch.children);
      }
    }
    collectComps(filteredResult.chapters);

    if (filteredResult.flatCompositions.length === 0) return;

    const newPhases = convertStructuredToProject(filteredResult, project.startDate);
    const updatedPhases = [...project.phases];
    let colorIdx = updatedPhases.length;

    for (const phase of newPhases) {
      const existing = updatedPhases.find(p => p.name.toLowerCase() === phase.name.toLowerCase());
      if (existing) {
        existing.tasks = [...existing.tasks, ...phase.tasks];
      } else {
        updatedPhases.push({ ...phase, color: PHASE_COLORS[colorIdx % PHASE_COLORS.length] });
        colorIdx++;
      }
    }

    onProjectChange({ ...project, phases: updatedPhases });
    handleClose();
  };

  // ── Flat import confirm ──
  const confirmFlatImport = () => {
    const selected = parsedTasks.filter((_, i) => selectedTasks.has(i));
    if (selected.length === 0) return;

    const { groups } = convertToProjectTasks(selected, project.startDate);
    let colorIdx = project.phases.length;
    const updatedPhases = [...project.phases];

    groups.forEach((tasks, groupName) => {
      const existing = updatedPhases.find(p => p.name.toLowerCase() === groupName.toLowerCase());
      if (existing) {
        existing.tasks = [...existing.tasks, ...tasks];
      } else {
        updatedPhases.push({
          id: `phase-imp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: groupName,
          color: PHASE_COLORS[colorIdx % PHASE_COLORS.length],
          tasks,
        });
        colorIdx++;
      }
    });

    onProjectChange({ ...project, phases: updatedPhases });
    handleClose();
  };

  const confirmImport = format === 'structured' ? confirmStructuredImport : confirmFlatImport;

  // Count for UI
  const totalCount = format === 'structured'
    ? (structuredResult?.flatCompositions.length ?? 0)
    : parsedTasks.length;
  const selectedCount = format === 'structured' ? selectedComps.size : selectedTasks.size;
  const reviewCount = format === 'structured'
    ? (structuredResult?.flatCompositions.filter(c => c.needsReview).length ?? 0)
    : parsedTasks.filter(t => t.needsReview).length;
  const warningCount = structuredResult?.warnings.length ?? 0;

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
            {step === 'preview' && format === 'structured' && `${totalCount} composições em estrutura hierárquica — revise e confirme.`}
            {step === 'preview' && format !== 'structured' && `${totalCount} composições detectadas — revise e confirme a importação.`}
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
                  <div className="mt-2 p-3 rounded-lg bg-muted/50 text-[10px] text-muted-foreground max-w-md">
                    <p className="font-medium text-foreground mb-1">📊 Formato Excel esperado:</p>
                    <p>A: Código • B: Tipo • C: Descrição • D: Unidade • E: Quantidade • F: RUP • G: Horas • H: Dias</p>
                    <p className="mt-1">O sistema detecta automaticamente capítulos, composições e mão de obra.</p>
                  </div>
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

        {/* ── Preview: Structured ── */}
        {step === 'preview' && format === 'structured' && structuredResult && (
          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {/* Summary */}
            <div className="flex items-center justify-between flex-wrap gap-2 px-1">
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">📄 {fileName}</span>
                <span className="text-xs font-bold text-foreground">{selectedCount}/{totalCount} selecionadas</span>
                {reviewCount > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-warning/15 text-warning font-medium flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> {reviewCount} para revisar
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 px-2 py-1 rounded bg-info/10 text-info text-[10px]">
                <Info className="w-3 h-3" /> Formato estruturado detectado
              </div>
            </div>

            {/* Warnings */}
            {warningCount > 0 && (
              <div className="p-2 rounded-lg bg-warning/10 border border-warning/20 text-[10px] text-warning space-y-0.5">
                {structuredResult.warnings.slice(0, 5).map((w, i) => (
                  <p key={i}>⚠️ {w}</p>
                ))}
                {warningCount > 5 && <p>... e mais {warningCount - 5} alertas</p>}
              </div>
            )}

            {/* Hierarchical tree */}
            {structuredResult.chapters.map((ch, i) => (
              <ChapterNode
                key={i}
                chapter={ch}
                prefix={String(i)}
                expandedChapters={expandedChapters}
                setExpandedChapters={setExpandedChapters}
                expandedComps={expandedComps}
                setExpandedComps={setExpandedComps}
                selectedComps={selectedComps}
                setSelectedComps={setSelectedComps}
                depth={0}
              />
            ))}
          </div>
        )}

        {/* ── Preview: Flat / PDF ── */}
        {step === 'preview' && format !== 'structured' && (
          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            <div className="flex items-center justify-between flex-wrap gap-2 px-1">
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">📄 {fileName}</span>
                <span className="text-xs font-bold text-foreground">{selectedCount}/{totalCount} selecionadas</span>
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

            {(() => {
              const groupedTasks = new Map<string, { tasks: ParsedTask[]; indices: number[] }>();
              parsedTasks.forEach((t, i) => {
                if (!groupedTasks.has(t.group)) groupedTasks.set(t.group, { tasks: [], indices: [] });
                groupedTasks.get(t.group)!.tasks.push(t);
                groupedTasks.get(t.group)!.indices.push(i);
              });

              return Array.from(groupedTasks.entries()).map(([group, { tasks, indices }]) => {
                const isExpanded = expandedGroups.has(group);
                const allSelected = indices.every(i => selectedTasks.has(i));

                return (
                  <div key={group} className="border border-border rounded-lg overflow-hidden bg-card">
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-secondary/30">
                      <button onClick={() => toggleGroup(group)} className="text-muted-foreground hover:text-foreground transition-colors">
                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </button>
                      <input type="checkbox" checked={allSelected} onChange={e => selectAllInGroup(group, e.target.checked)} className="rounded border-border" />
                      <span className="text-xs font-bold text-foreground">{group}</span>
                      <span className="text-[10px] text-muted-foreground">({tasks.length} tarefas)</span>
                    </div>
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                          <div className="divide-y divide-border">
                            {tasks.map((task, ti) => {
                              const globalIdx = indices[ti];
                              return (
                                <div key={globalIdx} className={`px-4 py-2 ${task.needsReview ? 'bg-warning/5' : ''}`}>
                                  <div className="flex items-start gap-2">
                                    <input type="checkbox" checked={selectedTasks.has(globalIdx)} onChange={() => toggleTask(globalIdx)} className="mt-1 rounded border-border" />
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        {task.code && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">{task.code}</span>}
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
                                              <Users className="w-2.5 h-2.5" /> {l.role}: <strong className="text-foreground">{l.rup} h/{task.unit}</strong>
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                      {task.needsReview && task.reviewReason && <p className="text-[10px] text-warning mt-1">{task.reviewReason}</p>}
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
              });
            })()}
          </div>
        )}

        <DialogFooter className="border-t border-border pt-3">
          {step === 'preview' && (
            <div className="flex items-center gap-2 w-full justify-between">
              <Button variant="ghost" size="sm" onClick={() => { reset(); }}>
                <X className="w-3 h-3 mr-1" /> Voltar
              </Button>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{selectedCount} composições serão importadas</span>
                <Button onClick={confirmImport} disabled={selectedCount === 0} size="sm" className="gap-1">
                  <Check className="w-3 h-3" /> Confirmar Importação
                </Button>
              </div>
            </div>
          )}
          {step === 'upload' && (
            <Button variant="ghost" size="sm" onClick={handleClose}>Cancelar</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Chapter Tree Node ──
function ChapterNode({
  chapter, prefix, expandedChapters, setExpandedChapters, expandedComps, setExpandedComps,
  selectedComps, setSelectedComps, depth,
}: {
  chapter: ParsedChapter;
  prefix: string;
  expandedChapters: Set<string>;
  setExpandedChapters: React.Dispatch<React.SetStateAction<Set<string>>>;
  expandedComps: Set<string>;
  setExpandedComps: React.Dispatch<React.SetStateAction<Set<string>>>;
  selectedComps: Set<string>;
  setSelectedComps: React.Dispatch<React.SetStateAction<Set<string>>>;
  depth: number;
}) {
  const isExpanded = expandedChapters.has(prefix);
  const compKeys = chapter.compositions.map((_, ci) => `${prefix}-${ci}`);
  const allSelected = compKeys.length > 0 && compKeys.every(k => selectedComps.has(k));
  const someSelected = compKeys.some(k => selectedComps.has(k));
  const totalComps = chapter.compositions.length;
  const totalChildren = chapter.children.length;

  const toggleExpand = () => {
    setExpandedChapters(prev => { const n = new Set(prev); n.has(prefix) ? n.delete(prefix) : n.add(prefix); return n; });
  };

  const toggleSelectAll = (select: boolean) => {
    setSelectedComps(prev => {
      const n = new Set(prev);
      compKeys.forEach(k => select ? n.add(k) : n.delete(k));
      return n;
    });
  };

  return (
    <div className={`border border-border rounded-lg overflow-hidden bg-card ${depth > 0 ? 'ml-4' : ''}`}>
      <div className="flex items-center gap-2 px-3 py-2 bg-secondary/30">
        <button onClick={toggleExpand} className="text-muted-foreground hover:text-foreground transition-colors">
          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        {totalComps > 0 && (
          <input
            type="checkbox"
            checked={allSelected}
            ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
            onChange={e => toggleSelectAll(e.target.checked)}
            className="rounded border-border"
          />
        )}
        <FolderOpen className="w-3.5 h-3.5 text-primary" />
        {chapter.code && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">{chapter.code}</span>}
        <span className="text-xs font-bold text-foreground">{chapter.name}</span>
        <span className="text-[10px] text-muted-foreground">
          ({totalComps} {totalComps === 1 ? 'composição' : 'composições'}
          {totalChildren > 0 && `, ${totalChildren} sub`})
        </span>
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="divide-y divide-border">
              {chapter.compositions.map((comp, ci) => {
                const compKey = `${prefix}-${ci}`;
                const isSelected = selectedComps.has(compKey);
                const isCompExpanded = expandedComps.has(compKey);

                return (
                  <div key={ci} className={`px-4 py-2 ${comp.needsReview ? 'bg-warning/5' : ''}`}>
                    <div className="flex items-start gap-2">
                      <input type="checkbox" checked={isSelected} onChange={() => {
                        setSelectedComps(prev => { const n = new Set(prev); n.has(compKey) ? n.delete(compKey) : n.add(compKey); return n; });
                      }} className="mt-1 rounded border-border" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Wrench className="w-3 h-3 text-muted-foreground" />
                          {comp.code && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">{comp.code}</span>}
                          <span className="text-xs font-medium text-foreground">{comp.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">{comp.quantity} {comp.unit}</span>
                          {comp.needsReview && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/15 text-warning flex items-center gap-0.5">
                              <AlertTriangle className="w-2.5 h-2.5" /> Revisar
                            </span>
                          )}
                          {comp.labor.length > 0 && (
                            <button onClick={() => setExpandedComps(prev => { const n = new Set(prev); n.has(compKey) ? n.delete(compKey) : n.add(compKey); return n; })}
                              className="text-[10px] text-primary hover:underline flex items-center gap-0.5">
                              <Users className="w-2.5 h-2.5" /> {comp.labor.length} mão de obra
                              {isCompExpanded ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
                            </button>
                          )}
                        </div>

                        {/* Labor details */}
                        <AnimatePresence>
                          {isCompExpanded && comp.labor.length > 0 && (
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                              <div className="mt-2 rounded-lg bg-muted/30 border border-border overflow-hidden">
                                <table className="w-full text-[10px]">
                                  <thead>
                                    <tr className="bg-muted/50">
                                      <th className="text-left px-2 py-1 font-medium text-muted-foreground">Profissional</th>
                                      <th className="text-right px-2 py-1 font-medium text-muted-foreground">Unidade</th>
                                      <th className="text-right px-2 py-1 font-medium text-muted-foreground">RUP (h/{comp.unit})</th>
                                      <th className="text-right px-2 py-1 font-medium text-muted-foreground">Horas</th>
                                      <th className="text-right px-2 py-1 font-medium text-muted-foreground">Dias</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {comp.labor.map((l, li) => (
                                      <tr key={li} className="border-t border-border">
                                        <td className="px-2 py-1 text-foreground font-medium">{l.role}</td>
                                        <td className="px-2 py-1 text-right text-muted-foreground">{l.unit}</td>
                                        <td className="px-2 py-1 text-right text-foreground font-bold">{l.rup.toFixed(2)}</td>
                                        <td className="px-2 py-1 text-right text-muted-foreground">{l.hours > 0 ? l.hours.toFixed(2) : '—'}</td>
                                        <td className="px-2 py-1 text-right text-muted-foreground">{l.days > 0 ? l.days.toFixed(2) : '—'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        {comp.needsReview && comp.reviewReason && <p className="text-[10px] text-warning mt-1">{comp.reviewReason}</p>}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Sub-chapters */}
              {chapter.children.map((child, ci) => (
                <ChapterNode
                  key={ci}
                  chapter={child}
                  prefix={`${prefix}-c${ci}`}
                  expandedChapters={expandedChapters}
                  setExpandedChapters={setExpandedChapters}
                  expandedComps={expandedComps}
                  setExpandedComps={setExpandedComps}
                  selectedComps={selectedComps}
                  setSelectedComps={setSelectedComps}
                  depth={depth + 1}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Helper: filter chapters by selected compositions ──
function filterSelectedChapters(chapters: ParsedChapter[], prefix: string, selected: Set<string>): ParsedChapter[] {
  return chapters.map((ch, i) => {
    const key = prefix ? `${prefix}-c${i}` : String(i);
    const filteredComps = ch.compositions.filter((_, ci) => selected.has(`${key}-${ci}`));
    const filteredChildren = filterSelectedChapters(ch.children, key, selected);
    return { ...ch, compositions: filteredComps, children: filteredChildren };
  }).filter(ch => ch.compositions.length > 0 || ch.children.length > 0);
}
