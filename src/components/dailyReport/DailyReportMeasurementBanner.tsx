import { FileText } from 'lucide-react';
import type { DateMembership } from '@/hooks/useDailyReportPeriods';

interface DailyReportMeasurementBannerProps {
  dateMembership: DateMembership;
}

export function DailyReportMeasurementBanner({ dateMembership }: DailyReportMeasurementBannerProps) {
  if (!dateMembership) return null;
  return (
    <div className={`rounded-md border px-3 py-2 text-xs flex items-center gap-2 ${
      dateMembership.kind === 'generated'
        ? 'border-info/40 bg-info/10 text-info'
        : 'border-warning/40 bg-warning/10 text-warning'
    }`}>
      <FileText className="w-3.5 h-3.5" />
      <span>
        {dateMembership.kind === 'generated'
          ? <>Este diário faz parte da <strong>{dateMembership.label}</strong>.</>
          : <>Este diário está dentro do período da <strong>{dateMembership.label}</strong>.</>}
      </span>
    </div>
  );
}
