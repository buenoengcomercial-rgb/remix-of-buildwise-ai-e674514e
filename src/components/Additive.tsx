import { useMemo, useState, useRef } from 'react';
import { Project, Additive as AdditiveModel, AdditiveInputType, AdditiveComposition } from '@/types/project';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
  Upload, Download, Printer, Search, ChevronRight, ChevronDown, AlertTriangle, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  importAdditiveFromExcel, exportAdditiveToExcel, exportAdditiveToPdf,
  additiveTotals, sumAnalyticTotalNoBDI, computeCompositionWithBDI,
} from '@/lib/additiveImport';

interface Props {
  project: Project;
  onProjectChange: (next: Project | ((prev: Project) => Project)) => void;
  undoButton?: React.ReactNode;
}

const TYPE_LABEL: Record<AdditiveInputType, string> = {
  material: 'Material',
  mao_obra: 'Mão de obra',
  equipamento: 'Equipamento',
  outro: 'Outro',
};
const TYPE_BADGE: Record<AdditiveInputType, string> = {
  material: 'bg-blue-100 text-blue-800',
  mao_obra: 'bg-amber-100 text-amber-800',
  equipamento: 'bg-purple-100 text-purple-800',
  outro: 'bg-gray-200 text-gray-700',
};

const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function Additive({ project, onProjectChange, undoButton }: Props) {
  const additives = project.additives ?? [];
  const [activeId, setActiveId] = useState<string | null>(additives[0]?.id ?? null);
  const active = useMemo(
    () => additives.find(a => a.id === activeId) ?? additives[0] ?? null,
    [additives, activeId],
  );

  const [search, setSearch] = useState('');
  const [bankFilter, setBankFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [showAnalytic, setShowAnalytic] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importName, setImportName] = useState('SINTÉTICA CORREÇÃO 02');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
      if (typeFilter !== 'all') {
        if (!c.inputs.some(i => i.type === (typeFilter as AdditiveInputType))) return false;
      }
      return true;
    });
  }, [active, search, bankFilter, typeFilter]);

  const totals = active ? additiveTotals(active) : null;

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
      const additive = await importAdditiveFromExcel(pendingFile, importName.trim() || 'Aditivo');
      onProjectChange(prev => ({
        ...prev,
        additives: [...(prev.additives ?? []), additive],
      }));
      setActiveId(additive.id);
      const errCount = additive.issues?.filter(i => i.level === 'error').length ?? 0;
      const warnCount = additive.issues?.filter(i => i.level === 'warning').length ?? 0;
      toast.success(
        `Aditivo importado: ${additive.compositions.length} composições${errCount ? ` (${errCount} erros)` : ''}${warnCount ? ` (${warnCount} avisos)` : ''}`,
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

  const handleChangeInputType = (compId: string, inputId: string, newType: AdditiveInputType) => {
    if (!active) return;
    onProjectChange(prev => ({
      ...prev,
      additives: (prev.additives ?? []).map(a => a.id !== active.id ? a : ({
        ...a,
        compositions: a.compositions.map(c => c.id !== compId ? c : ({
          ...c,
          inputs: c.inputs.map(i => i.id === inputId ? { ...i, type: newType } : i),
        })),
      })),
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
    if (!active) return;
    const num = Number(value.replace(',', '.'));
    if (!Number.isFinite(num) || num < 0) return;
    onProjectChange(prev => ({
      ...prev,
      additives: (prev.additives ?? []).map(a => a.id === active.id ? { ...a, bdiPercent: num } : a),
    }));
  };

  const bdi = active?.bdiPercent ?? 0;

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-[1600px] mx-auto">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Aditivo {active ? `— ${active.name}` : ''}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Importação de planilhas de aditivo contratual (Sintética + Analítica).
          </p>
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
          {additives.map(a => (
            <div key={a.id} className="flex items-center">
              <button
                onClick={() => setActiveId(a.id)}
                className={`px-2.5 py-1 rounded-l text-xs border ${a.id === active?.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-card hover:bg-muted'}`}
              >
                {a.name}
              </button>
              <button
                onClick={() => setConfirmDeleteId(a.id)}
                title="Excluir aditivo"
                className="px-1.5 py-1 rounded-r text-xs border border-l-0 hover:bg-destructive/10 text-destructive"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
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
            Nenhum aditivo importado ainda. Importe uma planilha Excel com as abas
            <strong> Sintética </strong> e <strong> Analítica</strong>.
          </p>
          <Button onClick={() => fileRef.current?.click()}>
            <Upload className="w-4 h-4 mr-2" /> Importar planilha
          </Button>
        </Card>
      )}

      {active && totals && (
        <>
          {/* Cards resumo */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Card className="p-3">
              <div className="text-[11px] text-muted-foreground">Composições</div>
              <div className="text-lg font-semibold">{totals.compCount}</div>
            </Card>
            <Card className="p-3">
              <div className="text-[11px] text-muted-foreground">Total s/ BDI</div>
              <div className="text-lg font-semibold">{fmtBRL(totals.totalSemBDI)}</div>
            </Card>
            <Card className="p-3">
              <div className="text-[11px] text-muted-foreground">Total c/ BDI</div>
              <div className="text-lg font-semibold">{fmtBRL(totals.totalComBDI)}</div>
            </Card>
            <Card className="p-3">
              <div className="text-[11px] text-muted-foreground">Total Geral</div>
              <div className="text-lg font-semibold text-primary">{fmtBRL(totals.total)}</div>
            </Card>
            <Card className="p-3">
              <div className="text-[11px] text-muted-foreground">Insumos vinculados</div>
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
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-9 w-[160px]"><SelectValue placeholder="Tipo de insumo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os tipos</SelectItem>
                <SelectItem value="material">Material</SelectItem>
                <SelectItem value="mao_obra">Mão de obra</SelectItem>
                <SelectItem value="equipamento">Equipamento</SelectItem>
                <SelectItem value="outro">Outro</SelectItem>
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

          {/* Tabela */}
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
                    <th className="px-2 py-2 text-right font-semibold">Qtd</th>
                    <th className="px-2 py-2 text-left font-semibold">Un</th>
                    <th className="px-2 py-2 text-right font-semibold">V.Unit s/BDI</th>
                    <th className="px-2 py-2 text-right font-semibold">V.Unit c/BDI</th>
                    <th className="px-2 py-2 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredComps.map(c => {
                    const isOpen = expanded.has(c.id);
                    const r = computeCompositionWithBDI(c, bdi);
                    const hasInputs = c.inputs.length > 0;
                    const diff = hasInputs ? r.diff : 0;
                    const hasDiff = hasInputs && Math.abs(diff) > 0.05;
                    const noAnalytic = !hasInputs;
                    return (
                      <>
                        <tr key={c.id} className="border-b hover:bg-muted/30 align-top">
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
                          <td className="px-2 py-2">{c.item}</td>
                          <td className="px-2 py-2 font-mono text-[11px]">{c.code}</td>
                          <td className="px-2 py-2">{c.bank}</td>
                          <td className="px-2 py-2 max-w-[420px]">
                            <div>{c.description}</div>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {noAnalytic && <Badge variant="outline" className="text-[9px] text-amber-700 border-amber-400">Sem analítico</Badge>}
                              {hasDiff && (
                                <Badge variant="outline" className="text-[9px] text-rose-700 border-rose-400">
                                  Diferença analítica c/ BDI: {fmtBRL(diff)}
                                </Badge>
                              )}
                            </div>
                          </td>
                          <td className="px-2 py-2 text-right">{c.quantity.toLocaleString('pt-BR')}</td>
                          <td className="px-2 py-2">{c.unit}</td>
                          <td className="px-2 py-2 text-right">{fmtBRL(c.unitPriceNoBDI)}</td>
                          <td className="px-2 py-2 text-right">{fmtBRL(r.unitPriceWithBDI)}</td>
                          <td className="px-2 py-2 text-right font-medium">{fmtBRL(r.totalSyntheticWithBDI)}</td>
                        </tr>
                        {isOpen && showAnalytic && c.inputs.length > 0 && (
                          <tr className="bg-muted/20 border-b">
                            <td />
                            <td colSpan={9} className="px-3 py-2">
                              <table className="w-full text-[11px]">
                                <thead>
                                  <tr className="text-muted-foreground">
                                    <th className="text-left px-1.5 py-1 font-medium">Código</th>
                                    <th className="text-left px-1.5 py-1 font-medium">Banco</th>
                                    <th className="text-left px-1.5 py-1 font-medium">Tipo</th>
                                    <th className="text-left px-1.5 py-1 font-medium">Descrição</th>
                                    <th className="text-left px-1.5 py-1 font-medium">Un</th>
                                    <th className="text-right px-1.5 py-1 font-medium">Coef.</th>
                                    <th className="text-right px-1.5 py-1 font-medium">V. Unit</th>
                                    <th className="text-right px-1.5 py-1 font-medium">Total</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {c.inputs
                                    .filter(i => typeFilter === 'all' || i.type === typeFilter)
                                    .map(i => (
                                    <tr key={i.id} className="border-t border-border/50">
                                      <td className="px-1.5 py-1 font-mono">{i.code}</td>
                                      <td className="px-1.5 py-1">{i.bank}</td>
                                      <td className="px-1.5 py-1">
                                        <Select
                                          value={i.type}
                                          onValueChange={v => handleChangeInputType(c.id, i.id, v as AdditiveInputType)}
                                        >
                                          <SelectTrigger className={`h-6 text-[10px] px-2 ${TYPE_BADGE[i.type]}`}>
                                            <SelectValue />
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="material">Material</SelectItem>
                                            <SelectItem value="mao_obra">Mão de obra</SelectItem>
                                            <SelectItem value="equipamento">Equipamento</SelectItem>
                                            <SelectItem value="outro">Outro</SelectItem>
                                          </SelectContent>
                                        </Select>
                                      </td>
                                      <td className="px-1.5 py-1">{i.description}</td>
                                      <td className="px-1.5 py-1">{i.unit}</td>
                                      <td className="px-1.5 py-1 text-right">{i.coefficient.toLocaleString('pt-BR')}</td>
                                      <td className="px-1.5 py-1 text-right">{fmtBRL(i.unitPrice)}</td>
                                      <td className="px-1.5 py-1 text-right">{fmtBRL(i.total)}</td>
                                    </tr>
                                  ))}
                                  <tr className="border-t font-medium">
                                    <td colSpan={7} className="px-1.5 py-1 text-right">Soma analítica (s/ BDI):</td>
                                    <td className="px-1.5 py-1 text-right">{fmtBRL(sumAnalyticTotal(c))}</td>
                                  </tr>
                                  {c.analyticUnitPriceWithBDI != null && (
                                    <tr className="font-medium text-primary">
                                      <td colSpan={7} className="px-1.5 py-1 text-right">Valor com BDI = (× qtd):</td>
                                      <td className="px-1.5 py-1 text-right">{fmtBRL(c.analyticTotalWithBDI ?? 0)}</td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                  {filteredComps.length === 0 && (
                    <tr>
                      <td colSpan={10} className="text-center text-muted-foreground py-8">
                        Nenhuma composição encontrada com os filtros atuais.
                      </td>
                    </tr>
                  )}
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
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setImportDialogOpen(false); setPendingFile(null); }}>Cancelar</Button>
            <Button onClick={handleConfirmImport}>Importar</Button>
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
