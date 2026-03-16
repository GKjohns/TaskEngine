# Dashboard Redesign — Plan

**Reframe the dashboard around the user's work, not the system's internals.**
Last updated: 2026-03-16

> **Status: Complete**
> Branch: `dashboard-redesign`

---

## The Problem

The current dashboard is an ops console for the runtime. It speaks in system concepts — runs, nodes, jobs, artifacts, statuses. That made sense during the MVP build when the audience was the developer. But the people who'd actually benefit from Task Engine don't think in those terms.

An operations manager at a trucking company monitoring compliance reports, an office admin at a construction firm synthesizing daily logs, a compliance coordinator reviewing policy updates — these people have paperwork to manage and patterns in their work that AI could handle. They're not going to learn a new vocabulary of "runs" and "node types" to get value from the tool.

The dashboard needs to answer three questions in three seconds:

1. **What happened while I was gone?** (Recent output, completions, changes)
2. **What needs my attention right now?** (Reviews, failures, overdue items)
3. **What's coming up?** (Scheduled work, upcoming deadlines)

Everything else is secondary.

---

## User Personas

### Linda — Operations Manager, Regional Trucking Company

Linda manages a team of 8 dispatchers and handles compliance reporting for a fleet of 120 trucks. Every Monday she compiles a safety summary from the week's incident reports. Every day she scans driver logs for anomalies. She gets 60+ emails a day and misses things constantly.

She uses Excel, Outlook, and a legacy TMS (transportation management system). She's heard of "AI tools" but hasn't found one that fits her workflow. She doesn't want to learn to code or build automations — she wants to describe what she needs done and have it happen.

**TaskEngine value**: She sets up a heartbeat task that watches for new incident reports, summarizes them, and flags anything that looks like a pattern. She sets up a scheduled Monday morning task that compiles the weekly safety brief and pauses for her review before filing it.

**Dashboard needs**: She opens TaskEngine once or twice a day. She wants to see: did anything get flagged overnight? Is my Monday brief ready for review? What documents were produced since yesterday? She does NOT want to see: run IDs, node execution graphs, system health metrics.

### Ray — Office Administrator, Mid-Size Construction Firm

Ray handles paperwork for 6 active job sites. Daily field reports come in as PDFs and emails. He turns them into weekly owner's reports and tracks change orders. He spends half his day reformatting information from one document into another.

He uses Word, basic cloud storage, and a shared inbox. He's organized but overwhelmed by volume. He'd describe himself as "not great with computers but I figure things out."

**TaskEngine value**: He uploads batches of daily logs and site reports. A task summarizes each day's reports, another compiles the weekly owner's report, and a review checkpoint lets him sanity-check the output before it's finalized.

**Dashboard needs**: He wants to see what documents are ready for him. He wants to approve things quickly. He wants to find the report that was generated last Tuesday without digging through folders.

### Marta — Compliance Coordinator, Healthcare Practice Group

Marta tracks regulatory changes across 3 state jurisdictions. When policy updates are published, she needs to compare them against current internal procedures, identify gaps, and draft updated procedure documents for attorney review.

She's methodical, detail-oriented, and skeptical of AI. She needs to verify everything before it goes out. The review step is the most important part of her workflow.

**TaskEngine value**: Heartbeat tasks watch for regulatory updates. When something changes, an agent analyzes the delta against current procedures and drafts a gap report for her review. She edits, approves, and the final document is stored.

**Dashboard needs**: Reviews are her entire workflow. She wants the review experience to be fast and trustworthy — show her what changed, what the AI wrote, and let her edit inline. Everything else is secondary.

---

## Design Principles for the Redesign

### 1. Lead with output, not status

The current dashboard leads with system status ("3 active tasks · 5 scheduled · 12 completed"). That's a health dashboard. Real users want to see what the system PRODUCED. A completed summary, a drafted brief, a flagged anomaly — the artifacts are the value. Show them.

### 2. Reviews are the main event

The human-in-the-loop moment is where trust gets built. Reviews should not be one item in a list. On the dashboard, the first pending review should be expanded with enough context to act on immediately — the artifact content, the task that produced it, and clear approve/reject actions.

### 3. Use human language, not system language

"Weekly Safety Brief is ready for your review" is better than "Run abc123 waiting_review." "3 new documents since yesterday" is better than "3 artifacts created." The data model stays the same; the labels change.

### 4. Progressive disclosure, not upfront complexity

Linda doesn't need to see the node execution graph. Ray doesn't care about Inngest job metadata. These things should be accessible (for debugging, for power users) but never on the first screen. The dashboard is the newspaper front page, not the full edition.

### 5. Artifact previews everywhere

Artifacts are the actual work product. Whenever the dashboard references an artifact — in the activity feed, in a review, in the schedule sidebar — show a meaningful preview. Title + type + first line of content, at minimum.

---

## Sprint Plan

### Sprint 1 — Dashboard Information Architecture

> **Status: Complete**

**Goal**: Restructure the home page so it answers "what needs attention?" and "what happened?" using language a non-technical user understands.

#### 1.1 Attention Center (replaces status hero + attention items)

The top of the dashboard becomes a focused "Needs Your Attention" zone.

**Pending reviews** render as expanded cards, not just links. Each card shows:
- The task title (human-readable, not the run ID)
- What the review is about (the node description or review message)
- A preview of the artifact content (first ~3 lines of markdown/text, or a summary for JSON/CSV)
- Time since the review was created
- Primary action buttons: Approve, Reject, View Full

If there are more than 2 pending reviews, show 2 expanded and a "+N more" link to the reviews page.

**Failed runs** show below pending reviews, as compact error cards:
- Task title
- Error summary (truncated)
- "Retry" and "View" actions

If nothing needs attention, the section collapses to a single line: "All caught up — no reviews or issues pending."

**Files changed:**
- `dashboard/app/pages/index.vue` — restructure template
- `dashboard/server/api/dashboard.get.ts` — include artifact content/preview for pending reviews
- New component: `dashboard/app/components/ReviewPreviewCard.vue`

#### 1.2 Recent Work Feed (replaces recent activity)

Replace the bare run-status list with a feed that shows what the system actually produced.

Each entry shows:
- Task title
- What happened: "Completed — produced *Weekly Safety Brief*" or "Flagged 2 anomalies in driver logs"
- Artifact link with type badge (markdown, csv, etc.)
- Relative timestamp
- Quick action: "View output" opens the artifact directly

The feed mixes completed runs (with their output artifacts) and shows the work narrative, not the system log.

**Files changed:**
- `dashboard/app/pages/index.vue` — new feed section
- `dashboard/server/api/dashboard.get.ts` — join recent runs with their output artifacts (via node_runs.output_refs) and include artifact title + type
- New component: `dashboard/app/components/WorkFeedItem.vue`

#### 1.3 Quick Actions

A compact action bar near the top of the page:
- "New Task" button (prominent, primary color)
- Frequent manual tasks as quick-run buttons (fetch the user's active manual tasks, show the top 2-3 with a "Run" action)

**Files changed:**
- `dashboard/app/pages/index.vue` — add quick actions row
- `dashboard/server/api/dashboard.get.ts` — include active manual tasks in response

#### 1.4 Schedule & System Sidebar Cleanup

The sidebar stays but gets humanized:
- "Schedule" becomes "Coming Up" — show task titles with "runs in 2 hours" or "runs Monday 8am", not raw cron metadata
- "System" summary gets simplified — just "N tasks active" and "N documents", linking to their respective pages. Remove the completed-run count from the sidebar (it's in the feed now).

**Files changed:**
- `dashboard/app/pages/index.vue` — update sidebar sections

#### 1.5 Dashboard API Enhancements

The `/api/dashboard` endpoint needs to return richer data to support the new layout:

- Pending reviews: include the artifact content (or first 500 chars) from the node_run that triggered the review, plus the review message from the plan node
- Recent runs: join with output artifacts (title, type, id) so the feed can show what was produced
- Active manual tasks: list of tasks with `trigger_type = 'manual'` and `status = 'active'` for quick actions

**Files changed:**
- `dashboard/server/api/dashboard.get.ts` — expand queries

---

### Sprint 2 — Review Experience & Artifact Presence

> **Status: Complete**

**Goal**: Make the review flow fast and trustworthy, and give artifacts more visibility throughout the app.

#### 2.1 Inline Review Resolution on Dashboard

For the first pending review on the dashboard, allow the user to approve or reject directly without navigating away. The `ReviewPreviewCard` component gets:
- "Approve" button that calls `PATCH /api/reviews/[id]` with `status: 'approved'`
- "Reject" button with an optional comment field
- "Review in full" link that navigates to the run detail page

On resolution, the card animates out and the dashboard refreshes.

**Files changed:**
- `dashboard/app/components/ReviewPreviewCard.vue` — add action handlers
- `dashboard/app/pages/index.vue` — wire up refresh on review action

#### 2.2 Review Inbox Improvements

The reviews page (`/reviews`) gets a richer treatment:
- Each review shows the artifact content inline (not just a link to the run)
- Edit mode: for "edited" resolution, allow inline text editing of the artifact content before approving
- Filter by task (common use case: "show me all reviews for the weekly brief task")
- Resolved reviews section with a clear visual distinction

**Files changed:**
- `dashboard/app/pages/reviews/index.vue` — expand review cards with artifact content
- `dashboard/app/components/ReviewCard.vue` — add inline artifact preview and edit capability
- `dashboard/server/api/reviews.get.ts` — join reviews with artifact content

#### 2.3 Artifact Previews in Activity Feed

The work feed items from Sprint 1 get real artifact previews:
- Markdown artifacts: render the first ~5 lines as formatted markdown
- Text artifacts: first ~3 lines as plain text
- JSON artifacts: formatted key count or summary
- CSV artifacts: row count and column headers

This gives users a reason to trust the feed — they can see what was produced at a glance without clicking through.

**Files changed:**
- `dashboard/app/components/WorkFeedItem.vue` — add artifact preview rendering
- `dashboard/app/components/ArtifactPreview.vue` — ensure it supports a "compact" mode for feed use

#### 2.4 Artifact Browser Polish

The artifacts page (`/artifacts`) gets treated more like a document library:
- Card view option (in addition to the current list) with content previews
- Search by content (not just title)
- "Produced by" context: which task/run created this artifact
- Download button for each artifact

**Files changed:**
- `dashboard/app/pages/artifacts/index.vue` — add card view, improve metadata display
- `dashboard/server/api/artifacts.get.ts` — support content search

---

### Sprint 3 — Navigation, Language, and Polish

> **Status: Complete**

**Goal**: Humanize the entire app's vocabulary, improve navigation clarity, and add the finishing touches that make it feel trustworthy to non-technical users.

#### 3.1 Vocabulary Pass

Rename user-facing labels throughout the app. The underlying code and data model stay the same — this is a presentation-layer change.

| Current term | New label | Rationale |
|---|---|---|
| Runs | Activity / History | "Runs" is a system concept |
| Artifacts | Documents | Users think in documents |
| Jobs | Schedules | "Jobs" sounds like a print queue |
| Plans | Workflows | "Plans" is ambiguous |
| Node | Step | "Node" is a graph theory term |

The sidebar, page titles, breadcrumbs, and empty states all get updated.

**Files changed:**
- `dashboard/app/layouts/default.vue` — sidebar labels
- All page files — page titles and section headers
- `dashboard/app/components/PageEmptyState.vue` — empty state copy
- `dashboard/app/composables/useDashboard.ts` — shortcut labels

#### 3.2 Sidebar Reorganization

Regroup the sidebar to match user mental models:

```
[Logo]

Home
Reviews (with badge)          ← elevated, this is the inbox

Tasks
Workflows
Schedules

Documents
Activity
```

Reviews moves up because it's the primary action item for most users. "Documents" (artifacts) and "Activity" (runs) are reference views that live lower.

**Files changed:**
- `dashboard/app/layouts/default.vue` — reorder and relabel links

#### 3.3 Loading & Empty States

Every page gets intentional loading and empty states:
- Skeleton loaders that match the shape of incoming content
- Empty states with a clear single action ("Create your first task", "Upload a document", etc.)
- First-use dashboard: instead of a bare "all caught up" message, show a brief onboarding prompt — "Describe something you do repeatedly and Task Engine will automate it."

**Files changed:**
- `dashboard/app/pages/index.vue` — loading skeleton, first-use state
- All list pages — empty state improvements
- `dashboard/app/components/PageEmptyState.vue` — support richer empty states

#### 3.4 Responsive Polish

The dashboard should work on a tablet (common for field supervisors checking in on a job site):
- Sidebar collapses cleanly on medium screens
- Review cards stack vertically on narrow viewports
- Activity feed remains readable on mobile
- Touch-friendly tap targets on action buttons

**Files changed:**
- `dashboard/app/pages/index.vue` — responsive breakpoints
- `dashboard/app/components/ReviewPreviewCard.vue` — mobile layout
- `dashboard/app/components/WorkFeedItem.vue` — mobile layout

#### 3.5 Keyboard Shortcuts & Accessibility

- `r` on the dashboard jumps to the first pending review
- `Enter` on a review card opens it
- Proper ARIA labels on status indicators and action buttons
- Focus management after inline review resolution

**Files changed:**
- `dashboard/app/composables/useDashboard.ts` — add review shortcut
- Component files — ARIA attributes

---

## New Components Summary

| Component | Purpose |
|---|---|
| `ReviewPreviewCard.vue` | Expanded review card with artifact preview and inline actions |
| `WorkFeedItem.vue` | Activity feed entry showing task output with artifact context |

---

## API Changes Summary

| Endpoint | Change |
|---|---|
| `GET /api/dashboard` | Add: artifact content for pending reviews, output artifacts for recent runs, active manual tasks for quick actions |
| `GET /api/reviews` | Add: join with artifact content from the triggering node_run |
| `GET /api/artifacts` | Add: content search support |

---

## What This Plan Does NOT Cover

- New features or backend changes to the task engine runtime
- Plan editor or visual graph builder
- Multi-user support or permissions
- Notification system (email, push)
- Chat or conversational interface

This is a pure dashboard/UI redesign. The runtime, data model, and API structure remain the same. We're changing what gets shown, how it's labeled, and how it's prioritized on screen.
