# Task Engine

A bare-bones, general-purpose agentic workspace for text-native work.

The system lets a user create a task in natural language, generate an execution plan, run it over artifacts, pause for review or waiting states, and resume later. It supports one-off requests, recurring jobs, and ambient periodic checks.

This is not a polished end-user product. It is a proof of concept designed to get the core runtime and agent logic into the right shape — and to ship as a working thing on the internet.

## Core idea

Task Engine is a small runtime for artifact-based work graphs.

A user gives the system a goal like:

> Review these documents every Monday morning, summarize key changes, and draft a brief for my review.

The system then creates a task, generates a plan, executes the plan as a graph of nodes, reads and writes artifacts, pauses for review or wait states, and resumes later via jobs, schedules, or user action.

The value is in the runtime logic, not in a flashy UI.

## Product principles

- General-purpose, not verticalized
- Text-first artifacts for speed and inspectability
- AI-generated plans rather than hand-built DAGs
- Small runtime with strict primitives
- Human review as a first-class concept
- Schedules and long-running jobs are core, not add-ons
- Every run should be inspectable

## Tech stack

**Frontend:** Nuxt 4, Nuxt UI, Nuxt UI Dashboard template

**Backend:** Nuxt server routes / Nitro for API endpoints and orchestration entry points

**Database & auth:** Supabase (Postgres, auth, object storage for artifacts)

**Jobs & durable execution:** Inngest (schedules, retries, pause/resume, multi-step workflows)

**Hosting:** Vercel

**AI:** OpenAI Responses API. Three model tiers matched to node complexity:

- **`gpt-5.4`** — flagship model for agent nodes that require complex reasoning, multi-step tool use, and judgment (analysis, research, memo drafting, plan generation).
- **`gpt-5-mini`** — for simple LLM nodes that need decent quality at lower cost (summarization, classification, extraction).
- **`gpt-5-nano`** — for high-volume, low-complexity nodes where speed and cost matter most (tagging, formatting, short transforms).

Two execution modes depending on the node:

- **ReAct agent nodes** for complex, multi-step reasoning (analysis, research, memo drafting, code generation). These use `gpt-5.4` with function calling and `previous_response_id` for multi-turn state. The model reasons, calls tools, and iterates.
- **Simple LLM call nodes** for straightforward transforms (sentiment classification, entity extraction, summarization, formatting). Single prompt in, structured output out via `text.format` with JSON schema. No agent loop needed.

The plan generator decides which mode each node uses based on the complexity of the step.

## MVP primitives

### Task

A standing instruction or one-off request. The user's intent expressed in natural language.

Examples: summarize this folder every morning; watch this source and flag important changes; analyze these files and draft a memo.

A task has a trigger type (manual, scheduled, heartbeat) and a status (active, paused, archived).

### Plan

A generated execution plan for a task. The system sends the task prompt to `gpt-5.4` via the Responses API and produces a graph of node steps with dependency relationships. Users don't manually build the graph — they describe what they want and the system figures out the steps.

The plan is stored as JSON. Each plan is versioned so the system can re-plan if the task prompt changes.

### Job

A durable execution unit managed over time by Inngest. A job is the bridge between a task's trigger configuration and actual execution.

Jobs may be one-off, scheduled (cron), heartbeat-triggered (periodic wake-up that checks whether work should happen), or resumed after review or external state changes.

### Run

A concrete execution instance. When a job fires, it creates a run. A run walks through the plan's nodes, tracking status, logs, node outputs, timestamps, and artifact references.

Run statuses: pending, running, waiting_review, completed, failed, cancelled.

### Node

A single unit of execution within a plan. Each node has a type that determines how it executes.

**Agent nodes (ReAct loop):**

- `agent_transform` — complex reasoning, analysis, drafting. `gpt-5.4` gets tools and iterates until done. This is the workhorse node for anything that requires judgment.
- `agent_code` — generates and executes Python in a sandboxed environment. Used for data processing, CSV/JSON manipulation, calculations.

**Simple LLM nodes (single call):**

- `llm_classify` — classification, tagging, sentiment. Prompt in, label out.
- `llm_extract` — entity extraction, structured data extraction. Prompt in, JSON out.
- `llm_summarize` — summarization, compression. Text in, shorter text out.
- `llm_transform` — rewriting, formatting, translation. Text in, text out.

**Infrastructure nodes:**

- `retrieve` — fetch artifacts from storage by reference or query.
- `branch` — conditional routing based on a previous node's output.
- `wait` — pause execution for a duration or until a condition.
- `review` — pause execution and request human review.
- `emit` — write an artifact to storage.
- `notify` — log a message or send a notification.

### Artifact

A document or structured text object that flows through the system. Artifacts are the inputs and outputs of nodes.

Supported formats: markdown, plain text, JSON, CSV.

Each artifact has a type, title, content body, metadata JSON, and a reference to the run that created it. Artifacts stored in Supabase — small ones as text in the database, larger ones in Supabase Storage with a storage_path reference.

### Review

An explicit human checkpoint. A node can request review, which pauses the run. The user sees the review in a focused inbox, can approve, reject, edit, or reroute.

Reviews reference both the run and the specific node that requested them. Once resolved, the run resumes from where it paused.

## Triggers

**Manual:** User creates or kicks off a task through the app.

**Scheduled:** Cron expression. Inngest fires the job on schedule.

**Heartbeat:** A periodic wake-up (e.g., every 30 minutes) that runs a lightweight check — has anything changed? If yes, kick off a full run. If no, go back to sleep. This is how "watch this source and flag changes" works without polling at the application layer.

**Resume:** A paused run continues after a review is resolved or an awaited condition is met. Inngest handles the durable wait.

## Plan generation

When a task is created (or re-planned), the system sends the task prompt to `gpt-5.4` via the Responses API with `instructions` describing the available node types and asking for a plan. The response uses `text.format` with a JSON schema to guarantee valid plan output.

The plan response is a JSON structure: an array of nodes that form a directed acyclic graph via `depends_on` references. Each node has an id, type, type-specific fields, and dependencies. There is no freeform config object. Every field on every node is strictly typed. The planner decides whether a node should be an agent node or a simple LLM call based on the complexity described in the task.

Example plan for "Summarize the weekly reports folder and draft a brief for review":

```json
{
  "nodes": [
    {
      "id": "fetch_reports",
      "type": "retrieve",
      "description": "Fetch the latest weekly reports",
      "per_artifact": false,
      "depends_on": [],
      "source": "folder:weekly-reports",
      "filter": "last_7_days"
    },
    {
      "id": "summarize_each",
      "type": "llm_summarize",
      "description": "Summarize each report individually",
      "per_artifact": true,
      "depends_on": ["fetch_reports"],
      "prompt": "Summarize the key points of this report in 3-5 bullets.",
      "max_length": 500
    },
    {
      "id": "draft_brief",
      "type": "agent_transform",
      "description": "Draft a weekly brief from the summaries",
      "per_artifact": false,
      "depends_on": ["summarize_each"],
      "prompt": "Given these summaries, draft a concise weekly brief highlighting the most important developments, risks, and action items."
    },
    {
      "id": "review_brief",
      "type": "review",
      "description": "Human review before finalizing",
      "per_artifact": false,
      "depends_on": ["draft_brief"],
      "message": "Please review the weekly brief before it's finalized."
    },
    {
      "id": "save_brief",
      "type": "emit",
      "description": "Save the final brief as an artifact",
      "per_artifact": false,
      "depends_on": ["review_brief"],
      "title": "Weekly Brief — {{date}}",
      "format": "markdown"
    }
  ]
}
```

The planner doesn't need to be perfect. The user can inspect the plan before it runs, and the system can re-plan.

## Agent node execution

Agent nodes use a ReAct-style loop powered by `gpt-5.4` via the Responses API. The node executor:

1. Builds `instructions` with the node's context: task description, input artifacts, available tools.
2. Sends the initial `input` to the Responses API with function tools defined.
3. The model reasons (with `reasoning.effort: "high"`) and optionally calls tools (read artifact, write artifact, run Python, search, etc.).
4. The executor processes tool calls and returns results via `previous_response_id` for multi-turn state.
5. Loop continues until the model produces a final output or hits a step limit.

Tools available to agent nodes:

- `read_artifact(id)` — read an artifact's content
- `write_artifact(title, content, format)` — create a new artifact
- `run_python(code)` — execute Python in a sandboxed environment and return stdout/stderr
- `search_artifacts(query)` — search artifact titles and content

Simple LLM nodes skip the loop entirely. They build `instructions` and `input` from the node's typed fields (prompt, labels, etc.) and input artifacts, make a single Responses API call with `gpt-5-mini` (or `gpt-5-nano` for high-volume tasks), and parse the response. Structured output nodes use `text.format` with a JSON schema to get typed results directly.

## Execution model

1. User creates a task with a natural language prompt and trigger config.
2. System stores the task in Supabase.
3. System calls the OpenAI Responses API (`gpt-5.4`) to generate a plan.
4. Plan is saved to Supabase, linked to the task.
5. A job is created in Inngest based on the trigger type.
6. When the job fires, it creates a run record and begins executing nodes.
7. Inngest walks the plan graph, executing each node as an Inngest step. This gives per-node retries and durable state.
8. Each node reads input artifacts from previous nodes and writes outputs.
9. If a node is a `review` node, the run pauses. Inngest uses `step.waitForEvent()` to durably wait for a resume signal.
10. User resolves the review in the app. The app sends an event to Inngest.
11. The run resumes from the review node.
12. On completion, all outputs are stored and the run is marked complete.
13. Everything is inspectable: the plan, each node's inputs/outputs/logs, the final artifacts.

## Data model

### tasks

- `id` uuid primary key
- `title` text
- `prompt` text (the user's natural language instruction)
- `trigger_type` enum: manual, scheduled, heartbeat
- `schedule_config` jsonb (cron expression, heartbeat interval, etc.)
- `status` enum: active, paused, archived
- `created_by` uuid references auth.users
- `created_at` timestamptz
- `updated_at` timestamptz

### plans

- `id` uuid primary key
- `task_id` uuid references tasks
- `plan_json` jsonb (the node graph)
- `version` integer
- `created_at` timestamptz

### jobs

- `id` uuid primary key
- `task_id` uuid references tasks
- `inngest_function_id` text
- `job_type` enum: one_off, scheduled, heartbeat
- `status` enum: active, paused, completed
- `next_run_at` timestamptz
- `last_run_at` timestamptz

### runs

- `id` uuid primary key
- `task_id` uuid references tasks
- `plan_id` uuid references plans
- `job_id` uuid references jobs
- `status` enum: pending, running, waiting_review, completed, failed, cancelled
- `started_at` timestamptz
- `completed_at` timestamptz
- `error_message` text

### node_runs

- `id` uuid primary key
- `run_id` uuid references runs
- `node_key` text (matches the node id in the plan)
- `node_type` text
- `status` enum: pending, running, waiting_review, completed, failed, skipped
- `input_refs` jsonb (artifact ids or previous node_run ids)
- `output_refs` jsonb (artifact ids produced)
- `logs` jsonb (execution logs, token counts, tool calls)
- `started_at` timestamptz
- `completed_at` timestamptz

### artifacts

- `id` uuid primary key
- `type` enum: markdown, text, json, csv
- `title` text
- `content` text (for small artifacts)
- `metadata_json` jsonb
- `storage_path` text (for large artifacts in Supabase Storage)
- `created_by_run_id` uuid references runs
- `created_by_node_id` uuid references node_runs
- `created_at` timestamptz

### reviews

- `id` uuid primary key
- `run_id` uuid references runs
- `node_run_id` uuid references node_runs
- `status` enum: pending, approved, rejected, edited
- `reviewer_id` uuid references auth.users
- `comments` text
- `created_at` timestamptz
- `resolved_at` timestamptz

## MVP views

### Tasks

A list of tasks and recurring automations. Shows title, trigger type, status, next run, last run. User can create a task in natural language, inspect the generated plan, and manually trigger a run.

### Runs

The run inspector. The most important surface for trust and debugging. Shows current run status, the generated plan as a visual graph, node-by-node execution with expand-to-see-details, logs, artifacts in/out, waiting states, errors, and review checkpoints.

### Artifacts

A browser for artifacts used and produced by the system. Shows artifact type, content preview, metadata, which run created it, and version history where applicable.

### Reviews

A focused inbox for human intervention. Shows runs waiting for approval, the context of what's being reviewed (the node output, the task description), and actions: approve, reject, edit, or reroute.

### Jobs

A simple view for long-running and scheduled execution. Shows cron or heartbeat config, active jobs, queued/running/completed states, retry history, and next scheduled execution.

## Inngest function structure

The main Inngest function for executing a run:

```
inngest.createFunction(
  { id: "execute-run" },
  { event: "task-engine/run.start" },
  async ({ event, step }) => {

    // Get the plan
    const plan = await step.run("load-plan", () => loadPlan(event.data.planId));

    // Topological sort of nodes
    const sorted = topoSort(plan.nodes);

    // Execute each node as a durable step
    for (const node of sorted) {
      const result = await step.run(`node-${node.id}`, () => executeNode(node, ...));

      // If this node requires review, wait for it
      if (node.type === "review") {
        const reviewEvent = await step.waitForEvent(
          `review-${node.id}`,
          { event: "task-engine/review.resolved", timeout: "7d" }
        );
      }
    }
  }
);
```

Scheduled tasks use `inngest.createFunction` with a `cron` trigger. Heartbeat tasks use a cron that runs the lightweight check function, which conditionally sends a `run.start` event.

## Project structure

```
task-engine/
├── app/
│   ├── pages/
│   │   ├── index.vue              # Dashboard / task list
│   │   ├── tasks/
│   │   │   ├── index.vue          # All tasks
│   │   │   ├── [id].vue           # Task detail + plan view
│   │   │   └── new.vue            # Create task
│   │   ├── runs/
│   │   │   ├── index.vue          # All runs
│   │   │   └── [id].vue           # Run inspector
│   │   ├── artifacts/
│   │   │   ├── index.vue          # Artifact browser
│   │   │   └── [id].vue           # Artifact viewer
│   │   ├── reviews/
│   │   │   └── index.vue          # Review inbox
│   │   └── jobs/
│   │       └── index.vue          # Job manager
│   ├── components/
│   │   ├── PlanGraph.vue          # Visual plan/node graph
│   │   ├── NodeDetail.vue         # Node execution detail
│   │   ├── ArtifactPreview.vue    # Inline artifact viewer
│   │   └── ReviewCard.vue         # Review action card
│   └── layouts/
│       └── dashboard.vue          # Nuxt UI Dashboard layout
├── server/
│   ├── api/
│   │   ├── tasks/                 # CRUD for tasks
│   │   ├── runs/                  # Run management
│   │   ├── artifacts/             # Artifact CRUD
│   │   ├── reviews/               # Review actions
│   │   └── plans/                 # Plan generation
│   ├── inngest/
│   │   ├── client.ts              # Inngest client
│   │   ├── functions/
│   │   │   ├── executeRun.ts      # Main run executor
│   │   │   ├── heartbeat.ts       # Heartbeat check function
│   │   │   └── scheduled.ts       # Scheduled task triggers
│   │   └── nodes/
│   │       ├── agentTransform.ts  # ReAct agent executor
│   │       ├── agentCode.ts       # Code generation + sandbox
│   │       ├── llmClassify.ts     # Simple classification
│   │       ├── llmExtract.ts      # Structured extraction
│   │       ├── llmSummarize.ts    # Summarization
│   │       ├── llmTransform.ts    # Text transform
│   │       ├── retrieve.ts        # Artifact retrieval
│   │       ├── branch.ts          # Conditional routing
│   │       ├── review.ts          # Human review pause
│   │       ├── emit.ts            # Artifact output
│   │       └── notify.ts          # Logging / notification
│   └── utils/
│       ├── supabase.ts            # Supabase client
│       ├── openai.ts              # OpenAI Responses API client
│       ├── planGenerator.ts       # Task → plan via gpt-5.4
│       └── graphUtils.ts          # Topo sort, dependency resolution
├── supabase/
│   └── migrations/                # SQL migrations for the data model
├── nuxt.config.ts
├── package.json
└── .env
```

## Scope boundaries

### In scope

- Natural-language task creation
- AI-generated plans (OpenAI as planner)
- ReAct agent nodes for complex work
- Simple LLM nodes for straightforward transforms
- Text-first artifacts (markdown, text, JSON, CSV)
- One-off and scheduled jobs via Inngest
- Heartbeat-style periodic jobs
- Run inspection with full node-level detail
- Review inbox with approve/reject/edit
- Generated Python execution in a constrained environment
- Single-user auth via Supabase

### Out of scope

- Multi-user collaboration
- Office document editing
- Rich connector ecosystem (API integrations, webhooks)
- Complex permissions model
- Chat interface or conversational UI
- Advanced agent personas or memory
- Enterprise hardening
- Mobile optimization

## Success criteria

The MVP is successful if it can reliably demonstrate these loops:

1. Summarize a folder of artifacts every morning (scheduled + LLM summarize + emit)
2. Watch a source on a heartbeat and flag changes (heartbeat + retrieve + agent analysis + notify)
3. Generate a memo from a set of files (manual + retrieve + agent transform + emit)
4. Pause for human review, then resume (any trigger + review node + Inngest waitForEvent + resume)
5. Run generated Python over CSV or JSON artifacts and emit a new artifact (agent code node + sandbox + emit)

If those loops feel coherent, inspectable, and easy to iterate on, the system is in the right shape.

## Design goal

Task Engine should feel like a tiny operating system for text work.

Not a chatbot. Not a workflow builder for power users. Not a fake agent demo.

A small set of primitives that support dynamic AI planning, durable execution, human review, schedules and jobs, and inspectable artifact flows.