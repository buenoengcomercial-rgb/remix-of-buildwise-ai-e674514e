export type TeamCode = 'alpha' | 'bravo' | 'charlie' | 'delta' | 'echo' | 'foxtrot' | 'golf' | 'hotel';

export interface TeamDefinition {
  code: TeamCode;
  label: string;
  composition: string;
  bgColor: string;
  textColor: string;
  borderColor: string;
}

export const TEAM_DEFINITIONS: Record<TeamCode, TeamDefinition> = {
  alpha: {
    code: 'alpha',
    label: 'Alpha',
    composition: 'Ajudante',
    bgColor: 'hsl(220, 10%, 45%)',
    textColor: 'hsl(0, 0%, 100%)',
    borderColor: 'hsl(220, 10%, 35%)',
  },
  bravo: {
    code: 'bravo',
    label: 'Bravo',
    composition: 'Equipe Engenharia',
    bgColor: 'hsl(0, 0%, 95%)',
    textColor: 'hsl(0, 0%, 15%)',
    borderColor: 'hsl(0, 0%, 60%)',
  },
  charlie: {
    code: 'charlie',
    label: 'Charlie',
    composition: 'Eletricista + Ajudante',
    bgColor: 'hsl(150, 50%, 30%)',
    textColor: 'hsl(0, 0%, 100%)',
    borderColor: 'hsl(150, 50%, 22%)',
  },
  delta: {
    code: 'delta',
    label: 'Delta',
    composition: 'Auxiliar + Ajudante',
    bgColor: 'hsl(140, 55%, 55%)',
    textColor: 'hsl(0, 0%, 100%)',
    borderColor: 'hsl(140, 55%, 42%)',
  },
  echo: {
    code: 'echo',
    label: 'Echo',
    composition: 'Encanador + Ajudante',
    bgColor: 'hsl(0, 65%, 45%)',
    textColor: 'hsl(0, 0%, 100%)',
    borderColor: 'hsl(0, 65%, 35%)',
  },
  foxtrot: {
    code: 'foxtrot',
    label: 'Foxtrot',
    composition: 'Encanador + Ajudante',
    bgColor: 'hsl(30, 80%, 50%)',
    textColor: 'hsl(0, 0%, 100%)',
    borderColor: 'hsl(30, 80%, 38%)',
  },
  golf: {
    code: 'golf',
    label: 'Golf',
    composition: 'Equipe de Gesso',
    bgColor: 'hsl(270, 50%, 45%)',
    textColor: 'hsl(0, 0%, 100%)',
    borderColor: 'hsl(270, 50%, 35%)',
  },
  hotel: {
    code: 'hotel',
    label: 'Hotel',
    composition: 'Pedreiros',
    bgColor: 'hsl(210, 70%, 45%)',
    textColor: 'hsl(0, 0%, 100%)',
    borderColor: 'hsl(210, 70%, 35%)',
  },
};

export const TEAM_CODES = Object.keys(TEAM_DEFINITIONS) as TeamCode[];

export function getTeamDefinition(team?: TeamCode): TeamDefinition | undefined {
  if (!team) return undefined;
  return TEAM_DEFINITIONS[team];
}
