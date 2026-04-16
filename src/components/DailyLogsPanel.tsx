import { Task, DailyProductionLog } from '@/types/project';
import { ClipboardList, Plus, Trash2, TrendingUp, TrendingDown } from 'lucide-react';
import { motion } from 'framer-motion';

interface DailyLogsPanelProps {
  task: Task;
  onChange: (logs: DailyProductionLog[]) => void;
}

/** Status color por defasagem (planejado - realizado).
 * <= 0  → verde (no prazo / adiantado)
 * 0-20% → amarelo
 * > 20% → vermelho */
function statusForDelta(delta: number, planned: number): 'ok' | 'warn' | 'late' {
  if (delta <= 0 || planned <= 0) return 'ok';
  const ratio = delta / planned;
  if (ratio <= 0.2) return 'warn';
  return 'late';
}

const STATUS_BG: Record<string, string> = {
  ok: 'bg-success/10 text-success',
  warn: 'bg-warning/10 text-warning',
  late: 'bg-destructive/10 text-destructive',
};

export default function DailyLogsPanel({ task, onChange }: DailyLogsPanelProps) {
  const logs = task.dailyLogs || [];
  const baseDuration = task.originalDuration ?? task.duration;
  const plannedDailyProduction = task.quantity && baseDuration > 0
    ? task.quantity / baseDuration
    : 0;

  const addLog = () => {
    const today = new Date().toISOString().split('T')[0];
    const newLog: DailyProductionLog = {
      id: `dl-${Date.now()}`,
      date: today,
      plannedQuantity: Math.round(plannedDailyProduction * 100) / 100,
      actualQuantity: 0,
    };
    onChange([...logs, newLog]);
  };

  const updateLog = (id: string, updates: Partial<DailyProductionLog>) => {
    onChange(logs.map(l => l.id === id ? { ...l, ...updates } : l));
  };

  const removeLog = (id: string) => {
    onChange(logs.filter(l => l.id !== id));
  };

  // Linhas: saldo dia, saldo acumulado, executado acumulado, falta executar
  let acc = 0;
  let execAcc = 0;
  const totalQty = task.quantity || 0;
  const sortedLogs = [...logs].sort((a, b) => a.date.localeCompare(b.date));
  const rows = sortedLogs.map(l => {
    const planned = l.plannedQuantity || 0;
    const actual = l.actualQuantity || 0;
    const delta = planned - actual;
    acc += delta;
    execAcc += actual;
    const remainingAfter = totalQty > 0 ? Math.max(totalQty - execAcc, 0) : 0;
    return {
      ...l,
      delta,
      accumulated: acc,
      executedAcc: execAcc,
      remainingAfter,
      status: statusForDelta(delta, planned),
    };
  });

  // Preview em tempo real do "Previsto" — atualiza imediatamente ao digitar realizado
  const previewRemaining = totalQty > 0 ? Math.max(totalQty - execAcc, 0) : 0;
  const previewRemainingDuration = plannedDailyProduction > 0
    ? Math.ceil(previewRemaining / plannedDailyProduction)
    : 0;
  const previewStartDate = sortedLogs.length > 0
    ? sortedLogs[0].date
    : (task.current?.startDate ?? task.startDate);
  const lastLogDate = sortedLogs.length > 0 ? sortedLogs[sortedLogs.length - 1].date : previewStartDate;
  const previewEndDate = (() => {
    if (sortedLogs.length === 0) {
      return task.current?.forecastEndDate ?? task.current?.endDate ?? task.startDate;
    }
    const projected = new Date(lastLogDate);
    projected.setDate(projected.getDate() + (previewRemaining <= 0 ? 0 : previewRemainingDuration));
    return projected.toISOString().split('T')[0];
  })();
  const previewDuration = Math.max(
    1,
    Math.ceil((new Date(previewEndDate).getTime() - new Date(previewStartDate).getTime()) / 86400000)
  );

  const accStatus = statusForDelta(task.accumulatedDelayQuantity || 0, plannedDailyProduction);
  const unit = task.unit || 'un';

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      className="overflow-hidden border-t border-border bg-muted/10"
    >
      <div className="px-8 py-3 space-y-3">
        {task.baseline && (
          <div className="flex items-center gap-2 flex-wrap text-[10px] bg-card border border-border rounded-md px-2 py-1">
            <span className="font-semibold text-muted-foreground uppercase tracking-wider">Cronograma:</span>
            <span className="text-muted-foreground">Base: <strong className="text-foreground">{task.baseline.duration}d</strong> ({new Date(task.baseline.startDate).toLocaleDateString('pt-BR')} → {new Date(task.baseline.endDate).toLocaleDateString('pt-BR')})</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">Previsto: <strong className="text-primary">{previewDuration}d</strong> ({new Date(previewStartDate).toLocaleDateString('pt-BR')} → {new Date(previewEndDate).toLocaleDateString('pt-BR')})</span>
            {(() => {
              const dev = previewDuration - task.baseline.duration;
              if (dev === 0) return null;
              const cls = dev <= 0 ? 'text-success' : dev <= 2 ? 'text-warning' : 'text-destructive';
              return <span className={`font-bold ${cls}`}>· Desvio: {dev > 0 ? '+' : ''}{dev}d</span>;
            })()}
          </div>
        )}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h4 className="text-[11px] font-semibold text-foreground flex items-center gap-1.5">
            <ClipboardList className="w-3.5 h-3.5 text-info" />
            Apontamento Diário — meta: <strong>{plannedDailyProduction.toFixed(1)} {unit}/dia</strong>
          </h4>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${STATUS_BG[accStatus]}`}>
              Saldo: {(task.accumulatedDelayQuantity || 0).toFixed(1)} {unit}
            </span>
            {sortedLogs.length > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                Previsão: {new Date(previewEndDate).toLocaleDateString('pt-BR')}
              </span>
            )}
            {task.physicalProgress !== undefined && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-info/10 text-info font-medium">
                Físico: {task.physicalProgress.toFixed(1)}%
              </span>
            )}
            <button
              onClick={addLog}
              className="text-[10px] px-2 py-1 rounded-md bg-primary/10 text-primary font-medium hover:bg-primary/20 transition-colors flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Lançamento
            </button>
          </div>
        </div>

        <div className="grid grid-cols-8 gap-2 text-[10px] font-semibold text-muted-foreground uppercase">
          <div>Data</div>
          <div className="text-center">Meta ({unit})</div>
          <div className="text-center">Realizado ({unit})</div>
          <div className="text-center">Saldo Dia</div>
          <div className="text-center">Saldo Acum.</div>
          <div className="text-center">Falta Executar</div>
          <div>Obs.</div>
          <div className="text-center">Ação</div>
        </div>

        {rows.length === 0 && (
          <p className="text-[11px] text-muted-foreground italic py-2 text-center">
            Sem lançamentos. Clique em "+ Lançamento" para registrar a produção do dia.
          </p>
        )}

        {rows.map(row => (
          <div
            key={row.id}
            className={`grid grid-cols-8 gap-2 text-[11px] items-center py-1 px-2 rounded ${STATUS_BG[row.status]}`}
          >
            <input
              type="date"
              value={row.date}
              onChange={e => updateLog(row.id, { date: e.target.value })}
              className="bg-transparent border border-current/30 rounded px-1 py-0.5 text-[10px] focus:outline-none focus:border-current"
            />
            <input
              type="number"
              min={0}
              step={0.1}
              value={row.plannedQuantity}
              onChange={e => updateLog(row.id, { plannedQuantity: Number(e.target.value) })}
              className="bg-transparent border border-current/30 rounded px-1 py-0.5 text-[11px] text-center focus:outline-none focus:border-current"
            />
            <input
              type="number"
              min={0}
              step={0.1}
              value={row.actualQuantity}
              onChange={e => updateLog(row.id, { actualQuantity: Number(e.target.value) })}
              className="bg-transparent border border-current/30 rounded px-1 py-0.5 text-[11px] text-center font-bold focus:outline-none focus:border-current"
            />
            <div className="text-center font-bold flex items-center justify-center gap-1">
              {row.delta > 0 ? <TrendingDown className="w-3 h-3" /> : row.delta < 0 ? <TrendingUp className="w-3 h-3" /> : null}
              {row.delta.toFixed(1)}
            </div>
            <div className="text-center font-bold">{row.accumulated.toFixed(1)}</div>
            <div className={`text-center font-bold ${row.remainingAfter <= 0 ? 'text-success' : ''}`} title={`Falta executar após este lançamento: ${row.remainingAfter.toFixed(1)} ${unit}`}>
              {row.remainingAfter.toFixed(1)} {unit}
            </div>
            <input
              type="text"
              value={row.notes || ''}
              placeholder="—"
              onChange={e => updateLog(row.id, { notes: e.target.value })}
              className="bg-transparent border border-current/30 rounded px-1 py-0.5 text-[10px] focus:outline-none focus:border-current"
            />
            <div className="text-center">
              <button
                onClick={() => removeLog(row.id)}
                className="p-1 rounded hover:bg-destructive/20 text-destructive transition-colors"
                title="Excluir lançamento"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
