create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

create table tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  prompt text not null,
  trigger_type text not null check (trigger_type in ('manual', 'scheduled', 'heartbeat')),
  schedule_config jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table plans (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks on delete cascade,
  plan_json jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now()
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks on delete cascade,
  inngest_function_id text,
  job_type text not null check (job_type in ('one_off', 'scheduled', 'heartbeat')),
  status text not null default 'idle'
    check (status in ('idle', 'scheduled', 'running', 'waiting_review', 'paused', 'completed', 'failed')),
  current_run_id uuid,
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_error text
);

create table runs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks on delete cascade,
  plan_id uuid not null references plans on delete cascade,
  job_id uuid references jobs on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'waiting_review', 'completed', 'failed', 'cancelled')),
  started_at timestamptz,
  completed_at timestamptz,
  error_message text
);

create table node_runs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs on delete cascade,
  node_key text not null,
  node_type text not null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'waiting_review', 'completed', 'failed', 'skipped')),
  input_refs jsonb not null default '[]'::jsonb,
  output_refs jsonb not null default '[]'::jsonb,
  logs jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz
);

create table artifacts (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('markdown', 'text', 'json', 'csv')),
  title text not null,
  content text,
  metadata_json jsonb not null default '{}'::jsonb,
  storage_path text,
  created_by_run_id uuid references runs on delete set null,
  created_by_node_id uuid references node_runs on delete set null,
  task_id uuid references tasks on delete set null,
  created_at timestamptz not null default now()
);

create table reviews (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs on delete cascade,
  node_run_id uuid not null references node_runs on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'edited')),
  reviewer_id uuid references auth.users on delete set null,
  comments text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table jobs add constraint fk_jobs_current_run
  foreign key (current_run_id) references runs(id) on delete set null;

create index idx_tasks_status on tasks(status);
create index idx_tasks_created_by on tasks(created_by);
create index idx_plans_task_id on plans(task_id);
create index idx_jobs_task_id on jobs(task_id);
create index idx_jobs_status on jobs(status);
create index idx_runs_task_id on runs(task_id);
create index idx_runs_status on runs(status);
create index idx_node_runs_run_id on node_runs(run_id);
create index idx_artifacts_task_id on artifacts(task_id);
create index idx_artifacts_created_by_run on artifacts(created_by_run_id);
create index idx_reviews_run_id on reviews(run_id);
create index idx_reviews_status on reviews(status);

create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger tasks_updated_at
  before update on tasks
  for each row execute function update_updated_at_column();
