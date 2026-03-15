# Entity Descriptions

**Date:** 2026-03-15
**Status:** Implemented, pending migration

## Problem

Every screen in the Task Engine dashboard shows structural metadata about entities: status badges, timestamps, UUIDs, node types, plan versions. But it doesn't show what things *are* or what they *did*. Reading the runs list, you see "completed, 12s ago, Plan v2" but have no idea what actually happened. Looking at an artifact, you see "sales_data.csv, csv, Stored artifact" with no context about what it contains or why it was created.

This forces users to click through to detail views and mentally reconstruct meaning from raw data, tool call logs, and content previews.

## Solution

Add short, natural-language descriptions to three core entities:

- **`node_runs.description`** - What this node execution accomplished
- **`runs.description`** - What the overall run produced (or why it failed)
- **`artifacts.description`** - What this artifact contains and why it exists

Descriptions are generated during execution, not retroactively. The key principle is **piggyback on existing LLM calls** rather than making new ones. Each node executor already has full context about what it's doing and what it produced.

## How descriptions are generated

### LLM nodes (llm.ts)

Descriptions are derived programmatically from the structured output the LLM already produces. No extra LLM call needed.

- **llm_classify**: Parses the JSON output and produces `"Input classified as 'infra' (92% confidence)"`. If the node processes multiple artifacts, they're combined into a summary.
- **llm_extract**: Reads the items array and summary from the JSON output. Produces `"Extracted 5 items from 'Sprint 3 notes'"` or uses the extraction's own summary field.
- **llm_summarize**: Takes the first sentence of the markdown output.
- **llm_transform**: Takes the first sentence of the markdown output.

### Agent nodes (agentTransform.ts, agentCode.ts)

The agent's final output text typically begins with a natural-language summary of what it accomplished. The description is extracted as the first sentence of that output. For per-artifact execution, individual artifact descriptions are combined into a node-level summary.

### Infrastructure nodes (infrastructure.ts)

Descriptions are generated from the execution logs with simple templates:

- **retrieve**: `"Retrieved 5 artifacts matching 'sprint notes'"`
- **emit**: `"Emitted 'Risk Summary' as markdown"`
- **review**: `"Awaiting review: Verify the risk summary before sending notification"`
- **branch**: `"Evaluated 'has_input', selected 'process_data' branch"`
- **wait**: `"Waiting 30m"`
- **notify**: `"Notification: Risk summary is ready for review"`

### Run-level descriptions (executeRun.ts)

This is the one place an extra LLM call is made. After all nodes complete, the system:

1. Collects descriptions from all completed node runs
2. Sends them to `gpt-5-nano` with a "summarize the outcome in 1-2 sentences" instruction
3. Writes the result to `runs.description`

This call is wrapped in a try/catch so a failure here never blocks a successful run. Cost is negligible (10-20 output tokens from the cheapest model).

For failed runs, the description is generated programmatically: `"Run failed: API rate limit exceeded. Completed 2 step(s) before failure: extract_risks: Extracted 5 risk items; classify_risks: Classified items into 3 categories."` This gives immediate context about how far the run got and what went wrong.

### Artifacts

Each `RuntimeArtifact` carries an optional `description` field set by the producing executor. It's persisted alongside the artifact in `persistArtifacts.ts`. The description comes from the same logic that generates the node description, applied per-artifact.

## Database changes

Migration `004_entity_descriptions.sql` adds a nullable `description text` column to `runs`, `node_runs`, and `artifacts`. All three are nullable because existing rows won't have descriptions, and some execution paths (skipped nodes, error states) may not produce one.

## UI changes

Descriptions appear in the following locations:

- **Runs list** (`pages/runs/index.vue`): Description shown below the task title, above the metadata line (time, plan version, duration).
- **Run detail** (`pages/runs/[id].vue`): Description shown in the "Run summary" card, between the heading and the timestamps.
- **Node detail** (`components/NodeDetail.vue`): Runtime description shown if available, falling back to the plan-level description. Runtime descriptions reflect what actually happened vs. what the plan intended.
- **Artifact preview** (`components/ArtifactPreview.vue`): Description shown above the content preview. When present, the content preview is visually de-emphasized.
- **Artifact detail** (`pages/artifacts/[id].vue`): Description shown in the metadata card.
- **Review card** (`components/ReviewCard.vue`): Node run description shown below the task title, giving reviewers context about what they're reviewing.

## Cost analysis

| Source | Extra LLM cost | Notes |
|--------|----------------|-------|
| LLM node descriptions | $0 | Derived from existing output |
| Agent node descriptions | $0 | First sentence of existing output |
| Infrastructure node descriptions | $0 | Template strings |
| Artifact descriptions | $0 | Inherited from node logic |
| Run-level descriptions | ~$0.001/run | Single gpt-5-nano call, ~20 output tokens |

## Files changed

### Server
- `server/inngest/nodes/types.ts` - Added `description` to `NodeExecutorResult` and `RuntimeArtifact`
- `server/inngest/nodes/describe.ts` - New file with description generation utilities
- `server/inngest/nodes/llm.ts` - Each LLM executor provides a `describe` function
- `server/inngest/nodes/agentTransform.ts` - Generates descriptions from agent output
- `server/inngest/nodes/agentCode.ts` - Generates descriptions from agent output
- `server/inngest/nodes/infrastructure.ts` - Programmatic descriptions for all infra nodes
- `server/inngest/nodes/persistArtifacts.ts` - Writes `description` column to artifacts
- `server/inngest/functions/executeRun.ts` - Persists node descriptions, generates run descriptions
- `server/api/reviews/index.get.ts` - Includes node_run description in review queries

### Shared types
- `shared/types/task-engine.ts` - Added `description` to `RunRecord`, `NodeRunRecord`, `ArtifactRecord`

### UI
- `app/pages/runs/index.vue` - Shows run descriptions in list
- `app/pages/runs/[id].vue` - Shows run description in summary card
- `app/pages/artifacts/[id].vue` - Shows artifact description in metadata
- `app/components/ArtifactPreview.vue` - Shows artifact description above preview
- `app/components/NodeDetail.vue` - Shows runtime description, falls back to plan description
- `app/components/ReviewCard.vue` - Shows node description for review context

### Migration
- `db_migrations/004_entity_descriptions.sql` - Adds `description text` to runs, node_runs, artifacts
