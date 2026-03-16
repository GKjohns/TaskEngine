# Chat Interface — Implementation Plan

**A conversational interface for TaskEngine, with OpenClaw-inspired memory and the ability to take action.**
Last updated: 2026-03-16

> **Status: Planning**

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
       └─ Stream response back via UIMessageStream
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

**Goal**: Build the server-side chat agent with tool use, streaming, and memory context loading. The agent can answer questions about the system and take actions.

**Duration**: 2 days

#### 2.1 Context assembly (`server/utils/chatContext.ts`)

Function that builds the full context for a chat request:

```typescript
async function assembleChatContext(sessionId: string): Promise<{
  systemPrompt: string
  messages: Message[]
}> {
  // 1. Load long-term memories
  // 2. Load last 3 session summaries (excluding current session)
  // 3. Load current session's non-compacted messages
  // 4. Compose system prompt with memories + summaries
  // 5. Return system prompt + message history
}
```

The system prompt is built from a template string with the dynamic sections filled in. The memories are formatted as a bulleted list. Session summaries are formatted as dated paragraphs.

#### 2.2 Tool implementations (`server/utils/chatTools/`)

Each tool is a module that exports an OpenAI-compatible tool definition and an execution function.

```
server/utils/chatTools/
├── index.ts          -- registry, exports all tools
├── listTasks.ts
├── getTask.ts
├── runTask.ts
├── createTask.ts
├── listArtifacts.ts
├── getArtifact.ts
├── listRuns.ts
├── getRun.ts
├── listReviews.ts
├── resolveReview.ts
├── saveMemory.ts
├── listMemories.ts
├── updateMemory.ts
├── deleteMemory.ts
├── searchSessions.ts
├── getCurrentDate.ts
└── getDashboardSummary.ts
```

Each tool follows this shape:

```typescript
export const listTasksTool = {
  type: 'function' as const,
  name: 'list_tasks',
  description: 'List tasks, optionally filtered by status or trigger type.',
  parameters: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['active', 'paused', 'archived'] },
      trigger_type: { type: 'string', enum: ['manual', 'scheduled', 'heartbeat'] }
    }
  },
  execute: async (args: any, supabase: SupabaseClient) => {
    // Query tasks table, return formatted result
  }
}
```

The `runTask` and `createTask` tools reuse existing server utilities (`createPendingRunForTask`, `sendRunStartEvent`, plan generation from `planGenerator.ts`).

The `resolveReview` tool calls the same logic as `PATCH /api/reviews/[id]`.

#### 2.3 Chat streaming endpoint (`server/api/chat/sessions/[id].post.ts`)

The main chat endpoint. Receives a user message, streams the agent response.

Flow:
1. Validate request body (message text, optional attachments)
2. Insert user message into `chat_messages`
3. Assemble context (system prompt + memories + summaries + history)
4. Call OpenAI with streaming and tools enabled
5. Handle tool calls in a loop (execute tool, feed result back)
6. Stream response tokens to the client
7. On completion, persist assistant message to `chat_messages`
8. If this is the first message, generate a session title and update `chat_sessions`

Uses the OpenAI Responses API (consistent with existing `server/utils/openai.ts`). The streaming format follows the Vercel AI SDK's `UIMessageStream` pattern from the Nuxt UI chat template — this gives us compatibility with the `@ai-sdk/vue` `Chat` class on the frontend.

Token counting is approximate (character count / 4). When the assembled context exceeds ~80K tokens, trigger compaction before processing the new message.

#### 2.4 Title generation

After the first assistant response, generate a short title for the session:

```typescript
const titleResult = await openai.responses.create({
  model: 'gpt-4.1-nano',
  input: `Generate a 3-6 word title for this conversation:\n\nUser: ${userMessage}\nAssistant: ${assistantResponse}`,
})
await supabase.from('chat_sessions').update({ title: titleResult.output_text }).eq('id', sessionId)
```

Send the title back through the stream as a custom data event so the client can update the sidebar without refetching.

#### 2.5 Compaction logic (`server/utils/chatCompaction.ts`)

When the context exceeds the token threshold:

1. **Pre-compaction memory flush**: Send a hidden system message asking the agent to save any durable information to long-term memory. Process tool calls silently (don't stream to the client).
2. **Generate summary**: Summarize the messages that will be compacted into a single paragraph.
3. **Store summary**: Insert into `session_summaries`.
4. **Mark messages**: Set `is_compacted = true` on the older messages.
5. **Continue**: The next context assembly will use the summary instead of the raw messages.

Configuration:
- Context limit: ~80K tokens (leaves room for the response)
- Compaction threshold: when total context exceeds 60K tokens
- Pre-flush prompt: "This session is approaching its context limit. Review the conversation and save any important facts, preferences, or decisions to long-term memory using the save_memory tool. Reply with NO_REPLY when done."

#### 2.6 Verification

```bash
# Send a message and get a streamed response
curl -N -X POST http://localhost:3000/api/chat/sessions/{id} \
  -H 'Content-Type: application/json' \
  -d '{"message": "What tasks do I have?"}'
# → Streamed response listing the user's tasks

# Ask the agent to take action
curl -N -X POST http://localhost:3000/api/chat/sessions/{id} \
  -H 'Content-Type: application/json' \
  -d '{"message": "Run the weekly safety brief"}'
# → Agent uses run_task tool, confirms the run was started

# Test memory
curl -N -X POST http://localhost:3000/api/chat/sessions/{id} \
  -H 'Content-Type: application/json' \
  -d '{"message": "Remember that I prefer markdown tables for data summaries"}'
# → Agent uses save_memory tool, confirms the preference was saved
```

#### Definition of Done

- Context assembly loads memories, summaries, and messages correctly
- All tools execute against the real database
- Streaming works end-to-end (tool calls, text, title generation)
- Memory save/read cycle works across sessions
- Compaction logic handles long conversations gracefully
- Agent can list tasks, start runs, search artifacts, and manage reviews through conversation

---

### Sprint 3 — Chat Slideover UI

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

The chat composable handles session lifecycle. The actual message state and streaming are handled by `@ai-sdk/vue`'s `Chat` class inside the chat component (following the Nuxt UI template pattern).

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

These are intentionally simple. The Nuxt UI chat template uses the AI SDK's native `UIMessage.parts` format, which handles text, tool calls, and tool results as a unified message structure. We follow the same pattern.

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

**Goal**: Build the dedicated `/chat` page with full session history sidebar and a more spacious conversation view.

**Duration**: 1 day

#### 4.1 Chat page (`pages/chat/index.vue`)

A full-page chat experience for longer conversations. Layout:

```
┌──────────────────────────────────────────────┐
│  Session Sidebar  │      Active Chat         │
│                   │                          │
│  [+ New Chat]     │  [messages...]           │
│                   │                          │
│  Today            │                          │
│   ├ Safety brief  │                          │
│   └ Compliance Q  │                          │
│                   │                          │
│  Yesterday        │                          │
│   └ Task setup    │  [input area]            │
└──────────────────────────────────────────────┘
```

Uses `UDashboardPanel` for the sidebar and main area (consistent with the existing dashboard layout pattern). The session sidebar groups sessions by date (Today, Yesterday, Last Week, etc.) following the Nuxt UI chat template's `useChats` grouping pattern.

#### 4.2 Session history sidebar component (`components/ChatSessionSidebar.vue`)

- Lists all sessions grouped by date
- Active session is highlighted
- Each session shows title and relative timestamp
- Right-click or hover reveals delete action (with confirmation)
- "New Chat" button at the top
- Search/filter for sessions (searches titles and summaries)

#### 4.3 Routing

- `/chat` → shows the chat page with the most recent session (or creates one)
- `/chat/[id]` → opens a specific session

The slideover and the full page share the same composable and session state. Opening a session in the slideover and then navigating to `/chat` shows the same session.

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

- Full chat page with session sidebar and spacious message area
- Session history grouped by date
- Session switching, creation, and deletion work
- Sidebar and full page share the same session state
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
│   └── ChatSessionSidebar.vue          # NEW — session list for full page
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

| Package | Purpose |
|---|---|
| `@ai-sdk/vue` | Vue integration for streaming chat (Chat class, DefaultChatTransport) |
| `ai` | Vercel AI SDK core (UIMessageStream, streamText) |
| `@ai-sdk/openai` | OpenAI provider for AI SDK |

The Nuxt UI chat template uses these exact packages. They provide the streaming protocol, message management, and Vue reactivity bindings that would be tedious to build from scratch.

Alternatively, if we want to stay closer to the existing pattern (direct OpenAI SDK + custom SSE), we can skip these and use the same approach as `useRunStream.ts` with a custom composable. The tradeoff is more custom code but fewer dependencies. **Recommendation**: Use the AI SDK. The streaming protocol handling alone saves significant work, and the Chat class handles optimistic updates, error recovery, and message state management.

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

2. **Model selection**: Should the chat agent use the same model as task execution (`gpt-4.1`), or a faster/cheaper model for conversational responses? Recommendation: `gpt-4.1-mini` for most interactions, with the option to escalate to `gpt-4.1` for complex tool-use chains.

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
| 4 | Full chat page & history | 1 day | Dedicated page, session sidebar, navigation |
| 5 | Memory management & polish | 1-2 days | Memory UI, session summaries, typing indicators, shortcuts |

**Total estimated time: 7-8 days.** Sprint 1-2 are backend. Sprint 3-4 are frontend. Sprint 5 is polish and the memory management interface.

The system is designed to grow. Adding new tools is a matter of writing a new module in `chatTools/`. Adding vector search later means adding `pg_vector` to Supabase and a new tool. The memory architecture handles session continuity without requiring the entire history to be loaded every time.
