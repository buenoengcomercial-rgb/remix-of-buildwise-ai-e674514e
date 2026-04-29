import { useMemo, useRef, useState } from 'react';
import type { Project, Additive as AdditiveModel, AdditiveStatus } from '@/types/project';

export function useAdditiveState(project: Project) {
  const additives = project.additives ?? [];
  const [activeId, setActiveId] = useState<string | null>(additives[0]?.id ?? null);
  const active = useMemo<AdditiveModel | null>(
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

  const status: AdditiveStatus = active?.status ?? 'rascunho';
  const isLocked =
    status === 'em_analise' ||
    status === 'aprovado' ||
    status === 'aditivo_contratado' ||
    !!active?.isContracted;
  const globalDiscount = active?.globalDiscountPercent ?? 0;
  const bdi = active?.bdiPercent ?? 0;

  const toggleExpand = (id: string) =>
    setExpanded(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  const toggleCollapsed = (id: string) =>
    setCollapsed(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  return {
    additives,
    activeId, setActiveId,
    active,
    search, setSearch,
    bankFilter, setBankFilter,
    showAnalytic, setShowAnalytic,
    expanded, toggleExpand,
    collapsed, toggleCollapsed,
    importDialogOpen, setImportDialogOpen,
    importName, setImportName,
    pendingFile, setPendingFile,
    issuesOpen, setIssuesOpen,
    confirmDeleteId, setConfirmDeleteId,
    reviewDialogOpen, setReviewDialogOpen,
    reviewNotes, setReviewNotes,
    approvedBy, setApprovedBy,
    fileRef,
    historyOpen, setHistoryOpen,
    status,
    isLocked,
    globalDiscount,
    bdi,
  };
}

export type AdditiveStateApi = ReturnType<typeof useAdditiveState>;
