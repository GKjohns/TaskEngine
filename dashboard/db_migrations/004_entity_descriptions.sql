-- Add LLM-generated natural language descriptions to core entities.
-- These are short, human-readable summaries produced during execution
-- so the UI can display meaningful context instead of raw IDs and metadata.

alter table runs add column description text;
alter table node_runs add column description text;
alter table artifacts add column description text;
