import { supabase } from '@/integrations/supabase/client';
import { Project } from '@/types/project';
import { sampleProject } from '@/data/sampleProject';

export interface CloudProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export async function listCloudProjects(): Promise<CloudProjectMeta[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, created_at, updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(r => ({
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function loadCloudProject(id: string): Promise<Project | null> {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, data_json')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const proj = (data.data_json ?? {}) as unknown as Project;
  // Garantir id e name sincronizados com a linha
  return { ...proj, id: data.id, name: data.name };
}

export async function upsertCloudProject(project: Project, ownerId: string): Promise<void> {
  const { error } = await supabase
    .from('projects')
    .upsert([{
      id: project.id,
      owner_id: ownerId,
      name: project.name,
      data_json: project as unknown as import('@/integrations/supabase/types').Json,
    }], { onConflict: 'id' });
  if (error) throw error;
}

export async function createCloudProject(name: string, ownerId: string, base?: Partial<Project>): Promise<Project> {
  const today = new Date().toISOString().split('T')[0];
  const seed: Project = {
    id: crypto.randomUUID(),
    name,
    startDate: today,
    endDate: today,
    phases: [],
    totalBudget: 0,
    ...base,
  };
  const { data, error } = await supabase
    .from('projects')
    .insert([{
      owner_id: ownerId,
      name: seed.name,
      data_json: seed as unknown as import('@/integrations/supabase/types').Json,
    }])
    .select('id')
    .single();
  if (error) throw error;
  const finalProject: Project = { ...seed, id: data.id };
  // Re-grava com o id correto dentro do JSON
  await upsertCloudProject(finalProject, ownerId);
  return finalProject;
}

export async function renameCloudProject(id: string, newName: string): Promise<Project | null> {
  const proj = await loadCloudProject(id);
  if (!proj) return null;
  const updated = { ...proj, name: newName };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Não autenticado');
  await upsertCloudProject(updated, user.id);
  return updated;
}

export async function duplicateCloudProject(id: string, ownerId: string): Promise<Project | null> {
  const proj = await loadCloudProject(id);
  if (!proj) return null;
  const newId = crypto.randomUUID();
  const copy: Project = { ...JSON.parse(JSON.stringify(proj)), id: newId, name: `${proj.name} (cópia)` };
  await supabase.from('projects').insert([{
    id: newId,
    owner_id: ownerId,
    name: copy.name,
    data_json: copy as unknown as import('@/integrations/supabase/types').Json,
  }]);
  return copy;
}

export async function deleteCloudProject(id: string): Promise<void> {
  const { error } = await supabase.from('projects').delete().eq('id', id);
  if (error) throw error;
}

export async function generateUniqueCloudName(base = 'Nova obra'): Promise<string> {
  const all = await listCloudProjects();
  const names = new Set(all.map(p => p.name));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

export function getSampleSeed(): Partial<Project> {
  const { id: _id, name: _name, ...rest } = sampleProject;
  return rest;
}
