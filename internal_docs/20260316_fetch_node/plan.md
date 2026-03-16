# Dynamic Data Loading — Design & Implementation Plan

**Smarter data loading that gets the right context for each run, not just the artifacts the user remembered to pin.**
Last updated: 2026-03-16

> **Status: Completed**

---

## The Problem

Today, a task gets its input data through one of three paths:

1. **Pinned artifacts** — the user selects documents at task creation time, and those IDs are stored on the task forever. Every scheduled run reuses the same stale set.
2. **The `retrieve` node** — can search the artifacts table by title substring or task ID, with a single time filter (`last_7_days`). Limited, brittle, and the plan generator avoids using it because inputs are "handled automatically."
3. **Agent tool calls** — `search_artifacts` and `read_artifact` tools let agent nodes look things up mid-execution, but this is unpredictable and expensive.

None of these handle the real recurring-task use case well: "every Monday, grab last week's field reports and summarize them." The field reports from March 10 are different from the ones on March 17. The task needs to fetch the right data dynamically, not replay the same pinned artifact IDs.

The same gap shows up for tasks that need external data: the latest page from a vendor portal, a JSON payload from an internal API, the current contents of a shared spreadsheet. There's no node that fetches from the outside world as a first-class step in the plan.

### What the current retrieve node actually does

```
1. If input artifacts exist (user-selected or from upstream nodes) → pass them through unchanged
2. Otherwise → query the artifacts table with optional title match and time filter
```

That's it. The query capabilities are: title substring match (`ilike`), task ID scope (`task:`), and a single hardcoded filter (`last_7_days`). No recency sorting with limits, no content search, no cross-task output chaining, no HTTP fetching.

---

## Approach: Upgrade retrieve + Add http_fetch

The original draft combined enhanced artifact queries and HTTP fetching into a single `fetch` node type with a discriminated union config. That approach has problems:

- The config schema becomes a flat bag of 13+ nullable fields where "which fields matter" depends on a discriminator. LLMs produce worse output with union schemas like this compared to focused, small schemas.
- `match`, `limit`, `sort` would be marked required even for HTTP fetches where they're meaningless.
- Every future source type (email, database, storage) adds more nullable fields to the same growing union.
- The codebase ends up with two ways to query artifacts (old `retrieve` with `source`/`filter`, new `fetch` with `fetch_source: 'artifacts'`) and a backward-compat wrapper bridging them.

Instead, this plan takes a simpler approach:

1. **Upgrade `retrieve` in place** with richer query capabilities (`since_last_run`, content search, type filtering, limit/sort). It's the same node, just better. No new node type, no backward compatibility dance, no wrapper delegation.

2. **Add `http_fetch` as a new, separate node type** for pulling external data. Clean config schema with only the fields that matter for HTTP requests.

This keeps schemas focused, makes the plan generator's job easier, and gives each node type a clear single responsibility.

---

## Design Principles

### 1. Data loading should match THIS run, not the first run

The retrieve node's job is answering "what should this run look at?" That answer changes every time. A Monday summary task should see last week's documents. A heartbeat task should see documents created since the last successful run. A competitor analysis should pull the latest pricing page.

### 2. User overrides are the escape hatch, not the default

The system should be smart enough to get the right data automatically on scheduled runs. When the user triggers a manual run, they can override the retrieve selection in the run modal. But if they don't override, the retrieve node's configured query should execute normally. Pinned artifacts on the task record are the fallback when the query returns nothing.

### 3. One node type, one job

Artifact queries and HTTP requests are different operations with different failure modes, security profiles, timeout characteristics, and config shapes. Keeping them as separate node types means focused schemas, clear executor logic, and a natural extension path for future source types.

---

## Enhanced Retrieve Node

Upgrade the existing `retrieve` node with richer query parameters. The current `source` and `filter` fields are replaced with a structured `retrieve_config` object.

### New config shape

| Parameter | Type | Description |
|---|---|---|
| `match` | `string \| null` | Title pattern (substring match, case-insensitive) |
| `task_id` | `string \| null` | Scope to artifacts produced by a specific task |
| `time_window` | `string \| null` | Relative window: `"24h"`, `"7d"`, `"30d"`, `"since_last_run"` |
| `content_search` | `string \| null` | Search within artifact content |
| `types` | `string[] \| null` | Filter by artifact type: `["csv", "json"]` |
| `limit` | `number` | Max results (default 10) |
| `sort` | `"newest" \| "oldest"` | Order by created_at (default `"newest"`) |

The `since_last_run` time window is the key addition for recurring tasks. The executor looks up the task's last completed run timestamp and filters artifacts created after that point. If there's no prior run, it falls back to `7d`.

**Examples of what this enables:**

- "Get the 3 most recent field reports" → `{ match: "field report", limit: 3, sort: "newest" }`
- "Get all CSV uploads since the last run" → `{ types: ["csv"], time_window: "since_last_run" }`
- "Get the latest output from the Weekly Brief task" → `{ task_id: "<id>", limit: 1, sort: "newest" }`

### Backward compatibility

The executor detects which config format is present:

- If `retrieve_config` exists on the node → use the new structured config
- If only `source` and `filter` exist → run the legacy query logic (title match or task ID scope, optional `last_7_days` filter)

Existing plans with old-style retrieve nodes keep working without migration. The plan generator starts producing `retrieve_config` for all new plans.

---

## HTTP Fetch Node

A new `http_fetch` node type that pulls data from an external endpoint and converts it into an artifact that downstream nodes can process.

| Parameter | Type | Description |
|---|---|---|
| `url` | `string` | The URL to fetch |
| `method` | `"GET" \| "POST"` | HTTP method (default `GET`) |
| `headers` | `Record<string, string> \| null` | Custom headers (e.g. `Authorization`) |
| `body` | `string \| null` | Request body for POST requests |
| `response_type` | `"json" \| "text" \| "html_to_text" \| "csv"` | How to interpret the response |
| `artifact_title` | `string \| null` | Title for the resulting artifact (default: derived from URL) |

The executor fetches the URL, converts the response according to `response_type`, and produces a single artifact. For `html_to_text`, it strips tags and extracts readable content. For `json`, it pretty-prints the response. For `csv`, it passes through as-is.

**Security:** HTTP fetch runs server-side in the Inngest function. No CORS issues. Headers can contain API keys stored in the task's `schedule_config` or (eventually) a secrets store. For V1, headers are stored in the plan JSON as-is. The secrets management story is a follow-up.

**Size limits:** Truncate response body to 100KB before processing. For `html_to_text`, extract main content first, then truncate to 50KB. Log a warning in node_run logs if truncation occurred.

**Examples:**

- "Fetch the latest pricing page" → `{ url: "https://competitor.com/pricing", response_type: "html_to_text" }`
- "Pull today's exchange rates" → `{ url: "https://api.exchangerate.host/latest", response_type: "json" }`

---

## Future source types (out of scope for V1)

| Source | Use case | Why it waits |
|---|---|---|
| `email_fetch` | "Get emails from ops@company.com since yesterday" | Needs OAuth integration, IMAP client |
| `db_query` | "Query the orders table for last week's records" | Needs connection pooling, credential management |
| `storage_fetch` | "Get the latest file from the reports/ bucket" | Needs Supabase Storage listing API |

Each future source becomes its own node type with a focused config schema. No union bags, no growing discriminator lists.

---

## How User Override Works

This applies to `retrieve` nodes only. `http_fetch` always runs its configured request (there's nothing to override with user-selected artifacts).

### Manual run — user selects artifacts in the modal

The user clicks "Run now" and picks specific documents. These override the retrieve node's query entirely for root retrieve nodes (nodes with no dependencies). The run's `input_artifact_ids` are populated, and the retrieve node sees them in `context.inputArtifacts`. This is the current behavior and it stays the same.

Non-root retrieve nodes (those with `depends_on` entries) always run their query, because they're fetching supplementary context mid-graph, not replacing the run's primary input.

### Manual run — user doesn't select anything

No override. The retrieve node runs its configured query. If the query returns nothing, the node falls back to the task's saved `input_artifact_ids` (if any). If those are also empty, the node produces zero artifacts and downstream nodes handle the empty input however they're designed to.

### Scheduled / heartbeat run

Always runs the retrieve query. The task's `input_artifact_ids` serve as a secondary fallback if the query returns nothing. This is the whole point: scheduled runs should get fresh data without human intervention.

### Override logic in pseudocode

```
function executeRetrieveNode(node, context):
  isRootNode = node.depends_on is empty
  hasUserOverride = isRootNode AND context.inputArtifacts.length > 0

  if hasUserOverride:
    return context.inputArtifacts  // user selection wins

  results = runRetrieveQuery(node.retrieve_config || legacyConfig(node))

  if results.length > 0:
    return results

  // Fallback: task's pinned artifact IDs
  if isRootNode:
    pinned = loadTaskInputArtifacts(context.taskId)
    if pinned.length > 0:
      return pinned

  return []  // empty input is valid, downstream nodes handle it
```

### What about combining user selection + retrieve?

Not for V1. The mental model is simpler if override means override. If a user selects documents, those are the inputs. If they want dynamic fetching, they leave the selection empty and let the retrieve node work. Composition (user picks some, retrieve adds more) is a V2 enhancement.

---

## Data Model Changes

### New field on PlanNode

```typescript
// Added to the PlanNode interface
retrieve_config: {
  match: string | null
  task_id: string | null
  time_window: string | null
  content_search: string | null
  types: string[] | null
  limit: number
  sort: 'newest' | 'oldest'
} | null

// http_fetch nodes use these fields (all on PlanNode directly)
url: string | null
method: 'GET' | 'POST' | null
headers: Record<string, string> | null
body: string | null
response_type: 'json' | 'text' | 'html_to_text' | 'csv' | null
artifact_title: string | null
```

The existing `source` and `filter` fields on PlanNode remain for backward compatibility with old retrieve configs. New retrieve nodes use `retrieve_config` instead. The executor checks which is present.

### New node type

Add `'http_fetch'` to `PLAN_NODE_TYPES`. The `retrieve` type stays and continues to be actively used (it's being upgraded, not replaced).

### Database changes

The `plan_json` column stores the plan as JSONB, so no schema migration is needed for the new fields. They're just additional keys on the node objects within the JSON.

The `tasks` table gets one new column:

```sql
alter table tasks add column if not exists last_completed_run_at timestamptz;
```

This powers the `since_last_run` time window. Updated by the run executor when a run completes successfully. Cheaper than querying the runs table every time a retrieve node needs to compute the window.

---

## Plan Generator Changes

The structure instructions in `planGenerator.ts` need updates for both the enhanced retrieve and the new http_fetch:

**Updated guidance for the planner:**

```
INFRASTRUCTURE NODES:
- retrieve: dynamically search for artifacts. Use when the task needs fresh data each time 
  it runs. Do NOT use retrieve for loading the user's manually selected input artifacts — 
  those are fed to root nodes automatically. Use retrieve when:
  - The task is recurring and needs "whatever's new since last time"
  - The task needs the latest output from another task
  - The prompt says "latest", "recent", "new", "since last", "current", or "today's"
  For one-off manual tasks where the user will select the input, start with a processing 
  node directly. For recurring tasks, start with a retrieve node.

- http_fetch: pull data from an external URL. Use when the task references a specific 
  website, API endpoint, or external data source. Produces a single artifact from the 
  response.
```

**Retrieve config schema (for the config-filling phase):**

```json
{
  "type": "json_schema",
  "name": "retrieve_config",
  "strict": true,
  "schema": {
    "type": "object",
    "properties": {
      "retrieve_config": {
        "type": "object",
        "properties": {
          "match": { "type": ["string", "null"] },
          "task_id": { "type": ["string", "null"] },
          "time_window": { "type": ["string", "null"] },
          "content_search": { "type": ["string", "null"] },
          "types": {
            "type": ["array", "null"],
            "items": { "type": "string" }
          },
          "limit": { "type": "number" },
          "sort": { "type": "string", "enum": ["newest", "oldest"] }
        },
        "required": ["match", "task_id", "time_window", "content_search", "types", "limit", "sort"],
        "additionalProperties": false
      }
    },
    "required": ["retrieve_config"],
    "additionalProperties": false
  }
}
```

**http_fetch config schema:**

```json
{
  "type": "json_schema",
  "name": "http_fetch_config",
  "strict": true,
  "schema": {
    "type": "object",
    "properties": {
      "url": { "type": "string" },
      "method": { "type": "string", "enum": ["GET", "POST"] },
      "headers": { "type": ["object", "null"] },
      "body": { "type": ["string", "null"] },
      "response_type": { "type": "string", "enum": ["json", "text", "html_to_text", "csv"] },
      "artifact_title": { "type": ["string", "null"] }
    },
    "required": ["url", "method", "response_type", "artifact_title"],
    "additionalProperties": false
  }
}
```

Two focused schemas instead of one union. Every required field is meaningful for its node type.

---

## Implementation Plan

### Phase 1 — Enhanced retrieve executor

**Goal:** The existing `retrieve` node handles richer artifact queries with time windows, content search, type filtering, and limit/sort.

**Files changed:**
- `dashboard/shared/types/task-engine.ts` — add `retrieve_config` field to `PlanNode`, add `RetrieveConfig` type
- `dashboard/server/inngest/nodes/infrastructure.ts` — upgrade `retrieve` executor to handle both old config (`source`/`filter`) and new config (`retrieve_config`)
- `dashboard/server/inngest/nodes/describe.ts` — update `describeRetrieve` for richer descriptions
- `dashboard/db_migrations/007_task_last_completed_run.sql` — NEW, add `last_completed_run_at` to tasks
- `dashboard/shared/types/database.ts` — add `last_completed_run_at` to the tasks type
- `dashboard/server/inngest/functions/executeRun.ts` — update `last_completed_run_at` on task when run completes

**Executor logic:**

```
1. Detect config format:
   - If node.retrieve_config exists → use structured config
   - Else if node.source exists → run legacy logic (unchanged from today)
   - Else → pass through inputArtifacts or return empty
2. Build Supabase query against artifacts table
3. Apply filters: match (ilike on title), task_id (eq), types (in), content_search (ilike on content)
4. Apply time_window:
   - "24h" / "7d" / "30d" → gte on created_at
   - "since_last_run" → look up task.last_completed_run_at, fall back to 7d
5. Apply sort and limit
6. Execute query, map results to RuntimeArtifact[]
7. If zero results and isRootNode, fall back to task's input_artifact_ids
```

### Phase 2 — http_fetch node

**Goal:** A new node type that pulls data from external URLs and produces artifacts.

**Files changed:**
- `dashboard/shared/types/task-engine.ts` — add `'http_fetch'` to `PLAN_NODE_TYPES`, add HTTP-related fields to `PlanNode`
- `dashboard/server/inngest/nodes/httpFetch.ts` — NEW, the http_fetch node executor
- `dashboard/server/inngest/nodes/register.ts` — register the http_fetch executor
- `dashboard/server/inngest/nodes/describe.ts` — add `describeHttpFetch` helper
- `dashboard/server/utils/httpFetch.ts` — NEW, shared HTTP fetching utility with timeout, content extraction, size limits

**Executor logic:**

```
1. Parse node config for url, method, headers, body, response_type
2. Execute HTTP request with 15s timeout
3. Based on response_type:
   - "json" → pretty-print JSON, artifact type = json
   - "csv" → pass through, artifact type = csv
   - "text" → pass through, artifact type = text
   - "html_to_text" → strip tags, extract readable content, artifact type = text
4. Create a single artifact with the result
5. Apply artifact_title or derive from URL hostname + path
```

### Phase 3 — Plan generator integration

**Goal:** The plan generator uses enhanced retrieve configs and knows when to use http_fetch.

**Files changed:**
- `dashboard/server/utils/planGenerator.ts` — update structure instructions, add `http_fetch` to node type enum, update `retrieve` config schema, add `http_fetch` config schema

**Key behavior changes:**
- For prompts mentioning "latest", "recent", "weekly", "daily", scheduled patterns → plan starts with a retrieve node using `retrieve_config`
- For prompts referencing external URLs or APIs → plan includes an http_fetch node
- For manual one-off prompts → plan starts with a processing node (user selects inputs)
- The prompt context now includes the task's trigger_type so the planner can see if it's scheduled

### Phase 4 — UI integration

**Goal:** Both node types are visible and configurable in the dashboard.

**Files changed:**
- `dashboard/app/pages/tasks/[id].vue` — show retrieve config and http_fetch config in node detail panel
- `dashboard/app/pages/runs/[id].vue` — show what each node actually retrieved/fetched
- `dashboard/app/components/NodeDetail.vue` — render config fields for both node types
- `dashboard/app/components/PlanGraph.vue` — http_fetch node gets a distinct icon/color; retrieve keeps its current styling
- `dashboard/app/pages/tasks/new.vue` — when trigger_type is scheduled/heartbeat, hint that a retrieve node may be useful

### Phase 5 — Seed data and testing

**Goal:** The demo dataset exercises both node types in realistic scenarios.

**Files changed:**
- `dashboard/server/api/seed.post.ts` — update 2-3 scheduled tasks to use enhanced retrieve configs (e.g., Equipment Service Check retrieves the latest maintenance log with `since_last_run`), add 1 task with an http_fetch node

---

## Interaction with Existing Systems

### How retrieve/http_fetch compose with the run dispatch flow

The run dispatch flow (`runDispatch.ts`) resolves `input_artifact_ids` for the run and passes them to `executeRun`. Both node types sit inside `executeRun` as regular node executors. Retrieve receives the resolved input artifacts via `context.inputArtifacts` (for root nodes) and can choose to use them or run its own query. http_fetch ignores input artifacts and always runs its configured request.

No changes to `runDispatch.ts` or `heartbeat.ts` are needed.

### How retrieve composes with the RunTaskModal

The RunTaskModal already lets users select input artifacts before a run. This selection populates `run.input_artifact_ids`, which flow into the retrieve node as `context.inputArtifacts`. The override logic described above handles the precedence.

One UI enhancement: when the task's plan starts with a retrieve node that has `retrieve_config`, the RunTaskModal should display a note like "This task is configured to load data automatically. Select documents below to override." This helps users understand why the modal might be empty by default for scheduled tasks.

### How these compose with agent tools

Agent nodes (`agent_transform`, `agent_code`) have `search_artifacts` and `read_artifact` tools for mid-execution lookups. Retrieve and http_fetch handle the structured, predictable data loading at the start of the graph. Agent tools handle the unstructured, exploratory lookups during processing.

They're complementary: retrieve/http_fetch get the known inputs, agent tools find the unknown supplementary context.

---

## What This Plan Does NOT Cover

- **Secrets management** — HTTP headers containing API keys are stored in plan JSON. A proper secrets store with encryption at rest is a separate project.
- **Webhook triggers** — "Run this task when a webhook payload arrives" is related but architecturally different from "fetch data when a run starts."
- **Pagination** — Retrieve queries have a `limit` but no cursor-based pagination. If someone needs 500 artifacts, they need a different approach.
- **Streaming responses** — HTTP fetch reads the entire response into memory. Streaming large responses into chunked artifacts is future work.
- **Authentication flows** — OAuth token refresh, cookie-based auth, mTLS. V1 supports static headers only.
- **Content diffing** — "Only process documents that changed since last run" requires comparing content hashes, not just timestamps.

---

## Summary

| Phase | Focus | Key change |
|---|---|---|
| 1 | Enhanced retrieve | Richer artifact queries, `since_last_run` window, backward compatible with existing plans |
| 2 | http_fetch node | New node type for external URLs, focused config schema |
| 3 | Plan generator | Planner uses enhanced retrieve configs and knows when to use http_fetch |
| 4 | UI integration | Both node types visible in task detail, run inspector shows what was loaded |
| 5 | Seed data | Demo tasks exercise both node types in realistic scenarios |

The highest-value addition is Phase 1 alone: the `since_last_run` time window and richer artifact queries make recurring tasks actually work without manual intervention. Phase 2 opens the door to external data. Phases 3-5 are integration and polish.
