# Chat Interface — Implementation Plan

**A conversational interface for TaskEngine, with OpenClaw-inspired memory and the ability to take action.**
Last updated: 2026-03-16

> **Status: In Progress**

---

## Background

TaskEngine today is a dashboard-first product. Users create tasks through forms, monitor runs through tables, and review outputs through cards. It works, but there's a whole class of interactions that would be faster and more natural through conversation:

- "Run the weekly safety brief on yesterday's incident reports"
- "What documents did the compliance task produce last week?"
- "Create a task that watches for new field reports and summarizes them daily"
- "Remember that Linda prefers bullet-point summaries, not prose"

The Nuxt UI chat template provides a strong UI foundation for streaming chat with sessions and history. OpenClaw provides the memory architecture blueprint — layered memory (short-term conversation, long-term curated knowledge, searchable history) that gives the agent continuity across sessions without dumping the entire history into every context window.

The key difference from OpenClaw: we store everything in Postgres (via Supabase) instead of markdown files on disk. And the agent isn't a general-purpose assistant — it's a TaskEngine operator that can query the system, kick off tasks, manage reviews, and remember user preferences.

### What This Enables

1. **Conversational task management**: Create tasks, start runs, check status, approve reviews — all through natural language.
2. **Memory across sessions**: The agent remembers preferences, decisions, and context from past conversations. "Run it the same way we did last time" actually works.
3. **System awareness**: The agent can query tasks, artifacts, runs, and reviews. It knows what's happening in the system and can answer questions about it.
4. **Progressive complexity**: New users can start with chat and graduate to the full dashboard. Power users can use both.

---

## Architecture

### UI Surface

The chat lives in a **slideover panel** on the right side of the dashboard, accessible from every page via a floating button or keyboard shortcut. This keeps the user in context — they can chat while looking at a task detail page, review artifacts while asking the agent questions, or start a run without navigating away.

A dedicated `/chat` page provides the full-screen experience for longer conversations, with session history in a sidebar.

```
┌──────────────────────────────────────────────────────────┐
│  Sidebar  │           Current Page              │  Chat  │
│           │                                     │Slideover│
│  Home     │   (any dashboard page)              │        │
│  Reviews  │                                     │  [msg] │
│  Tasks    │                                     │  [msg] │
│  ...      │                                     │  [msg] │
│           │                                     │        │
│           │                                     │  [___] │
└──────────────────────────────────────────────────────────┘
```

The slideover is a `USlideover` from Nuxt UI, rendered at the layout level so it persists across page navigations. The chat state (current session, messages, streaming status) is managed in a global composable.

For the full-page `/chat` experience, sessions are listed in a sidebar (grouped by date like the Nuxt UI chat template), and the active conversation fills the main panel.

### Data Flow

```
User types message
       │
       ▼
POST /api/chat/sessions/[id]
       │
       ├─ Load session context:
       │    ├─ Long-term memories (always)
       │    ├─ Recent session summaries (last 3)
       │    └─ Current session messages
       │
       ├─ Build system prompt with context + tool definitions
       │
       ├─ Call OpenAI (streaming, Responses API)
       │    │
       │    ├─ Text response → stream to client
       │    ├─ Tool call → execute locally → feed result back
       │    └─ Repeat until done
       │
       ├─ Persist assistant message(s) to chat_messages
       │
       └─ Stream response back via SSE (ChatEvent JSON lines)
              │
              ▼
       Client renders incrementally
```

### Memory Architecture (OpenClaw-inspired, DB-backed)

OpenClaw uses four layers: session context, daily notes, curated long-term memory, and semantic search. We adapt this for a DB-backed system:

#### Layer 1 — Session Context (Short-Term)

The current conversation's messages. Stored in `chat_messages`, loaded when the user opens a session. This is the bread and butter — most interactions stay within a single session's context.

When a session grows past the model's comfort zone (~80K tokens), **compaction** kicks in:
1. A summary of the older messages is generated
2. The summary is stored in `session_summaries`
3. Older messages are marked as compacted (kept in DB for history, but not loaded into context)
4. The session continues with: system prompt + long-term memories + compaction summary + recent messages

Before compaction, the agent gets one silent turn to flush important context to long-term memory — OpenClaw's "pre-compaction memory flush" pattern. This prevents losing information that the user mentioned once but never explicitly asked to save.

#### Layer 2 — Long-Term Memory

Curated facts, preferences, and decisions. Stored in the `memories` table. Always loaded at session start as part of the system prompt.

Examples:
- "User prefers bullet-point summaries over prose"
- "The weekly safety brief task should always include the incident count"
- "Linda is the operations manager; Ray handles the construction sites"
- "When running compliance checks, always include jurisdiction context"

The agent writes to long-term memory when the user explicitly asks ("remember that...") or when the pre-compaction flush identifies durable information. Long-term memory has a soft cap (~20 entries). When it gets too large, the agent is prompted to consolidate or prune stale entries.

#### Layer 3 — Session Summaries

When a session ends or is compacted, a summary is generated and stored. These provide continuity across sessions — when the user starts a new conversation, the agent can reference what happened in recent sessions.

At session start, the last 3 session summaries are loaded into context. For older history, the agent can search summaries via a tool call.

#### Layer 4 — Entity-Aware Search

The agent doesn't need a separate vector index when it has direct access to the TaskEngine database. Instead of semantic search over markdown files, the agent uses tool calls to query:
- Tasks (by name, status, trigger type)
- Artifacts (by title, content, type, task association)
- Runs (by status, task, date range)
- Reviews (by status)
- Session summaries (by content, date)

This is simpler than maintaining embedding indices, and the data is always fresh. If we later find that keyword/vector search adds value (especially for artifact content search), we can add `pg_vector` to Supabase without changing the architecture.

---

## Database Schema

### New Tables

```sql
-- Chat sessions
create table chat_sessions (
  id uuid primary key default gen_random_uuid(),
  title text,  -- null until first assistant response generates one
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Chat messages within a session
create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references chat_sessions(id) on delete cascade,
  role text not null,  -- 'user', 'assistant', 'system'
  content text not null,  -- text content of the message
  tool_calls jsonb not null default '[]',  -- tool invocations (for assistant messages)
  tool_results jsonb not null default '[]',  -- tool results (for tool response messages)
  is_compacted boolean not null default false,  -- true if rolled into a summary
  created_at timestamptz not null default now()
);

-- Long-term curated memory
create table memories (
  id uuid primary key default gen_random_uuid(),
  content text not null,  -- the memory itself
  category text not null default 'general',  -- 'preference', 'fact', 'decision', 'workflow', 'general'
  source_session_id uuid references chat_sessions(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Compressed session summaries (for cross-session continuity)
create table session_summaries (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references chat_sessions(id) on delete cascade,
  summary text not null,
  message_count integer not null,  -- how many messages were summarized
  token_estimate integer,  -- rough token count of the summarized content
  created_at timestamptz not null default now()
);

-- Indexes
create index idx_chat_sessions_created_by on chat_sessions(created_by);
create index idx_chat_sessions_updated_at on chat_sessions(updated_at desc);
create index idx_chat_messages_session_id on chat_messages(session_id);
create index idx_chat_messages_created_at on chat_messages(created_at);
create index idx_memories_created_by on memories(created_by);
create index idx_memories_category on memories(category);
create index idx_session_summaries_session_id on session_summaries(session_id);
```

### RLS

Follow the existing pattern — RLS enabled, scoped to `auth.uid()` via `created_by`. The chat_messages and session_summaries inherit access through their parent session.

### Migration Approach

Migrations are run directly against Supabase using the MCP tools — no migration files committed to the repo. This matches our workflow where schema changes are applied interactively during development.

---

## Agent Tools

The chat agent gets tools that let it operate TaskEngine. These are the actions users can take through conversation.

### System Query Tools

| Tool | Description | Returns |
|---|---|---|
| `list_tasks` | List tasks, optionally filtered by status or trigger type | Task array with title, status, trigger, last run info |
| `get_task` | Get task detail by ID or title search | Full task with plan summary, recent runs |
| `list_artifacts` | Search/filter artifacts by title, type, task, date | Artifact array with title, type, preview |
| `get_artifact` | Read artifact content by ID | Full artifact content |
| `list_runs` | List runs, filtered by task, status, date range | Run array with status, timestamps, output summary |
| `get_run` | Get run detail including node execution info | Full run with node_runs and their outputs |
| `list_reviews` | List pending reviews | Review array with task context and artifact preview |

### Action Tools

| Tool | Description | Side Effects |
|---|---|---|
| `run_task` | Start a run for a task, optionally with specific artifact inputs | Creates a run, dispatches to Inngest |
| `create_task` | Create a new task from a natural language description | Creates task + generates plan |
| `resolve_review` | Approve or reject a pending review | Updates review status, resumes run |
| `create_artifact` | Create a new artifact (document) | Inserts into artifacts table |

### Memory Tools

| Tool | Description | Side Effects |
|---|---|---|
| `save_memory` | Save a fact, preference, or decision to long-term memory | Inserts into memories table |
| `list_memories` | List current long-term memories | Reads from memories table |
| `update_memory` | Update or consolidate an existing memory | Updates memories table |
| `delete_memory` | Remove a stale or incorrect memory | Deletes from memories table |
| `search_sessions` | Search past session summaries for context | Queries session_summaries |

### Utility Tools

| Tool | Description |
|---|---|
| `get_current_date` | Returns current date and time |
| `get_dashboard_summary` | Returns the same data as the dashboard API — pending reviews count, recent activity, upcoming schedules |

---

## System Prompt Design

The system prompt is assembled at the start of each request. It has a fixed structure with dynamic sections:

```
[Identity & Role]
You are the TaskEngine assistant. You help users manage their automated
tasks, review outputs, search documents, and build new workflows through
conversation. You have direct access to the TaskEngine system via tools.

[Current Context]
Today is {date}. The user is {name}.

[Long-Term Memory]
The following is curated context from past interactions:
{memories — all entries from the memories table}

[Recent History]
Summary of recent sessions:
{last 3 session summaries}

[Available Tools]
{tool definitions}

[Behavior Guidelines]
- Use tools proactively. If the user asks about a task, look it up.
- When the user says "remember" or gives you a preference, save it to memory.
- Keep responses concise. The chat panel is narrow — long prose doesn't work.
- When taking actions (starting runs, creating tasks), confirm what you're
  about to do before executing. "I'll start the weekly brief task now — go ahead?"
- For artifact content, show a summary unless the user asks for the full text.
- If you're unsure what task/artifact the user means, list the options and ask.
```

The identity section is static. Everything else is composed per-request from the database.

---

## Sprint Plan

### Sprint 1 — Database & API Foundation

**Status**: Done

**Goal**: Set up the chat data model and core API routes. No UI yet — verify with curl.

**Duration**: 1 day

#### 1.1 Create tables via Supabase MCP

Run the schema directly against Supabase using the MCP tools. Four tables: `chat_sessions`, `chat_messages`, `memories`, `session_summaries`, plus indexes and RLS policies following existing patterns. No migration file in the repo.

#### 1.2 Chat session CRUD API

| Route | Method | Purpose |
|---|---|---|
| `/api/chat/sessions` | GET | List sessions for the current user, ordered by updated_at desc |
| `/api/chat/sessions` | POST | Create a new session (returns session ID) |
| `/api/chat/sessions/[id]` | GET | Get session with its messages (excluding compacted) |
| `/api/chat/sessions/[id]` | DELETE | Delete a session (cascades to messages) |

Follow existing API patterns — use `createServiceClient()` from `server/utils/supabase.ts`, Zod validation via `readValidatedBody()`.

#### 1.3 Memory CRUD API

| Route | Method | Purpose |
|---|---|---|
| `/api/chat/memories` | GET | List all memories for the current user |
| `/api/chat/memories` | POST | Create a memory |
| `/api/chat/memories/[id]` | PATCH | Update a memory |
| `/api/chat/memories/[id]` | DELETE | Delete a memory |

#### 1.4 Verification

```bash
# Create a session
curl -X POST http://localhost:3000/api/chat/sessions
# → { id: "uuid", title: null, created_at: "..." }

# List sessions
curl http://localhost:3000/api/chat/sessions
# → [{ id, title, created_at, updated_at }]

# Create a memory
curl -X POST http://localhost:3000/api/chat/memories \
  -H 'Content-Type: application/json' \
  -d '{"content": "User prefers bullet points", "category": "preference"}'
# → { id, content, category, created_at }
```

#### Definition of Done

- All 4 tables created in Supabase via MCP with indexes and RLS
- Session CRUD works end-to-end
- Memory CRUD works end-to-end
- Follows existing code patterns (service client, Zod, etc.)

---

### Sprint 2 — Chat Agent Core

**Status**: Done

**Goal**: Build the server-side chat agent with tool use, streaming, and memory context loading. The agent can answer questions about the system and take actions. Designed for conversational latency, not task-execution thoroughness.

**Duration**: 2 days

#### Design decision: lightweight chat loop, not heavy agent loop

The existing `agentLoop.ts` (used by `agentTransform` and `agentCode` nodes) is built for durable task execution: high reasoning effort, unlimited tool iterations, no streaming, and a model (`gpt-5.4`) chosen for depth over speed. Chat has different requirements:

| Concern | Task execution loop | Chat loop |
|---|---|---|
| Latency | Seconds to minutes are fine | First token under 1s matters |
| Tool calls | Unbounded, 10-15 iterations | Capped at 3 per turn |
| Streaming | Not needed (results stored) | Required for conversational feel |
| Model | `gpt-5.4` (heavy reasoning) | `gpt-5.4-mini` (fast, strong tool use) |
| Reasoning | `effort: 'high'` | No explicit reasoning param |
| Error handling | Retry and continue | Fail gracefully, tell the user |
| Tone | Execution log | Conversational |

We share the same tool *implementations* (same DB queries, same Supabase client, same run dispatch utilities), but wrap them in a purpose-built chat interface instead of reusing the task agent loop. This keeps the code path predictable: most chat turns are a single model call with zero tool use, some turns use 1-2 tools, and very rarely does a turn hit the 3-tool cap.

#### 2.1 Context assembly (`server/utils/chatContext.ts`)

Function that builds the full context for a chat request:

```typescript
interface ChatContext {
  systemPrompt: string
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  tokenEstimate: number
}

async function assembleChatContext(
  supabase: SupabaseClient,
  sessionId: string
): Promise<ChatContext> {
  // 1. Load all memories for the user
  // 2. Load last 3 session summaries (excluding current session)
  // 3. Load current session's non-compacted messages
  // 4. Compose system prompt from template with memories + summaries injected
  // 5. Estimate tokens (character count / 4)
  // 6. Return system prompt, message array, and token estimate
}
```

The system prompt template lives in the same file as a constant string. Dynamic sections are interpolated:
- `{date}` — today's date
- `{memories}` — bulleted list of all memory entries, grouped by category
- `{recent_sessions}` — last 3 session summaries as dated paragraphs

Memories and summaries go in the system prompt (not as messages) so they don't inflate the conversation history and are clearly distinguished from actual dialogue.

#### 2.2 Chat tool interface and implementations (`server/utils/chatTools/`)

Chat tools share a `ChatTool` interface that is intentionally simpler than the task execution `AgentTool`. The task execution tools need `NodeExecutionContext` (runId, nodeRunId, taskId, inputArtifacts). Chat tools only need a Supabase client and optional user/session info.

```typescript
interface ChatToolContext {
  supabase: SupabaseClient<Database>
  userId: string | null
  sessionId: string
}

interface ChatTool {
  name: string
  description: string
  parameters: Record<string, unknown>  // JSON Schema object
  execute: (args: Record<string, unknown>, ctx: ChatToolContext) => Promise<string>
}
```

Every tool's `execute` returns a plain string. The chat loop feeds this string back to the model as the tool result. Tools should format their output for readability (the model will summarize for the user, but concise structured output helps).

```
server/utils/chatTools/
├── index.ts              -- registry: exports allChatTools array + toolsByName map
├── listTasks.ts
├── getTask.ts
├── runTask.ts            -- reuses createPendingRunForTask + sendRunStartEvent
├── listArtifacts.ts
├── getArtifact.ts
├── listRuns.ts
├── getRun.ts
├── listReviews.ts
├── resolveReview.ts      -- reuses same logic as PATCH /api/reviews/[id]
├── saveMemory.ts
├── listMemories.ts
├── updateMemory.ts
├── deleteMemory.ts
├── searchSessions.ts
├── getCurrentDate.ts
└── getDashboardSummary.ts
```

Each file exports a single `ChatTool`. The registry (`index.ts`) collects them into an array for the chat loop and a name-keyed map for execution dispatch.

#### 2.3 Chat streaming loop (`server/utils/chatLoop.ts`)

The core chat orchestrator. Unlike the task execution `agentLoop.ts`, this is built around streaming and bounded tool use.

```typescript
interface ChatLoopConfig {
  openai: OpenAI
  model: string                        // default: 'gpt-5.4-mini'
  systemPrompt: string
  messages: ChatContext['messages']
  tools: ChatTool[]
  toolContext: ChatToolContext
  maxToolRounds: number                // default: 3
}

interface ChatEvent {
  type: 'text-delta' | 'tool-call' | 'tool-result' | 'error' | 'done'
  // text-delta: { delta: string }
  // tool-call: { name: string, arguments: string }
  // tool-result: { name: string, output: string }
  // error: { message: string }
  // done: { fullText: string }
}

async function* runChatLoop(config: ChatLoopConfig): AsyncGenerator<ChatEvent>
```

Flow:

1. Build the OpenAI Responses API input array from system prompt + message history
2. Call `openai.responses.create({ stream: true, model, input, tools, ... })`
3. Iterate the stream:
   - On text deltas → yield `text-delta` events immediately (this is what makes it feel fast)
   - On `function_call` output items → yield `tool-call` event, then execute the tool
4. After all function calls in one response are processed, yield `tool-result` events
5. If there were tool calls and `toolRound < maxToolRounds`, make another streaming call with the tool results appended to the input, then repeat from step 3
6. If there were no tool calls (pure text response), yield `done` with the full assembled text
7. If `maxToolRounds` is reached, yield `done` with whatever text the model produced last

Key differences from `agentLoop.ts`:
- **Streaming**: yields events as they arrive instead of waiting for complete responses
- **Bounded**: hard cap on tool rounds, not just max iterations
- **No reasoning param**: uses the model's default behavior, which is faster
- **No `previous_response_id` chaining**: builds the input array explicitly so we control what the model sees
- **Generator-based**: the endpoint can pipe events to SSE as they're yielded

#### 2.4 Chat streaming endpoint (`server/api/chat/sessions/[id].post.ts`)

The main chat endpoint. Receives a user message, streams the response via SSE.

```typescript
// Request body
{ message: string }

// Response: SSE stream (text/event-stream)
// Each event is a JSON line:
//   data: {"type":"text-delta","delta":"Hello"}
//   data: {"type":"tool-call","name":"list_tasks","arguments":"{}"}
//   data: {"type":"tool-result","name":"list_tasks","output":"Found 3 tasks..."}
//   data: {"type":"text-delta","delta":" here are your tasks:"}
//   data: {"type":"title","title":"Task Overview"}
//   data: {"type":"done","fullText":"Hello, here are your tasks: ..."}
```

Flow:
1. Validate request body (message string via Zod)
2. Verify session exists and belongs to the user
3. Insert user message into `chat_messages` (role: 'user')
4. Assemble context via `assembleChatContext`
5. If token estimate exceeds compaction threshold, run compaction first
6. Open SSE stream via `createEventStream(event)` (same pattern as run streaming)
7. Start `runChatLoop` generator
8. For each yielded `ChatEvent`, serialize and push to the SSE stream
9. On `done`, persist the full assistant message to `chat_messages`
10. If this is the session's first message exchange (no prior assistant messages), fire title generation in the background and push a `title` event when it resolves
11. Close the stream

Uses Nitro's `createEventStream` which is already used by `server/api/runs/[id]/stream.get.ts`. No new streaming dependencies needed.

The SSE event format is intentionally simple JSON lines. Sprint 3's frontend will parse these directly rather than depending on `@ai-sdk/vue`, keeping the dependency surface small. If we want AI SDK compatibility later, we can add an adapter without changing the backend.

#### 2.5 Title generation

After the first assistant response, generate a short title in the background (non-blocking):

```typescript
const titleResult = await openai.responses.create({
  model: 'gpt-5.4-nano',
  input: `Generate a 3-6 word title for this conversation:\n\nUser: ${userMessage}\nAssistant: ${assistantResponse}`,
})
await supabase.from('chat_sessions').update({ title: titleResult.output_text }).eq('id', sessionId)
```

Push the title through the SSE stream as a `title` event before the final `done` event. The client updates the sidebar/header without refetching.

#### 2.6 Compaction logic (`server/utils/chatCompaction.ts`)

Triggered when `assembleChatContext` reports a token estimate above the compaction threshold. Runs synchronously before the chat loop starts (the user sees a brief delay on that one turn, which is acceptable since it only triggers after very long conversations).

Steps:
1. **Summarize**: Call `gpt-5.4-mini` with the messages that will be compacted, asking for a 2-3 paragraph summary of the conversation so far
2. **Store summary**: Insert into `session_summaries` with message count and token estimate
3. **Mark messages**: Set `is_compacted = true` on the older messages
4. **Re-assemble**: The subsequent `assembleChatContext` call will use the summary instead of the raw messages

The pre-compaction memory flush from the original plan (asking the agent to save memories before compacting) adds another full model round-trip that blocks the user. Instead, we rely on the agent's natural behavior during conversation: the system prompt instructs it to save important information to memory proactively. If something was worth remembering, the agent should have already saved it by the time compaction triggers. This is simpler and avoids a confusing hidden agent pass.

Configuration:
- Compaction threshold: 60K estimated tokens
- Messages to keep uncompacted: the most recent 10 messages (ensures the model always has recent conversational context even after compaction)

#### 2.7 Verification

```bash
# Send a message and get a streamed response
curl -N -X POST http://localhost:3000/api/chat/sessions/{session_id} \
  -H 'Content-Type: application/json' \
  -d '{"message": "What tasks do I have?"}'
# → SSE stream with text-delta events listing the user's tasks

# Ask the agent to take action
curl -N -X POST http://localhost:3000/api/chat/sessions/{session_id} \
  -H 'Content-Type: application/json' \
  -d '{"message": "Run the weekly safety brief"}'
# → tool-call event (run_task), tool-result event, then text-delta confirming run started

# Test memory
curl -N -X POST http://localhost:3000/api/chat/sessions/{session_id} \
  -H 'Content-Type: application/json' \
  -d '{"message": "Remember that I prefer markdown tables for data summaries"}'
# → tool-call event (save_memory), tool-result event, then text-delta confirming saved

# Verify title generation (after first exchange)
curl http://localhost:3000/api/chat/sessions/{session_id}
# → { id, title: "Task Overview", messages: [...] }
```

#### Definition of Done

- Context assembly loads memories, summaries, and messages correctly
- All chat tools execute against the real database via the `ChatTool` interface
- Streaming works end-to-end via SSE (text deltas, tool calls, tool results, title)
- Tool use is bounded at 3 rounds per turn
- Memory save/read cycle works across sessions
- Compaction triggers at threshold and keeps conversations functional
- Agent can list tasks, start runs, search artifacts, and manage reviews through conversation
- First token latency is noticeably faster than a `gpt-5.4` with `reasoning: high` call

---

### Sprint 3 — Chat Slideover UI

**Status**: Done

**Goal**: Build the chat slideover that's accessible from every page. Streaming messages, session switching, and basic history.

**Duration**: 2 days

#### 3.1 Global chat state composable (`composables/useChat.ts`)

A global composable (via `useState`) that manages:

```typescript
const useGlobalChat = () => {
  const isOpen = useState('chat-open', () => false)
  const currentSessionId = useState<string | null>('chat-session', () => null)
  const sessions = useState<ChatSession[]>('chat-sessions', () => [])

  // Toggle slideover
  function toggle() { isOpen.value = !isOpen.value }

  // Create new session and set as current
  async function newSession() { ... }

  // Switch to an existing session
  async function switchSession(id: string) { ... }

  // Refresh session list
  async function refreshSessions() { ... }

  return { isOpen, currentSessionId, sessions, toggle, newSession, switchSession, refreshSessions }
}
```

The chat composable handles session lifecycle. The actual message state and streaming are handled by a lightweight SSE consumer inside the chat component that parses the `ChatEvent` JSON lines from Sprint 2's endpoint. No external AI SDK dependency needed.

#### 3.2 Chat slideover component (`components/ChatSlideover.vue`)

Rendered in the default layout. Uses `USlideover` with `side="right"`.

Structure:
- **Header**: Session title (or "New Chat"), session switcher dropdown, new session button, close button
- **Messages area**: Scrollable message list with streaming support
- **Input area**: Text input with send button, keyboard shortcut hints

The messages area renders:
- **User messages**: Right-aligned, neutral background
- **Assistant messages**: Left-aligned, with markdown rendering (reuse `ReadOnlyMarkdown.vue`)
- **Tool call indicators**: Compact inline cards ("Searching tasks...", "Starting run...", "Saving memory...") that resolve to a summary ("Found 3 tasks", "Run started: abc123", "Preference saved")
- **Streaming text**: Renders incrementally as tokens arrive

The slideover is ~400px wide (configurable) and uses the same font/color tokens as the rest of the dashboard.

#### 3.3 Chat input component (`components/ChatInput.vue`)

A focused input component:
- Auto-expanding textarea (1 line → up to 6 lines)
- Send on Enter, newline on Shift+Enter
- Disabled state while streaming
- Subtle placeholder: "Ask anything or give an instruction..."
- Optional context chips showing current page context (e.g., "Viewing: Weekly Safety Brief task" when on a task detail page)

#### 3.4 Chat message components

- `ChatMessageUser.vue` — User bubble with timestamp
- `ChatMessageAssistant.vue` — Assistant bubble with markdown rendering, copy button
- `ChatToolCall.vue` — Compact tool call indicator (pending → resolved states)

These are intentionally simple. Each message is rendered from the `ChatEvent` stream format defined in Sprint 2. Text deltas accumulate into the assistant message body. Tool calls and results render as inline status indicators within the message flow.

#### 3.5 Layout integration

Update `layouts/default.vue`:
- Add `ChatSlideover` component
- Add floating chat button (bottom-right corner, `UButton` with chat icon)
- Add keyboard shortcut: `c` toggles the chat (add to `useDashboard` shortcuts)
- The slideover renders over the page content, not alongside it (no layout shift)

#### 3.6 Page context awareness

The chat input can include contextual hints based on the current route:

| Route | Context sent with message |
|---|---|
| `/tasks/[id]` | `viewing_task: {task_id}` |
| `/artifacts/[id]` | `viewing_artifact: {artifact_id}` |
| `/runs/[id]` | `viewing_run: {run_id}` |
| `/reviews` | `viewing_page: reviews` |

This context is sent as metadata with the user's message, and the system prompt includes: "The user is currently viewing {context}. If their message seems related, use the relevant tools to pull up that entity's information."

#### 3.7 Verification

- Open any dashboard page, click the chat button → slideover opens
- Type "What tasks do I have?" → agent lists tasks with streaming text
- Type "Run the weekly brief" → agent confirms and starts the run
- Close slideover, navigate to another page, reopen → conversation persists
- Start a new session → fresh conversation, previous session still in history

#### Definition of Done

- Chat slideover opens from every page via button or keyboard shortcut
- Messages stream in with markdown rendering
- Tool calls show as compact indicators that resolve to summaries
- Session state persists across page navigations
- New session / switch session works
- Input handles Enter/Shift+Enter correctly
- No layout shift when opening/closing

---

### Sprint 4 — Full Chat Page & Session History

**Status**: Done

**Goal**: Build the dedicated `/chat` page as a spacious chat workspace without introducing a second always-visible sidebar inside the dashboard shell.

**Duration**: 1 day

#### 4.1 Chat page (`pages/chat/index.vue`)

A full-page chat experience for longer conversations. The page should prioritize the active conversation, not the archive. Since the app already has a primary dashboard sidebar, adding a pinned session sidebar on `/chat` would create a double-navigation layout and make history feel louder than the conversation itself.

Layout:

```
┌──────────────────────────────────────────────┐
│ Chat                       [History] [+ New] │
│ Ask about tasks, runs, reviews, and docs.    │
├──────────────────────────────────────────────┤
│                                              │
│               [messages...]                  │
│                                              │
│                                              │
├──────────────────────────────────────────────┤
│               [input area]                   │
└──────────────────────────────────────────────┘
```

If there is an active session, the page shows the conversation immediately.

If there is no active session yet, the page renders a meaningful null state instead of auto-opening the most recent conversation. The null state should include:
- A short explanation of what chat can do
- Primary actions: "Start new chat" and "Open history"
- A "Recent conversations" section inline on the page, grouped by date (Today, Yesterday, Last Week, etc.)
- Optional starter prompts for common actions

This keeps the first screen focused while still making history visible when it is most helpful.

Use `UDashboardPanel` for the main page container if helpful, but do not add a second persistent left rail inside the existing layout.

#### 4.2 Session history components

Replace the dedicated full-height sidebar concept with progressive disclosure:

- `ChatSessionHistoryList.vue` — shared grouped session list with search, active state, timestamps, and delete action
- `ChatSessionHistorySlideover.vue` — on-demand history browser opened from a "History" button on the chat page

Behavior:
- Sessions are grouped by date following the Nuxt UI chat template's `useChats` grouping pattern
- Search/filter matches titles and summaries
- Active session is highlighted
- Delete action requires confirmation
- Selecting a session from either the null state or the history slideover loads it into the main conversation area

The same grouped list component should be reused in two places:
- Inline in the `/chat` null state
- Inside the history slideover

#### 4.3 Routing and shared state

- `/chat` → shows the current active session if one already exists in shared state; otherwise shows the chat null state with recent history
- `/chat/[id]` → opens a specific session

The slideover and the full page continue to share the same composable and session state. Opening a session in the global chat slideover and then navigating to `/chat` shows that same session.

To support the null state cleanly, update the shared chat composable behavior:
- Do not force-load the most recent session just because sessions were fetched
- Allow `currentSessionId` to remain `null`
- Expose grouped sessions and session deletion helpers
- If the active session is deleted, return the page to the null state rather than silently switching to another conversation

#### 4.4 Sidebar navigation update

Add "Chat" to the main dashboard sidebar navigation, positioned prominently:

```
[Logo]

Home
Chat                  ← new
Reviews (with badge)

Tasks
Workflows
Schedules

Documents
Activity
```

Use the `i-lucide-message-square` icon.

#### Definition of Done

- Full chat page with spacious message area and no second persistent sidebar
- Null state shows recent session history grouped by date
- Session history is accessible from an on-demand slideover
- Session switching, creation, search, and deletion work
- Sidebar slideover and full page share the same session state
- Chat added to main navigation

---

### Sprint 5 — Memory Management & Polish

**Goal**: Expose memory management to the user, add session summarization on close, and polish the experience.

**Duration**: 1-2 days

#### 5.1 Memory management UI

A section in the chat settings (or a dedicated `/chat/memory` page) where users can:
- View all long-term memories, grouped by category
- Edit memory content inline
- Delete individual memories
- See which session created each memory

This is a simple CRUD interface using `UTable` or a card list. Most memory management happens through conversation ("remember that...", "forget that preference"), but the UI provides visibility and manual control.

#### 5.2 Session summary on close

When a user explicitly ends a session (closes it or starts a new one), generate a summary if the session has more than 5 messages and no summary exists yet. This runs in the background (doesn't block the UI).

The summary captures: what the user wanted, what actions were taken, what decisions were made, and any unresolved items.

#### 5.3 Typing indicators and tool progress

Polish the streaming UX:
- Show a typing indicator (animated dots) while waiting for the first token
- Tool calls show a subtle animation while executing
- Tool results show a brief summary that can be expanded for the full output
- Action confirmations (run started, review resolved) show as structured cards with links to the relevant entity

#### 5.4 Error handling

- Network errors during streaming: show a retry button on the last message
- Tool execution failures: show inline in the conversation ("I tried to start the run but got an error: {message}. Would you like me to try again?")
- Session load failures: show error state with retry
- Rate limiting: queue messages if the user types faster than the agent can respond

#### 5.5 Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `c` | Toggle chat slideover |
| `Escape` | Close chat slideover |
| `Cmd+Shift+C` | Open full chat page |
| `Cmd+N` (in chat) | New session |

Add these to `useDashboard` shortcuts.

#### Definition of Done

- Users can view and manage their long-term memories
- Sessions are summarized automatically when sufficient content exists
- Streaming UX is polished (typing indicator, tool progress, error handling)
- Keyboard shortcuts work throughout the app
- Memory persists correctly across sessions (verified by starting a new session and referencing a preference saved in a previous one)

---

## File Structure

New and modified files:

```
dashboard/server/
├── api/chat/
│   ├── sessions.get.ts                   # NEW — list sessions
│   ├── sessions.post.ts                  # NEW — create session
│   ├── sessions/[id].get.ts             # NEW — get session with messages
│   ├── sessions/[id].post.ts            # NEW — send message (streaming)
│   ├── sessions/[id].delete.ts          # NEW — delete session
│   ├── memories.get.ts                   # NEW — list memories
│   ├── memories.post.ts                  # NEW — create memory
│   └── memories/[id].patch.ts           # NEW — update memory
│   └── memories/[id].delete.ts          # NEW — delete memory
├── utils/
│   ├── chatContext.ts                    # NEW — context assembly (memories + summaries + messages)
│   ├── chatCompaction.ts                # NEW — compaction + pre-flush logic
│   └── chatTools/
│       ├── index.ts                     # NEW — tool registry
│       ├── listTasks.ts                 # NEW
│       ├── getTask.ts                   # NEW
│       ├── runTask.ts                   # NEW
│       ├── createTask.ts               # NEW
│       ├── listArtifacts.ts            # NEW
│       ├── getArtifact.ts              # NEW
│       ├── listRuns.ts                 # NEW
│       ├── getRun.ts                   # NEW
│       ├── listReviews.ts             # NEW
│       ├── resolveReview.ts           # NEW
│       ├── saveMemory.ts              # NEW
│       ├── listMemories.ts           # NEW
│       ├── updateMemory.ts           # NEW
│       ├── deleteMemory.ts           # NEW
│       ├── searchSessions.ts          # NEW
│       ├── getCurrentDate.ts          # NEW
│       └── getDashboardSummary.ts     # NEW

dashboard/app/
├── composables/
│   └── useGlobalChat.ts                 # NEW — global chat state
├── components/
│   ├── ChatSlideover.vue                # NEW — slideover wrapper
│   ├── ChatInput.vue                    # NEW — message input
│   ├── ChatMessageUser.vue              # NEW — user message bubble
│   ├── ChatMessageAssistant.vue         # NEW — assistant message with markdown
│   ├── ChatToolCall.vue                 # NEW — tool call indicator
│   ├── ChatSessionHistoryList.vue       # NEW — grouped session list
│   └── ChatSessionHistorySlideover.vue  # NEW — on-demand session history
├── pages/
│   └── chat/
│       ├── index.vue                    # NEW — full chat page
│       └── [id].vue                     # NEW — specific session
├── layouts/
│   └── default.vue                      # MODIFIED — add ChatSlideover, floating button, shortcut
```

---

## Dependencies

### New npm packages

No new npm packages required.

The chat backend uses the existing `openai` SDK (already in `package.json`) for model calls and Nitro's built-in `createEventStream` for SSE streaming (already used by `server/api/runs/[id]/stream.get.ts`). The frontend will consume the SSE stream with a lightweight custom composable, following the same pattern as `useRunStream.ts`. This keeps the dependency surface small and avoids coupling to the Vercel AI SDK's streaming protocol.

### No new environment variables

The chat agent uses the same OpenAI API key and Supabase credentials already configured.

---

## What This Intentionally Excludes

- **File uploads in chat**: No image or document upload through the chat interface (yet). Users upload artifacts through the existing UI and reference them in conversation.
- **Voice input**: Text only for now.
- **Multi-user chat**: Single-user sessions. No shared conversations.
- **Autonomous agent actions**: The agent always confirms before taking destructive actions (deleting, modifying). Read-only queries execute immediately.
- **Custom tool creation**: Users can't add their own tools through chat. Tool set is fixed.
- **Embedding/vector search**: We use direct DB queries instead. Can add `pg_vector` later if needed.
- **Notification integration**: The chat doesn't push notifications. It's pull-based (user opens chat).

---

## Open Questions

1. **AI SDK vs. custom streaming**: The Nuxt UI chat template uses the Vercel AI SDK for streaming. Our existing run streaming uses custom SSE via `useRunStream`. Should we standardize on the AI SDK for chat, or build a custom solution that's more consistent with existing patterns? (Recommendation: AI SDK for chat, keep custom SSE for runs since they have different streaming semantics.)

2. **Model selection**: Should the chat agent use the same model as task execution (`gpt-5.4`), or a faster/cheaper model for conversational responses? Recommendation: `gpt-5.4-mini` for most interactions, with the option to escalate to `gpt-5.4` for complex tool-use chains.

3. **Memory capacity**: How many long-term memories before we prompt consolidation? OpenClaw doesn't enforce a hard limit but relies on the agent's judgment. Recommendation: Soft cap at 30 entries, with a periodic consolidation prompt.

4. **Session auto-expiry**: Should old sessions be archived or deleted after N days? Or keep everything forever? Recommendation: Keep everything, but only load the most recent 50 sessions in the sidebar. Older sessions are accessible via search.

5. **Context page awareness**: How much current-page context should be sent with each message? Sending the full task detail when the user is on `/tasks/[id]` adds tokens but makes "run this task" unambiguous. Recommendation: Send entity ID + title, let the agent tool-call for details if needed.

---

## Summary

| Sprint | Focus | Duration | Key Deliverables |
|---|---|---|---|
| 1 | Database & API foundation | 1 day | Schema via Supabase MCP, session CRUD, memory CRUD |
| 2 | Chat agent core | 2 days | Context assembly, 17 tools, streaming endpoint, compaction |
| 3 | Chat slideover UI | 2 days | Slideover component, message rendering, input, layout integration |
| 4 | Full chat page & history | 1 day | Dedicated page, null state history, history slideover, navigation |
| 5 | Memory management & polish | 1-2 days | Memory UI, session summaries, typing indicators, shortcuts |

**Total estimated time: 7-8 days.** Sprint 1-2 are backend. Sprint 3-4 are frontend. Sprint 5 is polish and the memory management interface.

The system is designed to grow. Adding new tools is a matter of writing a new module in `chatTools/`. Adding vector search later means adding `pg_vector` to Supabase and a new tool. The memory architecture handles session continuity without requiring the entire history to be loaded every time.
