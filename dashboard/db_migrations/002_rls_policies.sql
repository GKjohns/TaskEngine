alter table tasks enable row level security;
alter table plans enable row level security;
alter table jobs enable row level security;
alter table runs enable row level security;
alter table node_runs enable row level security;
alter table artifacts enable row level security;
alter table reviews enable row level security;

create policy "Users manage own tasks" on tasks
  for all using (created_by = auth.uid())
  with check (created_by = auth.uid());

create policy "Users access own plans" on plans
  for all using (task_id in (select id from tasks where created_by = auth.uid()))
  with check (task_id in (select id from tasks where created_by = auth.uid()));

create policy "Users access own jobs" on jobs
  for all using (task_id in (select id from tasks where created_by = auth.uid()))
  with check (task_id in (select id from tasks where created_by = auth.uid()));

create policy "Users access own runs" on runs
  for all using (task_id in (select id from tasks where created_by = auth.uid()))
  with check (task_id in (select id from tasks where created_by = auth.uid()));

create policy "Users access own node runs" on node_runs
  for all using (
    run_id in (
      select r.id
      from runs r
      join tasks t on r.task_id = t.id
      where t.created_by = auth.uid()
    )
  )
  with check (
    run_id in (
      select r.id
      from runs r
      join tasks t on r.task_id = t.id
      where t.created_by = auth.uid()
    )
  );

create policy "Users access own artifacts" on artifacts
  for all using (
    task_id in (select id from tasks where created_by = auth.uid())
    or task_id is null
  )
  with check (
    task_id in (select id from tasks where created_by = auth.uid())
    or task_id is null
  );

create policy "Users access own reviews" on reviews
  for all using (
    run_id in (
      select r.id
      from runs r
      join tasks t on r.task_id = t.id
      where t.created_by = auth.uid()
    )
  )
  with check (
    run_id in (
      select r.id
      from runs r
      join tasks t on r.task_id = t.id
      where t.created_by = auth.uid()
    )
  );
