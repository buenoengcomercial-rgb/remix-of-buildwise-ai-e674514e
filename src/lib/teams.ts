export type TeamCode = 'alpha' | 'bravo' | 'charlie' | 'delta' | 'echo' | 'foxtrot' | 'golf' | 'hotel';

export interface TeamDefinition {
  code: TeamCode;
  label: string;
  composition: string;
  /** Cor clara (≈94% L) para o fundo da linha na sidebar/EAP */
  bgColor: string;
  /** Cor escura (≈18-22% L) para texto sobre o fundo claro */
  textColor: string;
  /** Cor média/saturada para borda da barra e marcadores */
  borderColor: string;
  /** Cor média/saturada para a barra do Gantt */
  barColor: string;
}

export const TEAM_DEFINITIONS: Record<TeamCode, TeamDefinition> = {
  alpha: {
    code: 'alpha',
    label: 'Alpha',
    composition: 'Ajudante',
    bgColor: 'hsl(270, 50%, 94%)',
    textColor: 'hsl(270, 50%, 22%)',
    borderColor: 'hsl(270, 50%, 50%)',
    barColor: 'hsl(270, 50%, 50%)',
  },
  bravo: {
    code: 'bravo',
    label: 'Bravo',
    composition: 'Equipe Engenharia',
    bgColor: 'hsl(0, 0%, 95%)',
    textColor: 'hsl(0, 0%, 18%)',
    borderColor: 'hsl(0, 0%, 55%)',
    barColor: 'hsl(0, 0%, 45%)',
  },
  charlie: {
    code: 'charlie',
    label: 'Charlie',
    composition: 'Eletricista + Ajudante',
    bgColor: 'hsl(210, 65%, 94%)',
    textColor: 'hsl(210, 65%, 20%)',
    borderColor: 'hsl(210, 65%, 45%)',
    barColor: 'hsl(210, 65%, 45%)',
  },
  delta: {
    code: 'delta',
    label: 'Delta',
    composition: 'Auxiliar + Ajudante',
    bgColor: 'hsl(152, 60%, 94%)',
    textColor: 'hsl(152, 60%, 18%)',
    borderColor: 'hsl(152, 60%, 42%)',
    barColor: 'hsl(152, 60%, 42%)',
  },
  echo: {
    code: 'echo',
    label: 'Echo',
    composition: 'Encanador + Ajudante',
    bgColor: 'hsl(0, 65%, 94%)',
    textColor: 'hsl(0, 65%, 22%)',
    borderColor: 'hsl(0, 65%, 45%)',
    barColor: 'hsl(0, 65%, 45%)',
  },
  foxtrot: {
    code: 'foxtrot',
    label: 'Foxtrot',
    composition: 'Encanador + Ajudante',
    bgColor: 'hsl(30, 80%, 93%)',
    textColor: 'hsl(30, 80%, 22%)',
    borderColor: 'hsl(30, 80%, 45%)',
    barColor: 'hsl(30, 80%, 48%)',
  },
  golf: {
    code: 'golf',
    label: 'Golf',
    composition: 'Equipe de Gesso',
    bgColor: 'hsl(290, 50%, 94%)',
    textColor: 'hsl(290, 50%, 22%)',
    borderColor: 'hsl(290, 50%, 45%)',
    barColor: 'hsl(290, 50%, 45%)',
  },
  hotel: {
    code: 'hotel',
    label: 'Hotel',
    composition: 'Pedreiros',
    bgColor: 'hsl(210, 70%, 94%)',
    textColor: 'hsl(210, 70%, 20%)',
    borderColor: 'hsl(210, 70%, 40%)',
    barColor: 'hsl(210, 70%, 45%)',
  },
};

export const TEAM_CODES = Object.keys(TEAM_DEFINITIONS) as TeamCode[];

export function getTeamDefinition(team?: TeamCode): TeamDefinition | undefined {
  if (!team) return undefined;
  return TEAM_DEFINITIONS[team];
}
