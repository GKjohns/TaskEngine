alter table tasks add column if not exists input_artifact_ids jsonb not null default '[]'::jsonb;
