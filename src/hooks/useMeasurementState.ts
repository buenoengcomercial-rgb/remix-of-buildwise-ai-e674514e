/**
 * Estado UI da Planilha de Medição:
 * - filtros (datas, capítulo, busca)
 * - cabeçalho contratual (formulário)
 * - flags de diálogos / edição inline
 * - sincronização com project.measurementDraft e project.contractInfo
 *
 * Não contém regras financeiras nem de aprovação.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project, SavedMeasurement } from '@/types/project';
import { isoAddDays, suggestPeriodForNext } from '@/components/measurement/measurementFormat';

export interface UseMeasurementStateParams {
  project: Project;
  measurements: SavedMeasurement[];
  defaultNextNumber: number;
  onProjectChange: (p: Project) => void;
  /** Ref sempre atualizada do projeto (evita closure stale ao chamar onProjectChange várias vezes). */
  projectRef: React.MutableRefObject<Project>;
}

export function useMeasurementState({
  project,
  measurements,
  defaultNextNumber,
  onProjectChange,
  projectRef,
}: UseMeasurementStateParams) {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const issueDate = today;

  const contract = project.contractInfo || {};
  const initialDraft = project.measurementDraft;
  const initialDraftMatches = initialDraft && initialDraft.number === defaultNextNumber;
  const initialSuggested = suggestPeriodForNext(measurements, today, monthAgo);

  const [activeId, setActiveId] = useState<string>('live');
  const [historyOpen, setHistoryOpen] = useState(false);

  // Filtros
  const [startDate, setStartDate] = useState(
    initialDraftMatches && initialDraft?.startDate ? initialDraft.startDate : initialSuggested.startDate,
  );
  const [endDate, setEndDate] = useState(
    initialDraftMatches && initialDraft?.endDate ? initialDraft.endDate : initialSuggested.endDate,
  );
  const [chapterFilter, setChapterFilter] = useState<string>(
    initialDraftMatches && initialDraft?.chapterFilter ? initialDraft.chapterFilter : 'all',
  );
  const [search, setSearch] = useState(
    initialDraftMatches && initialDraft?.search ? initialDraft.search : '',
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Cabeçalho contratual
  const [contractor, setContractor] = useState(contract.contractor || '');
  const [contracted, setContracted] = useState(contract.contracted || '');
  const [contractNumber, setContractNumber] = useState(contract.contractNumber || '');
  const [contractObject, setContractObject] = useState(contract.contractObject || '');
  const [location, setLocation] = useState(contract.location || '');
  const [budgetSource, setBudgetSource] = useState(contract.budgetSource || '');
  const [bdiInput, setBdiInput] = useState(
    contract.bdiPercent !== undefined ? String(contract.bdiPercent) : '25',
  );
  const [measurementNumber, setMeasurementNumber] = useState(String(defaultNextNumber));

  // Diálogos / edição inline
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [confirmEdit, setConfirmEdit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editReason, setEditReason] = useState('');
  const [editingPriceTaskId, setEditingPriceTaskId] = useState<string | null>(null);
  const [editingPriceValue, setEditingPriceValue] = useState<string>('');

  // Recarrega tudo ao trocar de obra
  useEffect(() => {
    const c = project.contractInfo || {};
    setContractor(c.contractor || '');
    setContracted(c.contracted || '');
    setContractNumber(c.contractNumber || '');
    setContractObject(c.contractObject || '');
    setLocation(c.location || '');
    setBudgetSource(c.budgetSource || '');
    setBdiInput(c.bdiPercent !== undefined ? String(c.bdiPercent) : '25');

    const sortedMs = (project.measurements || []).slice().sort((a, b) => a.number - b.number);
    const nextNum =
      (c.nextMeasurementNumber ?? ((sortedMs[sortedMs.length - 1]?.number || 0) + 1)) || 1;
    setMeasurementNumber(String(nextNum));
    const d = project.measurementDraft;
    if (d && d.number === nextNum && d.startDate && d.endDate) {
      setStartDate(d.startDate);
      setEndDate(d.endDate);
      setChapterFilter(d.chapterFilter || 'all');
      setSearch(d.search || '');
    } else {
      const s = suggestPeriodForNext(sortedMs, today, monthAgo);
      setStartDate(s.startDate);
      setEndDate(s.endDate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  // Sincroniza nº sugerido conforme medições mudam
  useEffect(() => {
    if (activeId !== 'live') return;
    const next = (measurements[measurements.length - 1]?.number || 0) + 1;
    setMeasurementNumber(prev => (prev === String(next) ? prev : String(next || 1)));
    const d = project.measurementDraft;
    if (d && d.number === next && d.startDate && d.endDate) {
      setStartDate(d.startDate);
      setEndDate(d.endDate);
    } else {
      const s = suggestPeriodForNext(measurements, today, monthAgo);
      setStartDate(s.startDate);
      setEndDate(s.endDate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measurements.length, activeId]);

  // Autocorreção: se Data final < Data inicial
  useEffect(() => {
    if (activeId !== 'live') return;
    if (startDate && endDate && endDate < startDate) {
      setEndDate(isoAddDays(startDate, 30));
    }
  }, [activeId, startDate, endDate]);

  // Persiste rascunho (datas + filtros) — usa projectRef p/ evitar stale closure
  useEffect(() => {
    if (activeId !== 'live') return;
    const num = Number(measurementNumber);
    if (!Number.isFinite(num) || num <= 0) return;
    const latestProject = projectRef.current;
    const current = latestProject.measurementDraft;
    const nextDraft = { number: num, startDate, endDate, chapterFilter, search };
    if (
      current &&
      current.number === nextDraft.number &&
      current.startDate === nextDraft.startDate &&
      current.endDate === nextDraft.endDate &&
      (current.chapterFilter || 'all') === nextDraft.chapterFilter &&
      (current.search || '') === nextDraft.search
    ) {
      return;
    }
    onProjectChange({ ...latestProject, measurementDraft: nextDraft });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, measurementNumber, startDate, endDate, chapterFilter, search]);

  return {
    today, monthAgo, issueDate,
    activeId, setActiveId,
    historyOpen, setHistoryOpen,
    startDate, setStartDate,
    endDate, setEndDate,
    chapterFilter, setChapterFilter,
    search, setSearch,
    collapsed, setCollapsed,
    contractor, setContractor,
    contracted, setContracted,
    contractNumber, setContractNumber,
    contractObject, setContractObject,
    location, setLocation,
    budgetSource, setBudgetSource,
    bdiInput, setBdiInput,
    measurementNumber, setMeasurementNumber,
    confirmGenerate, setConfirmGenerate,
    confirmEdit, setConfirmEdit,
    confirmDelete, setConfirmDelete,
    editReason, setEditReason,
    editingPriceTaskId, setEditingPriceTaskId,
    editingPriceValue, setEditingPriceValue,
  };
}
