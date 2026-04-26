-- ENUMS
CREATE TYPE public.org_role AS ENUM ('owner', 'admin', 'engineer', 'field_user', 'viewer');
CREATE TYPE public.member_status AS ENUM ('active', 'invited', 'blocked');

-- ORGANIZATIONS
CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  cnpj TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER organizations_set_updated_at
BEFORE UPDATE ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ORGANIZATION MEMBERS
CREATE TABLE public.organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role public.org_role NOT NULL DEFAULT 'viewer',
  status public.member_status NOT NULL DEFAULT 'invited',
  invited_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_org_members_user ON public.organization_members(user_id);
CREATE INDEX idx_org_members_org ON public.organization_members(organization_id);
CREATE TRIGGER org_members_set_updated_at
BEFORE UPDATE ON public.organization_members
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- HELPERS
CREATE OR REPLACE FUNCTION public.is_org_member(_user_id UUID, _org_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.organization_members
    WHERE user_id = _user_id AND organization_id = _org_id AND status = 'active');
$$;

CREATE OR REPLACE FUNCTION public.has_org_role(_user_id UUID, _org_id UUID, _roles public.org_role[])
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.organization_members
    WHERE user_id = _user_id AND organization_id = _org_id
      AND status = 'active' AND role = ANY(_roles));
$$;

CREATE OR REPLACE FUNCTION public.get_user_org_id(_user_id UUID)
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT organization_id FROM public.organization_members
  WHERE user_id = _user_id AND status = 'active'
  ORDER BY created_at ASC LIMIT 1;
$$;

-- RLS organizations
CREATE POLICY "org_select_member" ON public.organizations FOR SELECT TO authenticated
USING (public.is_org_member(auth.uid(), id));
CREATE POLICY "org_update_admin" ON public.organizations FOR UPDATE TO authenticated
USING (public.has_org_role(auth.uid(), id, ARRAY['owner','admin']::public.org_role[]));

-- RLS members
CREATE POLICY "members_select" ON public.organization_members FOR SELECT TO authenticated
USING (user_id = auth.uid()
  OR public.has_org_role(auth.uid(), organization_id, ARRAY['owner','admin']::public.org_role[]));
CREATE POLICY "members_insert_admin" ON public.organization_members FOR INSERT TO authenticated
WITH CHECK (public.has_org_role(auth.uid(), organization_id, ARRAY['owner','admin']::public.org_role[]));
CREATE POLICY "members_update_admin" ON public.organization_members FOR UPDATE TO authenticated
USING (public.has_org_role(auth.uid(), organization_id, ARRAY['owner','admin']::public.org_role[]));
CREATE POLICY "members_delete_admin" ON public.organization_members FOR DELETE TO authenticated
USING (public.has_org_role(auth.uid(), organization_id, ARRAY['owner','admin']::public.org_role[]));

-- SEED organização padrão
INSERT INTO public.organizations (id, name, cnpj)
VALUES ('00000000-0000-0000-0000-000000000001', 'K. C. BUENO DE GODOY OLIVEIRA LTDA', '39.973.085/0001-20')
ON CONFLICT (id) DO NOTHING;

-- DROP policies antigas que referenciam projects.owner_id ANTES da migração
DROP POLICY IF EXISTS history_select_owner ON public.project_history;
DROP POLICY IF EXISTS history_insert_owner ON public.project_history;
DROP POLICY IF EXISTS projects_select_own ON public.projects;
DROP POLICY IF EXISTS projects_insert_own ON public.projects;
DROP POLICY IF EXISTS projects_update_own ON public.projects;
DROP POLICY IF EXISTS projects_delete_own ON public.projects;

-- PROJECTS: adicionar organization_id
ALTER TABLE public.projects ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;

-- Donos atuais viram owner da org padrão
INSERT INTO public.organization_members (organization_id, user_id, role, status)
SELECT DISTINCT '00000000-0000-0000-0000-000000000001'::uuid, owner_id,
  'owner'::public.org_role, 'active'::public.member_status
FROM public.projects WHERE owner_id IS NOT NULL
ON CONFLICT (organization_id, user_id) DO UPDATE SET role = 'owner', status = 'active';

-- Associa obras à org padrão
UPDATE public.projects SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
ALTER TABLE public.projects ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.projects DROP COLUMN owner_id;
CREATE INDEX idx_projects_org ON public.projects(organization_id);

-- RLS projects
CREATE POLICY "projects_select_member" ON public.projects FOR SELECT TO authenticated
USING (public.is_org_member(auth.uid(), organization_id));
CREATE POLICY "projects_insert_editor" ON public.projects FOR INSERT TO authenticated
WITH CHECK (public.has_org_role(auth.uid(), organization_id, ARRAY['owner','admin']::public.org_role[]));
CREATE POLICY "projects_update_editor" ON public.projects FOR UPDATE TO authenticated
USING (public.has_org_role(auth.uid(), organization_id, ARRAY['owner','admin','engineer']::public.org_role[]));
CREATE POLICY "projects_delete_owner" ON public.projects FOR DELETE TO authenticated
USING (public.has_org_role(auth.uid(), organization_id, ARRAY['owner','admin']::public.org_role[]));

-- RLS project_history
CREATE POLICY "history_select_member" ON public.project_history FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.projects p
  WHERE p.id = project_history.project_id
    AND public.is_org_member(auth.uid(), p.organization_id)));
CREATE POLICY "history_insert_member" ON public.project_history FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.projects p
  WHERE p.id = project_history.project_id
    AND public.is_org_member(auth.uid(), p.organization_id)));