# Task Engine

A general-purpose agentic runtime for text-native work. You describe what you want done in natural language, and the system generates an execution plan, runs it over artifacts, pauses for human review when needed, and handles scheduling and long-running jobs.

Task Engine is a small runtime for artifact-based work graphs. Not a chatbot, not a workflow builder for power users, not a fake agent demo. A set of strict primitives that support dynamic AI planning, durable execution, human review, and inspectable artifact flows.

## What it does

You give the system a goal like:

> Review these documents every Monday morning, summarize key changes, and draft a brief for my review.

The system creates a task, generates a plan (a DAG of executable nodes), and runs it. Nodes can call LLMs, run code, fetch data, branch conditionally, pause for human review, and emit artifacts. Runs are durable, scheduled work is first-class, and everything is inspectable.

### Core loops

- **Summarize a folder of artifacts on a schedule** - scheduled trigger, retrieve node, LLM summarize, emit
- **Watch a source and flag changes** - heartbeat trigger, retrieve or HTTP fetch, agent analysis, notify
- **Generate a memo from uploaded files** - manual trigger, retrieve, agent transform, emit
- **Pause for human review, then resume** - any trigger, review node, durable wait via Inngest, resume on approval
- **Run generated Python over data** - agent code node, sandboxed execution, emit results

## Architecture

```
┌──────────────────────────────────────────────┐
│  Nuxt 4 Dashboard (Nuxt UI)                  │
│  Pages: tasks, plans, runs, artifacts,       │
│         reviews, jobs, home dashboard         │
└──────────────┬───────────────────────────────┘
               │
┌──────────────▼───────────────────────────────┐
│  Nitro Server Routes (API)                    │
│  CRUD for all entities + plan generation      │
│  + run dispatch + SSE streaming               │
└──────────────┬───────────────────────────────┘
               │
       ┌───────┴────────┐
       │                │
┌──────▼──────┐  ┌──────▼──────┐
│  Supabase   │  │  Inngest    │
│  Postgres   │  │  Durable    │
│  Auth       │  │  execution  │
│  Storage    │  │  Scheduling │
└─────────────┘  └──────┬──────┘
                        │
                 ┌──────▼──────┐
                 │  OpenAI     │
                 │  Responses  │
                 │  API        │
                 └─────────────┘
```

**Frontend:** Nuxt 4 with Nuxt UI dashboard template

**Backend:** Nitro server routes for API endpoints and orchestration

**Database & auth:** Supabase (Postgres, auth, object storage for artifacts)

**Durable execution:** Inngest (schedules, retries, pause/resume, multi-step workflows)

**AI:** OpenAI Responses API with three model tiers:
- `gpt-5.4` for agent nodes requiring complex reasoning and tool use
- `gpt-5-mini` for simple LLM nodes (summarization, classification, extraction)
- `gpt-5-nano` for high-volume, low-complexity transforms

**Hosting:** Vercel

## Primitives

| Primitive | Description |
|-----------|-------------|
| **Task** | A standing instruction or one-off request. Has a trigger type (manual, scheduled, heartbeat) and status. |
| **Plan** | A generated execution graph for a task. Array of typed nodes with dependency relationships, stored as JSON. |
| **Run** | A concrete execution instance. Walks the plan's nodes, tracks status and outputs, handles pauses and failures. |
| **Node** | A single execution step. Types include agent nodes (ReAct loop), simple LLM calls, and infrastructure nodes. |
| **Artifact** | A document or structured text (markdown, text, JSON, CSV) that flows through the system as inputs and outputs. |
| **Review** | A human checkpoint. Pauses the run, presents context, and resumes on approval/rejection/edit. |
| **Job** | A durable execution unit managed by Inngest. Bridges trigger configuration to actual execution. |

### Node types

**Agent nodes** (ReAct loop with `gpt-5.4`):
`agent_transform`, `agent_code`

**Simple LLM nodes** (single call):
`llm_classify`, `llm_extract`, `llm_summarize`, `llm_transform`

**Infrastructure nodes:**
`retrieve`, `http_fetch`, `branch`, `wait`, `review`, `emit`, `notify`

## Project structure

```
TaskEngine/
├── dashboard/                 # Nuxt 4 application
│   ├── app/
│   │   ├── pages/             # Dashboard views
│   │   ├── components/        # UI components (PlanGraph, NodeDetail, ReviewCard, etc.)
│   │   ├── composables/       # useDashboard, useRunStream (SSE)
│   │   └── utils/             # Status maps, formatting, graph utilities
│   ├── server/
│   │   ├── api/               # REST endpoints for all entities
│   │   ├── inngest/
│   │   │   ├── functions/     # executeRun, heartbeat
│   │   │   └── nodes/         # Node type executors and agent tools
│   │   └── utils/             # Supabase, OpenAI, plan generation, graph utils
│   ├── shared/types/          # TypeScript types for database and task engine
│   └── db_migrations/         # SQL migrations
└── internal_docs/             # Design docs and planning
```

## Setup

### Prerequisites

- Node.js 20+
- A Supabase project (Postgres, auth, storage)
- An Inngest account (or local dev server)
- An OpenAI API key

### Environment

Copy the example env file and fill in your keys:

```bash
cp dashboard/.env.example dashboard/.env
```

### Install and run

```bash
cd dashboard
npm install
npm run dev
```

This starts both the Nuxt dev server on `http://localhost:3000` and the Inngest dev server concurrently.

### Seed data

Hit `POST /api/seed` to populate the database with sample tasks, plans, artifacts, and runs for development.

## Design principles

- General-purpose, not verticalized
- Text-first artifacts for speed and inspectability
- AI-generated plans rather than hand-built DAGs
- Small runtime with strict primitives
- Human review as a first-class concept
- Schedules and long-running jobs are core, not add-ons
- Every run should be inspectable
