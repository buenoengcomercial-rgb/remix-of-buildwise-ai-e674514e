import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Settings } from 'lucide-react';
import { ESTADOS_BRASIL, getMunicipios, CAPITAIS } from '@/lib/feriados';

export interface ObraConfig {
  uf: string;
  municipio: string;
  jornadaDiaria: number;
  trabalhaSabado: boolean;
}

const STORAGE_KEY = 'obra-config';

export function loadObraConfig(): ObraConfig {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return { uf: 'SP', municipio: 'São Paulo', jornadaDiaria: 8, trabalhaSabado: false };
}

function saveObraConfig(config: ObraConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

interface Props {
  config: ObraConfig;
  onConfigChange: (config: ObraConfig) => void;
}

export default function ConfiguracaoObra({ config, onConfigChange }: Props) {
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState<ObraConfig>(config);
  const [municipios, setMunicipios] = useState<string[]>([]);
  const [municipioSearch, setMunicipioSearch] = useState('');

  useEffect(() => {
    setLocal(config);
  }, [config]);

  useEffect(() => {
    setMunicipios(getMunicipios(local.uf));
  }, [local.uf]);

  const handleSave = () => {
    saveObraConfig(local);
    onConfigChange(local);
    setOpen(false);
  };

  const handleUfChange = (uf: string) => {
    const capital = CAPITAIS[uf] || '';
    setLocal(prev => ({ ...prev, uf, municipio: capital }));
  };

  const filteredMunicipios = municipios.filter(m =>
    m.toLowerCase().includes(municipioSearch.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium rounded-md border border-border bg-card text-muted-foreground hover:text-foreground transition-colors">
          <Settings className="w-3 h-3" />
          Configurações
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Configuração da Obra</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label className="text-xs font-medium">Estado</Label>
            <Select value={local.uf} onValueChange={handleUfChange}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ESTADOS_BRASIL.map(e => (
                  <SelectItem key={e.uf} value={e.uf} className="text-sm">{e.uf} — {e.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-medium">Município</Label>
            <Input
              value={local.municipio}
              onChange={e => setLocal(prev => ({ ...prev, municipio: e.target.value }))}
              placeholder="Digite o nome do município"
              className="h-9 text-sm"
            />
            {filteredMunicipios.length > 0 && local.municipio && (
              <div className="flex flex-wrap gap-1">
                {filteredMunicipios.slice(0, 5).map(m => (
                  <button
                    key={m}
                    onClick={() => setLocal(prev => ({ ...prev, municipio: m }))}
                    className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                      local.municipio === m
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-secondary text-secondary-foreground border-border hover:bg-accent'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-medium">Jornada diária (horas)</Label>
            <Input
              type="number"
              value={local.jornadaDiaria}
              onChange={e => setLocal(prev => ({ ...prev, jornadaDiaria: Number(e.target.value) || 8 }))}
              min={1}
              max={12}
              className="h-9 text-sm w-24"
            />
          </div>

          <div className="flex items-center gap-3">
            <Switch
              checked={local.trabalhaSabado}
              onCheckedChange={v => setLocal(prev => ({ ...prev, trabalhaSabado: v }))}
            />
            <Label className="text-xs font-medium">Trabalha sábado? (meio período — 4h)</Label>
          </div>

          <Button onClick={handleSave} className="w-full">Salvar Configurações</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
