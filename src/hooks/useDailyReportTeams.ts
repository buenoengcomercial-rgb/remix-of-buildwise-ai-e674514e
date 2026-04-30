import { useMemo } from 'react';
import type { Project, DailyReport as DailyReportEntry, DailyReportTeamRow } from '@/types/project';
import { DEFAULT_TEAMS, type TeamDefinition } from '@/lib/teams';
import { uid } from '@/components/dailyReport/dailyReportFormat';
import type { ProductionEntry } from '@/components/dailyReport/types';

interface UseDailyReportTeamsArgs {
  project: Project;
  production: ProductionEntry[];
  persist: (mutator: (r: DailyReportEntry) => DailyReportEntry) => void;
}

export interface UseDailyReportTeamsResult {
  projectTeams: TeamDefinition[];
  teamByCode: Map<string, TeamDefinition>;
  teamDisplay: (def?: TeamDefinition, fallback?: string) => string;
  suggestedTeamCodes: string[];
  addTeamRow: (teamCode?: string) => void;
  updateTeamRow: (id: string, patch: Partial<DailyReportTeamRow>) => void;
  removeTeamRow: (id: string) => void;
  addSuggestedTeams: () => void;
}

export function useDailyReportTeams({
  project,
  production,
  persist,
}: UseDailyReportTeamsArgs): UseDailyReportTeamsResult {
  const projectTeams: TeamDefinition[] = useMemo(
    () => (project.teams && project.teams.length > 0) ? project.teams : DEFAULT_TEAMS,
    [project.teams],
  );

  const teamByCode = useMemo(
    () => new Map(projectTeams.map(t => [t.code, t])),
    [projectTeams],
  );

  /** Exibição amigável da equipe: composition → label → code. */
  const teamDisplay = (def?: TeamDefinition, fallback?: string): string => {
    if (def) return (def.composition?.trim() || def.label?.trim() || def.code);
    return fallback?.trim() || '—';
  };

  // Equipes sugeridas: códigos vindos das tarefas com produção no dia
  const suggestedTeamCodes = useMemo(() => {
    const set = new Set<string>();
    production.forEach(p => { if (p.teamCode) set.add(p.teamCode); });
    return Array.from(set);
  }, [production]);

  const addTeamRow = (teamCode?: string) => persist(r => {
    const def = teamCode ? teamByCode.get(teamCode) : undefined;
    return {
      ...r,
      teamsPresent: [
        ...(r.teamsPresent || []),
        { id: uid('tm'), teamCode, name: def?.label || '', role: def?.composition || '', count: 1 },
      ],
    };
  });

  const updateTeamRow = (id: string, patch: Partial<DailyReportTeamRow>) => persist(r => ({
    ...r,
    teamsPresent: (r.teamsPresent || []).map(t => t.id === id ? { ...t, ...patch } : t),
  }));

  const removeTeamRow = (id: string) => persist(r => ({
    ...r,
    teamsPresent: (r.teamsPresent || []).filter(t => t.id !== id),
  }));

  /** Adiciona em lote as equipes sugeridas pelo apontamento, evitando duplicar códigos já presentes. */
  const addSuggestedTeams = () => persist(r => {
    const existingCodes = new Set((r.teamsPresent || []).map(t => t.teamCode).filter(Boolean) as string[]);
    const toAdd = suggestedTeamCodes.filter(c => !existingCodes.has(c));
    if (toAdd.length === 0) return r;
    const newRows: DailyReportTeamRow[] = toAdd.map(code => {
      const def = teamByCode.get(code);
      return { id: uid('tm'), teamCode: code, name: def?.label || code, role: def?.composition || '', count: 1 };
    });
    return { ...r, teamsPresent: [...(r.teamsPresent || []), ...newRows] };
  });

  return {
    projectTeams,
    teamByCode,
    teamDisplay,
    suggestedTeamCodes,
    addTeamRow,
    updateTeamRow,
    removeTeamRow,
    addSuggestedTeams,
  };
}
