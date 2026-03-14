# Agentic Loop — Implementation Plan

**Replacing single-shot LLM calls with a tool-using agent loop, inspired by Claude Code's architecture**
Last updated: 2026-03-13

> **Status: NOT STARTED**
> Historical note: this plan predates the OpenAI migration and intentionally references the original Anthropic-based design. For current runtime behavior, use `internal_docs/20260313_openai_migration/migration_plan.md` and `internal_docs/openai_usage.md`.

---

## Background

Today, each agent task (content, sponsor, briefing) is a single Anthropic API call in `dashboard/server/api/chats.post.ts`:

```
User input → load prompt + context → messages.create() → save chat → return
```

There's no tool use, no iteration, and no streaming. The user stares at a spinner for 10-30 seconds with zero feedback. The sponsor agent is asked to research real companies but has no ability to look anything up. The briefing agent can't check what day it is.

All data lives in flat files: `data/chats.json`, `data/logs.json`, `packages/shared/prompts/*.txt`, `packages/shared/context.yaml`. This is fragile, doesn't scale, and makes the dashboard read/write directly to the filesystem.

### What Claude Code Taught Us

Claude Code's core is a while loop around the Anthropic tool_use API:

1. Send messages + tool definitions to Claude
2. Claude responds, possibly with `stop_reason: "tool_use"` and structured tool requests
3. Execute the requested tools, collect results
4. Feed results back as `tool_result` messages
5. Repeat until Claude responds with `stop_reason: "end_turn"` (no more tool calls)

"The product is a while loop around the tool use API."

Claude Code layers on subagents, context compaction, permission systems, session resumption, and dozens of tools. We don't need any of that. Our tasks are scoped (one user message in, one structured output back), so we only need the core loop + a few tools + streaming progress.

### Goals

1. **Supabase storage**: Move all data (prompts, org context, chats, logs) from flat files to Supabase so the system has a real persistence layer
2. **Agent loop**: A shared while loop that all three agents use, with per-agent tool/prompt configuration
3. **Tool use**: Internet search and page fetching so agents work with real data
4. **Streaming progress**: SSE events so the frontend shows reasoning, tool calls, and incremental text instead of a blank spinner
5. **Backward compatibility**: The Discord bot keeps working unchanged

---

## Architecture

```
                         POST /api/chats?stream=true
                                  │
                                  ▼
                        ┌─────────────────┐
                        │  chats.post.ts  │
                        │  (SSE or JSON)  │
                        └────────┬────────┘
                                 │
               ┌─────────────────┼─────────────────┐
               ▼                 ▼                  ▼
      ┌────────────────┐  ┌────────────┐   ┌──────────────┐
      │   Supabase     │  │ agentLoop  │   │  Supabase    │
      │  load prompt   │  │            │   │  save chat   │
      │  load context  │  │  while()   │   │  save log    │
      └────────────────┘  │  Claude →  │   └──────────────┘
                          │  tools →   │
                          │  repeat    │
                          └─────┬──────┘
                         emit AgentEvents
                                │
              ┌──────────┬──────┴───────┬──────────┐
              ▼          ▼              ▼          ▼
            init     text_delta     tool_call     result
                                    tool_result
```

### Data Flow

1. Request arrives at the Nitro API
2. Load org context + agent prompt from **Supabase** `org_context` and `prompts` tables
3. Build the agent config (system prompt, tools, model, limits)
4. Run the agent loop (while loop around Anthropic tool_use API)
5. Stream `AgentEvent`s back to the client via SSE
6. On completion, persist the chat to Supabase `chats` table and the execution log to `agent_logs`

### Data Types

```typescript
// Events emitted during the loop, streamed to the client via SSE
interface AgentEvent {
  type: 'init' | 'thinking' | 'tool_call' | 'tool_result' | 'text_delta' | 'turn_complete' | 'result' | 'error'
  timestamp: string
  data: Record<string, any>
}

// Tool registered on an agent
type AgentTool =
  | {
      kind: 'provider'           // executed by Anthropic, not by our loop
      name: string
      definition: Record<string, any>
    }
  | {
      kind: 'local'              // executed by our loop and returned as tool_result
      name: string
      description: string
      input_schema: Record<string, any>
      run: (input: any) => Promise<string>
    }

// Per-agent configuration
interface AgentConfig {
  agent: string              // 'content' | 'sponsor' | 'briefing'
  systemPrompt: string       // context.yaml + agent prompt file
  tools: AgentTool[]         // which tools this agent has access to
  maxTurns: number           // safety cap on loop iterations
  maxTokens: number          // per-turn output token limit
  model: string              // 'claude-sonnet-4-6'
}

// Callback that receives events during the loop
type OnEvent = (event: AgentEvent) => void
```

---

## Sprint 0: Supabase Data Layer (Gap: flat-file storage)

**Goal:** Move all persistent data from flat files (`data/*.json`, `packages/shared/prompts/*.txt`, `packages/shared/context.yaml`) into Supabase. Replace the filesystem-based utils with a Supabase client. No RLS for now; we use the service role key server-side.

**Duration:** 1 day

### Schema

Four tables cover everything:

```sql
-- Org context (single-row table, editable via Supabase dashboard or future UI)
create table org_context (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  updated_at timestamptz not null default now()
);

-- Agent prompt templates (one row per agent)
create table prompts (
  slug text primary key,          -- 'content' | 'sponsor' | 'briefing'
  name text not null,             -- 'Marketing Director'
  content text not null,          -- the full prompt text
  updated_at timestamptz not null default now()
);

-- Chat history
create table chats (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  agent text not null,
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- Agent execution logs
create table agent_logs (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid references chats(id) on delete set null,
  agent text not null,
  input text not null,
  output text,
  turns integer not null default 1,
  tool_calls jsonb not null default '[]'::jsonb,
  model text not null,
  duration_ms integer,
  created_at timestamptz not null default now()
);

-- Indexes for common queries
create index idx_chats_created_at on chats(created_at desc);
create index idx_chats_agent on chats(agent);
create index idx_agent_logs_created_at on agent_logs(created_at desc);
create index idx_agent_logs_agent on agent_logs(agent);
```

The `messages` column on `chats` is a JSONB array of `{ id, role, content }` objects, same structure as today's `ChatMessage[]`.

The `tool_calls` column on `agent_logs` is a JSONB array of `{ id, name, input, output, is_error }` objects recorded during the agent loop. Each entry captures both the call and its result.

### Tasks

#### 0.1 Write migration file

Create `db_migrations/001_initial_schema.sql` with the full schema above. The user runs this in the Supabase console.

#### 0.2 Seed prompts and org context

Create `db_migrations/002_seed_data.sql` that inserts the current prompt files and context.yaml content as initial rows:

```sql
insert into org_context (content) values ('...');  -- content of context.yaml

insert into prompts (slug, name, content) values
  ('content', 'Marketing Director', '...'),   -- content of content.txt
  ('sponsor', 'Fundraising Director', '...'),  -- content of sponsor.txt
  ('briefing', 'Chief of Staff', '...');        -- content of briefing.txt
```

This ensures the system works immediately after running migrations. The prompt text files in `packages/shared/` remain in the repo as a reference/backup, but the dashboard reads from the DB going forward.

#### 0.3 Install `@nuxtjs/supabase` module

```bash
npx nuxi@latest module add supabase
```

This adds `@nuxtjs/supabase` to `nuxt.config.ts` modules and installs the package. The module auto-configures from env vars and provides auto-imported server utilities:

- `serverSupabaseServiceRole(event)` — returns a Supabase client using the secret key (bypasses RLS). This is what we use everywhere since we have no RLS.

No custom singleton needed. The module handles client lifecycle.

**Env vars** (add to `.env`):

```bash
SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_KEY="your-publishable-key"
SUPABASE_SECRET_KEY="your-service-role-key"
```

**Disable auth redirects** (we're not using Supabase Auth):

```typescript
// nuxt.config.ts
supabase: {
  redirect: false
}
```

The `dataDir` runtime config entry can be removed after Sprint 0 (nothing reads from `data/` anymore). The `sharedDir` entry must stay until Sprint 1, since `chats.post.ts` still reads prompt files from the filesystem until it's replaced by the agent loop.

#### 0.4 Rewrite `dashboard/server/utils/chats.ts`

Replace all filesystem operations with Supabase queries. The functions now take an H3 `event` parameter so they can create the Supabase client via `serverSupabaseServiceRole(event)`.

The `Chat` and `ChatMessage` interfaces stay the same (using camelCase `createdAt`). Since Supabase columns are snake_case (`created_at`), the utility functions map between the two formats:

```typescript
export async function readChats(event: H3Event): Promise<Chat[]> {
  const client = serverSupabaseServiceRole(event)
  const { data } = await client.from('chats')
    .select('id, title, agent, messages, created_at')
    .order('created_at', { ascending: false })
  return (data ?? []).map(row => ({
    id: row.id,
    title: row.title,
    agent: row.agent,
    messages: row.messages,
    createdAt: row.created_at
  }))
}

export async function findChat(event: H3Event, id: string): Promise<Chat | undefined> {
  const client = serverSupabaseServiceRole(event)
  const { data } = await client.from('chats').select('*').eq('id', id).single()
  if (!data) return undefined
  return { ...data, createdAt: data.created_at }
}

export async function addChat(event: H3Event, chat: Chat): Promise<void> {
  const client = serverSupabaseServiceRole(event)
  await client.from('chats').insert({
    id: chat.id,
    title: chat.title,
    agent: chat.agent,
    messages: chat.messages,
    created_at: chat.createdAt
  })
}

export async function deleteChat(event: H3Event, id: string): Promise<boolean> {
  const client = serverSupabaseServiceRole(event)
  const { error } = await client.from('chats').delete().eq('id', id)
  return !error
}
```

The API routes (`chats.get.ts`, `chats.post.ts`, `chats/[id].get.ts`, `chats/[id].delete.ts`) need a small update to pass `event` as the first argument to each utility call. No frontend changes needed — the `Chat` interface and all component bindings stay as-is.

#### 0.5 Rewrite `dashboard/server/api/prompts.get.ts` and `prompts.put.ts`

Currently reads from `packages/shared/prompts/` directory. Rewrite to query the `prompts` table using the auto-imported `serverSupabaseServiceRole`.

The response now includes `name` and `updated_at` fields in addition to `slug` and `content`. The prompts page can use `name` for display instead of deriving it from the slug with `formatSlug()`. This is a minor enhancement, not blocking — the extra fields are additive and the page works either way.

```typescript
// prompts.get.ts
export default defineEventHandler(async (event) => {
  const client = serverSupabaseServiceRole(event)
  const { data } = await client.from('prompts')
    .select('slug, name, content, updated_at')
    .order('slug')
  return data
})

// prompts.put.ts
export default defineEventHandler(async (event) => {
  const { slug, content } = await readBody(event)
  const client = serverSupabaseServiceRole(event)
  await client.from('prompts')
    .update({ content, updated_at: new Date().toISOString() })
    .eq('slug', slug)
  return { ok: true }
})
```

#### 0.6 Rewrite `dashboard/server/api/logs.get.ts`

Replace the filesystem read with a Supabase query:

```typescript
export default defineEventHandler(async (event) => {
  const client = serverSupabaseServiceRole(event)
  const { data } = await client.from('agent_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)
  return data
})
```

#### 0.7 Create prompt/context loading utility for the agent loop

The agent configs need to read prompts and org context. Create a helper that fetches from Supabase. Takes the H3 `event` so it can use the module's client:

```typescript
// dashboard/server/utils/agentPrompts.ts
import type { H3Event } from 'h3'

export async function loadAgentPrompt(event: H3Event, slug: string): Promise<string> {
  const client = serverSupabaseServiceRole(event)
  const { data } = await client.from('prompts').select('content').eq('slug', slug).single()
  if (!data) throw createError({ statusCode: 404, message: `Prompt "${slug}" not found` })
  return data.content
}

export async function loadOrgContext(event: H3Event): Promise<string> {
  const client = serverSupabaseServiceRole(event)
  const { data } = await client.from('org_context').select('content').limit(1).single()
  if (!data) throw createError({ statusCode: 500, message: 'Org context not configured' })
  return data.content
}
```

This replaces the `readFile(join(sharedDir, 'prompts', ...))` and `readFile(join(sharedDir, 'context.yaml'))` calls in `chats.post.ts` and in the agent config factories.

### Verification

```bash
# After running migrations and seeding:

# Prompts load from DB
curl http://localhost:3000/api/prompts
# Expected: array of { slug, name, content, updated_at }

# Chat creation persists to DB
curl -X POST http://localhost:3000/api/chats \
  -H 'Content-Type: application/json' \
  -d '{"agent":"content","input":"Test topic"}'
# Expected: chat object returned, row visible in Supabase chats table

# Chat history loads from DB
curl http://localhost:3000/api/chats
# Expected: array with the chat just created

# Prompt editing persists to DB
curl -X PUT http://localhost:3000/api/prompts \
  -H 'Content-Type: application/json' \
  -d '{"slug":"content","content":"Updated prompt text..."}'
# Expected: 200, prompts table row updated
```

### Tests

**Backend (curl):**

```bash
# Prompts round-trip
curl http://localhost:3000/api/prompts
# → array of { slug, name, content, updated_at }

curl -X PUT http://localhost:3000/api/prompts \
  -H 'Content-Type: application/json' \
  -d '{"slug":"content","content":"Updated prompt"}'
# → { ok: true }, then GET confirms the change

# Chat CRUD
curl -X POST http://localhost:3000/api/chats \
  -H 'Content-Type: application/json' \
  -d '{"agent":"content","input":"Test topic"}'
# → chat object with messages

curl http://localhost:3000/api/chats
# → array includes the new chat

curl -X DELETE http://localhost:3000/api/chats/<id>
# → chat removed
```

**QA:**

1. Prompts page loads all three prompts from Supabase, edit + save round-trips correctly
2. Create a chat from the home page — chat appears in sidebar, persists on page refresh
3. Logs page renders empty state (no logs written yet)

### Definition of Done

- [x] Migration files in `db_migrations/` with full schema and seed data
- [x] `@nuxtjs/supabase` module installed and configured (redirect disabled)
- [x] `chats.ts` reads/writes to Supabase `chats` table via `serverSupabaseServiceRole`
- [x] `prompts.get.ts` and `prompts.put.ts` use the `prompts` table
- [x] `logs.get.ts` reads from `agent_logs` table
- [x] `agentPrompts.ts` loads prompts and org context from Supabase
- [x] Dashboard UI works identically (prompts page, chat, logs)
- [x] Discord bot works unchanged (same API contract)

### New Dependencies

| Package | Purpose |
|---------|---------|
| `@nuxtjs/supabase` | Nuxt module with auto-imported `serverSupabaseServiceRole` for server routes |

### New Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_KEY` | Yes | Publishable key (required by the module) |
| `SUPABASE_SECRET_KEY` | Yes | Service role / secret key (bypasses RLS) |

---

## Sprint 1: Agent Loop Core (Gap: single-shot calls)

**Goal:** Replace the single `messages.create()` call with a while loop that handles tool_use responses. Initially no tools registered, so it behaves identically to today but through the new loop infrastructure.

**Duration:** Half day

### Tasks

#### 1.1 Create `dashboard/server/utils/agentLoop.ts`

The core loop function:

```typescript
async function runAgentLoop(
  config: AgentConfig,
  userMessage: string,
  onEvent: OnEvent
): Promise<string>
```

**Loop pseudocode:**

```
1. messages = [{ role: 'user', content: userMessage }]
2. toolDefs = config.tools mapped to Anthropic tool format
3. emit('init', { agent, tools: names, maxTurns })
4. turnCount = 0

5. WHILE turnCount < config.maxTurns:
     turnCount++
     
     a. response = await client.messages.create({
          model, system: config.systemPrompt, messages, tools: toolDefs,
          max_tokens: config.maxTokens, stream: true
        })
     
     b. Stream handling:
        - text deltas → emit('text_delta', { text })
        - thinking blocks → emit('thinking', { text })
        - accumulate full response content
     
     c. Append assistant message to messages[]
        emit('turn_complete', { turn: turnCount, stop_reason })
     
     d. If stop_reason !== 'tool_use': BREAK
     
     e. For each tool_use block in response.content:
        - emit('tool_call', { id, name, input })
        - tool = config.tools.find(t => t.name === name)
        - result = await tool.run(input)  // catch errors → is_error: true
        - emit('tool_result', { id, name, output, is_error })
        - build tool_result content block
     
     f. Append user message with tool_result blocks to messages[]

6. finalText = extract text from last assistant message
7. emit('result', { text: finalText, turns: turnCount })
8. return finalText
```

**Key design decisions:**

- Tool execution is sequential within a turn. Our tools are I/O-bound (web requests), and sequential is simpler to debug. Parallelization can be added later.
- If a tool throws, catch the error and send it back to Claude as `tool_result` with `is_error: true`. Claude will adapt. A tool error never crashes the loop.
- The `onEvent` callback is synchronous from the loop's perspective. It's the caller's job to push events to SSE or buffer them.

#### 1.2 Create agent config factories in `dashboard/server/utils/agents/`

One file per agent (`content.ts`, `sponsor.ts`, `briefing.ts`) plus an `index.ts` that maps agent slug to config factory.

Each factory:
1. Takes the H3 `event` to access Supabase via `serverSupabaseServiceRole`
2. Loads the org context and agent prompt from Supabase using `loadOrgContext(event)` and `loadAgentPrompt(event, slug)` (from Sprint 0)
3. Returns an `AgentConfig` with the right tools, maxTurns, and model

For Sprint 1, all agents get `tools: []` so the loop produces the same output as today.

```typescript
// agents/index.ts
export async function createAgentConfig(event: H3Event, agent: string): Promise<AgentConfig>
```

#### 1.3 Update `dashboard/server/api/chats.post.ts` to use the loop

Replace the direct `client.messages.create()` call with `runAgentLoop()`. For now, pass a no-op `onEvent` callback and return the same JSON response shape. No streaming yet.

The existing agent-specific user message prefixes ("Create a content suite for:", "Research this company for sponsorship potential:", etc.) stay in `chats.post.ts`. Apply them to the user's input before passing it to `runAgentLoop()`. This keeps the prefix logic in one place and out of the agent configs, which are concerned with system prompts and tools.

### Verification

```bash
# Same behavior as before: POST returns a chat with assistant response
curl -X POST http://localhost:3000/api/chats \
  -H 'Content-Type: application/json' \
  -d '{"agent":"content","input":"Test topic"}'
# Expected: JSON chat object with user + assistant messages, same as today
```

### Tests

**Backend (curl):**

```bash
# Each agent type returns the same response shape as before
curl -X POST http://localhost:3000/api/chats \
  -H 'Content-Type: application/json' \
  -d '{"agent":"content","input":"Test topic"}'
# → same JSON chat object as Sprint 0

curl -X POST http://localhost:3000/api/chats \
  -H 'Content-Type: application/json' \
  -d '{"agent":"sponsor","input":"Test company"}'
# → same shape, different agent

curl -X POST http://localhost:3000/api/chats \
  -H 'Content-Type: application/json' \
  -d '{"agent":"briefing","input":"Generate briefing"}'
# → same shape, all three agents work through the loop
```

### Definition of Done

- [x] `agentLoop.ts` exists with the while loop, handles `tool_use` stop reason, emits events via callback
- [x] Agent configs load prompts and return `AgentConfig` objects
- [x] `chats.post.ts` uses the new loop, produces identical output to the old single-call path
- [x] Discord bot works unchanged (same API contract)

---

## Sprint 2: Tools (Gap: agents can't access real information)

**Goal:** Give agents the ability to search the internet, read specific web pages, and use current date awareness. Anthropic-native tools should fit cleanly into the same registry as local tools so future capabilities don't become one-off special cases.

**Duration:** 1 day

### Tasks

#### Problem we're addressing

We want to add Anthropic's built-in web search without warping the tool system around a provider-specific exception. If web search becomes a special case, every future tool addition gets messier. The fix is to define one shared tool model with two execution modes:

- **Provider tools**: passed straight to Anthropic and executed by Anthropic
- **Local tools**: executed by our loop and sent back as `tool_result`

That lets us use Anthropic web search now, add `web_fetch` and `get_current_date` as local utilities, and stay flexible for future local or provider-managed tools.

#### 2.1 Refactor `AgentTool` handling in `dashboard/server/utils/agentLoop.ts`

Update the loop to support both `provider` and `local` tools from the same `AgentTool[]` array.

**Behavior:**

- Build the outbound Anthropic `tools` array from all registered tools
- For `kind: 'provider'`, pass `tool.definition` through unchanged
- For `kind: 'local'`, map to Anthropic's standard `{ name, description, input_schema }` shape
- Only execute `tool_use` blocks locally when the matching tool is `kind: 'local'`
- If Anthropic handles a provider tool internally, the loop should simply continue when the next assistant message arrives

This keeps the tool registry unified while cleanly separating who executes each tool.

#### 2.2 Create `dashboard/server/utils/tools/webSearch.ts`

```typescript
const webSearchTool: AgentTool = {
  kind: 'provider',
  name: 'web_search',
  definition: {
    type: 'web_search_20250305',
    name: 'web_search'
  },
}
```

**Implementation:** Use Anthropic's native web search tool instead of calling Brave/Tavily directly. Claude decides when to search, formulates the query, reads results, and synthesizes them inside the same agent loop.

This avoids adding another API key, another billing surface, and another custom search client. It also keeps search reasoning in the same model call instead of wrapping search in a second nested LLM request.

#### 2.3 Create `dashboard/server/utils/tools/webFetch.ts`

```typescript
const webFetchTool: AgentTool = {
  kind: 'local',
  name: 'web_fetch',
  description: 'Fetch and read the text content of a specific web page URL.',
  input_schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to fetch' }
    },
    required: ['url']
  },
  run: async ({ url }) => { /* ... */ }
}
```

**Implementation:**

- Fetch the URL with a 5-second timeout and a reasonable user-agent header
- Parse HTML with `linkedom` and extract readable content with `@mozilla/readability`
- Truncate output to ~4000 characters to prevent context window blowout
- Return a clear error string on failure (timeout, 4xx/5xx, parse error, unsupported content)

`web_fetch` complements Anthropic web search rather than replacing it. Search is best for discovery and synthesis; fetch is useful when the model wants to inspect a specific page more closely or when we later add non-search retrieval flows.

#### 2.4 Create `dashboard/server/utils/tools/getCurrentDate.ts`

Lightweight utility so agents know what "this week" means:

```typescript
const getCurrentDateTool: AgentTool = {
  kind: 'local',
  name: 'get_current_date',
  description: 'Get the current date and day of the week.',
  input_schema: { type: 'object', properties: {} },
  run: async () => {
    return new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    })
  }
}
```

#### 2.5 Create `dashboard/server/utils/tools/index.ts`

Exports all tools and a helper to get the tool set for a given agent:

```typescript
export function getToolsForAgent(agent: string): AgentTool[]
```

**Per-agent tool assignment:**

| Agent | `web_search` (provider) | `web_fetch` (local) | `get_current_date` (local) |
|-------|-------------------------|---------------------|----------------------------|
| **sponsor** | Yes | Yes | Yes |
| **briefing** | Yes | Yes | Yes |
| **content** | Optional | No | Yes |

The sponsor agent benefits most. Its prompt already asks it to research companies, AI footprint, Richmond presence. With real web search and targeted page fetches it produces factual briefs instead of plausible-sounding fiction. The briefing agent can look up current events and read source pages. The content agent mostly works from user input but could reference recent events and use the date tool.

#### 2.6 Wire tools into agent configs

Update each agent config factory to include its tool set. Update `maxTurns` per agent:

| Agent | maxTurns | Rationale |
|-------|---------|-----------|
| sponsor | 10 | Needs multiple searches, page reads, and synthesis passes for research |
| briefing | 6 | May search for current news/events and inspect a few source pages |
| content | 4 | Mostly writes from input, occasional search |

#### 2.7 Add tool instructions to prompts

Update each agent's prompt in the Supabase `prompts` table (via the dashboard prompts page or a migration). Append a section:

```markdown
## Available Tools

You have access to the following tools during this task:
- **web_search**: Search the internet for current information
- **web_fetch**: Read the text content of a specific web page
- **get_current_date**: Get today's date

Use these tools proactively when you need factual, current information.
Do not fabricate company details, dates, or statistics when you could look them up.
```

Each agent gets a version listing only its assigned tools, plus agent-specific guidance. The sponsor prompt should add: "ALWAYS search for the company before writing your brief. Real data is required."

Since prompts now live in Supabase, these updates can be made from the dashboard prompts editor or via a seed migration (`db_migrations/003_add_tool_instructions.sql`). The text files in `packages/shared/prompts/` serve as version-controlled backups but are no longer read at runtime.

### Verification

```bash
# Sponsor agent should now search the web
curl -X POST http://localhost:3000/api/chats \
  -H 'Content-Type: application/json' \
  -d '{"agent":"sponsor","input":"Capital One"}'
# Expected: Response contains real company data from web search, not generic text
# Server logs/SSE should show search/fetch activity and the final response should reflect current facts

# Date tool works
curl -X POST http://localhost:3000/api/chats \
  -H 'Content-Type: application/json' \
  -d '{"agent":"briefing","input":"Generate a briefing for this week"}'
# Expected: Briefing references the actual current date
```

### Tests

**Backend (curl):**

```bash
# Sponsor agent triggers web research
curl -X POST http://localhost:3000/api/chats \
  -H 'Content-Type: application/json' \
  -d '{"agent":"sponsor","input":"Capital One"}'
# → response contains real company data, not fabricated text
# → response reflects current facts from web search and may inspect source pages with web_fetch

# Briefing agent uses current date
curl -X POST http://localhost:3000/api/chats \
  -H 'Content-Type: application/json' \
  -d '{"agent":"briefing","input":"Generate a briefing for this week"}'
# → output references today's actual date

# Content agent still works (fewer/no tools expected)
curl -X POST http://localhost:3000/api/chats \
  -H 'Content-Type: application/json' \
  -d '{"agent":"content","input":"AI meetup next Thursday"}'
# → content output, may or may not use tools
```

### Definition of Done

- [x] `AgentTool` supports both provider-managed and local tools through one shared registry
- [x] Anthropic `web_search_20250305` is wired in as a provider tool
- [x] `web_fetch` returns readable page content, truncated to ~4k chars
- [x] `get_current_date` returns current date string
- [x] Sponsor agent performs web searches when researching a company
- [x] Sponsor and briefing agents can fetch specific pages when useful
- [x] Briefing agent knows the current date
- [x] Tool errors are caught and fed back to Claude gracefully (no loop crashes)
- [x] Prompt files updated with tool instructions

### New Dependencies

| Package | Purpose |
|---------|---------|
| None required for web search | Anthropic provides `web_search_20250305` natively |
| `linkedom` | DOM parsing for `web_fetch` |
| `@mozilla/readability` | Article text extraction for `web_fetch` |

---

## Sprint 3: SSE Streaming (Gap: user sees no progress)

**Goal:** Stream agent events to the frontend via Server-Sent Events so the user sees tool calls, reasoning, and incremental text in real time instead of a blank spinner.

**Duration:** 1 day

### Tasks

#### 3.1 Add SSE streaming path to `chats.post.ts`

Support a `?stream=true` query parameter. When present, return an SSE stream instead of JSON. When absent, behave exactly like today (wait for completion, return JSON). This preserves backward compatibility for the Discord bot.

```typescript
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const body = await readBody(event)
  const shouldStream = query.stream === 'true'

  // ... validation, config loading ...

  if (shouldStream) {
    const eventStream = createEventStream(event)

    runAgentLoop(agentConfig, userMessage, (agentEvent) => {
      eventStream.push(JSON.stringify(agentEvent))
    }).then(async (finalText) => {
      // Build and persist chat
      await addChat(chat)
      await eventStream.close()
    }).catch(async (error) => {
      eventStream.push(JSON.stringify({ type: 'error', data: { message: error.message } }))
      await eventStream.close()
    })

    return eventStream.send()
  }

  // Non-streaming path: same as today
  const finalText = await runAgentLoop(agentConfig, userMessage, () => {})
  // ... build chat, addChat, return chat ...
})
```

**SSE event format:**

```
data: {"type":"init","timestamp":"...","data":{"agent":"sponsor","tools":["web_search","get_current_date"],"maxTurns":10}}

data: {"type":"text_delta","timestamp":"...","data":{"text":"I'll start by researching..."}}

data: {"type":"tool_call","timestamp":"...","data":{"id":"toolu_abc","name":"web_search","input":{"query":"Capital One Richmond VA AI initiatives 2026"}}}

data: {"type":"tool_result","timestamp":"...","data":{"id":"toolu_abc","name":"web_search","output":"1. Capital One ML Engineering Hub..."}}

data: {"type":"text_delta","timestamp":"...","data":{"text":"## Company Overview\n\nCapital One..."}}

data: {"type":"turn_complete","timestamp":"...","data":{"turn":2,"stop_reason":"end_turn"}}

data: {"type":"result","timestamp":"...","data":{"chatId":"...","text":"<full output>","turns":2}}
```

#### 3.2 Verify with curl

```bash
curl -N 'http://localhost:3000/api/chats?stream=true' \
  -H 'Content-Type: application/json' \
  -d '{"agent":"sponsor","input":"Capital One"}'
# Expected: SSE events stream in one at a time as the agent works
```

### Verification

- SSE events arrive incrementally during agent execution (not all at once)
- Non-streaming path still returns the same JSON as before
- Discord bot works without changes (it doesn't pass `?stream=true`)
- Errors during the loop are emitted as `error` events and the stream closes cleanly

### Tests

**Backend (curl):**

```bash
# SSE stream — events arrive incrementally
curl -N 'http://localhost:3000/api/chats?stream=true' \
  -H 'Content-Type: application/json' \
  -d '{"agent":"content","input":"Test topic"}'
# → data: lines arrive one at a time, each is valid JSON matching AgentEvent
# → must see init, at least one text_delta, turn_complete, and result in that order

# Non-streaming — backward compatible JSON
curl -X POST http://localhost:3000/api/chats \
  -H 'Content-Type: application/json' \
  -d '{"agent":"content","input":"Test topic"}'
# → same JSON response as before (no SSE)
```

### Definition of Done

- [x] `?stream=true` returns SSE stream with typed `AgentEvent` payloads
- [x] Without `?stream=true`, endpoint returns JSON (backward compatible)
- [x] `text_delta` events arrive as Claude generates text (not buffered)
- [x] `tool_call` and `tool_result` events bracket each tool execution
- [x] `result` event includes chatId so the client can navigate
- [x] Error events are emitted on failure, stream closes gracefully
- [x] Chat is persisted after the loop completes (same as today)

---

## Sprint 4: Frontend Streaming UI (Gap: no progress visibility)

**Goal:** The chat page renders agent progress in real time: streaming text, tool call cards, and turn indicators.

**Duration:** 1-2 days

### Tasks

#### 4.1 Create `dashboard/app/composables/useAgentStream.ts`

Client-side composable that manages the SSE connection and exposes reactive state:

```typescript
function useAgentStream() {
  const events = ref<AgentEvent[]>([])
  const streamingText = ref('')
  const finalText = ref<string | null>(null)
  const status = ref<'idle' | 'running' | 'complete' | 'error'>('idle')
  const currentTurn = ref(0)
  const toolCalls = ref<{ id: string, name: string, input: any, output?: string, pending: boolean }[]>([])

  async function start(chatId: string, agent: string, input: string) {
    status.value = 'running'
    streamingText.value = ''
    toolCalls.value = []

    const response = await fetch('/api/chats?stream=true', {
      method: 'POST',
      body: JSON.stringify({ id: chatId, agent, input }),
      headers: { 'Content-Type': 'application/json' }
    })

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    // Parse SSE lines, update reactive state based on event type:
    //   text_delta   → append to streamingText
    //   tool_call    → add to toolCalls (pending: true)
    //   tool_result  → update matching toolCall (pending: false, add output)
    //   turn_complete → increment currentTurn, reset streamingText for next turn
    //   result       → set finalText, status = 'complete'
    //   error        → status = 'error'
  }

  return { events, streamingText, finalText, status, currentTurn, toolCalls, start }
}
```

#### 4.2 Create `dashboard/app/components/AgentProgress.vue`

Renders the agent's work-in-progress state. Shown while `status === 'running'`:

- **Tool call cards**: When the agent calls `web_search`, show a compact card: search icon + "Searching: Capital One Richmond AI initiatives..." with a loading indicator. When the result arrives, swap to a checkmark and collapse the output to a one-line summary. Clicking expands the full result.
- **Turn indicator**: Subtle "Turn 2 of 10" text so the user knows the agent is iterating.
- **Streaming text**: As `text_delta` events arrive, render incrementally using the existing `UChatMessages` streaming support or a simple `v-html` with markdown rendering.

The component should feel lightweight, not overwhelming. Tool calls are informational, not interactive.

#### 4.3 Update `dashboard/app/pages/index.vue`

Wire the submit flow to use `useAgentStream()` instead of `$fetch`. On submit:

1. Generate chatId, navigate to `/chat/{id}`
2. Start the SSE stream
3. The chat page picks up the stream state and renders progress

This replaces `usePendingChat`. The optimistic user message display moves into `useAgentStream` — the composable shows the user message immediately, then streams the assistant response. `usePendingChat` can be deleted.

#### 4.4 Update `dashboard/app/pages/chat/[id].vue`

Two render modes:
- **Streaming** (when the agent stream is active): Show the `AgentProgress` component with tool calls and streaming text. The assistant message builds up incrementally.
- **Completed** (when loading a past chat): Same as today, load from `/api/chats/{id}` and render the full messages.

The transition from streaming to completed should be seamless. When the `result` event arrives, the streaming UI resolves into the final message view.

### Verification

- Start a sponsor research task from the dashboard
- See "Searching: [query]..." card appear while the agent searches
- See text stream in incrementally as Claude writes
- See turn counter update if the agent does multiple rounds
- After completion, the chat looks identical to a loaded past chat
- Refreshing the page loads the persisted chat normally

### Tests

**QA:**

1. Submit a sponsor research task from the dashboard — tool call cards appear with loading state, swap to checkmark when results arrive, text streams in incrementally
2. After completion, refresh the page — the persisted chat loads and looks identical to the streamed version
3. Simulate a failure (e.g. invalid agent name or network interruption) — error toast appears, UI does not break

### Definition of Done

- [ ] `useAgentStream` composable manages SSE connection and exposes reactive state
- [ ] `AgentProgress` component renders tool call cards with pending/complete states
- [ ] Text streams in incrementally during generation
- [ ] Turn indicator shows current/max turns
- [ ] Completed chats render identically whether streamed live or loaded from history
- [ ] Error states show a toast and allow retry

---

## Sprint 5: Logging & Polish

**Goal:** Write agent execution data to the `agent_logs` table, update the README, and clean up edge cases.

**Duration:** Half day

### Tasks

#### 5.1 Write to `agent_logs` table

The logs page (`/logs`) reads from Supabase (wired in Sprint 0) but nothing writes yet. After the agent loop completes, insert a log row:

```typescript
const client = serverSupabaseServiceRole(event)
await client.from('agent_logs').insert({
  chat_id: chatId,
  agent: config.agent,
  input: userMessage,
  output: finalText,
  turns: turnCount,
  tool_calls: collectedToolCalls,  // [{ id, name, input, output, is_error }]
  model: config.model,
  duration_ms: elapsed
})
```

This happens in `chats.post.ts` after the loop finishes, alongside the `addChat()` call. Both the chat and the log reference the same `chatId`.

#### 5.2 Update `logs.vue` to match `agent_logs` schema

The current logs page template references `log.timestamp` and `log.status`, which don't exist on the `agent_logs` table. Update the page to use the actual columns:

- `log.created_at` instead of `log.timestamp`
- Remove the `status` badge (or derive it: output present = success, output null = error)
- Add display for new fields: `turns`, `duration_ms`, `tool_calls` count, `model`

#### 5.3 Update the README

Reflect the new agentic architecture:
- Update the "Request Flow" section to describe the agent loop
- Add a "Tools" section listing available tools
- Note that Anthropic native web search is used, so no separate search API key is required
- Update the architecture diagram

#### 5.4 Edge cases

- **Max turns reached**: Emit a `result` event with a warning that the agent hit its turn limit. Include whatever partial output was generated.
- **Empty tool list**: If an agent has no tools, the loop should still work (single-turn, like today).
- **Provider tool availability**: If Anthropic web search is unavailable for the selected model/account, the provider tool should be omitted or fail clearly without crashing the loop.
- **Mixed tool execution**: Provider tools should pass through cleanly; local tools should still emit `tool_call` and `tool_result` events and return results through the existing loop.
- **Large fetched pages**: `web_fetch` should truncate output at ~4k chars and return a clear error for unsupported or unreadable content.

#### 5.5 Cleanup

- Update `.env.example` to include `SUPABASE_URL`, `SUPABASE_KEY`, and `SUPABASE_SECRET_KEY`. Remove unused `AIRTABLE_API_KEY` and `AIRTABLE_BASE_ID`.
- Delete `data/chats.json` and `data/logs.json` (no longer read by anything).
- Remove `dataDir` from `nuxt.config.ts` `runtimeConfig` (removed in Sprint 0). Remove `sharedDir` (removed in Sprint 1). Clean up the `dotenv` import in `nuxt.config.ts` if Supabase env vars are handled by the module.
- Keep `packages/shared/prompts/*.txt` and `packages/shared/context.yaml` in the repo as version-controlled backups, but they're no longer read at runtime.

### Tests

**Backend (curl):**

```bash
# Create a chat, then verify the log row exists
curl -X POST http://localhost:3000/api/chats \
  -H 'Content-Type: application/json' \
  -d '{"agent":"sponsor","input":"Capital One"}'

curl http://localhost:3000/api/logs
# → array includes a row with matching agent, non-zero turns, duration_ms, and tool_calls array
```

**QA:**

1. Logs page displays entries with agent badge, formatted timestamp, turns count, duration, and tool call count
2. Entries appear in reverse chronological order (newest first)

### Definition of Done

- [ ] Agent executions insert into the `agent_logs` table with chat_id, turns, tool_calls, duration
- [ ] Logs page shows real entries using `agent_logs` schema (created_at, turns, duration_ms, tool_calls)
- [ ] README reflects the new architecture (Supabase, agent loop, tools)
- [ ] `.env.example` is up to date
- [ ] Max turns and missing API keys are handled gracefully
- [ ] Stale files and config entries cleaned up

---

## File Structure

New and modified files:

```
db_migrations/
├── 001_initial_schema.sql              # NEW — tables: org_context, prompts, chats, agent_logs
├── 002_seed_data.sql                   # NEW — initial prompts + org context from current files
└── 003_add_tool_instructions.sql       # NEW — append tool sections to prompt rows (Sprint 2)
dashboard/server/
├── api/
│   ├── chats.post.ts                   # MODIFIED — use agentLoop, add SSE path, write logs
│   ├── chats.get.ts                    # MODIFIED — use serverSupabaseServiceRole
│   ├── chats/[id].get.ts              # MODIFIED — use serverSupabaseServiceRole
│   ├── chats/[id].delete.ts           # MODIFIED — use serverSupabaseServiceRole
│   ├── prompts.get.ts                  # MODIFIED — read from Supabase
│   ├── prompts.put.ts                  # MODIFIED — write to Supabase
│   └── logs.get.ts                     # MODIFIED — read from Supabase
├── utils/
│   ├── chats.ts                        # MODIFIED — Supabase queries instead of file I/O
│   ├── agentPrompts.ts                 # NEW — loadAgentPrompt(), loadOrgContext()
│   ├── agentLoop.ts                    # NEW — core while loop
│   ├── tools/
│   │   ├── index.ts                    # NEW — tool registry, getToolsForAgent()
│   │   ├── webSearch.ts                # NEW — Anthropic native web search provider tool
│   │   ├── webFetch.ts                 # NEW — page content fetcher
│   │   └── getCurrentDate.ts           # NEW — current date utility
│   └── agents/
│       ├── index.ts                    # NEW — createAgentConfig() factory
│       ├── content.ts                  # NEW — content agent config
│       ├── sponsor.ts                  # NEW — sponsor agent config
│       └── briefing.ts                 # NEW — briefing agent config
dashboard/app/
├── composables/
│   └── useAgentStream.ts               # NEW — SSE client composable
├── components/
│   └── AgentProgress.vue               # NEW — tool call / progress display
├── pages/
│   ├── index.vue                       # MODIFIED — wire up streaming submit
│   ├── logs.vue                        # MODIFIED — match agent_logs schema
│   └── chat/
│       └── [id].vue                    # MODIFIED — render streaming + completed
packages/shared/prompts/
├── content.txt                         # KEPT as version-controlled backup (no longer read at runtime)
├── sponsor.txt                         # KEPT as version-controlled backup
└── briefing.txt                        # KEPT as version-controlled backup
```

---

## Dependencies

### New npm packages (dashboard)

| Package | Purpose |
|---------|---------|
| `@nuxtjs/supabase` | Nuxt module for Supabase integration (auto-imports `serverSupabaseServiceRole`) |
| None required for web search | Anthropic provides native web search in the Messages API |

The Anthropic SDK (`@anthropic-ai/sdk`) is already installed and supports streaming. Nitro's `h3` already provides `createEventStream()` for SSE.

### New environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_KEY` | Yes | Publishable key (required by the module) |
| `SUPABASE_SECRET_KEY` | Yes | Service role / secret key (bypasses RLS) |

---

## What This Intentionally Excludes

Keeping scope tight by explicitly not building:

- **RLS / auth**: All Supabase access uses the service role key server-side. No row-level security, no user auth. Can be layered on later.
- **Subagents / task delegation**: Claude Code spawns child agents with their own context. Our tasks are scoped enough that a single loop with tools is sufficient.
- **Context compaction**: Our conversations are short (one user message, agent loop, done). No multi-turn history accumulation.
- **Session resumption**: Each chat is a standalone task, not a persistent conversation.
- **Permission system**: All tools are pre-approved. No interactive approval flow.
- **File read/write/edit tools**: The agents produce text output, they don't modify files.
- **Bash/shell execution**: No code execution needed for these use cases.
- **Realtime subscriptions**: The SSE stream from the agent loop is sufficient. No need for Supabase Realtime channels.

The abstract loop is extensible. Adding a new tool later is just defining a new `AgentTool` object and adding it to an agent's config. Adding new data tables is a migration file.

---

## Summary

| Sprint | Focus | Duration | Key Files |
|--------|-------|----------|-----------|
| 0 | Supabase data layer | 1 day | `db_migrations/*`, `chats.ts`, `agentPrompts.ts`, API routes |
| 1 | Agent loop core | Half day | `agentLoop.ts`, `agents/*.ts`, `chats.post.ts` |
| 2 | Tools (search, fetch, date) | 1 day | `tools/*.ts`, `agents/*.ts`, prompt rows in DB |
| 3 | SSE streaming endpoint | 1 day | `chats.post.ts` |
| 4 | Frontend streaming UI | 1-2 days | `useAgentStream.ts`, `AgentProgress.vue`, pages |
| 5 | Logging & polish | Half day | `agent_logs` writes, README, edge cases |

**Total estimated time: 5-6 days.** Sprint 0 is the data migration. Sprints 1-3 are backend-only and can be verified with curl. Sprint 4 is the frontend integration. Sprint 5 is cleanup.
