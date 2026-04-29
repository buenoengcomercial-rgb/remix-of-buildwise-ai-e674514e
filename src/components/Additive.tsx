import { useMemo, useState, useRef, Fragment } from 'react';
import {
  Project, Additive as AdditiveModel, AdditiveComposition,
  AdditiveChangeKind, AdditiveStatus,
} from '@/types/project';
import { getChapterTree, getChapterNumbering, type ChapterNode } from '@/lib/chapters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Upload, Download, Printer, Search, ChevronRight, ChevronDown,
  AlertTriangle, Trash2, CheckCircle2, XCircle, Send, RotateCcw, Lock,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  importAdditiveFromExcel, exportAdditiveToExcel, exportAdditiveToPdf,
  additiveTotals, sumAnalyticTotalNoBDI, computeCompositionWithBDI,
  totalAfterAdditive, getApprovedAdditiveBudgetItems,
  buildAdditiveFromSyntheticBudgetItems,
} from '@/lib/additiveImport';

interface Props {
  project: Project;
  onProjectChange: (next: Project | ((prev: Project) => Project)) => void;
  undoButton?: React.ReactNode;
}

const STATUS_LABEL: Record<AdditiveStatus, string> = {
  rascunho: 'Rascunho',
  em_analise: 'Em análise fiscal',
  reprovado: 'Reprovado',
  aprovado: 'Aprovado',
};
const STATUS_BADGE: Record<AdditiveStatus, string> = {
  rascunho: 'bg-slate-100 text-slate-700 border-slate-300',
  em_analise: 'bg-amber-100 text-amber-800 border-amber-300',
  reprovado: 'bg-rose-100 text-rose-800 border-rose-300',
  aprovado: 'bg-emerald-100 text-emerald-800 border-emerald-300',
};

const CHANGE_LABEL: Record<AdditiveChangeKind, string> = {
  acrescido: 'Acrescido',
  suprimido: 'Suprimido',
  sem_alteracao: 'Sem alteração',
};

const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const fmtNum = (v: number) =>
  (v ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 });

export default function Additive({ project, onProjectChange, undoButton }: Props) {
  const additives = project.additives ?? [];
  const [activeId, setActiveId] = useState<string | null>(additives[0]?.id ?? null);
  const active = useMemo(
    () => additives.find(a => a.id === activeId) ?? additives[0] ?? null,
    [additives, activeId],
  );

  const [search, setSearch] = useState('');
  const [bankFilter, setBankFilter] = useState<string>('all');
  const [showAnalytic, setShowAnalytic] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importName, setImportName] = useState('SINTÉTICA CORREÇÃO 02');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [reviewNotes, setReviewNotes] = useState('');
  const [approvedBy, setApprovedBy] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const status: AdditiveStatus = active?.status ?? 'rascunho';
  const isLocked = status === 'em_analise' || status === 'aprovado';

  const banks = useMemo(() => {
    if (!active) return [] as string[];
    const set = new Set<string>();
    active.compositions.forEach(c => { if (c.bank) set.add(c.bank); });
    return Array.from(set).sort();
  }, [active]);

  const filteredComps = useMemo(() => {
    if (!active) return [] as AdditiveComposition[];
    const term = search.trim().toLowerCase();
    return active.compositions.filter(c => {
      if (bankFilter !== 'all' && c.bank !== bankFilter) return false;
      if (term) {
        const hay = `${c.item} ${c.code} ${c.description}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [active, search, bankFilter]);

  const totals = active ? additiveTotals(active) : null;

  // ── Árvore de grupos da EAP, refletindo a estrutura da Medição ──
  type CompGroup = {
    phaseId: string;
    number: string;
    name: string;
    depth: number;
    rows: AdditiveComposition[];
    children: CompGroup[];
    subtotalComBDI: number;
    subtotalSemBDI: number;
  };
  const { groupTree, orphanRows, hasEapLink } = useMemo(() => {
    const empty = { groupTree: [] as CompGroup[], orphanRows: [] as AdditiveComposition[], hasEapLink: false };
    if (!active) return empty;
    const bdi = active.bdiPercent ?? 0;
    const compsByPhase = new Map<string, AdditiveComposition[]>();
    const orphans: AdditiveComposition[] = [];
    let anyLinked = false;
    filteredComps.forEach(c => {
      if (c.phaseId) {
        anyLinked = true;
        const arr = compsByPhase.get(c.phaseId) || [];
        arr.push(c);
        compsByPhase.set(c.phaseId, arr);
      } else {
        orphans.push(c);
      }
    });
    if (!anyLinked) return { ...empty, orphanRows: filteredComps };

    const numbering = getChapterNumbering(project);
    const tree = getChapterTree(project);

    const buildNode = (chapterNode: ChapterNode, depth: number): CompGroup | null => {
      const directRows = compsByPhase.get(chapterNode.phase.id) || [];
      const childGroups = chapterNode.children
        .map(c => buildNode(c, depth + 1))
        .filter((g): g is CompGroup => g !== null);
      if (directRows.length === 0 && childGroups.length === 0) return null;

      let subtotalComBDI = 0;
      let subtotalSemBDI = 0;
      directRows.forEach(c => {
        const r = computeCompositionWithBDI(c, bdi);
        subtotalComBDI += r.impactoComBDI;
        subtotalSemBDI += r.impactoSemBDI;
      });
      childGroups.forEach(c => {
        subtotalComBDI += c.subtotalComBDI;
        subtotalSemBDI += c.subtotalSemBDI;
      });
      return {
        phaseId: chapterNode.phase.id,
        number: numbering.get(chapterNode.phase.id) || '',
        name: chapterNode.phase.name,
        depth,
        rows: directRows,
        children: childGroups,
        subtotalComBDI,
        subtotalSemBDI,
      };
    };

    const groups = tree
      .map(n => buildNode(n, 0))
      .filter((g): g is CompGroup => g !== null)
      .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));

    return { groupTree: groups, orphanRows: orphans, hasEapLink: anyLinked };
  }, [active, filteredComps, project]);

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const handleFileSelected = (f: File | null) => {
    if (!f) return;
    setPendingFile(f);
    const base = f.name.replace(/\.(xlsx|xls)$/i, '');
    setImportName(base || 'Aditivo');
    setImportDialogOpen(true);
  };

  const handleConfirmImport = async () => {
    if (!pendingFile) return;
    try {
      toast.loading('Importando aditivo...', { id: 'imp-add' });
      // Para o modo "analytic_only", tentamos vincular ao aditivo ativo (em rascunho).
      const draftCandidate = active && (active.status ?? 'rascunho') === 'rascunho' ? active : null;
      const result = await importAdditiveFromExcel(
        pendingFile,
        importName.trim() || 'Aditivo',
        draftCandidate,
      );

      if (result.mode === 'analytic_only' && draftCandidate) {
        // Substitui o aditivo existente pela versão mesclada
        const merged = result.additive;
        onProjectChange(prev => ({
          ...prev,
          additives: (prev.additives ?? []).map(a =>
            a.id === draftCandidate.id ? { ...merged, id: draftCandidate.id, name: draftCandidate.name } : a,
          ),
        }));
        setActiveId(draftCandidate.id);
      } else {
        // Adiciona como novo aditivo (synthetic_only, both ou analytic_only sem draft)
        onProjectChange(prev => ({
          ...prev,
          additives: [...(prev.additives ?? []), result.additive],
        }));
        setActiveId(result.additive.id);
      }

      const errCount = result.additive.issues?.filter(i => i.level === 'error').length ?? 0;
      const warnCount = result.additive.issues?.filter(i => i.level === 'warning').length ?? 0;
      toast.success(
        `${result.message}${errCount ? ` (${errCount} erros)` : ''}${warnCount ? ` (${warnCount} avisos)` : ''}`,
        { id: 'imp-add' },
      );
      if (errCount + warnCount > 0) setIssuesOpen(true);
    } catch (e) {
      console.error(e);
      toast.error('Falha ao importar a planilha do aditivo.', { id: 'imp-add' });
    } finally {
      setImportDialogOpen(false);
      setPendingFile(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleExportExcel = async () => {
    if (!active) return;
    try { await exportAdditiveToExcel(active); toast.success('Excel gerado'); }
    catch { toast.error('Falha ao gerar Excel'); }
  };

  const handleExportPdf = async () => {
    if (!active) return;
    try { await exportAdditiveToPdf(active, project.name, showAnalytic); toast.success('PDF gerado'); }
    catch (e) { console.error(e); toast.error('Falha ao gerar PDF'); }
  };

  // ===== Atualizações =====
  const updateAdditive = (mutator: (a: AdditiveModel) => AdditiveModel) => {
    if (!active) return;
    onProjectChange(prev => ({
      ...prev,
      additives: (prev.additives ?? []).map(a => a.id === active.id ? mutator(a) : a),
    }));
  };

  const updateComposition = (compId: string, patch: Partial<AdditiveComposition>) => {
    updateAdditive(a => ({
      ...a,
      compositions: a.compositions.map(c => c.id === compId ? { ...c, ...patch } : c),
    }));
  };

  const handleDeleteAdditive = (id: string) => {
    onProjectChange(prev => ({
      ...prev,
      additives: (prev.additives ?? []).filter(a => a.id !== id),
    }));
    if (activeId === id) {
      const remaining = (project.additives ?? []).filter(a => a.id !== id);
      setActiveId(remaining[0]?.id ?? null);
    }
    setConfirmDeleteId(null);
    toast.success('Aditivo excluído');
  };

  const handleChangeBdi = (value: string) => {
    if (!active || isLocked) return;
    const num = Number(value.replace(',', '.'));
    if (!Number.isFinite(num) || num < 0) return;
    updateAdditive(a => ({ ...a, bdiPercent: num }));
  };

  const setStatus = (next: AdditiveStatus, extra?: Partial<AdditiveModel>) => {
    updateAdditive(a => ({ ...a, status: next, ...(extra ?? {}) }));
  };

  const handleSendForReview = () => {
    setStatus('em_analise');
    toast.success('Aditivo enviado para análise fiscal');
  };

  const handleReject = () => {
    setStatus('reprovado', { reviewNotes: reviewNotes || undefined });
    toast.success('Aditivo reprovado — voltou para ajuste');
    setReviewDialogOpen(false);
    setReviewNotes('');
  };

  const handleApprove = () => {
    if (!active) return;
    const approvedAdditive: AdditiveModel = {
      ...active,
      status: 'aprovado',
      approvedAt: new Date().toISOString(),
      approvedBy: approvedBy || undefined,
      reviewNotes: reviewNotes || undefined,
    };
    onProjectChange(prev => {
      const nextAdditives = (prev.additives ?? []).map(a =>
        a.id === active.id ? approvedAdditive : a,
      );
      // Recalcula budgetItems source 'aditivo' a partir de TODOS aditivos aprovados
      const projWithApproved: Project = { ...prev, additives: nextAdditives };
      const approvedBudget = getApprovedAdditiveBudgetItems(projWithApproved);
      const keep = (prev.budgetItems ?? []).filter(b => b.source !== 'aditivo');
      return {
        ...projWithApproved,
        budgetItems: [...keep, ...approvedBudget],
      };
    });
    toast.success('Aditivo aprovado e integrado à Medição');
    setReviewDialogOpen(false);
    setApprovedBy('');
    setReviewNotes('');
  };

  const handleBackToDraft = () => {
    if (!active) return;
    onProjectChange(prev => {
      const nextAdditives = (prev.additives ?? []).map(a =>
        a.id === active.id ? { ...a, status: 'rascunho' as AdditiveStatus } : a,
      );
      const projWithChange: Project = { ...prev, additives: nextAdditives };
      const approvedBudget = getApprovedAdditiveBudgetItems(projWithChange);
      const keep = (prev.budgetItems ?? []).filter(b => b.source !== 'aditivo');
      return { ...projWithChange, budgetItems: [...keep, ...approvedBudget] };
    });
    toast.success('Aditivo voltou para rascunho — itens removidos da Medição');
  };

  const handleUseSyntheticFromMeasurement = () => {
    const built = buildAdditiveFromSyntheticBudgetItems(project, 'Aditivo (a partir da Sintética da Medição)');
    if (!built) {
      toast.error('Nenhuma Sintética encontrada na Medição. Importe a Sintética primeiro na aba Tarefas/EAP.');
      return;
    }
    onProjectChange(prev => ({ ...prev, additives: [...(prev.additives ?? []), built] }));
    setActiveId(built.id);
    toast.success(`Sintética da Medição reaproveitada (${built.compositions.length} composições).`);
  };

  const bdi = active?.bdiPercent ?? 0;

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-[1700px] mx-auto">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Aditivo {active ? `— ${active.name}` : ''}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Importação de planilhas de aditivo contratual (Sintética + Analítica).
          </p>
          {active && (
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className={STATUS_BADGE[status]}>
                {status === 'aprovado' && <CheckCircle2 className="w-3 h-3 mr-1" />}
                {status === 'em_analise' && <Lock className="w-3 h-3 mr-1" />}
                {status === 'reprovado' && <XCircle className="w-3 h-3 mr-1" />}
                {STATUS_LABEL[status]}
              </Badge>
              {active.approvedAt && (
                <span className="text-[11px] text-muted-foreground">
                  Aprovado em {new Date(active.approvedAt).toLocaleDateString('pt-BR')}
                  {active.approvedBy ? ` por ${active.approvedBy}` : ''}
                </span>
              )}
              {active.reviewNotes && (
                <span className="text-[11px] text-muted-foreground italic">"{active.reviewNotes}"</span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {undoButton}
          {active && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded border bg-card">
              <span className="text-xs text-muted-foreground">BDI (%):</span>
              <Input
                type="number"
                step="0.01"
                min={0}
                value={bdi}
                disabled={isLocked}
                onChange={e => handleChangeBdi(e.target.value)}
                className="h-7 w-20 text-xs"
              />
            </div>
          )}
          <input
            ref={fileRef} type="file" accept=".xlsx,.xls"
            className="hidden"
            onChange={e => handleFileSelected(e.target.files?.[0] ?? null)}
          />
          <Button variant="default" size="sm" onClick={() => fileRef.current?.click()}>
            <Upload className="w-4 h-4 mr-1" /> Importar Excel
          </Button>
          {(project.budgetItems ?? []).some(b => b.source === 'sintetica') && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleUseSyntheticFromMeasurement}
              title="Cria um aditivo em rascunho a partir da Sintética já importada na Medição/EAP"
            >
              <Upload className="w-4 h-4 mr-1" /> Usar Sintética da Medição
            </Button>
          )}
          <Button variant="outline" size="sm" disabled={!active} onClick={handleExportExcel}>
            <Download className="w-4 h-4 mr-1" /> Exportar Excel
          </Button>
          <Button variant="outline" size="sm" disabled={!active} onClick={handleExportPdf}>
            <Printer className="w-4 h-4 mr-1" /> Imprimir / PDF
          </Button>
        </div>
      </header>

      {/* Lista de aditivos importados */}
      {additives.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Aditivos:</span>
          {additives.map(a => {
            const st = a.status ?? 'rascunho';
            return (
              <div key={a.id} className="flex items-center">
                <button
                  onClick={() => setActiveId(a.id)}
                  className={`px-2.5 py-1 rounded-l text-xs border flex items-center gap-1.5 ${a.id === active?.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-card hover:bg-muted'}`}
                >
                  {a.name}
                  <span className={`text-[9px] px-1 py-0.5 rounded ${STATUS_BADGE[st]}`}>
                    {STATUS_LABEL[st]}
                  </span>
                </button>
                <button
                  onClick={() => setConfirmDeleteId(a.id)}
                  title="Excluir aditivo"
                  className="px-1.5 py-1 rounded-r text-xs border border-l-0 hover:bg-destructive/10 text-destructive"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            );
          })}
          {active?.issues && active.issues.some(i => i.level !== 'info') && (
            <Button variant="ghost" size="sm" onClick={() => setIssuesOpen(true)}>
              <AlertTriangle className="w-3.5 h-3.5 mr-1 text-amber-600" />
              Inconsistências
            </Button>
          )}
        </div>
      )}

      {/* Sem aditivos */}
      {!active && (
        <Card className="p-10 text-center border-dashed">
          <p className="text-muted-foreground mb-4">
            Nenhum aditivo importado ainda. Importe uma planilha Excel contendo a aba
            <strong> Sintética</strong>, a aba <strong>Analítica</strong>, ou ambas.
            <br />
            <span className="text-xs">Você pode importar a Sintética primeiro e a Analítica depois — o sistema vincula os insumos automaticamente.</span>
          </p>
          <Button onClick={() => fileRef.current?.click()}>
            <Upload className="w-4 h-4 mr-2" /> Importar planilha
          </Button>
        </Card>
      )}

      {active && totals && (
        <>
          {/* Banner de status / fluxo de aprovação */}
          <Card className="p-3 flex flex-wrap items-center justify-between gap-3 border-l-4"
            style={{ borderLeftColor: status === 'aprovado' ? 'hsl(var(--primary))' : status === 'em_analise' ? '#d97706' : status === 'reprovado' ? '#e11d48' : '#94a3b8' }}>
            <div className="text-xs space-y-0.5">
              <div className="font-medium">Fluxo de aprovação</div>
              {status === 'rascunho' && (
                <div className="text-muted-foreground">Rascunho — uso interno apenas. Não integra Medição, Cronograma, Tarefas ou Diário.</div>
              )}
              {status === 'em_analise' && (
                <div className="text-muted-foreground">Em análise fiscal — edição bloqueada, aguardando aprovação.</div>
              )}
              {status === 'reprovado' && (
                <div className="text-muted-foreground">Reprovado — ajuste e reenvie para análise.</div>
              )}
              {status === 'aprovado' && (
                <div className="text-emerald-700">Aprovado — itens integrados ao projeto (rastreáveis em Medição, Tarefas e Diário).</div>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {status === 'rascunho' && (
                <Button size="sm" variant="default" onClick={handleSendForReview}>
                  <Send className="w-3.5 h-3.5 mr-1" /> Enviar para análise
                </Button>
              )}
              {status === 'em_analise' && (
                <>
                  <Button size="sm" variant="outline" className="border-rose-300 text-rose-700"
                    onClick={() => { setReviewNotes(''); setReviewDialogOpen(true); }}>
                    <XCircle className="w-3.5 h-3.5 mr-1" /> Reprovar
                  </Button>
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700"
                    onClick={() => { setApprovedBy(''); setReviewNotes(''); setReviewDialogOpen(true); }}>
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Aprovar
                  </Button>
                </>
              )}
              {status === 'reprovado' && (
                <Button size="sm" variant="default" onClick={handleSendForReview}>
                  <Send className="w-3.5 h-3.5 mr-1" /> Reenviar para análise
                </Button>
              )}
              {status === 'aprovado' && (
                <Button size="sm" variant="outline" onClick={handleBackToDraft}>
                  <RotateCcw className="w-3.5 h-3.5 mr-1" /> Voltar para rascunho
                </Button>
              )}
            </div>
          </Card>

          {/* Cards resumo */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <Card className="p-3">
              <div className="text-[11px] text-muted-foreground">Composições</div>
              <div className="text-lg font-semibold">{totals.compCount}</div>
            </Card>
            <Card className="p-3">
              <div className="text-[11px] text-muted-foreground">Acrescidas</div>
              <div className="text-lg font-semibold text-emerald-700">{totals.acrescidos}</div>
            </Card>
            <Card className="p-3">
              <div className="text-[11px] text-muted-foreground">Suprimidas</div>
              <div className="text-lg font-semibold text-rose-700">{totals.suprimidos}</div>
            </Card>
            <Card className="p-3">
              <div className="text-[11px] text-muted-foreground">Impacto s/ BDI</div>
              <div className={`text-lg font-semibold ${totals.impactoSemBDI < 0 ? 'text-rose-700' : ''}`}>
                {fmtBRL(totals.impactoSemBDI)}
              </div>
            </Card>
            <Card className="p-3">
              <div className="text-[11px] text-muted-foreground">Impacto c/ BDI</div>
              <div className={`text-lg font-semibold ${totals.impactoComBDI < 0 ? 'text-rose-700' : 'text-primary'}`}>
                {fmtBRL(totals.impactoComBDI)}
              </div>
            </Card>
            <Card className="p-3">
              <div className="text-[11px] text-muted-foreground">Insumos</div>
              <div className="text-lg font-semibold">{totals.inputCount}</div>
            </Card>
            <Card className="p-3">
              <div className="text-[11px] text-muted-foreground">Sem analítico</div>
              <div className={`text-lg font-semibold ${totals.semAnalitico > 0 ? 'text-amber-600' : ''}`}>
                {totals.semAnalitico}
              </div>
            </Card>
          </div>

          {/* Filtros */}
          <Card className="p-3 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar por item, código ou descrição..."
                className="pl-7 h-9"
              />
            </div>
            <Select value={bankFilter} onValueChange={setBankFilter}>
              <SelectTrigger className="h-9 w-[140px]"><SelectValue placeholder="Banco" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os bancos</SelectItem>
                {banks.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant={showAnalytic ? 'default' : 'outline'}
              onClick={() => setShowAnalytic(s => !s)}
            >
              {showAnalytic ? 'Ocultar analítico' : 'Mostrar analítico'}
            </Button>
          </Card>

          {/* Tabela principal — modelo "1ºADITIVO" */}
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/60 sticky top-0">
                  <tr className="border-b">
                    <th className="w-8" />
                    <th className="px-2 py-2 text-left font-semibold">Item</th>
                    <th className="px-2 py-2 text-left font-semibold">Código</th>
                    <th className="px-2 py-2 text-left font-semibold">Banco</th>
                    <th className="px-2 py-2 text-left font-semibold">Discriminação</th>
                    <th className="px-2 py-2 text-left font-semibold">Und</th>
                    <th className="px-2 py-2 text-right font-semibold">Quant. Contrat.</th>
                    <th className="px-2 py-2 text-right font-semibold text-rose-700">Suprimidos</th>
                    <th className="px-2 py-2 text-right font-semibold text-emerald-700">Aditivados</th>
                    <th className="px-2 py-2 text-right font-semibold">Total após troca</th>
                    
                    <th className="px-2 py-2 text-right font-semibold">V.Unit s/BDI</th>
                    <th className="px-2 py-2 text-right font-semibold">V.Unit c/BDI</th>
                    <th className="px-2 py-2 text-right font-semibold">Impacto c/BDI</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const COL_COUNT = 13;
                    const renderCompRow = (c: AdditiveComposition) => {
                      const isOpen = expanded.has(c.id);
                      const r = computeCompositionWithBDI(c, bdi);
                      const hasInputs = c.inputs.length > 0;
                      const diff = hasInputs ? r.diff : 0;
                      const hasDiff = hasInputs && Math.abs(diff) > 0.05;
                      const noAnalytic = !hasInputs;
                      const kind: AdditiveChangeKind = c.changeKind ?? 'acrescido';
                      return (
                        <Fragment key={c.id}>
                          <tr className="border-b hover:bg-muted/30 align-top">
                            <td className="px-1 py-2 text-center">
                              <button
                                onClick={() => toggleExpand(c.id)}
                                className="p-1 rounded hover:bg-muted"
                                disabled={c.inputs.length === 0}
                                title={c.inputs.length === 0 ? 'Sem analítico' : 'Expandir'}
                              >
                                {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                              </button>
                            </td>
                            <td className="px-2 py-2">{c.itemNumber || c.item}</td>
                            <td className="px-2 py-2 font-mono text-[11px]">{c.code}</td>
                            <td className="px-2 py-2">{c.bank}</td>
                            <td className="px-2 py-2 max-w-[360px]">
                              <div>{c.description}</div>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {noAnalytic && <Badge variant="outline" className="text-[9px] text-amber-700 border-amber-400">Sem analítico</Badge>}
                                {hasDiff && (
                                  <Badge variant="outline" className="text-[9px] text-rose-700 border-rose-400">
                                    Dif. analítica c/ BDI: {fmtBRL(diff)}
                                  </Badge>
                                )}
                              </div>
                            </td>
                            <td className="px-2 py-2">{c.unit}</td>
                            <td className="px-2 py-2 text-right">
                              <Input
                                type="number" step="0.0001" min={0}
                                value={c.originalQuantity ?? 0}
                                disabled={isLocked}
                                onChange={e => updateComposition(c.id, { originalQuantity: Number(e.target.value) || 0 })}
                                className="h-7 w-20 text-xs text-right"
                              />
                            </td>
                            <td className="px-2 py-2 text-right">
                              <Input
                                type="number" step="0.0001" min={0}
                                value={c.suppressedQuantity ?? 0}
                                disabled={isLocked}
                                onChange={e => updateComposition(c.id, { suppressedQuantity: Number(e.target.value) || 0 })}
                                className="h-7 w-20 text-xs text-right border-rose-200"
                              />
                            </td>
                            <td className="px-2 py-2 text-right">
                              <Input
                                type="number" step="0.0001" min={0}
                                value={c.addedQuantity ?? c.quantity}
                                disabled={isLocked}
                                onChange={e => updateComposition(c.id, { addedQuantity: Number(e.target.value) || 0 })}
                                className="h-7 w-20 text-xs text-right border-emerald-200"
                              />
                            </td>
                            <td className="px-2 py-2 text-right font-medium">{fmtNum(totalAfterAdditive(c))}</td>
                            <td className="px-2 py-2">
                              <Select
                                value={kind}
                                disabled={isLocked}
                                onValueChange={v => updateComposition(c.id, { changeKind: v as AdditiveChangeKind })}
                              >
                                <SelectTrigger className="h-7 text-[11px] w-[120px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="acrescido">Acrescido</SelectItem>
                                  <SelectItem value="suprimido">Suprimido</SelectItem>
                                  <SelectItem value="sem_alteracao">Sem alteração</SelectItem>
                                </SelectContent>
                              </Select>
                            </td>
                            <td className="px-2 py-2 text-right">{fmtBRL(c.unitPriceNoBDI)}</td>
                            <td className="px-2 py-2 text-right">{fmtBRL(r.unitPriceWithBDI)}</td>
                            <td className={`px-2 py-2 text-right font-medium ${r.impactoComBDI < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                              {fmtBRL(r.impactoComBDI)}
                            </td>
                          </tr>
                          {isOpen && showAnalytic && c.inputs.length > 0 && (
                            <tr className="bg-muted/20 border-b">
                              <td />
                              <td colSpan={COL_COUNT - 1} className="px-3 py-2">
                                <table className="w-full text-[11px]">
                                  <thead>
                                    <tr className="text-muted-foreground">
                                      <th className="text-left px-1.5 py-1 font-medium">Código</th>
                                      <th className="text-left px-1.5 py-1 font-medium">Banco</th>
                                      <th className="text-left px-1.5 py-1 font-medium">Descrição</th>
                                      <th className="text-left px-1.5 py-1 font-medium">Un</th>
                                      <th className="text-right px-1.5 py-1 font-medium">Coef.</th>
                                      <th className="text-right px-1.5 py-1 font-medium">V. Unit s/ BDI</th>
                                      <th className="text-right px-1.5 py-1 font-medium">Total s/ BDI</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {c.inputs.map(i => (
                                      <tr key={i.id} className="border-t border-border/50">
                                        <td className="px-1.5 py-1 font-mono">{i.code}</td>
                                        <td className="px-1.5 py-1">{i.bank}</td>
                                        <td className="px-1.5 py-1">{i.description}</td>
                                        <td className="px-1.5 py-1">{i.unit}</td>
                                        <td className="px-1.5 py-1 text-right">{i.coefficient.toLocaleString('pt-BR')}</td>
                                        <td className="px-1.5 py-1 text-right">{fmtBRL(i.unitPrice)}</td>
                                        <td className="px-1.5 py-1 text-right">{fmtBRL(i.total)}</td>
                                      </tr>
                                    ))}
                                    <tr className="border-t font-medium">
                                      <td colSpan={6} className="px-1.5 py-1 text-right">Soma analítica s/ BDI:</td>
                                      <td className="px-1.5 py-1 text-right">{fmtBRL(sumAnalyticTotalNoBDI(c))}</td>
                                    </tr>
                                    <tr className="font-medium text-primary">
                                      <td colSpan={6} className="px-1.5 py-1 text-right">Valor analítico c/ BDI calculado (× qtd):</td>
                                      <td className="px-1.5 py-1 text-right">{fmtBRL(computeCompositionWithBDI(c, bdi).totalAnalyticWithBDI)}</td>
                                    </tr>
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    };

                    const renderGroup = (g: CompGroup): JSX.Element => {
                      const indent = g.depth * 14;
                      return (
                        <Fragment key={g.phaseId}>
                          <tr className="bg-primary/5 border-b border-primary/20 font-semibold">
                            <td colSpan={COL_COUNT} className="px-2 py-1.5">
                              <div className="flex items-center gap-2" style={{ paddingLeft: indent }}>
                                <span className="text-[12px]">{g.number} {g.name}</span>
                              </div>
                            </td>
                          </tr>
                          {g.rows.map(c => renderCompRow(c))}
                          {g.children.map(child => renderGroup(child))}
                          <tr className="border-b bg-muted/30 font-medium">
                            <td colSpan={COL_COUNT - 1} className="px-2 py-1 text-right text-[11px]" style={{ paddingLeft: indent }}>
                              Subtotal {g.number} {g.name}
                            </td>
                            <td className="px-2 py-1 text-right text-[11px]">{fmtBRL(g.subtotalComBDI)}</td>
                          </tr>
                        </Fragment>
                      );
                    };

                    if (filteredComps.length === 0) {
                      return (
                        <tr>
                          <td colSpan={COL_COUNT} className="text-center text-muted-foreground py-8">
                            Nenhuma composição encontrada com os filtros atuais.
                          </td>
                        </tr>
                      );
                    }

                    if (!hasEapLink) {
                      return <>{filteredComps.map(c => renderCompRow(c))}</>;
                    }

                    const grandComBDI = groupTree.reduce((a, g) => a + g.subtotalComBDI, 0);
                    const orphanComBDI = orphanRows.reduce((a, c) => a + computeCompositionWithBDI(c, bdi).impactoComBDI, 0);
                    return (
                      <>
                        {groupTree.map(g => renderGroup(g))}
                        {orphanRows.length > 0 && (
                          <>
                            <tr className="bg-amber-50 border-b border-amber-200 font-semibold">
                              <td colSpan={COL_COUNT} className="px-2 py-1.5 text-amber-900 text-[12px]">
                                Itens da Sintética sem vínculo na EAP
                              </td>
                            </tr>
                            {orphanRows.map(c => renderCompRow(c))}
                            <tr className="border-b bg-amber-50/60 font-medium">
                              <td colSpan={COL_COUNT - 1} className="px-2 py-1 text-right text-[11px]">
                                Subtotal sem vínculo
                              </td>
                              <td className="px-2 py-1 text-right text-[11px]">{fmtBRL(orphanComBDI)}</td>
                            </tr>
                          </>
                        )}
                        <tr className="bg-primary/10 border-t-2 border-primary/40 font-bold">
                          <td colSpan={COL_COUNT - 1} className="px-2 py-2 text-right">TOTAL GERAL c/ BDI</td>
                          <td className="px-2 py-2 text-right text-primary">{fmtBRL(grandComBDI + orphanComBDI)}</td>
                        </tr>
                      </>
                    );
                  })()}
                </tbody>

              </table>
            </div>
          </Card>
        </>
      )}

      {/* Diálogo de nome do aditivo */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nome do aditivo</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Input value={importName} onChange={e => setImportName(e.target.value)} placeholder="Ex.: SINTÉTICA CORREÇÃO 02" />
            <p className="text-xs text-muted-foreground">
              Esse nome aparecerá no topo da tela e no PDF exportado.
            </p>
            <p className="text-[11px] text-muted-foreground border-t pt-2">
              <strong>Formatos aceitos:</strong> arquivo único com SINTETICA + ANALITICA, somente SINTETICA, ou somente ANALITICA (vincula ao rascunho ativo).
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setImportDialogOpen(false); setPendingFile(null); }}>Cancelar</Button>
            <Button onClick={handleConfirmImport}>Importar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo de aprovação/reprovação */}
      <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Aprovar ou reprovar aditivo</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Responsável / Fiscal (opcional)</label>
              <Input value={approvedBy} onChange={e => setApprovedBy(e.target.value)} placeholder="Nome do responsável" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Observações</label>
              <Textarea value={reviewNotes} onChange={e => setReviewNotes(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter className="flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setReviewDialogOpen(false)}>Cancelar</Button>
            <Button variant="outline" className="border-rose-300 text-rose-700" onClick={handleReject}>
              <XCircle className="w-4 h-4 mr-1" /> Reprovar
            </Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handleApprove}>
              <CheckCircle2 className="w-4 h-4 mr-1" /> Aprovar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo de inconsistências */}
      <Dialog open={issuesOpen} onOpenChange={setIssuesOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Inconsistências da importação</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto divide-y text-xs">
            {(active?.issues ?? []).map((iss, idx) => (
              <div key={idx} className="py-2 flex gap-2">
                <Badge
                  variant="outline"
                  className={
                    iss.level === 'error' ? 'border-red-400 text-red-700' :
                    iss.level === 'warning' ? 'border-amber-400 text-amber-700' :
                    'border-sky-300 text-sky-700'
                  }
                >
                  {iss.level === 'error' ? 'Erro' : iss.level === 'warning' ? 'Aviso' : 'Info'}
                </Badge>
                <div className="flex-1">
                  <div>{iss.message}</div>
                  {(iss.code || iss.line) && (
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {iss.code && `Código: ${iss.code}`}{iss.code && iss.line && ' · '}
                      {iss.line && `Linha: ${iss.line}`}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {(!active?.issues || active.issues.length === 0) && (
              <div className="py-8 text-center text-muted-foreground">Sem inconsistências.</div>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setIssuesOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirma exclusão */}
      <AlertDialog open={!!confirmDeleteId} onOpenChange={o => !o && setConfirmDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir aditivo?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. As composições e insumos deste aditivo serão removidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => confirmDeleteId && handleDeleteAdditive(confirmDeleteId)}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
