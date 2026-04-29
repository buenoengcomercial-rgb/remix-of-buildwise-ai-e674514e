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
  AlertTriangle, Trash2, CheckCircle2, XCircle, Send, RotateCcw, Lock, History,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  importAdditiveFromExcel, exportAdditiveToExcel, exportAdditiveToPdf,
  additiveTotals, sumAnalyticTotalNoBDI, computeCompositionWithBDI,
  totalAfterAdditive, getApprovedAdditiveBudgetItems,
  buildAdditiveFromSyntheticBudgetItems, computeAdditiveRow,
  createNewServiceComposition, contractAdditive, money2, truncar2,
} from '@/lib/additiveImport';
import { useAuth } from '@/hooks/useAuth';
import { logToProject, userInfoFromSupabaseUser } from '@/lib/audit';
import AuditHistoryPanel from '@/components/AuditHistoryPanel';
import type { AdditiveApprovalSnapshot } from '@/types/project';

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
  aditivo_contratado: 'Aditivo Contratado',
};
const STATUS_BADGE: Record<AdditiveStatus, string> = {
  rascunho: 'bg-slate-100 text-slate-700 border-slate-300',
  em_analise: 'bg-amber-100 text-amber-800 border-amber-300',
  reprovado: 'bg-rose-100 text-rose-800 border-rose-300',
  aprovado: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  aditivo_contratado: 'bg-primary/15 text-primary border-primary/40',
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

const fmtPct = (v: number) =>
  `${(v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

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
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importName, setImportName] = useState('SINTÉTICA CORREÇÃO 02');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [reviewNotes, setReviewNotes] = useState('');
  const [approvedBy, setApprovedBy] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const { user } = useAuth();
  const auditUser = useMemo(() => userInfoFromSupabaseUser(user), [user]);

  const status: AdditiveStatus = active?.status ?? 'rascunho';
  const isLocked = status === 'em_analise' || status === 'aprovado' || status === 'aditivo_contratado' || !!active?.isContracted;
  const globalDiscount = active?.globalDiscountPercent ?? 0;

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
    subtotalContratado: number;
    subtotalFinal: number;
  };
  const { groupTree, orphanRows, hasEapLink } = useMemo(() => {
    const empty = { groupTree: [] as CompGroup[], orphanRows: [] as AdditiveComposition[], hasEapLink: false };
    if (!active) return empty;
    const bdi = active.bdiPercent ?? 0;
    void globalDiscount; // captured pra recalcular grupos quando muda
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

      let subtotalContratado = 0;
      let subtotalFinal = 0;
      directRows.forEach(c => {
        const r = computeAdditiveRow(c, bdi, globalDiscount);
        subtotalContratado += r.valorContratadoOriginalPreservado;
        subtotalFinal += r.valorFinal;
      });
      childGroups.forEach(c => {
        subtotalContratado += c.subtotalContratado;
        subtotalFinal += c.subtotalFinal;
      });
      return {
        phaseId: chapterNode.phase.id,
        number: numbering.get(chapterNode.phase.id) || '',
        name: chapterNode.phase.name,
        depth,
        rows: directRows,
        children: childGroups,
        subtotalContratado,
        subtotalFinal,
      };
    };

    const groups = tree
      .map(n => buildNode(n, 0))
      .filter((g): g is CompGroup => g !== null)
      .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));

    return { groupTree: groups, orphanRows: orphans, hasEapLink: anyLinked };
  }, [active, filteredComps, project, globalDiscount]);

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const toggleCollapsed = (id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
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
      // Detecta antecipadamente o conteúdo da planilha (nome + cabeçalhos) para validar pré-condições.
      const XLSX = await import('xlsx');
      const buf = await pendingFile.arrayBuffer();
      const peek = XLSX.read(buf, { type: 'array' });
      const normName = (n: string) => n.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const lower = peek.SheetNames.map(normName);
      let hasSynth = lower.some(n => n.includes('sintetica'));
      let hasAnaly = lower.some(n => n.includes('analitica'));

      // Fallback por conteúdo: aceita "Planilha1" / "Folha 1" como Analítica se cabeçalhos baterem.
      if (!hasAnaly) {
        for (let i = 0; i < peek.SheetNames.length; i++) {
          const name = peek.SheetNames[i];
          if (hasSynth && normName(name).includes('sintetica')) continue;
          const ws = peek.Sheets[name];
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }) as unknown[][];
          const norm = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
          for (let r = 0; r < Math.min(rows.length, 30); r++) {
            const cells = (rows[r] || []).map(norm);
            const joined = cells.join(' | ');
            const hits = [
              cells.some(c => c === 'item' || c.startsWith('item')),
              joined.includes('codigo'),
              cells.some(c => c === 'banco' || c.startsWith('banco')),
              joined.includes('descricao'),
              cells.some(c => c === 'quant' || c.startsWith('quant') || c === 'coef' || c.startsWith('coef')),
              cells.some(c => c === 'un' || c === 'und' || c === 'unid' || c.startsWith('unid')),
            ].filter(Boolean).length;
            if (hits >= 4) { hasAnaly = true; break; }
          }
          if (hasAnaly) break;
        }
      }

      const draftCandidate = active && (active.status ?? 'rascunho') === 'rascunho' && !active.isContracted ? active : null;

      if (!hasSynth && !hasAnaly) {
        toast.error('Nenhuma aba reconhecida (esperado SINTETICA e/ou ANALITICA, ou planilha com cabeçalhos compatíveis).');
        return;
      }

      if (!hasSynth && hasAnaly && !draftCandidate) {
        toast.error('Importe ou selecione um aditivo em rascunho antes de vincular a Analítica.');
        return;
      }

      toast.loading('Importando aditivo...', { id: 'imp-add' });
      const result = await importAdditiveFromExcel(
        pendingFile,
        importName.trim() || 'Aditivo',
        draftCandidate,
      );

      // Salvaguarda: se o resultado vier vazio com erro "Nenhuma aba reconhecida", não cria aba.
      const hasFatalError = (result.additive.issues ?? []).some(
        i => i.level === 'error' && /nenhuma aba reconhecida/i.test(i.message),
      );
      if (hasFatalError && result.additive.compositions.length === 0) {
        toast.error('Nenhuma aba reconhecida na planilha. Nada foi adicionado.', { id: 'imp-add' });
        return;
      }

      const inputsCount = result.additive.compositions.reduce((a, c) => a + (c.inputs?.length ?? 0), 0);
      const importMeta = {
        fileName: pendingFile.name,
        mode: result.mode,
        hasSynthetic: hasSynth,
        hasAnalytic: hasAnaly,
        compositionsCount: result.additive.compositions.length,
        inputsCount,
      };

      if (result.mode === 'analytic_only' && draftCandidate) {
        // Mescla a Analítica no aditivo ativo em rascunho — não cria nova aba.
        const merged = result.additive;
        onProjectChange(prev => {
          const next = {
            ...prev,
            additives: (prev.additives ?? []).map(a =>
              a.id === draftCandidate.id
                ? { ...merged, id: draftCandidate.id, name: draftCandidate.name, status: draftCandidate.status ?? 'rascunho' }
                : a,
            ),
          };
          return logToProject(next, {
            ...auditUser,
            entityType: 'additive',
            entityId: draftCandidate.id,
            action: 'imported',
            title: 'Planilha importada no Aditivo',
            metadata: importMeta,
          });
        });
        setActiveId(draftCandidate.id);
      } else {
        // Adiciona como novo aditivo (synthetic_only ou both)
        onProjectChange(prev => {
          const next = {
            ...prev,
            additives: [...(prev.additives ?? []), result.additive],
          };
          return logToProject(next, {
            ...auditUser,
            entityType: 'additive',
            entityId: result.additive.id,
            action: 'imported',
            title: 'Planilha importada no Aditivo',
            metadata: importMeta,
          });
        });
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
    try {
      await exportAdditiveToExcel(active);
      toast.success('Excel gerado');
      logAdd(active.id, { action: 'exported', title: 'Aditivo exportado em Excel' });
    } catch { toast.error('Falha ao gerar Excel'); }
  };

  const handleExportPdf = async () => {
    if (!active) return;
    try {
      await exportAdditiveToPdf(active, project.name, showAnalytic);
      toast.success('PDF gerado');
      logAdd(active.id, { action: 'exported', title: 'Aditivo exportado em PDF' });
    } catch (e) { console.error(e); toast.error('Falha ao gerar PDF'); }
  };

  // ===== Helper de log (Aditivo) =====
  const logAdd = (
    additiveId: string,
    params: Omit<Parameters<typeof logToProject>[1], 'entityType' | 'entityId'>,
  ) => {
    onProjectChange(prev => logToProject(prev, {
      ...params,
      ...auditUser,
      entityType: 'additive',
      entityId: additiveId,
    }));
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

  /** Atualiza uma quantidade da composição registrando AuditLog para acrescida/suprimida. */
  const updateCompositionQuantity = (
    compId: string,
    field: 'addedQuantity' | 'suppressedQuantity',
    nextValue: number,
  ) => {
    if (!active) return;
    const comp = active.compositions.find(c => c.id === compId);
    if (!comp) return;
    const before = comp[field] ?? 0;
    if (before === nextValue) return;
    updateComposition(compId, { [field]: nextValue });
    logAdd(active.id, {
      action: 'updated',
      title: field === 'addedQuantity'
        ? 'Quantidade acrescida alterada'
        : 'Quantidade suprimida alterada',
      metadata: {
        item: comp.item || comp.itemNumber,
        code: comp.code,
        description: comp.description,
        before,
        after: nextValue,
      },
      before,
      after: nextValue,
    });
  };

  const handleDeleteAdditive = (id: string) => {
    const target = (project.additives ?? []).find(a => a.id === id);
    onProjectChange(prev => {
      const next = {
        ...prev,
        additives: (prev.additives ?? []).filter(a => a.id !== id),
      };
      return logToProject(next, {
        ...auditUser,
        entityType: 'additive',
        entityId: id,
        action: 'deleted',
        title: 'Aditivo excluído',
        description: target?.name,
      });
    });
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
    const before = active.bdiPercent ?? 0;
    if (before === num) return;
    updateAdditive(a => ({ ...a, bdiPercent: num }));
    logAdd(active.id, {
      action: 'updated',
      title: 'BDI do aditivo alterado',
      before,
      after: num,
    });
  };

  const setStatus = (next: AdditiveStatus, extra?: Partial<AdditiveModel>) => {
    updateAdditive(a => ({ ...a, status: next, ...(extra ?? {}) }));
  };

  const handleSendForReview = () => {
    if (!active) return;
    setStatus('em_analise');
    const t = additiveTotals(active);
    const errCount = (active.issues ?? []).filter(i => i.level === 'error').length;
    const warnCount = (active.issues ?? []).filter(i => i.level === 'warning').length;
    logAdd(active.id, {
      action: 'submitted_for_review',
      title: 'Aditivo enviado para análise fiscal',
      metadata: {
        totalContratadoOriginal: t.totalContratadoOriginal,
        totalSuprimido: t.totalSuprimido,
        totalAcrescido: t.totalAcrescido,
        valorFinal: t.valorFinal,
        diferencaLiquida: t.diferencaLiquida,
        percentImpactoLiquido: t.percentImpactoLiquido,
        errorsCount: errCount,
        warningsCount: warnCount,
      },
    });
    toast.success('Aditivo enviado para análise fiscal');
  };

  const handleReject = () => {
    if (!active) return;
    setStatus('reprovado', { reviewNotes: reviewNotes || undefined });
    logAdd(active.id, {
      action: 'rejected',
      title: 'Aditivo reprovado',
      description: reviewNotes || undefined,
    });
    toast.success('Aditivo reprovado — voltou para ajuste');
    setReviewDialogOpen(false);
    setReviewNotes('');
  };

  const handleApprove = () => {
    if (!active) return;
    const totals = additiveTotals(active);
    const nextVersion = (active.version ?? 0) + 1;
    const approvedAt = new Date().toISOString();
    const snapshot: AdditiveApprovalSnapshot = {
      version: nextVersion,
      approvedAt,
      approvedBy: approvedBy || undefined,
      reviewNotes: reviewNotes || undefined,
      bdiPercent: active.bdiPercent ?? 0,
      globalDiscountPercent: active.globalDiscountPercent ?? 0,
      totals,
      compositions: JSON.parse(JSON.stringify(active.compositions)),
      issues: JSON.parse(JSON.stringify(active.issues ?? [])),
    };
    const approvedAdditive: AdditiveModel = {
      ...active,
      status: 'aprovado',
      approvedAt,
      approvedBy: approvedBy || undefined,
      reviewNotes: reviewNotes || undefined,
      version: nextVersion,
      approvalSnapshots: [...(active.approvalSnapshots ?? []), snapshot],
    };
    onProjectChange(prev => {
      const nextAdditives = (prev.additives ?? []).map(a =>
        a.id === active.id ? approvedAdditive : a,
      );
      const projWithApproved: Project = { ...prev, additives: nextAdditives };
      const approvedBudget = getApprovedAdditiveBudgetItems(projWithApproved);
      const keep = (prev.budgetItems ?? []).filter(b => b.source !== 'aditivo');
      const next = {
        ...projWithApproved,
        budgetItems: [...keep, ...approvedBudget],
      };
      return logToProject(next, {
        ...auditUser,
        entityType: 'additive',
        entityId: active.id,
        action: 'approved',
        title: 'Aditivo aprovado',
        description: approvedBy ? `Por ${approvedBy}` : undefined,
        metadata: {
          version: nextVersion,
          totalContratadoOriginal: totals.totalContratadoOriginal,
          totalSuprimido: totals.totalSuprimido,
          totalAcrescido: totals.totalAcrescido,
          valorFinal: totals.valorFinal,
          percentImpactoLiquido: totals.percentImpactoLiquido,
        },
      });
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
      const next = { ...projWithChange, budgetItems: [...keep, ...approvedBudget] };
      return logToProject(next, {
        ...auditUser,
        entityType: 'additive',
        entityId: active.id,
        action: 'unlocked',
        title: 'Aditivo voltou para rascunho',
      });
    });
    toast.success('Aditivo voltou para rascunho — itens removidos da Medição');
  };

  const handleUseSyntheticFromMeasurement = () => {
    const built = buildAdditiveFromSyntheticBudgetItems(project, 'Aditivo (a partir da Sintética da Medição)');
    if (!built) {
      toast.error('Nenhuma Sintética encontrada na Medição. Importe a Sintética primeiro na aba Tarefas/EAP.');
      return;
    }
    onProjectChange(prev => {
      const next = { ...prev, additives: [...(prev.additives ?? []), built] };
      return logToProject(next, {
        ...auditUser,
        entityType: 'additive',
        entityId: built.id,
        action: 'imported',
        title: 'Aditivo criado a partir da Sintética da Medição',
        metadata: {
          compositionsCount: built.compositions.length,
          source: 'sintetica_medicao',
        },
      });
    });
    setActiveId(built.id);
    toast.success(`Sintética da Medição reaproveitada (${built.compositions.length} composições).`);
  };

  const handleChangeGlobalDiscount = (value: string) => {
    if (!active || isLocked) return;
    const num = Number(value.replace(',', '.'));
    if (!Number.isFinite(num) || num < 0) return;
    const before = active.globalDiscountPercent ?? 0;
    if (before === num) return;
    updateAdditive(a => ({ ...a, globalDiscountPercent: num }));
    logAdd(active.id, {
      action: 'updated',
      title: 'Desconto licitatório do aditivo alterado',
      before,
      after: num,
    });
  };

  const handleAddNewService = (phaseId: string, phaseChain: string, parentNumber: string) => {
    if (!active || isLocked) return;
    const novo = createNewServiceComposition(active, phaseId, phaseChain, parentNumber);
    updateAdditive(a => ({ ...a, compositions: [...a.compositions, novo] }));
    logAdd(active.id, {
      action: 'created',
      title: 'Novo serviço criado no aditivo',
      metadata: {
        item: novo.itemNumber,
        code: novo.code,
        phaseId,
        phaseChain,
      },
    });
    toast.success(`Novo serviço ${novo.itemNumber} adicionado`);
  };

  const handleRemoveComposition = (compId: string) => {
    if (!active || isLocked) return;
    const comp = active.compositions.find(c => c.id === compId);
    updateAdditive(a => ({ ...a, compositions: a.compositions.filter(c => c.id !== compId) }));
    if (comp?.isNewService) {
      logAdd(active.id, {
        action: 'deleted',
        title: 'Novo serviço excluído do aditivo',
        metadata: {
          item: comp.item || comp.itemNumber,
          code: comp.code,
          description: comp.description,
        },
      });
    }
  };

  const handleContractAdditive = () => {
    if (!active) return;
    if (active.status !== 'aprovado' && !active.isContracted) {
      toast.error('O aditivo precisa estar Aprovado para ser contratado.');
      return;
    }
    const novosServicos = active.compositions.filter(c => c.isNewService);
    onProjectChange(prev => {
      const next = contractAdditive(prev, active.id);
      return logToProject(next, {
        ...auditUser,
        entityType: 'additive',
        entityId: active.id,
        action: 'contracted',
        title: 'Aditivo contratado e integrado ao projeto',
        metadata: {
          novosServicosIntegrados: novosServicos.length,
          budgetItemsCriados: (next.budgetItems ?? []).filter(b => b.additiveId === active.id).length,
        },
      });
    });
    toast.success('Aditivo contratado — novos serviços integrados ao projeto');
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
          {active && (() => {
            const lastLog = (project.auditLogs ?? [])
              .filter(l => l.entityType === 'additive' && l.entityId === active.id)
              .sort((a, b) => (a.at < b.at ? 1 : -1))[0];
            return (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className={STATUS_BADGE[status]}>
                  {status === 'aprovado' && <CheckCircle2 className="w-3 h-3 mr-1" />}
                  {status === 'em_analise' && <Lock className="w-3 h-3 mr-1" />}
                  {status === 'reprovado' && <XCircle className="w-3 h-3 mr-1" />}
                  {STATUS_LABEL[status]}
                </Badge>
                {(active.version ?? 0) > 0 && (
                  <Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-300">
                    v{active.version}
                  </Badge>
                )}
                {active.approvedAt && (
                  <span className="text-[11px] text-muted-foreground">
                    Aprovado em {new Date(active.approvedAt).toLocaleDateString('pt-BR')}
                    {active.approvedBy ? ` por ${active.approvedBy}` : ''}
                  </span>
                )}
                {lastLog && (
                  <span className="text-[11px] text-muted-foreground">
                    Última alteração: {new Date(lastLog.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    {lastLog.userName ? ` · ${lastLog.userName}` : ''}
                  </span>
                )}
                {active.reviewNotes && (
                  <span className="text-[11px] text-muted-foreground italic">"{active.reviewNotes}"</span>
                )}
              </div>
            );
          })()}
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
          {active && (
            <div
              className="flex items-center gap-1.5 px-2 py-1 rounded border bg-card"
              title="Desconto global aplicado APENAS aos novos serviços (estudo do aditivo)."
            >
              <span className="text-xs text-muted-foreground">Desconto Licit. (%):</span>
              <Input
                type="number"
                step="0.01"
                min={0}
                value={globalDiscount}
                disabled={isLocked}
                onChange={e => handleChangeGlobalDiscount(e.target.value)}
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
          {active && (active.status === 'aprovado' || active.isContracted) && (
            <Button
              size="sm"
              className="bg-primary hover:bg-primary/90"
              onClick={handleContractAdditive}
              disabled={!!active.isContracted}
              title={active.isContracted
                ? 'Aditivo já contratado — novos serviços integrados ao projeto.'
                : 'Marca o aditivo como contratado e integra os novos serviços à EAP/Medição.'}
            >
              <CheckCircle2 className="w-4 h-4 mr-1" />
              {active.isContracted ? 'Aditivo Contratado' : 'Marcar como Contratado'}
            </Button>
          )}
          <Button variant="outline" size="sm" disabled={!active} onClick={handleExportExcel}>
            <Download className="w-4 h-4 mr-1" /> Exportar Excel
          </Button>
          <Button variant="outline" size="sm" disabled={!active} onClick={handleExportPdf}>
            <Printer className="w-4 h-4 mr-1" /> Imprimir / PDF
          </Button>
          <Button variant="outline" size="sm" disabled={!active} onClick={() => setHistoryOpen(true)}>
            <History className="w-4 h-4 mr-1" /> Histórico
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
                <div className="text-emerald-700">Aprovado — itens integrados ao projeto. Clique em "Marcar como Contratado" para liberar os novos serviços na EAP/Medição.</div>
              )}
              {status === 'aditivo_contratado' && (
                <div className="text-primary">Aditivo Contratado — novos serviços integrados à EAP, disponíveis na Medição, Cronograma e Diário.</div>
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

          {/* Tabela principal — modelo Excel "Aditivo e Supressao" */}
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/60 sticky top-0">
                  <tr className="border-b">
                    <th className="w-8" />
                    <th className="px-2 py-2 text-left font-semibold">Item</th>
                    <th className="px-2 py-2 text-left font-semibold">Código</th>
                    <th className="px-2 py-2 text-left font-semibold">Banco</th>
                    <th className="px-2 py-2 text-left font-semibold">Descrição</th>
                    <th className="px-2 py-2 text-left font-semibold">Und</th>
                    <th className="px-2 py-2 text-right font-semibold">Qtd Contratada</th>
                    <th className="px-2 py-2 text-right font-semibold text-rose-700">Qtd Suprimida</th>
                    <th className="px-2 py-2 text-right font-semibold text-emerald-700">Qtd Acrescida</th>
                    <th className="px-2 py-2 text-right font-semibold">Qtd Final</th>
                    <th className="px-2 py-2 text-right font-semibold">Valor Unit</th>
                    <th className="px-2 py-2 text-right font-semibold">Valor Unit c/ BDI</th>
                    <th className="px-2 py-2 text-right font-semibold">Total Fonte</th>
                    <th className="px-2 py-2 text-right font-semibold">Valor Contratado Calc.</th>
                    <th className="px-2 py-2 text-right font-semibold text-rose-700">Valor Suprimido</th>
                    <th className="px-2 py-2 text-right font-semibold text-emerald-700">Valor Acrescido</th>
                    <th className="px-2 py-2 text-right font-semibold">Valor Final</th>
                    <th className="px-2 py-2 text-right font-semibold">Diferença</th>
                    <th className="px-2 py-2 text-right font-semibold">% Var.</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const COL_COUNT = 19; // expander + 18 colunas
                    const renderCompRow = (c: AdditiveComposition) => {
                      const isOpen = expanded.has(c.id);
                      const r = computeAdditiveRow(c, bdi, globalDiscount);
                      const cb = computeCompositionWithBDI(c, bdi);
                      const hasInputs = c.inputs.length > 0;
                      const diff = hasInputs ? cb.diff : 0;
                      const hasDiff = hasInputs && Math.abs(diff) > 0.05;
                      const noAnalytic = !hasInputs && !c.isNewService;
                      const isNew = !!c.isNewService;

                      return (
                        <Fragment key={c.id}>
                          <tr className={`border-b hover:bg-muted/30 align-top ${isNew ? 'bg-sky-50/40' : ''}`}>
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
                            <td className="px-2 py-2 font-mono text-[11px]">
                              {isNew && !isLocked ? (
                                <Input
                                  value={c.code}
                                  onChange={e => updateComposition(c.id, { code: e.target.value })}
                                  className="h-7 w-20 text-[11px] font-mono"
                                />
                              ) : c.code}
                            </td>
                            <td className="px-2 py-2">
                              {isNew && !isLocked ? (
                                <Input
                                  value={c.bank}
                                  onChange={e => updateComposition(c.id, { bank: e.target.value })}
                                  className="h-7 w-20 text-xs"
                                />
                              ) : c.bank}
                            </td>
                            <td className="px-2 py-2 max-w-[320px]">
                              {isNew && !isLocked ? (
                                <Input
                                  value={c.description}
                                  onChange={e => updateComposition(c.id, { description: e.target.value })}
                                  className="h-7 text-xs"
                                />
                              ) : (
                                <div>{c.description}</div>
                              )}
                              <div className="flex flex-wrap gap-1 mt-1 items-center">
                                {isNew && (
                                  <Badge variant="outline" className="text-[9px] text-sky-700 border-sky-400 bg-sky-50">
                                    Novo serviço
                                  </Badge>
                                )}
                                {noAnalytic && <Badge variant="outline" className="text-[9px] text-amber-700 border-amber-400">Sem analítico</Badge>}
                                {hasDiff && (
                                  <Badge variant="outline" className="text-[9px] text-rose-700 border-rose-400">
                                    Dif. analítica c/ BDI: {fmtBRL(diff)}
                                  </Badge>
                                )}
                                {isNew && !isLocked && (
                                  <button
                                    onClick={() => handleRemoveComposition(c.id)}
                                    className="text-[10px] text-rose-600 hover:underline ml-1"
                                    title="Remover novo serviço"
                                  >
                                    <Trash2 className="w-3 h-3 inline" />
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="px-2 py-2">
                              {isNew && !isLocked ? (
                                <Input
                                  value={c.unit}
                                  onChange={e => updateComposition(c.id, { unit: e.target.value })}
                                  className="h-7 w-14 text-xs"
                                />
                              ) : c.unit}
                            </td>
                            {/* F — Qtd Contratada */}
                            <td className="px-2 py-2 text-right">
                              <Input
                                type="number" step="0.0001" min={0}
                                value={c.originalQuantity ?? 0}
                                disabled={isLocked || isNew}
                                onChange={e => updateComposition(c.id, { originalQuantity: Number(e.target.value) || 0 })}
                                className="h-7 w-20 text-xs text-right"
                              />
                            </td>
                            {/* G — Qtd Suprimida */}
                            <td className="px-2 py-2 text-right">
                              <Input
                                type="number" step="0.0001" min={0}
                                value={c.suppressedQuantity ?? 0}
                                disabled={isLocked || isNew}
                                onChange={e => updateComposition(c.id, { suppressedQuantity: Number(e.target.value) || 0 })}
                                onBlur={e => updateCompositionQuantity(c.id, 'suppressedQuantity', Number(e.target.value) || 0)}
                                className="h-7 w-20 text-xs text-right border-rose-200"
                              />
                            </td>
                            {/* H — Qtd Acrescida */}
                            <td className="px-2 py-2 text-right">
                              <Input
                                type="number" step="0.0001" min={0}
                                value={c.addedQuantity ?? 0}
                                disabled={isLocked}
                                onChange={e => updateComposition(c.id, { addedQuantity: Number(e.target.value) || 0 })}
                                onBlur={e => updateCompositionQuantity(c.id, 'addedQuantity', Number(e.target.value) || 0)}
                                className="h-7 w-20 text-xs text-right border-emerald-200"
                              />
                            </td>
                            {/* I — Qtd Final */}
                            <td className="px-2 py-2 text-right font-medium">{fmtNum(r.qtdFinal)}</td>
                            {/* J — Valor Unit (s/ BDI). Para novos serviços, exibe valor JÁ COM desconto. */}
                            <td className="px-2 py-2 text-right">
                              {isNew && !isLocked && c.inputs.length === 0 ? (
                                <Input
                                  type="number" step="0.01" min={0}
                                  value={c.unitPriceNoBDIInformed ?? 0}
                                  onChange={e => updateComposition(c.id, { unitPriceNoBDIInformed: Number(e.target.value) || 0 })}
                                  className="h-7 w-24 text-xs text-right"
                                  title={globalDiscount > 0 ? `Informe a referência s/ BDI. Desconto licit. ${globalDiscount}% será aplicado.` : 'Valor s/ BDI'}
                                />
                              ) : (
                                <span title={isNew && globalDiscount > 0 ? `Já com desconto de ${globalDiscount}% (referência: ${fmtBRL(r.referenceUnitNoBDI)})` : undefined}>
                                  {fmtBRL(isNew ? r.unitPriceNoBDIWithDiscount : r.unitPriceNoBDI)}
                                </span>
                              )}
                            </td>
                            {/* K — Valor Unit c/ BDI */}
                            <td className="px-2 py-2 text-right">{fmtBRL(r.unitPriceWithBDI)}</td>
                            {/* L — Total Fonte (preserva valor original da Sintética) */}
                            <td className="px-2 py-2 text-right text-muted-foreground">{fmtBRL(r.totalFonte)}</td>
                            {/* M — Valor Contratado Calc. */}
                            <td className="px-2 py-2 text-right">{fmtBRL(r.valorContratadoCalc)}</td>
                            {/* N — Valor Suprimido */}
                            <td className="px-2 py-2 text-right text-rose-700">
                              {r.valorSuprimido > 0 ? fmtBRL(-r.valorSuprimido) : fmtBRL(0)}
                            </td>
                            {/* O — Valor Acrescido */}
                            <td className="px-2 py-2 text-right text-emerald-700">{fmtBRL(r.valorAcrescido)}</td>
                            {/* P — Valor Final */}
                            <td className="px-2 py-2 text-right font-medium">{fmtBRL(r.valorFinal)}</td>
                            {/* Q — Diferença */}
                            <td className={`px-2 py-2 text-right font-medium ${r.diferenca < 0 ? 'text-rose-700' : r.diferenca > 0 ? 'text-emerald-700' : ''}`}>
                              {fmtBRL(r.diferenca)}
                            </td>
                            {/* R — % Var. */}
                            <td className={`px-2 py-2 text-right ${r.percentVar < 0 ? 'text-rose-700' : r.percentVar > 0 ? 'text-emerald-700' : ''}`}>
                              {fmtPct(r.percentVar)}
                            </td>
                          </tr>
                          {isOpen && showAnalytic && c.inputs.length > 0 && (
                            <tr className="bg-muted/20 border-b">
                              <td />
                              <td colSpan={COL_COUNT - 1} className="px-3 py-2">
                                {(() => {
                                  const showDiscount = isNew && globalDiscount > 0;
                                  const discFactor = showDiscount ? (1 - globalDiscount / 100) : 1;
                                  const sumNoBDI = sumAnalyticTotalNoBDI(c);
                                  const sumNoBDIDisc = money2(sumNoBDI * discFactor);
                                  const qty = c.addedQuantity ?? c.quantity ?? 0;
                                  const fator = 1 + bdi / 100;
                                  // Para novos serviços com desconto: valor analítico c/ BDI usa a base já com desconto.
                                  const totalAnalyticWithBDI = showDiscount
                                    ? truncar2(truncar2(sumNoBDIDisc * fator) * qty)
                                    : cb.totalAnalyticWithBDI;
                                  return (
                                    <table className="w-full text-[11px]">
                                      <thead>
                                        <tr className="text-muted-foreground">
                                          <th className="text-left px-1.5 py-1 font-medium">Código</th>
                                          <th className="text-left px-1.5 py-1 font-medium">Banco</th>
                                          <th className="text-left px-1.5 py-1 font-medium">Descrição</th>
                                          <th className="text-left px-1.5 py-1 font-medium">Un</th>
                                          <th className="text-right px-1.5 py-1 font-medium">Coef.</th>
                                          <th className="text-right px-1.5 py-1 font-medium">V. Unit s/ BDI</th>
                                          {showDiscount && (
                                            <th className="text-right px-1.5 py-1 font-medium text-sky-700">V. Unit s/ BDI c/ Desc.</th>
                                          )}
                                          <th className="text-right px-1.5 py-1 font-medium">Total s/ BDI</th>
                                          {showDiscount && (
                                            <th className="text-right px-1.5 py-1 font-medium text-sky-700">Total s/ BDI c/ Desc.</th>
                                          )}
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {c.inputs.map(i => {
                                          const unitDisc = money2(i.unitPrice * discFactor);
                                          const totalDisc = money2(i.coefficient * unitDisc);
                                          return (
                                            <tr key={i.id} className="border-t border-border/50">
                                              <td className="px-1.5 py-1 font-mono">{i.code}</td>
                                              <td className="px-1.5 py-1">{i.bank}</td>
                                              <td className="px-1.5 py-1">{i.description}</td>
                                              <td className="px-1.5 py-1">{i.unit}</td>
                                              <td className="px-1.5 py-1 text-right">{i.coefficient.toLocaleString('pt-BR')}</td>
                                              <td className="px-1.5 py-1 text-right">{fmtBRL(i.unitPrice)}</td>
                                              {showDiscount && (
                                                <td className="px-1.5 py-1 text-right text-sky-700">{fmtBRL(unitDisc)}</td>
                                              )}
                                              <td className="px-1.5 py-1 text-right">{fmtBRL(i.total)}</td>
                                              {showDiscount && (
                                                <td className="px-1.5 py-1 text-right text-sky-700">{fmtBRL(totalDisc)}</td>
                                              )}
                                            </tr>
                                          );
                                        })}
                                        <tr className="border-t font-medium">
                                          <td colSpan={showDiscount ? 6 : 6} className="px-1.5 py-1 text-right">Soma analítica s/ BDI:</td>
                                          {showDiscount && <td />}
                                          <td className="px-1.5 py-1 text-right">{fmtBRL(sumNoBDI)}</td>
                                          {showDiscount && <td />}
                                        </tr>
                                        {showDiscount && (
                                          <tr className="font-medium text-sky-700">
                                            <td colSpan={6} className="px-1.5 py-1 text-right">Soma analítica s/ BDI c/ desconto ({globalDiscount}%):</td>
                                            <td />
                                            <td />
                                            <td className="px-1.5 py-1 text-right">{fmtBRL(sumNoBDIDisc)}</td>
                                          </tr>
                                        )}
                                        <tr className="font-medium text-primary">
                                          <td colSpan={showDiscount ? 8 : 6} className="px-1.5 py-1 text-right">Valor analítico c/ BDI calculado (× qtd):</td>
                                          <td className="px-1.5 py-1 text-right">{fmtBRL(totalAnalyticWithBDI)}</td>
                                        </tr>
                                      </tbody>
                                    </table>
                                  );
                                })()}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    };

                    const renderGroup = (g: CompGroup): JSX.Element => {
                      const indent = g.depth * 14;
                      const isCollapsed = collapsed.has(g.phaseId);
                      return (
                        <Fragment key={g.phaseId}>
                          <tr className="bg-primary/5 border-b border-primary/20 font-semibold">
                            <td colSpan={COL_COUNT} className="px-2 py-1.5">
                              <div className="flex items-center gap-2" style={{ paddingLeft: indent }}>
                                <button
                                  type="button"
                                  onClick={() => toggleCollapsed(g.phaseId)}
                                  className="inline-flex items-center justify-center w-4 h-4 hover:bg-primary/10 rounded"
                                  aria-label={isCollapsed ? 'Expandir' : 'Recolher'}
                                >
                                  {isCollapsed
                                    ? <ChevronRight className="w-3.5 h-3.5" />
                                    : <ChevronDown className="w-3.5 h-3.5" />}
                                </button>
                                <span className="text-[12px]">{g.number} {g.name}</span>
                              </div>
                            </td>
                          </tr>
                          {!isCollapsed && g.rows.map(c => renderCompRow(c))}
                          {!isCollapsed && !isLocked && (
                            <tr className="border-b bg-sky-50/30">
                              <td colSpan={COL_COUNT} className="px-2 py-1">
                                <div style={{ paddingLeft: indent + 24 }}>
                                  <button
                                    type="button"
                                    onClick={() => handleAddNewService(g.phaseId, `${g.number} ${g.name}`, g.number)}
                                    className="text-[11px] text-sky-700 hover:text-sky-900 hover:underline inline-flex items-center gap-1"
                                  >
                                    + Novo serviço em {g.number} {g.name}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )}
                          {!isCollapsed && g.children.map(child => renderGroup(child))}
                          <tr className="border-b bg-muted/30 font-medium">
                            <td colSpan={13} className="px-2 py-1 text-right text-[11px]" style={{ paddingLeft: indent }}>
                              Subtotal {g.number} {g.name}
                            </td>
                            <td className="px-2 py-1 text-right text-[11px]">{fmtBRL(g.subtotalContratado)}</td>
                            <td colSpan={3} />
                            <td className="px-2 py-1 text-right text-[11px]">{fmtBRL(g.subtotalFinal)}</td>
                            <td colSpan={2} />
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
                          </>
                        )}
                      </>
                    );
                  })()}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Bloco TOTAL GERAL — modelo Excel "Aditivo e Supressao" */}
          <Card className="p-4 space-y-4">
            <div>
              <h3 className="text-sm font-bold mb-2 text-primary">TOTAL GERAL</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
                <div>
                  <div className="text-[11px] text-muted-foreground">Total contratado original</div>
                  <div className="font-semibold">{fmtBRL(totals.totalContratadoOriginal)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">Total suprimido</div>
                  <div className="font-semibold text-rose-700">
                    {totals.totalSuprimido > 0 ? fmtBRL(-totals.totalSuprimido) : fmtBRL(0)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">Total acrescido (existentes)</div>
                  <div className="font-semibold text-emerald-700">{fmtBRL(totals.totalAcrescidoExistentes)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">Total novos serviços</div>
                  <div className="font-semibold text-sky-700">{fmtBRL(totals.totalNovosServicos)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">Total acrescido (geral)</div>
                  <div className="font-semibold text-emerald-700">{fmtBRL(totals.totalAcrescido)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">Valor final</div>
                  <div className="font-semibold">{fmtBRL(totals.valorFinal)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">Diferença líquida</div>
                  <div className={`font-semibold ${totals.diferencaLiquida < 0 ? 'text-rose-700' : totals.diferencaLiquida > 0 ? 'text-emerald-700' : ''}`}>
                    {fmtBRL(totals.diferencaLiquida)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">% variação líquida</div>
                  <div className={`font-semibold ${totals.percentVariacaoLiquida < 0 ? 'text-rose-700' : totals.percentVariacaoLiquida > 0 ? 'text-emerald-700' : ''}`}>
                    {fmtPct(totals.percentVariacaoLiquida)}
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t pt-3">
              <h3 className="text-sm font-bold mb-2">PERCENTUAIS SOBRE O VALOR CONTRATADO</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                <div>
                  <div className="text-[11px] text-muted-foreground">% Supressão</div>
                  <div className="font-semibold text-rose-700">{fmtPct(totals.percentSupressao)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">% Acréscimo</div>
                  <div className="font-semibold text-emerald-700">{fmtPct(totals.percentAcrescimo)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">% Impacto líquido</div>
                  <div className={`font-semibold ${totals.percentImpactoLiquido < 0 ? 'text-rose-700' : totals.percentImpactoLiquido > 0 ? 'text-emerald-700' : ''}`}>
                    {fmtPct(totals.percentImpactoLiquido)}
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t pt-3">
              <h3 className="text-sm font-bold mb-2">LIMITE DE ADITIVO DA LICITAÇÃO</h3>
              <div className="flex flex-wrap items-end gap-4 text-xs">
                <div>
                  <div className="text-[11px] text-muted-foreground">Limite (%)</div>
                  <Input
                    type="number" step="0.5" min={0}
                    value={active.aditivoLimitPercent ?? 50}
                    disabled={isLocked}
                    onChange={e => {
                      const v = Number(e.target.value);
                      if (!Number.isFinite(v) || v < 0) return;
                      updateAdditive(a => ({ ...a, aditivoLimitPercent: v }));
                    }}
                    className="h-8 w-24 text-xs"
                  />
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">Status</div>
                  <Badge
                    variant="outline"
                    className={
                      totals.limitStatus === 'ok'
                        ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                        : 'bg-amber-100 text-amber-800 border-amber-300'
                    }
                  >
                    {totals.limitStatus === 'ok' ? (
                      <><CheckCircle2 className="w-3 h-3 mr-1" /> OK</>
                    ) : (
                      <><AlertTriangle className="w-3 h-3 mr-1" /> Revisar Limite</>
                    )}
                  </Badge>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Impacto líquido atual: <span className="font-semibold">{fmtPct(totals.percentImpactoLiquido)}</span>
                  {' · '}
                  Limite: <span className="font-semibold">{fmtPct(totals.limitPercent)}</span>
                </div>
              </div>
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
      {active && (
        <AuditHistoryPanel
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          project={project}
          entityType="additive"
          entityId={active.id}
          title={active.name}
        />
      )}
    </div>
  );
}
