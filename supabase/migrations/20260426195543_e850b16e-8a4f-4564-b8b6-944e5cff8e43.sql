-- Bucket público para fotos do Diário de Obra
insert into storage.buckets (id, name, public)
values ('daily-report-photos', 'daily-report-photos', true)
on conflict (id) do nothing;

-- Leitura pública (bucket público — qualquer pessoa lê)
create policy "Public read daily-report-photos"
  on storage.objects for select
  using (bucket_id = 'daily-report-photos');

-- Upload por usuário autenticado
create policy "Authenticated upload daily-report-photos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'daily-report-photos');

-- Atualização por usuário autenticado (para metadados)
create policy "Authenticated update daily-report-photos"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'daily-report-photos');

-- Remoção por usuário autenticado
create policy "Authenticated delete daily-report-photos"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'daily-report-photos');