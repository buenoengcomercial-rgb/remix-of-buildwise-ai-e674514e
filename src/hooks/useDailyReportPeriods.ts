import { useMemo } from 'react';
import type { Project } from '@/types/project';
import {
  summarizeDailyReportsForPeriod,
  type DailyReportPeriodSummary,
} from '@/lib/dailyReportSummary';

export interface MeasurementPeriod {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
}

export type DateMembership =
  | { kind: 'generated'; label: string }
  | { kind: 'draft'; label: string }
  | null;

interface UseDailyReportPeriodsArgs {
  project: Project;
  selectedDate: string;
  measurementFilter: string;
}

export interface UseDailyReportPeriodsResult {
  measurementPeriods: MeasurementPeriod[];
  activePeriod: MeasurementPeriod | null;
  periodDates: string[];
  dateMembership: DateMembership;
  periodSummary: DailyReportPeriodSummary | null;
}

export function useDailyReportPeriods({
  project,
  selectedDate,
  measurementFilter,
}: UseDailyReportPeriodsArgs): UseDailyReportPeriodsResult {
  // Lista de períodos selecionáveis (medições geradas + medição em preparação)
  const measurementPeriods = useMemo<MeasurementPeriod[]>(() => {
    const list: MeasurementPeriod[] = [];
    (project.measurements || []).slice().sort((a, b) => a.number - b.number).forEach(m => {
      list.push({
        id: m.id,
        label: `Medição Nº ${m.number}`,
        startDate: m.startDate,
        endDate: m.endDate,
      });
    });
    const draft = project.measurementDraft;
    if (draft?.startDate && draft?.endDate) {
      list.push({
        id: 'draft',
        label: `Medição em preparação (Nº ${draft.number})`,
        startDate: draft.startDate,
        endDate: draft.endDate,
      });
    }
    return list;
  }, [project.measurements, project.measurementDraft]);

  const activePeriod = useMemo(
    () => measurementPeriods.find(p => p.id === measurementFilter) || null,
    [measurementPeriods, measurementFilter],
  );

  // Datas exibidas no seletor secundário (quando filtra por uma medição)
  const periodDates = useMemo(() => {
    if (!activePeriod) return [] as string[];
    const out: string[] = [];
    const [sy, sm, sd] = activePeriod.startDate.split('-').map(Number);
    const [ey, em, ed] = activePeriod.endDate.split('-').map(Number);
    const cur = new Date(Date.UTC(sy, (sm || 1) - 1, sd || 1));
    const end = new Date(Date.UTC(ey, (em || 1) - 1, ed || 1));
    while (cur.getTime() <= end.getTime()) {
      out.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return out;
  }, [activePeriod]);

  // Detecta se a data selecionada pertence a alguma medição (gerada ou em preparação)
  const dateMembership = useMemo<DateMembership>(() => {
    const generated = (project.measurements || []).find(
      m => selectedDate >= m.startDate && selectedDate <= m.endDate,
    );
    if (generated) {
      return { kind: 'generated', label: `Medição Nº ${generated.number}` };
    }
    const draft = project.measurementDraft;
    if (draft?.startDate && draft?.endDate &&
        selectedDate >= draft.startDate && selectedDate <= draft.endDate) {
      return { kind: 'draft', label: `Medição em preparação (Nº ${draft.number})` };
    }
    return null;
  }, [project.measurements, project.measurementDraft, selectedDate]);

  // Resumo do período (só calcula quando há período ativo)
  const periodSummary = useMemo(
    () => activePeriod ? summarizeDailyReportsForPeriod(project, activePeriod.startDate, activePeriod.endDate) : null,
    [activePeriod, project],
  );

  return { measurementPeriods, activePeriod, periodDates, dateMembership, periodSummary };
}
