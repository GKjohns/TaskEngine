# Fetch Node — Design & Implementation Plan

**A smarter data-loading node that gets the right context for each run, not just the artifacts the user remembered to pin.**
Last updated: 2026-03-16

> **Status: Planning**

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

## Design Principles

### 1. Fetch is about getting the right data for THIS run

The fetch node's job is answering "what should this run look at?" That answer changes every time. A Monday summary task should see last week's documents. A heartbeat task should see documents created since the last successful run. A competitor analysis should pull the latest pricing page.

### 2. User overrides are the escape hatch, not the default

The system should be smart enough to get the right data automatically on scheduled runs. When the user triggers a manual run, they can override the fetch selection in the run modal. But if they don't override, the fetch node's configured query should execute normally. Pinned artifacts on the task record are the fallback when the query returns nothing.

### 3. Start with artifacts and HTTP, design for extensions

V1 handles two source types: enhanced artifact queries and HTTP fetches. The architecture should make it straightforward to add database queries, email ingestion, and file system watchers later without redesigning the node.

### 4. Backward compatible with retrieve

Existing plans with `retrieve` nodes keep working. The `retrieve` executor becomes a thin wrapper that delegates to the new `fetch` logic. The plan generator starts using `fetch` for new plans.

---

## Source Types

### `artifacts` — Query the document library

Enhanced version of what `retrieve` does today. Supports:

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

### `http` — Fetch from a URL

Pulls data from an external endpoint and converts it into an artifact that downstream nodes can process.

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

**Examples:**

- "Fetch the latest pricing page" → `{ url: "https://competitor.com/pricing", response_type: "html_to_text" }`
- "Pull today's exchange rates" → `{ url: "https://api.exchangerate.host/latest", response_type: "json" }`

### Future source types (out of scope for V1)

| Source | Use case | Why it waits |
|---|---|---|
| `email` | "Get emails from ops@company.com since yesterday" | Needs OAuth integration, IMAP client |
| `database` | "Query the orders table for last week's records" | Needs connection pooling, credential management |
| `storage` | "Get the latest file from the reports/ bucket" | Needs Supabase Storage listing API |
| `webhook` | "Use the payload that triggered this run" | Needs webhook ingestion infrastructure |

The `fetch_config` JSON structure is open-ended enough that adding these later means adding a new `source` value and a new executor branch, not redesigning the node.

---

## How User Override Works

This is the trickiest part. Three contexts, three behaviors:

### Manual run — user selects artifacts in the modal

The user clicks "Run now" and picks specific documents. These override the fetch node's query entirely for root fetch nodes (nodes with no dependencies). The run's `input_artifact_ids` are populated, and the fetch node sees them in `context.inputArtifacts`. This is the current retrieve behavior and it stays the same.

Non-root fetch nodes (those with `depends_on` entries) always run their query, because they're fetching supplementary context mid-graph, not replacing the run's primary input.

### Manual run — user doesn't select anything

No override. The fetch node runs its configured query. If the query returns nothing, the node falls back to the task's saved `input_artifact_ids` (if any). If those are also empty, the node produces zero artifacts and downstream nodes handle the empty input however they're designed to.

### Scheduled / heartbeat run

Always runs the fetch query. The task's `input_artifact_ids` serve as a secondary fallback if the query returns nothing. This is the whole point: scheduled runs should get fresh data without human intervention.

### Override logic in pseudocode

```
function executeFetchNode(node, context):
  isRootNode = node.depends_on is empty
  hasUserOverride = isRootNode AND context.inputArtifacts.length > 0

  if hasUserOverride:
    return context.inputArtifacts  // user selection wins

  results = runFetchQuery(node.fetch_config)

  if results.length > 0:
    return results

  // Fallback: task's pinned artifact IDs
  if isRootNode:
    pinned = loadTaskInputArtifacts(context.taskId)
    if pinned.length > 0:
      return pinned

  return []  // empty input is valid, downstream nodes handle it
```

### What about combining user selection + fetch?

Not for V1. The mental model is simpler if override means override. If a user selects documents, those are the inputs. If they want dynamic fetching, they leave the selection empty and let the fetch node work. Composition (user picks some, fetch adds more) is a V2 enhancement.

---

## Data Model Changes

### New fields on PlanNode

```typescript
// Added to the PlanNode interface
fetch_source: 'artifacts' | 'http' | null
fetch_config: Record<string, unknown> | null
```

The `fetch_source` discriminator tells the executor which source type to use. The `fetch_config` holds source-specific parameters as a JSON object. This keeps the PlanNode interface flat (consistent with how other node-specific fields work) while supporting arbitrary source configs.

The existing `source` and `filter` fields on PlanNode remain for backward compatibility with `retrieve` nodes. New `fetch` nodes use `fetch_source` and `fetch_config` instead.

### New node type

Add `'fetch'` to `PLAN_NODE_TYPES`. The `retrieve` type stays in the list for backward compatibility but the plan generator stops producing it.

### Database changes

The `plan_json` column stores the plan as JSONB, so no schema migration is needed for the new fields. They're just additional keys on the node objects within the JSON.

The `tasks` table gets one new column:

```sql
alter table tasks add column if not exists last_completed_run_at timestamptz;
```

This powers the `since_last_run` time window. Updated by the run executor when a run completes successfully. Cheaper than querying the runs table every time a fetch node needs to compute the window.

---

## Plan Generator Changes

The structure instructions in `planGenerator.ts` need to be updated to teach the model about `fetch`:

**New guidance for the planner:**

```
FETCH NODES:
- fetch: load context dynamically at the start of a run. Use when the task needs fresh data 
  each time it runs (e.g., "latest reports", "documents since last run", "data from a URL").
  
  Do NOT use fetch for loading the user's manually selected input artifacts — those are fed 
  to root nodes automatically. Use fetch when:
  - The task is recurring and needs "whatever's new since last time"
  - The task references a specific external URL or API
  - The task needs the latest output from another task
  - The prompt says "latest", "recent", "new", "since last", "current", or "today's"
  
  For one-off manual tasks where the user will select the input, start with a processing 
  node directly. For recurring tasks, start with a fetch node.
```

The node config schema for `fetch`:

```json
{
  "type": "json_schema",
  "name": "fetch_config",
  "strict": true,
  "schema": {
    "type": "object",
    "properties": {
      "fetch_source": { "type": "string", "enum": ["artifacts", "http"] },
      "fetch_config": {
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
          "sort": { "type": "string", "enum": ["newest", "oldest"] },
          "url": { "type": ["string", "null"] },
          "method": { "type": ["string", "null"] },
          "headers": { "type": ["object", "null"] },
          "body": { "type": ["string", "null"] },
          "response_type": { "type": ["string", "null"] },
          "artifact_title": { "type": ["string", "null"] }
        },
        "required": ["match", "limit", "sort"],
        "additionalProperties": false
      }
    },
    "required": ["fetch_source", "fetch_config"],
    "additionalProperties": false
  }
}
```

---

## Implementation Plan

### Phase 1 — Core fetch node executor

**Goal:** A working `fetch` node type that handles artifact queries with the enhanced filter set.

**Files changed:**
- `dashboard/shared/types/task-engine.ts` — add `'fetch'` to `PLAN_NODE_TYPES`, add `fetch_source` and `fetch_config` fields to `PlanNode`
- `dashboard/server/inngest/nodes/fetch.ts` — NEW, the fetch node executor
- `dashboard/server/inngest/nodes/register.ts` — register the fetch executor
- `dashboard/server/inngest/nodes/describe.ts` — add `describeFetch` helper
- `dashboard/server/inngest/nodes/infrastructure.ts` — update `retrieve` to delegate to fetch logic for backward compatibility
- `dashboard/db_migrations/007_task_last_completed_run.sql` — NEW, add `last_completed_run_at` to tasks
- `dashboard/shared/types/database.ts` — add `last_completed_run_at` to the tasks type
- `dashboard/server/inngest/functions/executeRun.ts` — update `last_completed_run_at` on task when run completes

**Executor logic for `artifacts` source:**

```
1. Parse fetch_config
2. Build Supabase query against artifacts table
3. Apply filters: match (ilike on title), task_id (eq), types (in), content_search (ilike on content)
4. Apply time_window:
   - "24h" / "7d" / "30d" → gte on created_at
   - "since_last_run" → look up task.last_completed_run_at, fall back to 7d
5. Apply sort and limit
6. Execute query, map results to RuntimeArtifact[]
7. If zero results and isRootNode, fall back to task's input_artifact_ids
```

### Phase 2 — HTTP source

**Goal:** Fetch nodes can pull data from external URLs.

**Files changed:**
- `dashboard/server/inngest/nodes/fetch.ts` — add HTTP source branch
- `dashboard/server/utils/httpFetch.ts` — NEW, shared HTTP fetching utility with timeout, content extraction, size limits

**Executor logic for `http` source:**

```
1. Parse fetch_config for url, method, headers, body, response_type
2. Execute HTTP request with 15s timeout
3. Based on response_type:
   - "json" → pretty-print JSON, artifact type = json
   - "csv" → pass through, artifact type = csv
   - "text" → pass through, artifact type = text
   - "html_to_text" → strip tags, extract readable content, artifact type = text
4. Create a single artifact with the result
5. Apply artifact_title or derive from URL hostname + path
```

**Size limits:** Truncate response body to 100KB before processing. For `html_to_text`, extract main content first, then truncate to 50KB. Log a warning in node_run logs if truncation occurred.

### Phase 3 — Plan generator integration

**Goal:** The plan generator knows when to use `fetch` nodes and produces correct configs.

**Files changed:**
- `dashboard/server/utils/planGenerator.ts` — update structure instructions, add fetch to node type enum, add fetch config schema

**Key behavior changes:**
- For prompts mentioning "latest", "recent", "weekly", "daily", scheduled patterns → plan starts with a fetch node
- For manual one-off prompts → plan starts with a processing node (user selects inputs)
- The prompt context now includes the task's trigger_type so the planner can see if it's scheduled

### Phase 4 — UI integration

**Goal:** The fetch node is visible and configurable in the dashboard.

**Files changed:**
- `dashboard/app/pages/tasks/[id].vue` — show fetch config in node detail panel
- `dashboard/app/pages/runs/[id].vue` — show what the fetch node actually retrieved
- `dashboard/app/components/NodeDetail.vue` — render fetch config fields
- `dashboard/app/components/PlanGraph.vue` — fetch node gets a distinct icon/color
- `dashboard/app/pages/tasks/new.vue` — when trigger_type is scheduled/heartbeat, suggest that a fetch node may be needed

### Phase 5 — Seed data and testing

**Goal:** The demo dataset exercises fetch nodes in realistic scenarios.

**Files changed:**
- `dashboard/server/api/seed.post.ts` — update 2-3 scheduled tasks to use fetch nodes in their plans (e.g., Equipment Service Check fetches the latest maintenance log, Green Bean Low Stock Alert fetches the latest inventory)

---

## Interaction with Existing Systems

### How fetch composes with the run dispatch flow

The run dispatch flow (`runDispatch.ts`) resolves `input_artifact_ids` for the run and passes them to `executeRun`. The fetch node sits inside `executeRun` as a regular node executor. It receives the resolved input artifacts via `context.inputArtifacts` (for root nodes) and can choose to use them or run its own query.

No changes to `runDispatch.ts` or `heartbeat.ts` are needed. The fetch node's dynamic behavior is entirely within the node executor.

### How fetch composes with the RunTaskModal

The RunTaskModal already lets users select input artifacts before a run. This selection populates `run.input_artifact_ids`, which flow into the fetch node as `context.inputArtifacts`. The override logic described above handles the precedence.

One UI enhancement: when the task's plan starts with a fetch node, the RunTaskModal should display a note like "This task is configured to fetch data automatically. Select documents below to override the automatic fetch." This helps users understand why the modal might be empty by default for scheduled tasks.

### How fetch composes with the agent tools

Agent nodes (`agent_transform`, `agent_code`) have `search_artifacts` and `read_artifact` tools for mid-execution lookups. The fetch node handles the structured, predictable data loading at the start of the graph. Agent tools handle the unstructured, exploratory lookups during processing.

They're complementary: fetch gets the known inputs, agent tools find the unknown supplementary context.

---

## What This Plan Does NOT Cover

- **Secrets management** — HTTP headers containing API keys are stored in plan JSON. A proper secrets store with encryption at rest is a separate project.
- **Webhook triggers** — "Run this task when a webhook payload arrives" is related but architecturally different from "fetch data when a run starts."
- **Pagination** — Fetch queries have a `limit` but no cursor-based pagination. If someone needs 500 artifacts, they need a different approach.
- **Streaming responses** — HTTP fetch reads the entire response into memory. Streaming large responses into chunked artifacts is future work.
- **Authentication flows** — OAuth token refresh, cookie-based auth, mTLS. V1 supports static headers only.
- **Content diffing** — "Only process documents that changed since last run" requires comparing content hashes, not just timestamps.

---

## Summary

| Phase | Focus | Key change |
|---|---|---|
| 1 | Core executor | New `fetch` node type with enhanced artifact queries, `since_last_run` window |
| 2 | HTTP source | Fetch data from external URLs, convert to artifacts |
| 3 | Plan generator | Planner knows when and how to use fetch nodes |
| 4 | UI integration | Fetch config visible in task detail, run inspector shows what was fetched |
| 5 | Seed data | Demo tasks exercise fetch nodes in realistic scenarios |

The highest-value addition is Phase 1 alone: the `since_last_run` time window and richer artifact queries make recurring tasks actually work without manual intervention. Phase 2 opens the door to external data. Phases 3-5 are integration and polish.
