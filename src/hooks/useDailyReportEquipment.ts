import type { DailyReport as DailyReportEntry, DailyReportEquipmentRow } from '@/types/project';
import { uid } from '@/components/dailyReport/dailyReportFormat';

interface UseDailyReportEquipmentArgs {
  persist: (mutator: (r: DailyReportEntry) => DailyReportEntry) => void;
}

export interface UseDailyReportEquipmentResult {
  addEqRow: () => void;
  updateEqRow: (id: string, patch: Partial<DailyReportEquipmentRow>) => void;
  removeEqRow: (id: string) => void;
}

export function useDailyReportEquipment({
  persist,
}: UseDailyReportEquipmentArgs): UseDailyReportEquipmentResult {
  const addEqRow = () => persist(r => ({
    ...r,
    equipment: [...(r.equipment || []), { id: uid('eq'), name: '', count: 1, notes: '' }],
  }));

  const updateEqRow = (id: string, patch: Partial<DailyReportEquipmentRow>) => persist(r => ({
    ...r,
    equipment: (r.equipment || []).map(e => e.id === id ? { ...e, ...patch } : e),
  }));

  const removeEqRow = (id: string) => persist(r => ({
    ...r,
    equipment: (r.equipment || []).filter(e => e.id !== id),
  }));

  return { addEqRow, updateEqRow, removeEqRow };
}
