insert into storage.buckets (id, name, public)
values ('artifacts', 'artifacts', false)
on conflict (id) do nothing;

create policy "Users upload artifacts" on storage.objects
  for insert
  with check (bucket_id = 'artifacts' and auth.uid() is not null);

create policy "Users read own artifacts" on storage.objects
  for select
  using (bucket_id = 'artifacts' and auth.uid() is not null);
