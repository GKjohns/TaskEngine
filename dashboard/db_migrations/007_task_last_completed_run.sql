alter table tasks add column if not exists last_completed_run_at timestamptz;
