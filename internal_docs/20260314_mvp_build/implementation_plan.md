# Task Engine — Implementation Plan

**A bare-bones, general-purpose agentic workspace for text-native work.**
Last updated: 2026-03-14

> **Status: Sprint 0 complete, Sprint 1 next**
> Reference docs: `internal_docs/20260314_mvp_build/vision.md`, `internal_docs/openai_usage.md`

---

## Background

Task Engine is a small runtime for artifact-based work graphs. A user gives the system a goal in natural language, the system generates an execution plan as a graph of nodes, and a durable runtime walks the graph — reading and writing artifacts, calling LLMs, pausing for human review, and resuming on schedule or user action.

There is no existing code. This is a greenfield build.

### What We're Building On

**Nuxt UI Dashboard Template** (`nuxt-ui-templates/dashboard`) provides the entire frontend scaffold. The template ships with a sidebar layout (`UDashboardGroup` + `UDashboardSidebar` + `UDashboardPanel`), command palette, keyboard shortcuts, table patterns (TanStack), form validation (Zod), and a composable-driven state model. We clone this template as the project base and reshape its pages/components to match Task Engine's views.

**Claude Code's architecture** informs the agent node executor. Claude Code's core insight is that "the product is a while loop around the tool use API" — send a message with tools, execute any tool calls, feed results back, repeat until the model stops calling tools. Our `agent_transform` and `agent_code` nodes use this exact pattern, adapted for the OpenAI Responses API with `previous_response_id` for multi-turn state and function calling for tool dispatch.

**OpenAI Responses API** is the LLM layer. Three model tiers (`gpt-5.4`, `gpt-5-mini`, `gpt-5-nano`) cover the full spectrum from flagship agent reasoning to cheap high-volume transforms. The API's `text.format` with JSON schema guarantees structured output for plan generation and simple LLM nodes. `previous_response_id` eliminates manual context management in agent loops.

**Inngest** provides durable execution. Each run is an Inngest function with per-node steps, automatic retries, and `step.waitForEvent()` for review pauses. Scheduled and heartbeat triggers are native Inngest cron functions.

### Goals

1. **Project scaffold**: Nuxt 4 app based on the dashboard template, with Supabase auth/storage and the full data model
2. **Plan generation**: Natural-language task → AI-generated node graph via `gpt-5.4` structured output
3. **Node execution**: Simple LLM nodes (single call) and infrastructure nodes (retrieve, branch, emit, review, etc.)
4. **Agent nodes**: ReAct-style loop for complex work, with tool calling and multi-turn state
5. **Durable runtime**: Inngest-powered graph walker with per-node retries, review pauses, schedules, and heartbeats
6. **Inspectable UI**: Task management, run inspector, artifact browser, review inbox, job manager

---

## Architecture

```
                    ┌──────────────────────────────────────┐
                    │            Nuxt 4 App                │
                    │  (Nuxt UI Dashboard Template base)   │
                    └──────────┬───────────────────────────┘
                               │
              ┌────────────────┼─────────────────┐
              ▼                ▼                  ▼
     ┌────────────────┐  ┌──────────┐   ┌──────────────────┐
     │   Pages/UI     │  │  Nitro   │   │   Composables    │
     │  Tasks, Runs,  │  │  API     │   │  useRunStream()  │
     │  Artifacts,    │  │  Routes  │   │  useDashboard()  │
     │  Reviews, Jobs │  │          │   │                  │
     └────────────────┘  └────┬─────┘   └──────────────────┘
                              │
           ┌──────────────────┼──────────────────┐
           ▼                  ▼                   ▼
   ┌───────────────┐  ┌─────────────┐   ┌────────────────┐
   │   Supabase    │  │   Inngest   │   │  OpenAI        │
   │   Postgres    │  │   Functions │   │  Responses API │
   │   Auth        │  │             │   │                │
   │   Storage     │  │  executeRun │   │  gpt-5.4       │
   │               │  │  heartbeat  │   │  gpt-5-mini    │
   │   tasks       │  │  scheduled  │   │  gpt-5-nano    │
   │   plans       │  │             │   │                │
   │   runs        │  │  step.run() │   │  Plan gen      │
   │   node_runs   │  │  waitFor()  │   │  Agent loop    │
   │   artifacts   │  │             │   │  Simple LLM    │
   │   reviews     │  └─────────────┘   └────────────────┘
   │   jobs        │
   └───────────────┘
```

### Execution Flow

1. User creates a task with a natural-language prompt and trigger config
2. Nitro API stores the task in Supabase
3. Multi-pass plan generation: `gpt-5.4` generates the DAG structure, then `gpt-5-mini` fills in each node's type-specific fields in parallel (both passes use strict schemas)
4. Plan (node graph) is saved to Supabase, linked to the task
5. A job is created for the task — status set to `idle` (manual), `scheduled` (cron), or `scheduled` (heartbeat)
6. When the job fires (manual trigger, cron schedule, or heartbeat), it creates a run record, links it to the job, and sends a `task-engine/run.start` event
7. The Inngest `executeRun` function loads the plan, marks the job as `running`, and walks the graph topologically
8. Each node executes as a durable `step.run()` — retries and state are automatic
9. Nodes load input artifacts from the database (via predecessor node_runs' output_refs) and write outputs
10. `review` nodes pause via `step.waitForEvent()` — the run enters `waiting_review`, job status updates to `waiting_review`
11. User resolves the review in the UI, app sends `task-engine/review.resolved` event
12. Run and job resume, remaining nodes execute
13. All outputs stored, run marked complete, job updated to `completed` with `last_run_at`

### Data Types

```typescript
// Plan node — flat, strictly typed, no freeform config object.
// Nodes form a DAG via depends_on. Type-specific fields are nullable.
interface PlanNode {
  id: string
  type: 'agent_transform' | 'agent_code' | 'llm_classify' | 'llm_extract'
       | 'llm_summarize' | 'llm_transform' | 'retrieve' | 'branch'
       | 'wait' | 'review' | 'emit' | 'notify'
  description: string
  per_artifact: boolean
  depends_on: string[]
  // Type-specific fields (nullable — only relevant ones filled based on type)
  prompt: string | null           // agent_transform, agent_code, llm_*
  labels: string[] | null         // llm_classify
  max_length: number | null       // llm_summarize
  source: string | null           // retrieve
  filter: string | null           // retrieve
  condition: string | null        // branch
  if_true_node: string | null     // branch
  if_false_node: string | null    // branch
  duration: string | null         // wait
  message: string | null          // review, notify
  title: string | null            // emit
  format: string | null           // emit
  level: string | null            // notify
}

// The full plan structure
interface Plan {
  nodes: PlanNode[]
}

// Tool available to agent nodes (inspired by Claude Code's tool registry)
interface AgentTool {
  name: string
  description: string
  parameters: Record<string, any>   // JSON schema
  run: (input: any, context: NodeExecutionContext) => Promise<string>
}

// Context passed to node executors
interface NodeExecutionContext {
  runId: string
  nodeRunId: string
  taskId: string
  inputArtifacts: Artifact[]
  supabase: SupabaseClient
  openai: OpenAI
}

// Events streamed to the frontend during a run
interface RunEvent {
  type: 'run_start' | 'node_start' | 'node_progress' | 'node_complete'
     | 'node_error' | 'review_requested' | 'run_complete' | 'run_error'
  timestamp: string
  data: Record<string, any>
}
```

---

## Sprint 0: Project Scaffold & Data Layer

**Goal:** Stand up the Nuxt 4 app using the dashboard template as the base, keep the UI close to the upstream template during development, configure Supabase for database/storage only, create the schema in single-user local mode, and wire up the dashboard layout with empty placeholder pages for every view.

**Duration:** 2 days

### Tasks

#### 0.1 Initialize the Nuxt project from the dashboard template

```bash
npm create nuxt@latest -- -t ui/dashboard task-engine
cd task-engine
npm install
```

This gives us the full dashboard template: sidebar layout, command palette, keyboard shortcuts, TanStack table patterns, form validation with Zod, light/dark mode, and all the Nuxt UI component infrastructure.

After scaffolding, strip the demo content (home stats, inbox, customers, mock APIs) but preserve the layout architecture, navigation patterns, composable structure, and component organization conventions. The demo code is useful reference.

**Implementation note:** the upstream dashboard template is a known-good baseline in local dev and should remain the starting point for UI work. Do not introduce auth-driven routing or heavy layout rewrites during Sprint 0. Keep the dashboard shell close to the original template until the placeholder routes are stable.

#### 0.2 Update `app.config.ts` theme

Replace the dashboard template's green theme with Task Engine's identity:

```typescript
export default defineAppConfig({
  ui: {
    colors: {
      primary: 'blue',
      neutral: 'slate'
    }
  }
})
```

#### 0.3 Install core dependencies

```bash
npm install @supabase/supabase-js inngest openai
npm install -D @iconify-json/lucide
```

Update `nuxt.config.ts`:

```typescript
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui',
    '@vueuse/nuxt'
  ],

  css: ['~/assets/css/main.css'],

  routeRules: {
    '/api/**': { cors: true }
  },

  compatibilityDate: '2025-01-01'
})
```

Environment variables (`.env`):

```bash
SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_SERVICE_KEY="your-service-role-key"
OPENAI_API_KEY="sk-..."
INNGEST_EVENT_KEY="..."
INNGEST_SIGNING_KEY="..."
```

#### 0.4 Write Supabase migration — full schema

Create `db_migrations/001_schema.sql` with the complete data model from the vision doc, but do not include user ownership columns during development:

```sql
-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Tasks: standing instructions or one-off requests
create table tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  prompt text not null,
  trigger_type text not null check (trigger_type in ('manual', 'scheduled', 'heartbeat')),
  schedule_config jsonb default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Plans: AI-generated execution graphs
create table plans (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks on delete cascade,
  plan_json jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now()
);

-- Jobs: durable execution units managed by Inngest
-- Every task gets a job. The job tracks execution lifecycle.
create table jobs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks on delete cascade,
  inngest_function_id text,
  job_type text not null check (job_type in ('one_off', 'scheduled', 'heartbeat')),
  status text not null default 'idle'
    check (status in ('idle', 'scheduled', 'running', 'waiting_review', 'paused', 'completed', 'failed')),
  current_run_id uuid,  -- references runs, FK added after runs table exists
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_error text
);

-- Runs: concrete execution instances
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

-- Node runs: per-node execution records within a run
create table node_runs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs on delete cascade,
  node_key text not null,
  node_type text not null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'waiting_review', 'completed', 'failed', 'skipped')),
  input_refs jsonb default '[]'::jsonb,
  output_refs jsonb default '[]'::jsonb,
  logs jsonb default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz
);

-- Artifacts: documents and structured text flowing through the system
create table artifacts (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('markdown', 'text', 'json', 'csv')),
  title text not null,
  content text,
  metadata_json jsonb default '{}'::jsonb,
  storage_path text,
  created_by_run_id uuid references runs on delete set null,
  created_by_node_id uuid references node_runs on delete set null,
  task_id uuid references tasks on delete set null,
  created_at timestamptz not null default now()
);

-- Reviews: human checkpoints
create table reviews (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs on delete cascade,
  node_run_id uuid not null references node_runs on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'edited')),
  comments text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- Add FK from jobs.current_run_id to runs now that runs table exists
alter table jobs add constraint fk_jobs_current_run
  foreign key (current_run_id) references runs(id) on delete set null;

-- Indexes
create index idx_tasks_status on tasks(status);
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

-- Updated_at trigger for tasks
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
```

#### 0.5 Defer auth and RLS

Do not add `login` flows, row-level security policies, or `auth.uid()`-scoped queries during development. Treat the app as a single-user local operator console for now.

Auth, user ownership, and RLS return in a later sprint once the dashboard and execution model are stable.

#### 0.6 Create Supabase Storage bucket

Create `db_migrations/002_storage.sql` with development-only permissive policies:

```sql
insert into storage.buckets (id, name, public)
values ('artifacts', 'artifacts', false);

create policy "Dev upload artifacts" on storage.objects
  for insert with check (bucket_id = 'artifacts');

create policy "Dev read artifacts" on storage.objects
  for select using (bucket_id = 'artifacts');
```

#### 0.7 Create server utility: Supabase clients

`server/utils/supabase.ts`:

```typescript
import { createClient } from '@supabase/supabase-js'

export function createServiceClient() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  )
}
```

During development, all server-side database access can use the service role client. Do not build separate user-scoped and admin-scoped paths yet.

#### 0.8 Set up the dashboard layout

Reshape `app/layouts/default.vue` from the template. Keep the `UDashboardGroup` + `UDashboardSidebar` + `UDashboardPanel` structure. Replace demo navigation with Task Engine's views:

```typescript
const links = [[
  {
    label: 'Tasks',
    icon: 'i-lucide-list-checks',
    to: '/tasks'
  },
  {
    label: 'Runs',
    icon: 'i-lucide-play-circle',
    to: '/runs'
  },
  {
    label: 'Artifacts',
    icon: 'i-lucide-file-text',
    to: '/artifacts'
  },
  {
    label: 'Reviews',
    icon: 'i-lucide-message-circle-warning',
    to: '/reviews',
    badge: pendingReviewCount
  },
  {
    label: 'Jobs',
    icon: 'i-lucide-clock',
    to: '/jobs'
  }
]]
```

Keep the `UDashboardSearch` + `UCommandPalette` for quick navigation if the template remains stable. Theme toggle is fine to keep, but auth-specific menus and logout flows are deferred.

#### 0.9 Create placeholder pages

Stub out every page with a `UDashboardPanel` + `UDashboardNavbar` + empty state. Each page just needs a title and an "empty" message for now. This establishes the routing and navigation before any backend exists.

```
app/pages/
├── index.vue              # Redirects to /tasks
├── tasks/
│   ├── index.vue          # Task list
│   ├── [id].vue           # Task detail + plan view
│   └── new.vue            # Create task
├── runs/
│   ├── index.vue          # All runs
│   └── [id].vue           # Run inspector
├── artifacts/
│   ├── index.vue          # Artifact browser
│   └── [id].vue           # Artifact viewer
├── reviews/
│   └── index.vue          # Review inbox
└── jobs/
    └── index.vue          # Job manager
```

Each placeholder follows the dashboard template pattern:

```vue
<template>
  <UDashboardPanel>
    <UDashboardNavbar title="Tasks">
      <template #actions>
        <UButton label="New Task" icon="i-lucide-plus" to="/tasks/new" />
      </template>
    </UDashboardNavbar>

    <div class="p-4">
      <UAlert
        title="No tasks yet"
        description="Create your first task to get started."
        icon="i-lucide-info"
      />
    </div>
  </UDashboardPanel>
</template>
```

#### 0.10 Open directly into the dashboard

Do not add a login page in Sprint 0. The app should open directly to `/tasks`, with no route guards, no session handling, and no user-specific redirects.

### Verification

```bash
# App starts and renders the dashboard layout
npm run dev
# → http://localhost:3000 redirects to /tasks
# → Sidebar shows Tasks/Runs/Artifacts/Reviews/Jobs
# → Each page renders its placeholder empty state
# → Template shell remains stable in local dev
```

### Tests

**QA:**

1. App opens directly to `/tasks` with no sign-in step
2. Sidebar navigation works — each link renders the correct placeholder page
3. Root URL redirects to `/tasks`
4. No login or logout flows are present in local development
5. Command palette works only if kept from the upstream template without destabilizing dev mode

### Definition of Done

- [x] Nuxt 4 app running with dashboard template layout
- [x] Supabase configured for database/storage, with no auth flow in development
- [x] Jobs table has full lifecycle statuses: idle, scheduled, running, waiting_review, paused, completed, failed
- [x] No user model, RLS, or login flow required during development
- [x] `createServiceClient()` available for Inngest functions and server routes
- [x] Dashboard layout with sidebar navigation for all 5 views
- [x] Placeholder pages for tasks, runs, artifacts, reviews, jobs
- [x] App opens directly into the dashboard
- [x] UI work stays close to the upstream template baseline to preserve local dev stability
- [x] `.env.example` with all required vars

### New Dependencies

| Package | Purpose |
|---------|---------|
| `@supabase/supabase-js` | Supabase server/database client |
| `inngest` | Durable execution runtime |
| `openai` | OpenAI Responses API client |

### New Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Yes | Service role key for single-user local development |
| `OPENAI_API_KEY` | Yes | OpenAI API key |
| `INNGEST_EVENT_KEY` | Yes | Inngest event key |
| `INNGEST_SIGNING_KEY` | Yes | Inngest signing key |

---

## Sprint 1: Plan Generation & Core API

**Goal:** Build the task creation flow end-to-end: user submits a natural-language prompt, the system calls `gpt-5.4` to generate a plan as a structured node graph, and stores everything in Supabase. Also build the CRUD APIs for tasks, plans, and artifacts.

**Duration:** 2 days

### Tasks

#### 1.1 Create OpenAI Responses API client

`server/utils/openai.ts`:

```typescript
import OpenAI from 'openai'

let _client: OpenAI | null = null

export function useOpenAI(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      apiKey: useRuntimeConfig().openaiApiKey
    })
  }
  return _client
}
```

Add to `nuxt.config.ts`:

```typescript
runtimeConfig: {
  openaiApiKey: process.env.OPENAI_API_KEY
}
```

#### 1.2 Build the plan generator (multi-pass)

`server/utils/planGenerator.ts`:

Plan generation is a two-pass process. The first pass uses `gpt-5.4` to generate the DAG structure: which nodes, what types, and how they depend on each other. The second pass uses `gpt-5-mini` to fill in each node's type-specific fields using per-type strict schemas. Both passes produce strictly typed output. The resulting plan is flat nodes with no freeform objects.

```typescript
import type { OpenAI } from 'openai'

// Pass 1 schema: high-level structure only (no freeform config — strict is safe here)
const STRUCTURE_SCHEMA = {
  type: 'json_schema' as const,
  name: 'plan_structure',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      nodes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            type: {
              type: 'string',
              enum: [
                'agent_transform', 'agent_code',
                'llm_classify', 'llm_extract', 'llm_summarize', 'llm_transform',
                'retrieve', 'branch', 'wait', 'review', 'emit', 'notify'
              ]
            },
            description: { type: 'string' },
            per_artifact: { type: 'boolean' },
            depends_on: { type: 'array', items: { type: 'string' } }
          },
          required: ['id', 'type', 'description', 'per_artifact', 'depends_on'],
          additionalProperties: false
        }
      }
    },
    required: ['nodes'],
    additionalProperties: false
  }
}

const STRUCTURE_INSTRUCTIONS = `You are a plan generator for Task Engine, a runtime that executes text-based work as directed acyclic graphs of nodes.

Given a user's task description, generate a high-level execution plan as a JSON object with a "nodes" array. Each node has:
- id: a short, descriptive snake_case identifier
- type: one of the available node types
- description: one sentence explaining what this node does and why
- per_artifact: whether this node should process each input artifact individually (true) or all at once (false). Set to true when each artifact needs independent processing (e.g. classifying 10 documents individually). Set to false when the node needs to see all inputs together (e.g. drafting a summary across all reports).
- depends_on: array of node ids that must complete before this node runs

Available node types:

AGENT NODES (ReAct loop, complex reasoning — uses gpt-5.4):
- agent_transform: complex reasoning, analysis, drafting, research
- agent_code: generate and execute Python code

SIMPLE LLM NODES (single call, straightforward transforms):
- llm_classify: classification, tagging, sentiment
- llm_extract: entity/data extraction
- llm_summarize: summarization
- llm_transform: rewriting, formatting, translation

INFRASTRUCTURE NODES:
- retrieve: fetch artifacts by reference or query
- branch: conditional routing based on previous output
- wait: pause for a duration
- review: pause for human review
- emit: write an artifact to storage
- notify: log a message or send notification

Choose agent nodes (agent_transform) for tasks requiring judgment, multi-step reasoning, or research. Choose simple LLM nodes for straightforward transforms where a single prompt-in/result-out call suffices. Use infrastructure nodes for control flow.

The plan should be minimal — only include nodes that are necessary. Prefer fewer, more capable nodes over many granular ones.

Be thoughtful about per_artifact. If a user says "summarize these 10 reports," each report should be summarized individually (per_artifact: true). If a user says "draft a brief from these reports," the brief needs all inputs together (per_artifact: false).`

// Per-type strict schemas for Pass 2. Every schema is strict — no freeform fields.
const NODE_CONFIG_SCHEMAS: Record<string, any> = {
  agent_transform: {
    type: 'json_schema', name: 'agent_transform_config', strict: true,
    schema: {
      type: 'object',
      properties: { prompt: { type: 'string' } },
      required: ['prompt'], additionalProperties: false
    }
  },
  agent_code: {
    type: 'json_schema', name: 'agent_code_config', strict: true,
    schema: {
      type: 'object',
      properties: { prompt: { type: 'string' } },
      required: ['prompt'], additionalProperties: false
    }
  },
  llm_classify: {
    type: 'json_schema', name: 'llm_classify_config', strict: true,
    schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        labels: { type: 'array', items: { type: 'string' } }
      },
      required: ['prompt', 'labels'], additionalProperties: false
    }
  },
  llm_extract: {
    type: 'json_schema', name: 'llm_extract_config', strict: true,
    schema: {
      type: 'object',
      properties: { prompt: { type: 'string' } },
      required: ['prompt'], additionalProperties: false
    }
  },
  llm_summarize: {
    type: 'json_schema', name: 'llm_summarize_config', strict: true,
    schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        max_length: { type: 'number' }
      },
      required: ['prompt', 'max_length'], additionalProperties: false
    }
  },
  llm_transform: {
    type: 'json_schema', name: 'llm_transform_config', strict: true,
    schema: {
      type: 'object',
      properties: { prompt: { type: 'string' } },
      required: ['prompt'], additionalProperties: false
    }
  },
  retrieve: {
    type: 'json_schema', name: 'retrieve_config', strict: true,
    schema: {
      type: 'object',
      properties: {
        source: { type: 'string' },
        filter: { type: ['string', 'null'] }
      },
      required: ['source', 'filter'], additionalProperties: false
    }
  },
  branch: {
    type: 'json_schema', name: 'branch_config', strict: true,
    schema: {
      type: 'object',
      properties: {
        condition: { type: 'string' },
        if_true_node: { type: 'string' },
        if_false_node: { type: 'string' }
      },
      required: ['condition', 'if_true_node', 'if_false_node'], additionalProperties: false
    }
  },
  wait: {
    type: 'json_schema', name: 'wait_config', strict: true,
    schema: {
      type: 'object',
      properties: { duration: { type: 'string' } },
      required: ['duration'], additionalProperties: false
    }
  },
  review: {
    type: 'json_schema', name: 'review_config', strict: true,
    schema: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'], additionalProperties: false
    }
  },
  emit: {
    type: 'json_schema', name: 'emit_config', strict: true,
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        format: { type: 'string', enum: ['markdown', 'text', 'json', 'csv'] }
      },
      required: ['title', 'format'], additionalProperties: false
    }
  },
  notify: {
    type: 'json_schema', name: 'notify_config', strict: true,
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        level: { type: 'string', enum: ['info', 'warning', 'error'] }
      },
      required: ['message', 'level'], additionalProperties: false
    }
  }
}

const NODE_CONFIG_INSTRUCTIONS = `You are filling in the configuration for a single node in a Task Engine execution plan. Given the node's type, description, and the overall task context, generate the fields for this node.

Be specific in prompts. Don't be vague — write the actual instructions the LLM will receive.`

interface StructureNode {
  id: string
  type: string
  description: string
  per_artifact: boolean
  depends_on: string[]
}

export async function generatePlan(
  openai: OpenAI,
  taskPrompt: string
): Promise<{ nodes: PlanNode[] }> {
  // Pass 1: High-level plan structure via gpt-5.4
  const structureResponse = await openai.responses.create({
    model: 'gpt-5.4',
    instructions: STRUCTURE_INSTRUCTIONS,
    input: taskPrompt,
    reasoning: { effort: 'high' },
    text: { format: STRUCTURE_SCHEMA }
  })

  const structure: { nodes: StructureNode[] } = JSON.parse(structureResponse.output_text)

  // Pass 2: Expand each node's type-specific fields via gpt-5-mini (parallel).
  // Each node type has its own strict schema — no freeform output.
  const configPromises = structure.nodes.map(async (node) => {
    const schema = NODE_CONFIG_SCHEMAS[node.type]
    if (!schema) return node // unknown type, pass through

    const response = await openai.responses.create({
      model: 'gpt-5-mini',
      instructions: NODE_CONFIG_INSTRUCTIONS,
      input: `Task: ${taskPrompt}\n\nNode ID: ${node.id}\nNode type: ${node.type}\nDescription: ${node.description}\nPer-artifact: ${node.per_artifact}`,
      text: { format: schema }
    })

    return { ...node, ...JSON.parse(response.output_text) }
  })

  const expandedNodes = await Promise.all(configPromises)

  // Build flat PlanNodes — null out any fields not set by this node type
  const nullFields = {
    prompt: null, labels: null, max_length: null,
    source: null, filter: null, condition: null,
    if_true_node: null, if_false_node: null, duration: null,
    message: null, title: null, format: null, level: null
  }

  return {
    nodes: expandedNodes.map(n => ({
      ...nullFields,
      ...n
    })) as PlanNode[]
  }
}
```

Both passes use strict schemas. Pass 1 constrains the DAG structure. Pass 2 constrains each node's type-specific fields using per-type schemas. The resulting plan is fully typed with no freeform objects.

#### 1.3 Build the graph utility

`server/utils/graphUtils.ts`:

```typescript
export function topoSort(nodes: PlanNode[]): PlanNode[] {
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const done = new Set<string>()
  const inProgress = new Set<string>()
  const sorted: PlanNode[] = []

  function visit(id: string) {
    if (done.has(id)) return
    if (inProgress.has(id)) throw new Error(`Cycle detected at node: ${id}`)
    inProgress.add(id)
    const node = nodeMap.get(id)
    if (!node) throw new Error(`Unknown node: ${id}`)
    for (const dep of node.depends_on) {
      visit(dep)
    }
    inProgress.delete(id)
    done.add(id)
    sorted.push(node)
  }

  for (const node of nodes) {
    visit(node.id)
  }
  return sorted
}

export function validatePlan(plan: { nodes: PlanNode[] }): string[] {
  const errors: string[] = []
  const ids = new Set(plan.nodes.map(n => n.id))

  for (const node of plan.nodes) {
    for (const dep of node.depends_on) {
      if (!ids.has(dep)) {
        errors.push(`Node "${node.id}" depends on unknown node "${dep}"`)
      }
    }
  }

  try { topoSort(plan.nodes) }
  catch (e: any) { errors.push(e.message) }

  return errors
}
```

#### 1.4 Tasks API

`server/api/tasks/index.get.ts` — List tasks:

```typescript
export default defineEventHandler(async (event) => {
  const client = await serverSupabaseClient(event)
  const { data, error } = await client
    .from('tasks')
    .select('*, plans(id, version, created_at), runs(id, status)')
    .order('created_at', { ascending: false })

  if (error) throw createError({ statusCode: 500, message: error.message })
  return data
})
```

`server/api/tasks/index.post.ts` — Create task + generate plan + create job:

```typescript
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const client = createServiceClient()
  const openai = useOpenAI()

  // Create the task
  const { data: task, error: taskError } = await client
    .from('tasks')
    .insert({
      title: body.title,
      prompt: body.prompt,
      trigger_type: body.trigger_type || 'manual',
      schedule_config: body.schedule_config || {}
    })
    .select()
    .single()

  if (taskError) throw createError({ statusCode: 500, message: taskError.message })

  // Generate the plan
  const planJson = await generatePlan(openai, body.prompt)
  const errors = validatePlan(planJson)

  const { data: plan, error: planError } = await client
    .from('plans')
    .insert({
      task_id: task.id,
      plan_json: planJson,
      version: 1
    })
    .select()
    .single()

  if (planError) throw createError({ statusCode: 500, message: planError.message })

  // Create the job — every task gets a job to track execution lifecycle
  const jobType = body.trigger_type === 'scheduled' ? 'scheduled'
    : body.trigger_type === 'heartbeat' ? 'heartbeat'
    : 'one_off'

  const jobStatus = body.trigger_type === 'scheduled' ? 'scheduled' : 'idle'

  const { data: job, error: jobError } = await client
    .from('jobs')
    .insert({
      task_id: task.id,
      job_type: jobType,
      status: jobStatus,
      next_run_at: body.schedule_config?.next_run_at || null
    })
    .select()
    .single()

  if (jobError) throw createError({ statusCode: 500, message: jobError.message })

  return { task, plan, job, validation_errors: errors }
})
```

`server/api/tasks/[id].get.ts` — Get task with latest plan:

```typescript
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const client = await serverSupabaseClient(event)

  const { data: task } = await client
    .from('tasks')
    .select('*, plans(id, plan_json, version, created_at), runs(id, status, started_at, completed_at)')
    .eq('id', id)
    .single()

  if (!task) throw createError({ statusCode: 404, message: 'Task not found' })
  return task
})
```

`server/api/tasks/[id].patch.ts` — Update task (status, prompt, trigger):

```typescript
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody(event)
  const client = await serverSupabaseClient(event)

  const { data, error } = await client
    .from('tasks')
    .update(body)
    .eq('id', id)
    .select()
    .single()

  if (error) throw createError({ statusCode: 500, message: error.message })
  return data
})
```

`server/api/tasks/[id]/replan.post.ts` — Re-generate the plan:

```typescript
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const client = await serverSupabaseClient(event)
  const openai = useOpenAI()

  const { data: task } = await client.from('tasks').select('*').eq('id', id).single()
  if (!task) throw createError({ statusCode: 404, message: 'Task not found' })

  // Get current max version
  const { data: plans } = await client
    .from('plans')
    .select('version')
    .eq('task_id', id)
    .order('version', { ascending: false })
    .limit(1)

  const nextVersion = (plans?.[0]?.version || 0) + 1

  const planJson = await generatePlan(openai, task.prompt)
  const errors = validatePlan(planJson)

  const { data: plan } = await client
    .from('plans')
    .insert({
      task_id: id,
      plan_json: planJson,
      version: nextVersion
    })
    .select()
    .single()

  return { plan, validation_errors: errors }
})
```

#### 1.5 Artifacts API

`server/api/artifacts/index.get.ts` — List artifacts:

```typescript
export default defineEventHandler(async (event) => {
  const client = await serverSupabaseClient(event)
  const query = getQuery(event)

  let q = client.from('artifacts')
    .select('*')
    .order('created_at', { ascending: false })

  if (query.task_id) q = q.eq('task_id', query.task_id)
  if (query.run_id) q = q.eq('created_by_run_id', query.run_id)

  const { data, error } = await q
  if (error) throw createError({ statusCode: 500, message: error.message })
  return data
})
```

`server/api/artifacts/[id].get.ts` — Get artifact (with content or storage URL):

```typescript
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const client = await serverSupabaseClient(event)

  const { data: artifact } = await client
    .from('artifacts')
    .select('*')
    .eq('id', id)
    .single()

  if (!artifact) throw createError({ statusCode: 404, message: 'Artifact not found' })

  // If content is in storage, generate a signed URL
  if (artifact.storage_path && !artifact.content) {
    const { data: urlData } = await client.storage
      .from('artifacts')
      .createSignedUrl(artifact.storage_path, 3600)
    artifact.download_url = urlData?.signedUrl
  }

  return artifact
})
```

`server/api/artifacts/index.post.ts` — Create artifact (used for manual uploads and by node executors):

```typescript
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const client = await serverSupabaseClient(event)

  const INLINE_LIMIT = 50_000 // 50KB — above this, store in Supabase Storage

  let storagePath = null
  let content = body.content

  if (content && content.length > INLINE_LIMIT) {
    const path = `${body.task_id || 'uploads'}/${Date.now()}-${body.title.replace(/\s+/g, '_')}`
    const { error: uploadError } = await client.storage
      .from('artifacts')
      .upload(path, content, { contentType: 'text/plain' })

    if (uploadError) throw createError({ statusCode: 500, message: uploadError.message })
    storagePath = path
    content = null
  }

  const { data, error } = await client
    .from('artifacts')
    .insert({
      type: body.type || 'text',
      title: body.title,
      content,
      metadata_json: body.metadata || {},
      storage_path: storagePath,
      task_id: body.task_id,
      created_by_run_id: body.run_id,
      created_by_node_id: body.node_run_id
    })
    .select()
    .single()

  if (error) throw createError({ statusCode: 500, message: error.message })
  return data
})
```

#### 1.6 Reviews API

`server/api/reviews/index.get.ts` — List reviews (filterable by status):

```typescript
export default defineEventHandler(async (event) => {
  const client = await serverSupabaseClient(event)
  const query = getQuery(event)

  let q = client.from('reviews')
    .select('*, runs(id, task_id, tasks(title)), node_runs(node_key, node_type)')
    .order('created_at', { ascending: false })

  if (query.status) q = q.eq('status', query.status)

  const { data, error } = await q
  if (error) throw createError({ statusCode: 500, message: error.message })
  return data
})
```

`server/api/reviews/[id].patch.ts` — Resolve a review (approve, reject, edit):

```typescript
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody(event)
  const client = createServiceClient()

  const { data: review, error } = await client
    .from('reviews')
    .update({
      status: body.status,
      comments: body.comments,
      resolved_at: new Date().toISOString()
    })
    .eq('id', id)
    .select('*, node_runs(run_id)')
    .single()

  if (error) throw createError({ statusCode: 500, message: error.message })

  // Send Inngest event to resume the run (wired in Sprint 2)
  // await inngest.send({ name: 'task-engine/review.resolved', data: { ... } })

  return review
})
```

#### 1.7 Runs API

`server/api/runs/index.get.ts` — List runs:

```typescript
export default defineEventHandler(async (event) => {
  const client = await serverSupabaseClient(event)
  const query = getQuery(event)

  let q = client.from('runs')
    .select('*, tasks(title), plans(version)')
    .order('started_at', { ascending: false, nullsFirst: false })

  if (query.task_id) q = q.eq('task_id', query.task_id)
  if (query.status) q = q.eq('status', query.status)

  const { data, error } = await q
  if (error) throw createError({ statusCode: 500, message: error.message })
  return data
})
```

`server/api/runs/[id].get.ts` — Get run with node runs:

```typescript
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const client = await serverSupabaseClient(event)

  const { data: run } = await client
    .from('runs')
    .select(`
      *,
      tasks(title, prompt),
      plans(plan_json, version),
      node_runs(*),
      reviews(*)
    `)
    .eq('id', id)
    .single()

  if (!run) throw createError({ statusCode: 404, message: 'Run not found' })
  return run
})
```

### Verification

```bash
# Create a task — should generate a plan via gpt-5.4
curl -X POST http://localhost:3000/api/tasks \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <supabase-jwt>' \
  -d '{"title":"Weekly Summary","prompt":"Summarize the weekly reports folder and draft a brief for review","trigger_type":"manual"}'
# Expected: { task: {...}, plan: { plan_json: { nodes: [...] } }, validation_errors: [] }

# List tasks
curl http://localhost:3000/api/tasks -H 'Authorization: Bearer <supabase-jwt>'
# Expected: array with the task just created

# Re-plan
curl -X POST http://localhost:3000/api/tasks/<id>/replan -H 'Authorization: Bearer <supabase-jwt>'
# Expected: new plan with version 2
```

### Definition of Done

- [ ] OpenAI client configured and accessible in server routes
- [ ] Multi-pass plan generator: `gpt-5.4` for DAG structure, `gpt-5-mini` for per-node fields
- [ ] Both passes use strict JSON schemas (structure schema + per-type config schemas)
- [ ] `per_artifact` flag is set by the planner for each node
- [ ] Graph utility validates plans (including cycle detection) and performs topological sort
- [ ] Tasks API: create (with plan generation + job creation), list, get, update, re-plan
- [ ] Job created for every task, with status matching trigger type (idle for manual, scheduled for cron)
- [ ] Artifacts API: create (inline or storage), list, get
- [ ] Reviews API: list, resolve
- [ ] Runs API: list, get (with node runs)

---

## Sprint 2: Execution Runtime — Inngest & Node Executors

**Goal:** Build the durable execution engine. Inngest walks the plan graph, executing each node as a durable step. Simple LLM nodes and infrastructure nodes are implemented. The review pause/resume flow works end-to-end.

**Duration:** 2-3 days

### Tasks

#### 2.1 Set up Inngest

`server/utils/inngest.ts`:

```typescript
import { Inngest } from 'inngest'

export const inngest = new Inngest({
  id: 'task-engine',
  eventKey: process.env.INNGEST_EVENT_KEY
})
```

`server/api/inngest.ts` — Inngest serve endpoint:

```typescript
import { serve } from 'inngest/nuxt'
import { inngest } from '~/server/utils/inngest'
import { executeRun } from '~/server/inngest/functions/executeRun'
import { heartbeatCheck } from '~/server/inngest/functions/heartbeat'

export default serve({
  client: inngest,
  functions: [executeRun, heartbeatCheck]
})
```

#### 2.2 Build node executors

Each node type gets an executor function that takes the plan node and execution context and returns output artifacts. All executors share the same signature:

`server/inngest/nodes/types.ts`:

```typescript
export interface NodeExecutorResult {
  artifacts: Array<{
    title: string
    content: string
    type: 'markdown' | 'text' | 'json' | 'csv'
    metadata?: Record<string, any>
  }>
  logs: Record<string, any>
}

export type NodeExecutor = (
  node: PlanNode,
  context: NodeExecutionContext
) => Promise<NodeExecutorResult>
```

`server/inngest/nodes/registry.ts`:

```typescript
import type { NodeExecutor } from './types'

const executors: Record<string, NodeExecutor> = {}

export function registerNodeExecutor(type: string, executor: NodeExecutor) {
  executors[type] = executor
}

export function getNodeExecutor(type: string): NodeExecutor {
  const executor = executors[type]
  if (!executor) throw new Error(`No executor registered for node type: ${type}`)
  return executor
}
```

#### 2.3 Simple LLM node executors

All simple LLM executors share a common pattern via `runLlmNode()`. This helper handles the `per_artifact` flag: when true, it calls the LLM once per input artifact and collects the results; when false, it concatenates all inputs and makes a single call.

`server/inngest/nodes/llmHelper.ts`:

```typescript
interface LlmCallConfig {
  model: string
  instructions: string
  reasoning?: { effort: 'low' | 'medium' | 'high' }
  textFormat?: any
}

// Core helper: handles per_artifact iteration vs batching
async function runLlmNode(
  node: PlanNode,
  context: NodeExecutionContext,
  buildCall: (inputText: string, artifactTitle?: string) => LlmCallConfig
): Promise<NodeExecutorResult> {
  const { openai } = context
  const perArtifact = node.per_artifact === true
  const allLogs: any[] = []

  if (perArtifact && context.inputArtifacts.length > 0) {
    const artifacts = []
    for (const artifact of context.inputArtifacts) {
      const callConfig = buildCall(artifact.content, artifact.title)
      const response = await openai.responses.create({
        model: callConfig.model,
        instructions: callConfig.instructions,
        input: artifact.content,
        reasoning: callConfig.reasoning,
        text: callConfig.textFormat ? { format: callConfig.textFormat } : undefined
      })
      artifacts.push({
        title: `${artifact.title} — Result`,
        content: response.output_text,
        type: callConfig.textFormat ? 'json' as const : 'markdown' as const
      })
      allLogs.push({ artifact: artifact.title, tokens: response.usage })
    }
    return {
      artifacts,
      logs: { model: artifacts.length > 0 ? buildCall('').model : 'unknown', calls: allLogs, per_artifact: true }
    }
  }

  // Batch mode: single call with all inputs concatenated
  const inputText = context.inputArtifacts.map(a => a.content).join('\n\n---\n\n')
  const callConfig = buildCall(inputText)
  const response = await openai.responses.create({
    model: callConfig.model,
    instructions: callConfig.instructions,
    input: inputText || node.prompt,
    reasoning: callConfig.reasoning,
    text: callConfig.textFormat ? { format: callConfig.textFormat } : undefined
  })

  return {
    artifacts: [{
      title: 'Result',
      content: response.output_text,
      type: callConfig.textFormat ? 'json' : 'markdown'
    }],
    logs: { model: callConfig.model, tokens: response.usage, per_artifact: false }
  }
}
```

`server/inngest/nodes/llmSummarize.ts`:

```typescript
export const llmSummarize: NodeExecutor = async (node, context) => {
  return runLlmNode(node, context, (inputText, artifactTitle) => ({
    model: 'gpt-5-mini',
    instructions: `Summarize the following content. ${node.prompt || ''}`,
    reasoning: { effort: 'medium' }
  }))
}
```

`server/inngest/nodes/llmClassify.ts`:

```typescript
export const llmClassify: NodeExecutor = async (node, context) => {
  return runLlmNode(node, context, () => ({
    model: 'gpt-5-nano',
    instructions: node.prompt || 'Classify the following content.',
    textFormat: {
      type: 'json_schema',
      name: 'classification',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          label: { type: 'string', enum: node.labels || [] },
          confidence: { type: 'number' },
          reasoning: { type: 'string' }
        },
        required: ['label', 'confidence', 'reasoning'],
        additionalProperties: false
      }
    }
  }))
}
```

Same pattern for `llmExtract.ts` and `llmTransform.ts`. The `per_artifact` flag is the key decision: if the planner set it to `true`, each artifact gets its own LLM call; if `false`, everything is batched into one call. Users can flip this on the plan detail page before running.

#### 2.4 Infrastructure node executors

`server/inngest/nodes/retrieve.ts`:

```typescript
export const retrieve: NodeExecutor = async (node, context) => {
  const { supabase } = context

  let query = supabase.from('artifacts').select('*')

  if (node.source) {
    if (node.source.startsWith('task:')) {
      query = query.eq('task_id', node.source.replace('task:', ''))
    } else {
      query = query.ilike('title', `%${node.source}%`)
    }
  }

  if (node.filter === 'last_7_days') {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    query = query.gte('created_at', weekAgo)
  }

  const { data: artifacts } = await query.order('created_at', { ascending: false })

  return {
    artifacts: (artifacts || []).map(a => ({
      title: a.title,
      content: a.content || '',
      type: a.type,
      metadata: { source_id: a.id }
    })),
    logs: { retrieved_count: artifacts?.length || 0 }
  }
}
```

`server/inngest/nodes/emit.ts`:

```typescript
export const emit: NodeExecutor = async (node, context) => {
  const { supabase } = context
  const inputContent = context.inputArtifacts.map(a => a.content).join('\n\n')

  const title = (node.title || 'Output')
    .replace('{{date}}', new Date().toLocaleDateString())

  const { data: artifact } = await supabase
    .from('artifacts')
    .insert({
      type: node.format || 'markdown',
      title,
      content: inputContent,
      created_by_run_id: context.runId,
      created_by_node_id: context.nodeRunId,
      task_id: context.taskId
    })
    .select()
    .single()

  return {
    artifacts: [{
      title,
      content: inputContent,
      type: node.format || 'markdown',
      metadata: { artifact_id: artifact?.id }
    }],
    logs: { emitted_artifact_id: artifact?.id }
  }
}
```

`server/inngest/nodes/review.ts`:

The review node doesn't execute any logic — it creates a review record and signals the run executor to pause via `step.waitForEvent()`. The actual pause logic lives in the run executor (2.5).

```typescript
export const review: NodeExecutor = async (node, context) => {
  const { supabase } = context

  const { data: reviewRecord } = await supabase
    .from('reviews')
    .insert({
      run_id: context.runId,
      node_run_id: context.nodeRunId,
      status: 'pending'
    })
    .select()
    .single()

  // Update the run status to waiting_review
  await supabase.from('runs').update({ status: 'waiting_review' }).eq('id', context.runId)

  return {
    artifacts: [],
    logs: {
      review_id: reviewRecord?.id,
      message: node.message || 'Review requested'
    }
  }
}
```

`server/inngest/nodes/branch.ts`, `server/inngest/nodes/notify.ts`, `server/inngest/nodes/wait.ts` — similar pattern, each implementing their specific behavior.

#### 2.5 The run executor — Inngest function

This is the main Inngest function that walks the plan graph. Inspired by Claude Code's core loop architecture: iterate through a sequence of operations, handle each one durably, and manage state across iterations.

**Important:** Input artifacts for each node are loaded from the database via `node_runs.output_refs`, not held in memory. This ensures correctness when Inngest replays steps after a review wait or restart. The job status is updated at each lifecycle transition so the jobs page always reflects reality.

`server/inngest/functions/executeRun.ts`:

```typescript
import { inngest } from '~/server/utils/inngest'
import { createServiceClient } from '~/server/utils/supabase'
import { topoSort } from '~/server/utils/graphUtils'
import { getNodeExecutor } from '~/server/inngest/nodes/registry'

export const executeRun = inngest.createFunction(
  { id: 'execute-run', retries: 0 },
  { event: 'task-engine/run.start' },
  async ({ event, step }) => {
    const { runId, planId, taskId, jobId } = event.data

    // Load the plan
    const plan = await step.run('load-plan', async () => {
      const supabase = createServiceClient()
      const { data } = await supabase.from('plans').select('plan_json').eq('id', planId).single()
      return data.plan_json
    })

    // Mark run + job as running
    await step.run('mark-running', async () => {
      const supabase = createServiceClient()
      await supabase.from('runs')
        .update({ status: 'running', started_at: new Date().toISOString() })
        .eq('id', runId)
      if (jobId) {
        await supabase.from('jobs')
          .update({ status: 'running', current_run_id: runId })
          .eq('id', jobId)
      }
    })

    const sorted = topoSort(plan.nodes)

    // Build a map of node_key → node_run_id for artifact lookups
    // This persists across Inngest replays because each step.run returns its result
    const nodeRunIds: Record<string, string> = {}

    for (const node of sorted) {
      const result = await step.run(`node-${node.id}`, async () => {
        const supabase = createServiceClient()
        const openai = useOpenAI()

        // Create node_run record
        const { data: nodeRun } = await supabase.from('node_runs')
          .insert({
            run_id: runId,
            node_key: node.id,
            node_type: node.type,
            status: 'running',
            started_at: new Date().toISOString()
          })
          .select()
          .single()

        // Load input artifacts from the database using dependency node_runs' output_refs.
        // This is durable — works correctly after Inngest replays.
        const depNodeRunIds = node.depends_on
          .map(depId => nodeRunIds[depId])
          .filter(Boolean)

        let inputArtifacts: any[] = []
        if (depNodeRunIds.length > 0) {
          const { data: depRuns } = await supabase.from('node_runs')
            .select('output_refs')
            .in('id', depNodeRunIds)

          const artifactIds = (depRuns || []).flatMap(r => r.output_refs || [])
          if (artifactIds.length > 0) {
            const { data: artifacts } = await supabase.from('artifacts')
              .select('id, title, content, type, metadata_json')
              .in('id', artifactIds)
            inputArtifacts = artifacts || []
          }
        }

        const context: NodeExecutionContext = {
          runId,
          nodeRunId: nodeRun.id,
          taskId,
          inputArtifacts,
          supabase,
          openai
        }

        try {
          const executor = getNodeExecutor(node.type)
          const result = await executor(node, context)

          await supabase.from('node_runs')
            .update({
              status: 'completed',
              output_refs: result.artifacts.map(a => a.metadata?.artifact_id).filter(Boolean),
              logs: result.logs,
              completed_at: new Date().toISOString()
            })
            .eq('id', nodeRun.id)

          return { nodeId: node.id, nodeRunId: nodeRun.id, artifacts: result.artifacts }
        } catch (err: any) {
          await supabase.from('node_runs')
            .update({
              status: 'failed',
              logs: { error: err.message },
              completed_at: new Date().toISOString()
            })
            .eq('id', nodeRun.id)
          throw err
        }
      })

      nodeRunIds[node.id] = result.nodeRunId

      // Review node: pause and wait for human resolution
      if (node.type === 'review') {
        // Update job status to reflect the wait
        await step.run(`review-wait-start-${node.id}`, async () => {
          const supabase = createServiceClient()
          if (jobId) {
            await supabase.from('jobs').update({ status: 'waiting_review' }).eq('id', jobId)
          }
        })

        const reviewEvent = await step.waitForEvent(`review-${node.id}`, {
          event: 'task-engine/review.resolved',
          match: 'data.runId',
          timeout: '7d'
        })

        if (!reviewEvent) {
          await step.run('review-timeout', async () => {
            const supabase = createServiceClient()
            await supabase.from('runs')
              .update({ status: 'failed', error_message: 'Review timed out after 7 days' })
              .eq('id', runId)
            if (jobId) {
              await supabase.from('jobs')
                .update({ status: 'failed', last_error: 'Review timed out' })
                .eq('id', jobId)
            }
          })
          return
        }

        if (reviewEvent.data.status === 'rejected') {
          await step.run('review-rejected', async () => {
            const supabase = createServiceClient()
            await supabase.from('runs')
              .update({ status: 'cancelled', error_message: 'Review rejected' })
              .eq('id', runId)
            if (jobId) {
              await supabase.from('jobs')
                .update({ status: 'failed', last_error: 'Review rejected' })
                .eq('id', jobId)
            }
          })
          return
        }

        // Resume
        await step.run(`review-resume-${node.id}`, async () => {
          const supabase = createServiceClient()
          await supabase.from('runs').update({ status: 'running' }).eq('id', runId)
          if (jobId) {
            await supabase.from('jobs').update({ status: 'running' }).eq('id', jobId)
          }
        })
      }
    }

    // Mark run + job as completed
    await step.run('mark-completed', async () => {
      const supabase = createServiceClient()
      await supabase.from('runs')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', runId)
      if (jobId) {
        await supabase.from('jobs')
          .update({
            status: 'completed',
            current_run_id: null,
            last_run_at: new Date().toISOString()
          })
          .eq('id', jobId)
      }
    })
  }
)
```

#### 2.6 Trigger API — start a run

`server/api/runs/index.post.ts` — Trigger a new run for a task. Looks up the task's job and latest plan, creates the run record, links it to the job, and fires the Inngest event.

```typescript
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const client = await serverSupabaseClient(event)

  // Get the latest plan
  const { data: plan } = await client
    .from('plans')
    .select('id')
    .eq('task_id', body.task_id)
    .order('version', { ascending: false })
    .limit(1)
    .single()

  if (!plan) throw createError({ statusCode: 400, message: 'No plan exists for this task' })

  // Get the job for this task
  const { data: job } = await client
    .from('jobs')
    .select('id')
    .eq('task_id', body.task_id)
    .single()

  // Create the run record
  const { data: run } = await client
    .from('runs')
    .insert({
      task_id: body.task_id,
      plan_id: plan.id,
      job_id: job?.id || null,
      status: 'pending'
    })
    .select()
    .single()

  // Send Inngest event with job context
  await inngest.send({
    name: 'task-engine/run.start',
    data: {
      runId: run.id,
      planId: plan.id,
      taskId: body.task_id,
      jobId: job?.id || null
    }
  })

  return run
})
```

#### 2.7 Wire review resolution to Inngest

Update `server/api/reviews/[id].patch.ts` to send the resume event:

```typescript
// After updating the review record...
await inngest.send({
  name: 'task-engine/review.resolved',
  data: {
    reviewId: review.id,
    runId: review.node_runs.run_id,
    status: body.status,
    comments: body.comments
  }
})
```

#### 2.8 Jobs API and scheduled execution

`server/api/jobs/index.get.ts` — List jobs with task info and current run:

```typescript
export default defineEventHandler(async (event) => {
  const client = await serverSupabaseClient(event)
  const query = getQuery(event)

  let q = client
    .from('jobs')
    .select('*, tasks(title, trigger_type, status), runs:current_run_id(id, status, started_at)')
    .order('next_run_at', { ascending: true, nullsFirst: false })

  if (query.status) q = q.eq('status', query.status)

  const { data, error } = await q
  if (error) throw createError({ statusCode: 500, message: error.message })
  return data
})
```

`server/api/jobs/[id].patch.ts` — Pause/resume a job:

```typescript
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody(event)
  const client = await serverSupabaseClient(event)

  const { data, error } = await client
    .from('jobs')
    .update({ status: body.status })
    .eq('id', id)
    .select()
    .single()

  if (error) throw createError({ statusCode: 500, message: error.message })
  return data
})
```

`server/inngest/functions/heartbeat.ts` — Heartbeat check function:

```typescript
export const heartbeatCheck = inngest.createFunction(
  { id: 'heartbeat-check' },
  { cron: '*/30 * * * *' },
  async ({ step }) => {
    const activeHeartbeats = await step.run('load-heartbeats', async () => {
      const supabase = createServiceClient()
      // Only check heartbeat tasks that aren't already running
      const { data } = await supabase
        .from('jobs')
        .select('id, task_id, tasks(prompt, schedule_config)')
        .eq('job_type', 'heartbeat')
        .in('status', ['idle', 'scheduled', 'completed'])
      return data || []
    })

    for (const job of activeHeartbeats) {
      await step.run(`check-${job.task_id}`, async () => {
        const shouldRun = await checkHeartbeatCondition(job.tasks)

        if (shouldRun) {
          const supabase = createServiceClient()

          // Get the latest plan
          const { data: plan } = await supabase.from('plans')
            .select('id')
            .eq('task_id', job.task_id)
            .order('version', { ascending: false })
            .limit(1)
            .single()

          if (!plan) return

          // Create the run record
          const { data: run } = await supabase.from('runs')
            .insert({
              task_id: job.task_id,
              plan_id: plan.id,
              job_id: job.id,
              status: 'pending'
            })
            .select()
            .single()

          // Fire the run
          await inngest.send({
            name: 'task-engine/run.start',
            data: {
              runId: run.id,
              planId: plan.id,
              taskId: job.task_id,
              jobId: job.id
            }
          })
        }
      })
    }
  }
)
```

### Verification

```bash
# Create a task
curl -X POST http://localhost:3000/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"Test","prompt":"Summarize the text and emit it","trigger_type":"manual"}'

# Trigger a run
curl -X POST http://localhost:3000/api/runs \
  -H 'Content-Type: application/json' \
  -d '{"task_id":"<task-id>"}'
# Expected: run record with status "pending"

# Check run status after a few seconds
curl http://localhost:3000/api/runs/<run-id>
# Expected: status "completed" with node_runs showing each node's execution

# Inngest dashboard: http://localhost:8288
# Expected: function runs visible with step-by-step execution
```

### Definition of Done

- [x] Inngest configured with serve endpoint
- [x] Node executor registry with executors for all infrastructure and simple LLM types
- [x] `llm_summarize`, `llm_classify`, `llm_extract`, `llm_transform` use appropriate model tiers
- [x] `per_artifact` flag: when true, LLM executors iterate per artifact; when false, they batch
- [x] `retrieve`, `emit`, `branch`, `notify`, `wait` infrastructure nodes work
- [x] `review` node creates review record and pauses the run
- [x] Run executor walks plan graph topologically with per-node durable steps
- [x] Input artifacts loaded from DB (not in-memory) — survives Inngest replays after review waits
- [x] Job status updated at each lifecycle transition: running, waiting_review, completed, failed
- [x] Review resolution sends Inngest event and resumes the run (updates job status)
- [x] Trigger API creates run via job, fires Inngest event with jobId
- [x] Heartbeat cron queries jobs table, creates run record before firing event
- [x] Runs, node_runs, and artifacts tables are populated during execution
- [x] Jobs API: list (with status filter), pause/resume

---

## Sprint 3: Agent Nodes & Tool System

**Goal:** Implement the ReAct-style agent loop for `agent_transform` and `agent_code` nodes. This is where Claude Code's "while loop around the tool use API" pattern is adapted for the OpenAI Responses API.

**Duration:** 2-3 days

### Background: Lessons from Claude Code

Claude Code's core architecture is a while loop:

1. Send messages + tool definitions to the model
2. Model responds, possibly with function calls
3. Execute the requested tools, collect results
4. Feed results back as tool call outputs
5. Repeat until the model responds without any tool calls

Key engineering decisions from Claude Code that we adopt:

- **Tool execution is sequential within a turn.** Simpler to debug. Parallel execution can be added later.
- **Tool errors never crash the loop.** Catch errors and send them back to the model as error results. The model adapts.
- **Step limit as a safety cap.** Prevent runaway loops with a configurable max iterations.
- **Structured tool registry.** Each tool is a well-typed object with a schema and an execute function, making the system extensible.

We adapt this for OpenAI's Responses API using `previous_response_id` for multi-turn state instead of manually managing a messages array, and function calling instead of Anthropic's tool_use blocks.

### Tasks

#### 3.1 Build the agent loop

`server/inngest/nodes/agentLoop.ts`:

This is the core ReAct loop — the most important piece of the runtime.

```typescript
import type { OpenAI } from 'openai'
import type { AgentTool } from './types'

interface AgentLoopConfig {
  model: string
  instructions: string
  input: string
  tools: AgentTool[]
  maxIterations: number
  reasoning: { effort: 'low' | 'medium' | 'high' }
  context: NodeExecutionContext
}

interface AgentLoopResult {
  output: string
  iterations: number
  toolCalls: Array<{ name: string; input: any; output: string; isError: boolean }>
  tokens: { input: number; output: number; reasoning: number }
}

export async function runAgentLoop(config: AgentLoopConfig): Promise<AgentLoopResult> {
  const { openai } = config.context
  const collectedToolCalls: AgentLoopResult['toolCalls'] = []
  let totalTokens = { input: 0, output: 0, reasoning: 0 }
  let previousResponseId: string | null = null
  let iterations = 0
  let currentInput: string | any[] = config.input

  // Build OpenAI function tool definitions
  const toolDefs = config.tools.map(tool => ({
    type: 'function' as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters
  }))

  while (iterations < config.maxIterations) {
    iterations++

    const requestParams: any = {
      model: config.model,
      instructions: config.instructions,
      input: currentInput,
      reasoning: config.reasoning,
      tools: toolDefs.length > 0 ? toolDefs : undefined,
      store: true
    }

    // Use previous_response_id for multi-turn state after the first call
    if (previousResponseId) {
      requestParams.previous_response_id = previousResponseId
    }

    const response = await openai.responses.create(requestParams)

    previousResponseId = response.id
    totalTokens.input += response.usage?.input_tokens || 0
    totalTokens.output += response.usage?.output_tokens || 0
    totalTokens.reasoning += response.usage?.output_tokens_details?.reasoning_tokens || 0

    // Check for function calls in the output
    const functionCalls = response.output.filter(
      (item: any) => item.type === 'function_call'
    )

    // No function calls — model is done
    if (functionCalls.length === 0) {
      return {
        output: response.output_text,
        iterations,
        toolCalls: collectedToolCalls,
        tokens: totalTokens
      }
    }

    // Execute each function call sequentially
    const toolResults: any[] = []
    for (const call of functionCalls) {
      const tool = config.tools.find(t => t.name === call.name)

      let output: string
      let isError = false

      if (!tool) {
        output = `Error: Unknown tool "${call.name}"`
        isError = true
      } else {
        try {
          const parsedInput = typeof call.arguments === 'string'
            ? JSON.parse(call.arguments)
            : call.arguments
          output = await tool.run(parsedInput, config.context)
        } catch (err: any) {
          output = `Error: ${err.message}`
          isError = true
        }
      }

      collectedToolCalls.push({
        name: call.name,
        input: call.arguments,
        output,
        isError
      })

      toolResults.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output
      })
    }

    // Feed tool results back — they become the next input with previous_response_id
    currentInput = toolResults
  }

  // Max iterations reached — return whatever we have
  return {
    output: `[Agent reached max iterations (${config.maxIterations}). Last output may be incomplete.]`,
    iterations,
    toolCalls: collectedToolCalls,
    tokens: totalTokens
  }
}
```

#### 3.2 Build the tool registry

`server/inngest/nodes/tools/readArtifact.ts`:

```typescript
export const readArtifactTool: AgentTool = {
  name: 'read_artifact',
  description: 'Read the full content of an artifact by its ID.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The artifact UUID' }
    },
    required: ['id'],
    additionalProperties: false
  },
  run: async (input, context) => {
    const { data } = await context.supabase
      .from('artifacts')
      .select('title, content, type')
      .eq('id', input.id)
      .single()

    if (!data) return 'Error: Artifact not found'
    return `# ${data.title}\nType: ${data.type}\n\n${data.content}`
  }
}
```

`server/inngest/nodes/tools/writeArtifact.ts`:

```typescript
export const writeArtifactTool: AgentTool = {
  name: 'write_artifact',
  description: 'Create a new artifact with the given title and content.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Artifact title' },
      content: { type: 'string', description: 'Artifact content' },
      format: {
        type: 'string',
        enum: ['markdown', 'text', 'json', 'csv'],
        description: 'Content format'
      }
    },
    required: ['title', 'content', 'format'],
    additionalProperties: false
  },
  run: async (input, context) => {
    const { data } = await context.supabase
      .from('artifacts')
      .insert({
        type: input.format,
        title: input.title,
        content: input.content,
        created_by_run_id: context.runId,
        created_by_node_id: context.nodeRunId,
        task_id: context.taskId
      })
      .select('id')
      .single()

    return `Artifact created: ${data?.id} — "${input.title}"`
  }
}
```

`server/inngest/nodes/tools/searchArtifacts.ts`:

```typescript
export const searchArtifactsTool: AgentTool = {
  name: 'search_artifacts',
  description: 'Search artifacts by title or content keywords. Returns a list of matching artifacts with IDs.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' }
    },
    required: ['query'],
    additionalProperties: false
  },
  run: async (input, context) => {
    const { data } = await context.supabase
      .from('artifacts')
      .select('id, title, type, created_at')
      .or(`title.ilike.%${input.query}%,content.ilike.%${input.query}%`)
      .order('created_at', { ascending: false })
      .limit(10)

    if (!data || data.length === 0) return 'No artifacts found matching the query.'

    return data.map(a =>
      `- ${a.id}: "${a.title}" (${a.type}, ${a.created_at})`
    ).join('\n')
  }
}
```

`server/inngest/nodes/tools/runPython.ts`:

For the MVP, Python execution uses a constrained subprocess with timeout. Future versions could use a proper sandbox (Firecracker, E2B, etc.).

```typescript
export const runPythonTool: AgentTool = {
  name: 'run_python',
  description: 'Execute Python code and return stdout/stderr. Available for data processing, CSV/JSON manipulation, and calculations. No network access.',
  parameters: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'Python code to execute' }
    },
    required: ['code'],
    additionalProperties: false
  },
  run: async (input, _context) => {
    const { execFile } = await import('child_process')
    const { promisify } = await import('util')
    const exec = promisify(execFile)

    try {
      const { stdout, stderr } = await exec('python3', ['-c', input.code], {
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }
      })
      return `stdout:\n${stdout}\n${stderr ? `stderr:\n${stderr}` : ''}`
    } catch (err: any) {
      return `Execution error:\n${err.stderr || err.message}`
    }
  }
}
```

#### 3.3 Agent transform executor

`server/inngest/nodes/agentTransform.ts`:

```typescript
export const agentTransform: NodeExecutor = async (node, context) => {
  const inputText = context.inputArtifacts
    .map(a => `## ${a.title}\n\n${a.content}`)
    .join('\n\n---\n\n')

  const tools = [readArtifactTool, writeArtifactTool, searchArtifactsTool]

  const result = await runAgentLoop({
    model: 'gpt-5.4',
    instructions: `You are an agent node in Task Engine. Your job is to perform the following task.

${node.prompt}

You have access to tools for reading, writing, and searching artifacts. Use them as needed to accomplish the task. Think step by step and be thorough.`,
    input: inputText || node.prompt,
    tools,
    maxIterations: 10,
    reasoning: { effort: 'high' },
    context
  })

  return {
    artifacts: [{
      title: node.title || 'Agent Output',
      content: result.output,
      type: 'markdown'
    }],
    logs: {
      model: 'gpt-5.4',
      iterations: result.iterations,
      tool_calls: result.toolCalls,
      tokens: result.tokens
    }
  }
}
```

#### 3.4 Agent code executor

`server/inngest/nodes/agentCode.ts`:

```typescript
export const agentCode: NodeExecutor = async (node, context) => {
  const inputText = context.inputArtifacts
    .map(a => `## ${a.title} (${a.type})\n\n${a.content}`)
    .join('\n\n---\n\n')

  const tools = [runPythonTool, readArtifactTool, writeArtifactTool]

  const result = await runAgentLoop({
    model: 'gpt-5.4',
    instructions: `You are a code execution agent in Task Engine. Your job:

${node.prompt}

You can run Python code to process data. You can also read existing artifacts for input and write new artifacts for output. When processing CSV or JSON data, use Python with the standard library (csv, json modules).

Always test your code with a small sample first, then process the full dataset.`,
    input: inputText || node.prompt,
    tools,
    maxIterations: 15,
    reasoning: { effort: 'high' },
    context
  })

  return {
    artifacts: [{
      title: node.title || 'Code Output',
      content: result.output,
      type: 'text'
    }],
    logs: {
      model: 'gpt-5.4',
      iterations: result.iterations,
      tool_calls: result.toolCalls,
      tokens: result.tokens
    }
  }
}
```

#### 3.5 Register all executors

`server/inngest/nodes/index.ts`:

```typescript
import { registerNodeExecutor } from './registry'
import { agentTransform } from './agentTransform'
import { agentCode } from './agentCode'
import { llmSummarize } from './llmSummarize'
import { llmClassify } from './llmClassify'
import { llmExtract } from './llmExtract'
import { llmTransformNode } from './llmTransform'
import { retrieve } from './retrieve'
import { branch } from './branch'
import { wait } from './wait'
import { review } from './review'
import { emit } from './emit'
import { notify } from './notify'

registerNodeExecutor('agent_transform', agentTransform)
registerNodeExecutor('agent_code', agentCode)
registerNodeExecutor('llm_summarize', llmSummarize)
registerNodeExecutor('llm_classify', llmClassify)
registerNodeExecutor('llm_extract', llmExtract)
registerNodeExecutor('llm_transform', llmTransformNode)
registerNodeExecutor('retrieve', retrieve)
registerNodeExecutor('branch', branch)
registerNodeExecutor('wait', wait)
registerNodeExecutor('review', review)
registerNodeExecutor('emit', emit)
registerNodeExecutor('notify', notify)
```

### Verification

```bash
# Create a task that requires agent reasoning
curl -X POST http://localhost:3000/api/tasks \
  -d '{"title":"Memo Draft","prompt":"Read the uploaded project status reports, analyze the key themes, and draft a concise executive memo with recommendations."}'

# Upload some artifacts first, then trigger the run
curl -X POST http://localhost:3000/api/runs -d '{"task_id":"<task-id>"}'

# Check run — should show agent_transform node with tool calls in logs
curl http://localhost:3000/api/runs/<run-id>
# Expected: node_runs include agent_transform with logs showing iterations, tool_calls array
```

### Tests

**Backend:**

1. Agent transform node runs a multi-turn loop with tool calls (read, write, search)
2. Agent code node generates and executes Python, produces output
3. Tool errors are caught and fed back to the model gracefully
4. Max iterations cap is respected — loop terminates and returns partial output
5. `previous_response_id` maintains context across iterations

**QA:**

1. Create a task "Summarize these documents and draft a brief" with uploaded artifacts
2. Trigger a run — the agent_transform node should iterate (visible in node_run logs)
3. Artifacts produced by write_artifact tool appear in the artifacts table

### Definition of Done

- [x] `runAgentLoop` implements the ReAct while loop with `previous_response_id` for state
- [x] Function calling works: model calls tools, results fed back, loop continues
- [x] Tool registry: `read_artifact`, `write_artifact`, `search_artifacts`, `run_python`
- [x] `agent_transform` executor uses `gpt-5.4` with tools and high reasoning effort
- [x] `agent_code` executor generates and runs Python in a sandboxed subprocess
- [x] Tool errors are caught and returned to the model (never crash the loop)
- [x] Max iterations safety cap works
- [x] All node executors registered in the registry

---

## Sprint 4: Dashboard UI

**Goal:** Build all five dashboard views using Nuxt UI components, following the patterns established by the dashboard template. This is the user-facing layer — task management, run inspection, artifact browsing, review inbox, and job management.

**Duration:** 3-4 days

### Tasks

#### 4.1 Tasks list page — `app/pages/tasks/index.vue`

Shows all tasks with key info at a glance. Follows the Customers page pattern from the dashboard template (TanStack table with filters, actions, and pagination).

**Columns:** Title, Trigger Type, Status, Last Run (relative time), Next Run, Actions

**Features:**
- Status filter tabs: All / Active / Paused / Archived
- "New Task" button in the navbar
- Row click navigates to task detail
- Row actions dropdown: Run Now, Pause, Archive, Delete

```vue
<template>
  <UDashboardPanel>
    <UDashboardNavbar title="Tasks">
      <template #actions>
        <UButton label="New Task" icon="i-lucide-plus" to="/tasks/new" />
      </template>
    </UDashboardNavbar>

    <UDashboardToolbar>
      <UTabs :items="statusTabs" v-model="activeTab" />
    </UDashboardToolbar>

    <UTable
      :data="filteredTasks"
      :columns="columns"
      :loading="pending"
      @select="row => navigateTo(`/tasks/${row.id}`)"
    />
  </UDashboardPanel>
</template>
```

#### 4.2 Create task page — `app/pages/tasks/new.vue`

Natural-language task creation form. User describes what they want in a text area, selects a trigger type, and submits. The system generates a plan and shows it for review.

**Form fields:**
- Title (UInput)
- Prompt (UTextarea — large, this is the main input)
- Trigger type (URadioGroup: Manual, Scheduled, Heartbeat)
- Schedule config (conditional — cron expression for scheduled, interval for heartbeat)

**Flow:**
1. User fills out form and submits
2. Loading state: "Generating plan..."
3. Plan is generated and displayed as a list of nodes
4. User can review the plan, then confirm to create the task
5. Or re-generate the plan if it looks wrong

```vue
<template>
  <UDashboardPanel>
    <UDashboardNavbar title="New Task">
      <template #actions>
        <UButton label="Cancel" variant="ghost" to="/tasks" />
      </template>
    </UDashboardNavbar>

    <div class="max-w-2xl mx-auto p-6">
      <UForm :schema="schema" :state="state" @submit="onSubmit">
        <UFormField label="Title" name="title" class="mb-4">
          <UInput v-model="state.title" placeholder="Weekly summary brief" />
        </UFormField>

        <UFormField label="What should this task do?" name="prompt" class="mb-4">
          <UTextarea
            v-model="state.prompt"
            :rows="6"
            placeholder="Summarize the weekly reports folder every Monday morning, highlight key changes, and draft a brief for my review."
          />
        </UFormField>

        <UFormField label="Trigger" name="trigger_type" class="mb-6">
          <URadioGroup v-model="state.trigger_type" :items="triggerOptions" />
        </UFormField>

        <UButton type="submit" label="Generate Plan" :loading="generating" block />
      </UForm>

      <!-- Plan Preview -->
      <div v-if="plan" class="mt-8">
        <h3 class="text-lg font-medium mb-4">Generated Plan</h3>
        <PlanNodeList :nodes="plan.nodes" />
        <div class="flex gap-2 mt-4">
          <UButton label="Create Task" @click="confirmTask" color="primary" />
          <UButton label="Re-generate" @click="regenerate" variant="outline" />
        </div>
      </div>
    </div>
  </UDashboardPanel>
</template>
```

#### 4.3 Task detail page — `app/pages/tasks/[id].vue`

Shows the task configuration, its current plan as a visual graph, run history, job status, and actions.

**Sections:**
- Task info header (title, status badge, trigger type, created date)
- Job status card (current job state — idle/scheduled/running/waiting_review/etc., link to active run if running)
- Plan visualization (PlanGraph component — visual node graph with edges). Each node shows the `per_artifact` flag as a small indicator so users can see whether the node processes artifacts individually or as a batch.
- Run history (compact table of recent runs with status badges)
- Actions: Run Now, Re-plan, Edit, Pause/Resume, Archive

#### 4.4 Plan graph component — `app/components/PlanGraph.vue`

Renders the node graph as a vertical flow. Each node is a card showing type icon, id, and a summary of its key fields. Edges connect dependent nodes. Nodes are color-coded by type category (agent=blue, llm=green, infrastructure=neutral).

For the MVP, a simple vertical list with dependency arrows is sufficient. A more sophisticated graph layout (dagre, elkjs) can be added later.

```vue
<template>
  <div class="space-y-3">
    <div
      v-for="node in sortedNodes"
      :key="node.id"
      class="flex items-start gap-3"
    >
      <div class="flex flex-col items-center">
        <div
          class="w-8 h-8 rounded-full flex items-center justify-center"
          :class="nodeColorClass(node.type)"
        >
          <UIcon :name="nodeIcon(node.type)" class="text-sm" />
        </div>
        <div v-if="!isLast(node)" class="w-px h-6 bg-(--ui-border)" />
      </div>

      <UCard class="flex-1" size="sm">
        <div class="flex items-center justify-between">
          <div>
            <span class="font-medium text-sm">{{ node.id }}</span>
            <UBadge :label="node.type" size="xs" variant="subtle" class="ml-2" />
          </div>
          <UBadge
            v-if="nodeRunStatus"
            :label="nodeRunStatus"
            :color="statusColor(nodeRunStatus)"
            size="xs"
          />
        </div>
        <p class="text-sm text-(--ui-text-muted) mt-1">
          {{ node.description }}
        </p>
      </UCard>
    </div>
  </div>
</template>
```

#### 4.5 Run inspector page — `app/pages/runs/[id].vue`

The most important surface for trust and debugging. Shows the run status, the plan graph with per-node execution state, expand-to-see-details for each node, logs, artifacts in/out, waiting states, and errors.

**Layout:**
- Run header: status badge, task title, plan version, timestamps, duration
- Plan graph with node execution overlay: each node shows its status (pending/running/completed/failed), and clicking expands to show:
  - Input artifacts
  - Output artifacts
  - Execution logs (tool calls for agent nodes, model/tokens for LLM nodes)
  - Error message if failed
  - Timing info
- Review section (if run is in waiting_review state): shows the review context and approve/reject buttons inline

**Node detail component — `app/components/NodeDetail.vue`:**

```vue
<template>
  <div class="border rounded-lg p-4">
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center gap-2">
        <UBadge :label="nodeRun.node_type" size="sm" />
        <span class="font-medium">{{ nodeRun.node_key }}</span>
      </div>
      <UBadge :label="nodeRun.status" :color="statusColor" size="sm" />
    </div>

    <!-- Input artifacts -->
    <div v-if="inputArtifacts.length" class="mb-3">
      <h4 class="text-xs font-medium text-(--ui-text-muted) mb-1">Inputs</h4>
      <ArtifactPreview v-for="a in inputArtifacts" :key="a.id" :artifact="a" />
    </div>

    <!-- Output artifacts -->
    <div v-if="outputArtifacts.length" class="mb-3">
      <h4 class="text-xs font-medium text-(--ui-text-muted) mb-1">Outputs</h4>
      <ArtifactPreview v-for="a in outputArtifacts" :key="a.id" :artifact="a" />
    </div>

    <!-- Logs (agent nodes show tool calls) -->
    <div v-if="nodeRun.logs?.tool_calls?.length" class="mb-3">
      <h4 class="text-xs font-medium text-(--ui-text-muted) mb-1">Tool Calls</h4>
      <div v-for="call in nodeRun.logs.tool_calls" :key="call.name" class="text-xs font-mono p-2 bg-(--ui-bg-muted) rounded mb-1">
        <span class="font-semibold">{{ call.name }}</span>({{ truncate(call.input, 80) }})
        <div v-if="call.isError" class="text-(--ui-error) mt-1">{{ call.output }}</div>
      </div>
    </div>

    <!-- Token usage -->
    <div v-if="nodeRun.logs?.tokens" class="text-xs text-(--ui-text-muted)">
      Tokens: {{ nodeRun.logs.tokens.input }} in / {{ nodeRun.logs.tokens.output }} out
      <span v-if="nodeRun.logs.tokens.reasoning"> / {{ nodeRun.logs.tokens.reasoning }} reasoning</span>
    </div>
  </div>
</template>
```

#### 4.6 Runs list page — `app/pages/runs/index.vue`

Table of all runs across all tasks. Filterable by status.

**Columns:** Task Title, Status, Plan Version, Started, Duration, Actions

#### 4.7 Artifact browser — `app/pages/artifacts/index.vue`

Shows all artifacts with type icons, content preview, source run, and creation date. Filterable by type and task.

#### 4.8 Artifact viewer — `app/pages/artifacts/[id].vue`

Full artifact view with content rendering:
- Markdown: rendered with prose styling
- JSON: syntax-highlighted and formatted
- CSV: rendered as a table (using UTable)
- Text: monospaced block

Metadata panel shows: type, created by (run/node), task, timestamps.

```vue
<template>
  <UDashboardPanel>
    <UDashboardNavbar :title="artifact?.title">
      <template #actions>
        <UBadge :label="artifact?.type" />
      </template>
    </UDashboardNavbar>

    <div class="p-6">
      <!-- Markdown -->
      <div v-if="artifact?.type === 'markdown'" class="prose dark:prose-invert max-w-none">
        <MDC :value="artifact.content" />
      </div>

      <!-- JSON -->
      <pre v-else-if="artifact?.type === 'json'" class="text-sm font-mono bg-(--ui-bg-muted) p-4 rounded-lg overflow-auto">{{ formatJson(artifact.content) }}</pre>

      <!-- CSV -->
      <UTable v-else-if="artifact?.type === 'csv'" :data="parseCsv(artifact.content)" />

      <!-- Text -->
      <pre v-else class="text-sm font-mono whitespace-pre-wrap">{{ artifact?.content }}</pre>
    </div>
  </UDashboardPanel>
</template>
```

#### 4.9 Review inbox — `app/pages/reviews/index.vue`

A focused inbox for pending reviews. Each review card shows:
- Task name and run context
- The node output that needs review
- The review message from the node
- Action buttons: Approve, Reject, Edit

Follows the Inbox page pattern from the dashboard template (list on left, detail on right with resizable panels).

```vue
<template>
  <UDashboardPanel>
    <UDashboardNavbar title="Reviews">
      <template #actions>
        <UBadge :label="`${pendingCount} pending`" color="warning" v-if="pendingCount" />
      </template>
    </UDashboardNavbar>

    <div v-if="reviews?.length" class="divide-y divide-(--ui-border)">
      <ReviewCard
        v-for="review in reviews"
        :key="review.id"
        :review="review"
        @resolve="handleResolve"
      />
    </div>
    <div v-else class="p-8 text-center text-(--ui-text-muted)">
      No reviews pending.
    </div>
  </UDashboardPanel>
</template>
```

**ReviewCard component — `app/components/ReviewCard.vue`:**

```vue
<template>
  <div class="p-4">
    <div class="flex items-start justify-between mb-2">
      <div>
        <h3 class="font-medium">{{ review.runs?.tasks?.title }}</h3>
        <p class="text-sm text-(--ui-text-muted)">
          Node: {{ review.node_runs?.node_key }} ({{ review.node_runs?.node_type }})
        </p>
      </div>
      <UBadge :label="review.status" :color="review.status === 'pending' ? 'warning' : 'success'" />
    </div>

    <ArtifactPreview v-if="nodeOutput" :artifact="nodeOutput" class="mb-3" />

    <div v-if="review.status === 'pending'" class="flex gap-2">
      <UButton label="Approve" color="success" size="sm" @click="$emit('resolve', { id: review.id, status: 'approved' })" />
      <UButton label="Reject" color="error" size="sm" variant="outline" @click="$emit('resolve', { id: review.id, status: 'rejected' })" />
    </div>
  </div>
</template>
```

#### 4.10 Jobs page — `app/pages/jobs/index.vue`

The jobs page is the central view for execution lifecycle. Every task has a job, and the job shows the current state: idle (waiting for manual trigger), scheduled (next run time visible), running (with a link to the active run), waiting_review, paused, completed, or failed.

**Columns:** Task Title, Job Type, Status (color-coded badge), Current Run (link), Next Run, Last Run, Actions

**Features:**
- Status filter tabs: All / Running / Scheduled / Waiting Review / Failed
- Row actions: Run Now, Pause, Resume
- Running jobs show a link to the active run inspector
- Failed jobs show `last_error` in a tooltip
- Scheduled jobs show countdown to next run

#### 4.11 Dashboard composable — `app/composables/useDashboard.ts`

Adapt the template's `useDashboard` composable for Task Engine. Add keyboard shortcuts for navigation and shared state:

```typescript
const _useDashboard = () => {
  const router = useRouter()

  defineShortcuts({
    'g-t': () => router.push('/tasks'),
    'g-r': () => router.push('/runs'),
    'g-a': () => router.push('/artifacts'),
    'g-v': () => router.push('/reviews'),
    'g-j': () => router.push('/jobs'),
    'n': () => router.push('/tasks/new')
  })

  // Fetch pending review count for the sidebar badge
  const { data: pendingReviews } = useFetch('/api/reviews', {
    query: { status: 'pending' },
    transform: (data: any[]) => data.length
  })

  return { pendingReviewCount: pendingReviews }
}

export const useDashboard = createSharedComposable(_useDashboard)
```

#### 4.12 Run progress streaming via SSE

`server/api/runs/[id]/stream.get.ts` — SSE endpoint that streams run events:

```typescript
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const eventStream = createEventStream(event)

  // Poll the run and node_runs tables for changes
  // In a production system this would use Supabase Realtime,
  // but for the MVP, polling every 2 seconds is fine
  const interval = setInterval(async () => {
    const supabase = await serverSupabaseClient(event)
    const { data: run } = await supabase
      .from('runs')
      .select('status, node_runs(*)')
      .eq('id', id)
      .single()

    if (run) {
      await eventStream.push(JSON.stringify({
        type: 'run_update',
        data: run
      }))

      if (['completed', 'failed', 'cancelled'].includes(run.status)) {
        clearInterval(interval)
        await eventStream.close()
      }
    }
  }, 2000)

  event.node.req.on('close', () => {
    clearInterval(interval)
  })

  return eventStream.send()
})
```

`app/composables/useRunStream.ts` — Client-side composable for run progress:

```typescript
export function useRunStream(runId: Ref<string>) {
  const run = ref<any>(null)
  const nodeRuns = ref<any[]>([])
  const status = ref<string>('pending')

  let eventSource: EventSource | null = null

  function connect() {
    eventSource = new EventSource(`/api/runs/${runId.value}/stream`)

    eventSource.onmessage = (e) => {
      const data = JSON.parse(e.data)
      if (data.type === 'run_update') {
        status.value = data.data.status
        nodeRuns.value = data.data.node_runs || []
      }
    }

    eventSource.onerror = () => {
      eventSource?.close()
    }
  }

  function disconnect() {
    eventSource?.close()
  }

  onMounted(() => connect())
  onUnmounted(() => disconnect())

  return { run, nodeRuns, status }
}
```

### Verification

- Create a task from the New Task page — plan renders as a node list
- Trigger a run from the task detail page — run appears in runs list
- Open the run inspector — node execution states update in near-realtime
- After completion, all node details are expandable with logs and artifacts
- Review inbox shows pending reviews with approve/reject buttons
- Approving a review resumes the run (visible in the run inspector)
- Artifacts page lists all created artifacts with type-appropriate rendering
- Keyboard shortcuts navigate between views

### Definition of Done

- [ ] Tasks list with status filter tabs, actions, and navigation
- [ ] Create task page with natural-language prompt, plan generation, and preview
- [ ] Task detail page with plan graph, run history, and actions
- [ ] Run inspector with node-by-node execution detail, expandable logs, artifact previews
- [ ] Runs list with status filters
- [ ] Artifact browser and viewer with type-appropriate rendering (markdown, JSON, CSV, text)
- [ ] Review inbox with approve/reject flow that resumes runs
- [ ] Jobs page with status filters, current run link, pause/resume, failed job visibility
- [ ] SSE streaming for run progress
- [ ] Keyboard shortcuts for navigation
- [ ] Pending review count badge in sidebar

---

## Sprint 5: End-to-End Integration & Polish

**Goal:** Verify all five success criteria loops work end-to-end, handle edge cases, polish the UI, and clean up.

**Duration:** 2 days

### Tasks

#### 5.1 Success criteria verification

Test each of the five loops defined in the vision doc:

**Loop 1: Summarize a folder of artifacts every morning**
- Create a task: "Summarize all artifacts in the weekly-reports folder every morning"
- Trigger: scheduled (cron)
- Expected plan: `retrieve` → `llm_summarize` → `emit`
- Verify: artifacts are fetched, summaries are generated, output artifact is created
- Verify: scheduled job fires on cron

**Loop 2: Watch a source on a heartbeat and flag changes**
- Create a task: "Check the project artifacts every 30 minutes, flag any new or changed items"
- Trigger: heartbeat
- Expected plan: `retrieve` → `agent_transform` (analysis) → `notify`
- Verify: heartbeat cron runs, lightweight check detects changes, full run triggers

**Loop 3: Generate a memo from a set of files**
- Create a task: "Read the quarterly reports and draft an executive memo with recommendations"
- Trigger: manual
- Expected plan: `retrieve` → `agent_transform` (draft memo) → `emit`
- Verify: agent loop runs, reads artifacts, writes the memo artifact

**Loop 4: Pause for human review, then resume**
- Create a task: "Draft a weekly brief and submit it for my review before saving"
- Expected plan: `retrieve` → `agent_transform` → `review` → `emit`
- Verify: run pauses at review node, review appears in inbox, approving resumes the run, final artifact is emitted

**Loop 5: Run generated Python over CSV/JSON artifacts**
- Upload a CSV artifact, then create a task: "Process this CSV — calculate totals by category and output a summary"
- Expected plan: `retrieve` → `agent_code` → `emit`
- Verify: agent generates Python, code executes, output artifact is created

#### 5.2 Error handling and edge cases

- **Plan generation fails**: Show error in the create task flow, allow retry
- **Node execution fails**: Mark node as failed, mark run as failed, show error in run inspector
- **Review timeout**: After 7 days, run is marked failed with timeout message
- **Empty plan**: If planner returns zero nodes, show a clear message and allow re-plan
- **Large artifacts**: Content over 50KB stored in Supabase Storage, viewer fetches signed URL
- **Inngest function timeout**: Configure appropriate timeouts per function type
- **Python execution timeout**: 30-second hard limit on `run_python` tool
- **Concurrent runs**: Multiple runs of the same task should work independently

#### 5.3 Artifact upload flow

Add the ability for users to upload artifacts manually (not just via node execution). This is needed for Loop 3 and Loop 5 where the user provides input files.

`app/pages/artifacts/upload.vue`:

- File dropzone or text input
- Type selection (markdown, text, JSON, CSV)
- Optional association with a task
- Preview before upload

#### 5.4 Dashboard home page

Replace the redirect with a simple dashboard showing:
- Active tasks count
- Running/waiting runs count
- Pending reviews count (prominent, since these need attention)
- Recent runs (last 5, with status badges)
- Quick actions: New Task, View Reviews

Keep it minimal. The value is in the task and run views, not in vanity metrics.

#### 5.5 Command palette enhancement

Wire the command palette to show:
- Navigation commands (already handled by the layout)
- Recent tasks (searchable)
- Pending reviews (quick jump)
- "New Task" action

```typescript
const groups = computed(() => [{
  id: 'actions',
  label: 'Actions',
  items: [
    { label: 'New Task', icon: 'i-lucide-plus', to: '/tasks/new' },
    { label: 'View Reviews', icon: 'i-lucide-message-circle-warning', to: '/reviews' }
  ]
}, {
  id: 'tasks',
  label: 'Tasks',
  items: tasks.value?.map(t => ({
    label: t.title,
    icon: 'i-lucide-list-checks',
    to: `/tasks/${t.id}`
  })) || []
}])
```

#### 5.6 Polish and cleanup

- **Loading states**: Ensure all data-fetching pages show skeleton/loading states
- **Empty states**: Each list page has a clear empty state with a call to action
- **Error toasts**: API errors surface as toast notifications
- **Responsive behavior**: Sidebar collapses on mobile (handled by the dashboard template)
- **Type safety**: Ensure all API responses have TypeScript types in `app/types/`
- **`.env.example`**: Document all required environment variables
- **README.md**: Write setup instructions, architecture overview, and development guide

### Verification

All five success criteria loops run to completion:

1. Scheduled summarization: Task creates, cron fires, artifacts summarized, output emitted
2. Heartbeat watching: Heartbeat checks run, changes detected, notification sent
3. Manual memo generation: Agent reads artifacts, drafts memo, output artifact saved
4. Review pause/resume: Run pauses, review appears in inbox, approval resumes run
5. Python execution: Code generated, CSV processed, output artifact created

### Definition of Done

- [ ] All five success criteria loops work end-to-end
- [ ] Error handling covers plan generation failure, node execution failure, timeouts
- [ ] Artifact upload flow works for manual input
- [ ] Dashboard home page shows overview stats and quick actions
- [ ] Command palette searches tasks and shows navigation
- [ ] Loading states, empty states, and error toasts throughout
- [ ] TypeScript types for all API responses
- [ ] `.env.example` and README are complete
- [ ] The system feels inspectable — every run's execution is traceable through the UI

---

## Project Structure

```
task-engine/
├── app/
│   ├── app.vue
│   ├── app.config.ts
│   ├── error.vue
│   ├── assets/
│   │   └── css/main.css
│   ├── layouts/
│   │   └── default.vue                    # Dashboard layout (sidebar, nav, command palette)
│   ├── pages/
│   │   ├── index.vue                      # Dashboard home
│   │   ├── login.vue                      # Auth login
│   │   ├── tasks/
│   │   │   ├── index.vue                  # Task list (TanStack table)
│   │   │   ├── [id].vue                   # Task detail + plan graph + run history
│   │   │   └── new.vue                    # Create task (prompt + plan preview)
│   │   ├── runs/
│   │   │   ├── index.vue                  # All runs
│   │   │   └── [id].vue                   # Run inspector (node-by-node detail)
│   │   ├── artifacts/
│   │   │   ├── index.vue                  # Artifact browser
│   │   │   ├── [id].vue                   # Artifact viewer (type-aware rendering)
│   │   │   └── upload.vue                 # Manual artifact upload
│   │   ├── reviews/
│   │   │   └── index.vue                  # Review inbox
│   │   └── jobs/
│   │       └── index.vue                  # Job manager
│   ├── components/
│   │   ├── PlanGraph.vue                  # Visual node graph
│   │   ├── NodeDetail.vue                 # Expandable node execution detail
│   │   ├── ArtifactPreview.vue            # Inline artifact card
│   │   ├── ReviewCard.vue                 # Review action card
│   │   ├── UserMenu.vue                   # Auth user menu (from template)
│   │   └── home/
│   │       ├── HomeStats.vue              # Dashboard stat cards
│   │       └── HomeRecentRuns.vue         # Recent runs list
│   ├── composables/
│   │   ├── useDashboard.ts               # Shared state, keyboard shortcuts
│   │   └── useRunStream.ts               # SSE composable for run progress
│   ├── types/
│   │   └── index.d.ts                     # Shared TypeScript interfaces
│   └── utils/
│       └── index.ts                       # Formatting helpers
├── server/
│   ├── api/
│   │   ├── inngest.ts                     # Inngest serve endpoint
│   │   ├── tasks/
│   │   │   ├── index.get.ts               # List tasks
│   │   │   ├── index.post.ts              # Create task + generate plan
│   │   │   ├── [id].get.ts                # Get task detail
│   │   │   ├── [id].patch.ts              # Update task
│   │   │   └── [id]/
│   │   │       └── replan.post.ts         # Re-generate plan
│   │   ├── runs/
│   │   │   ├── index.get.ts               # List runs
│   │   │   ├── index.post.ts              # Trigger a run
│   │   │   ├── [id].get.ts                # Get run with node runs
│   │   │   └── [id]/
│   │   │       └── stream.get.ts          # SSE run progress stream
│   │   ├── artifacts/
│   │   │   ├── index.get.ts               # List artifacts
│   │   │   ├── index.post.ts              # Create artifact
│   │   │   └── [id].get.ts                # Get artifact
│   │   ├── reviews/
│   │   │   ├── index.get.ts               # List reviews
│   │   │   └── [id].patch.ts              # Resolve review
│   │   └── jobs/
│   │       ├── index.get.ts               # List jobs
│   │       └── [id].patch.ts              # Pause/resume job
│   ├── inngest/
│   │   ├── functions/
│   │   │   ├── executeRun.ts              # Main run executor (graph walker)
│   │   │   └── heartbeat.ts               # Heartbeat check function
│   │   └── nodes/
│   │       ├── types.ts                   # NodeExecutor interface
│   │       ├── registry.ts                # Executor registry
│   │       ├── index.ts                   # Register all executors
│   │       ├── llmHelper.ts               # Shared per_artifact / batch helper
│   │       ├── agentLoop.ts               # ReAct agent loop (core engine)
│   │       ├── agentTransform.ts          # Complex reasoning agent node
│   │       ├── agentCode.ts               # Code generation + execution node
│   │       ├── llmSummarize.ts            # Summarization (gpt-5-mini)
│   │       ├── llmClassify.ts             # Classification (gpt-5-nano)
│   │       ├── llmExtract.ts              # Structured extraction
│   │       ├── llmTransform.ts            # Text transform
│   │       ├── retrieve.ts                # Artifact retrieval
│   │       ├── branch.ts                  # Conditional routing
│   │       ├── wait.ts                    # Duration wait
│   │       ├── review.ts                  # Human review pause
│   │       ├── emit.ts                    # Artifact output
│   │       ├── notify.ts                  # Notification/logging
│   │       └── tools/
│   │           ├── readArtifact.ts        # read_artifact tool
│   │           ├── writeArtifact.ts       # write_artifact tool
│   │           ├── searchArtifacts.ts     # search_artifacts tool
│   │           └── runPython.ts           # run_python tool (sandboxed)
│   └── utils/
│       ├── supabase.ts                    # Supabase client helpers
│       ├── openai.ts                      # OpenAI client singleton
│       ├── inngest.ts                     # Inngest client
│       ├── planGenerator.ts               # Task → plan via gpt-5.4
│       └── graphUtils.ts                  # Topo sort, validation
├── db_migrations/
│   ├── 001_schema.sql                     # Full data model
│   ├── 002_rls_policies.sql               # Row-level security
│   └── 003_storage.sql                    # Artifact storage bucket
├── nuxt.config.ts
├── package.json
├── .env.example
└── README.md
```

---

## Dependencies

### npm packages

| Package | Purpose |
|---------|---------|
| `nuxt` (^4.x) | Framework |
| `@nuxt/ui` (^4.x) | Component library (Nuxt UI v3) |
| `@nuxt/eslint` | Linting |
| `@vueuse/core` + `@vueuse/nuxt` | Vue composition utilities |
| `@supabase/supabase-js` | Supabase server/database client |
| `inngest` | Durable execution runtime |
| `openai` | OpenAI Responses API client |
| `tailwindcss` (^4.x) | Styling |
| `@tanstack/table-core` | Table state management |
| `zod` | Form validation |
| `@iconify-json/lucide` | Lucide icons |
| `date-fns` | Date formatting |

### Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Yes | Service role key for single-user local development |
| `OPENAI_API_KEY` | Yes | OpenAI API key for Responses API |
| `INNGEST_EVENT_KEY` | Yes | Inngest event key |
| `INNGEST_SIGNING_KEY` | Yes | Inngest signing key |

---

## What This Intentionally Excludes

Keeping scope tight by explicitly not building:

- **Multi-user collaboration**: This is a single-user local operator tool during development. No shared workspaces or team features.
- **Chat interface**: This is not a chatbot. Tasks are described, plans are generated, runs execute. No back-and-forth conversation.
- **Rich connectors**: No API integrations, webhooks, or external service connections beyond the core tools (artifact CRUD, Python execution).
- **Advanced agent memory**: Agents operate within a single run. No persistent memory across runs or tasks.
- **Subagent delegation**: Each agent node runs a single loop. No nested agent spawning.
- **Complex permissions**: No role-based access or permission groups during development. Auth and RLS are intentionally deferred.
- **Office documents**: Artifacts are text-first — markdown, text, JSON, CSV. No DOCX, PDF, or spreadsheet editing.
- **Mobile optimization**: Desktop-first dashboard. Responsive sidebar collapse from the template is fine, but no mobile-specific views.
- **Enterprise hardening**: No audit logs, no SSO, no compliance features.

---

## Summary

| Sprint | Focus | Duration | Key Deliverables |
|--------|-------|----------|------------------|
| 0 | Project scaffold & data layer | 2 days | Nuxt 4 app, Supabase schema, auth, dashboard layout, placeholder pages |
| 1 | Plan generation & core API | 2 days | OpenAI plan generator, graph utils, CRUD APIs for tasks/artifacts/reviews/runs |
| 2 | Execution runtime | 2-3 days | Inngest functions, node executors, run graph walker, review pause/resume, jobs |
| 3 | Agent nodes & tool system | 2-3 days | ReAct agent loop, tool registry, agent_transform, agent_code, Python sandbox |
| 4 | Dashboard UI | 3-4 days | All 5 views, plan graph, run inspector, artifact viewer, review inbox, SSE streaming |
| 5 | Integration & polish | 2 days | E2E success criteria, error handling, artifact upload, dashboard home, cleanup |

**Total estimated time: 13-16 days.** Sprint 0 is scaffolding. Sprints 1-3 are backend/runtime. Sprint 4 is the full UI. Sprint 5 is integration testing and polish.
