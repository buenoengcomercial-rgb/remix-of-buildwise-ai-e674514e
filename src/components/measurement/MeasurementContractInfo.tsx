import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Building2 } from 'lucide-react';
import type { Project, ContractInfo } from '@/types/project';
import { fmtDateBR } from '@/components/measurement/measurementFormat';

interface MeasurementContractInfoProps {
  project: Project;
  isSnapshotMode: boolean;
  effStart: string;
  effEnd: string;
  effIssue: string;
  effBdi: number;
  effNumber: string;
  contractor: string; setContractor: (v: string) => void;
  contracted: string; setContracted: (v: string) => void;
  contractNumber: string; setContractNumber: (v: string) => void;
  contractObject: string; setContractObject: (v: string) => void;
  location: string; setLocation: (v: string) => void;
  budgetSource: string; setBudgetSource: (v: string) => void;
  artNumber: string; setArtNumber: (v: string) => void;
  bdiInput: string; setBdiInput: (v: string) => void;
  bdiPercent: number;
  measurementNumber: string; setMeasurementNumber: (v: string) => void;
  persistContractInfo: (patch: Partial<ContractInfo>) => void;
}

export default function MeasurementContractInfo({
  project,
  isSnapshotMode,
  effStart, effEnd, effIssue, effBdi, effNumber,
  contractor, setContractor,
  contracted, setContracted,
  contractNumber, setContractNumber,
  contractObject, setContractObject,
  location, setLocation,
  budgetSource, setBudgetSource,
  artNumber, setArtNumber,
  bdiInput, setBdiInput,
  bdiPercent,
  measurementNumber, setMeasurementNumber,
  persistContractInfo,
}: MeasurementContractInfoProps) {
  return (
    <Card className="border-2 border-foreground/20 print:border-foreground print:shadow-none">
      <CardContent className="p-0">
        <div className="bg-muted/40 px-5 py-3 border-b-2 border-foreground/20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Building2 className="w-5 h-5 text-foreground" />
            <h2 className="text-sm font-bold tracking-widest uppercase text-foreground">
              Boletim de Medição para Pagamento
            </h2>
          </div>
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Medição Nº</p>
            <p className="text-lg font-bold tabular-nums text-foreground leading-none">
              {effNumber || '—'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-12 text-[11px]">
          <FormField label="Contratante" colSpan={6}>
            <Input
              className="h-7 text-xs border-0 px-0 focus-visible:ring-0 bg-transparent"
              value={contractor}
              disabled={isSnapshotMode}
              onChange={e => setContractor(e.target.value)}
              onBlur={() => persistContractInfo({ contractor })}
              placeholder="Nome do contratante"
            />
          </FormField>
          <FormField label="Contratada" colSpan={6}>
            <Input
              className="h-7 text-xs border-0 px-0 focus-visible:ring-0 bg-transparent"
              value={contracted}
              disabled={isSnapshotMode}
              onChange={e => setContracted(e.target.value)}
              onBlur={() => persistContractInfo({ contracted })}
              placeholder="Nome da contratada"
            />
          </FormField>
          <FormField label="Obra" colSpan={8}>
            <p className="text-xs font-semibold text-foreground py-1">{project.name}</p>
          </FormField>
          <FormField label="Local / Município" colSpan={4}>
            <Input
              className="h-7 text-xs border-0 px-0 focus-visible:ring-0 bg-transparent"
              value={location}
              disabled={isSnapshotMode}
              onChange={e => setLocation(e.target.value)}
              onBlur={() => persistContractInfo({ location })}
              placeholder="Cidade / UF"
            />
          </FormField>
          <FormField label="Objeto" colSpan={8}>
            <Input
              className="h-7 text-xs border-0 px-0 focus-visible:ring-0 bg-transparent"
              value={contractObject}
              disabled={isSnapshotMode}
              onChange={e => setContractObject(e.target.value)}
              onBlur={() => persistContractInfo({ contractObject })}
              placeholder="Descrição resumida do escopo"
            />
          </FormField>
          <FormField label="Nº do Contrato" colSpan={3}>
            <Input
              className="h-7 text-xs border-0 px-0 focus-visible:ring-0 bg-transparent"
              value={contractNumber}
              disabled={isSnapshotMode}
              onChange={e => setContractNumber(e.target.value)}
              onBlur={() => persistContractInfo({ contractNumber })}
              placeholder="Ex.: 001/2025"
            />
          </FormField>
          <FormField label="Nº ART" colSpan={3}>
            <Input
              className="h-7 text-xs border-0 px-0 focus-visible:ring-0 bg-transparent"
              value={artNumber}
              disabled={isSnapshotMode}
              onChange={e => setArtNumber(e.target.value)}
              onBlur={() => persistContractInfo({ artNumber })}
              placeholder="Ex.: BR20240000000"
            />
          </FormField>
          <FormField label="Período da Medição" colSpan={4}>
            <p className="text-xs font-semibold text-foreground py-1 tabular-nums">
              {fmtDateBR(effStart)} a {fmtDateBR(effEnd)}
            </p>
          </FormField>
          <FormField label="Data de Emissão" colSpan={2}>
            <p className="text-xs font-semibold text-foreground py-1 tabular-nums">
              {fmtDateBR(effIssue)}
            </p>
          </FormField>
          <FormField label="Período da Medição" colSpan={4}>
            <p className="text-xs font-semibold text-foreground py-1 tabular-nums">
              {fmtDateBR(effStart)} a {fmtDateBR(effEnd)}
            </p>
          </FormField>
          <FormField label="Data de Emissão" colSpan={2}>
            <p className="text-xs font-semibold text-foreground py-1 tabular-nums">
              {fmtDateBR(effIssue)}
            </p>
          </FormField>
          <FormField label="Fonte de Orçamento" colSpan={4}>
            <Input
              className="h-7 text-xs border-0 px-0 focus-visible:ring-0 bg-transparent"
              value={budgetSource}
              disabled={isSnapshotMode}
              onChange={e => setBudgetSource(e.target.value)}
              onBlur={() => persistContractInfo({ budgetSource })}
              placeholder="Ex.: SINAPI 07/2024"
            />
          </FormField>
          <FormField label="BDI %" colSpan={2} last>
            <Input
              type="number"
              step="0.01"
              min="0"
              disabled={isSnapshotMode}
              className="h-7 text-xs border-0 px-0 focus-visible:ring-0 bg-transparent tabular-nums font-semibold"
              value={isSnapshotMode ? String(effBdi) : bdiInput}
              onChange={e => setBdiInput(e.target.value)}
              onBlur={() => persistContractInfo({ bdiPercent: bdiPercent })}
            />
          </FormField>
          <FormField label="Medição Nº" colSpan={3} bottom>
            <Input
              className="h-7 text-xs border-0 px-0 focus-visible:ring-0 bg-transparent tabular-nums font-semibold"
              value={effNumber}
              disabled={isSnapshotMode}
              onChange={e => setMeasurementNumber(e.target.value)}
              onBlur={() => persistContractInfo({ nextMeasurementNumber: Number(measurementNumber) || 1 })}
            />
          </FormField>
          <div className="col-span-9 border-t border-border" />
        </div>
      </CardContent>
    </Card>
  );
}

function FormField({
  label, colSpan, children, last, bottom,
}: {
  label: string; colSpan: number; children: React.ReactNode; last?: boolean; bottom?: boolean;
}) {
  return (
    <div
      className={`col-span-${colSpan} px-3 py-1.5 border-border ${last ? '' : 'border-r'} ${bottom ? '' : 'border-b'}`}
      style={{ gridColumn: `span ${colSpan} / span ${colSpan}` }}
    >
      <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}
