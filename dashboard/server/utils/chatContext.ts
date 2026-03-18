import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../shared/types/database'
import type { MemoryCategory } from '../../shared/types/task-engine'

type ServiceClient = SupabaseClient<Database>

export interface ChatContextMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface ChatContext {
  systemPrompt: string
  messages: ChatContextMessage[]
  tokenEstimate: number
}

export interface ChatViewContext {
  kind: 'task' | 'artifact' | 'run' | 'page'
  label: string
  id?: string | null
}

const MEMORY_CATEGORY_ORDER: MemoryCategory[] = ['preference', 'workflow', 'decision', 'fact', 'general']

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))
}

function formatNow() {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'full',
    timeStyle: 'short'
  }).format(new Date())
}

function buildMemorySection(memories: Database['public']['Tables']['memories']['Row'][]) {
  if (!memories.length) {
    return 'None saved yet.'
  }

  const grouped = new Map<MemoryCategory, string[]>()

  for (const category of MEMORY_CATEGORY_ORDER) {
    grouped.set(category, [])
  }

  for (const memory of memories) {
    if (!grouped.has(memory.category)) {
      grouped.set(memory.category, [])
    }

    grouped.get(memory.category)?.push(memory.content.trim())
  }

  return MEMORY_CATEGORY_ORDER
    .map((category) => {
      const entries = grouped.get(category) || []

      if (!entries.length) {
        return null
      }

      return [
        `${category}:`,
        ...entries.map(entry => `- ${entry}`)
      ].join('\n')
    })
    .filter((value): value is string => Boolean(value))
    .join('\n\n')
}

function buildRecentSessionsSection(summaries: Database['public']['Tables']['session_summaries']['Row'][]) {
  if (!summaries.length) {
    return 'No recent session summaries.'
  }

  return summaries
    .map(summary => `[${formatTimestamp(summary.created_at)}]\n${summary.summary.trim()}`)
    .join('\n\n')
}

function buildSystemPrompt(params: {
  memories: Database['public']['Tables']['memories']['Row'][]
  summaries: Database['public']['Tables']['session_summaries']['Row'][]
  currentView?: ChatViewContext | null
}) {
  const currentViewSection = params.currentView
    ? [
        '[Current Page Context]',
        params.currentView.id
          ? `The user is currently viewing ${params.currentView.label} (id: ${params.currentView.id}). If their message seems related to that entity or page, use that context when deciding which tools to call.`
          : `The user is currently viewing ${params.currentView.label}. If their message seems related to that entity or page, use that context when deciding which tools to call.`,
        ''
      ]
    : []

  return [
    'You are the TaskEngine assistant. You help users manage automated tasks, review outputs, search documents, and build workflows through conversation.',
    `Today is ${formatNow()}.`,
    '',
    ...currentViewSection,
    '[Long-Term Memory]',
    buildMemorySection(params.memories),
    '',
    '[Recent Session Summaries]',
    buildRecentSessionsSection(params.summaries),
    '',
    '[Behavior Guidelines]',
    '- Keep responses concise and practical.',
    '- Use tools proactively when the user asks about real system state.',
    '- Save durable preferences or facts when the user explicitly asks you to remember them.',
    '- Read-only lookups can happen immediately.',
    '- Before destructive or state-changing actions like creating tasks, starting runs, or resolving reviews, confirm the action unless the user is already giving a clear go-ahead.',
    '- If a tool search returns multiple plausible matches, ask a clarifying question instead of guessing.',
    '- Summarize artifact content unless the user explicitly asks for the full text.'
  ].join('\n')
}

function estimateTokens(systemPrompt: string, messages: ChatContextMessage[]) {
  const totalChars = systemPrompt.length + messages.reduce((sum, message) => sum + message.content.length, 0)
  return Math.ceil(totalChars / 4)
}

async function listRecentSessionIds(
  supabase: ServiceClient,
  sessionId: string,
  userId: string | null
) {
  let query = supabase
    .from('chat_sessions')
    .select('id')
    .neq('id', sessionId)
    .order('updated_at', { ascending: false })
    .limit(12)

  query = userId
    ? query.eq('created_by', userId)
    : query.is('created_by', null)

  const { data, error } = await query

  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message
    })
  }

  return (data || []).map(session => session.id)
}

export async function assembleChatContext(
  supabase: ServiceClient,
  sessionId: string,
  userId: string | null,
  currentView?: ChatViewContext | null
): Promise<ChatContext> {
  let memoriesQuery = supabase
    .from('memories')
    .select('*')
    .order('updated_at', { ascending: false })

  memoriesQuery = userId
    ? memoriesQuery.eq('created_by', userId)
    : memoriesQuery.is('created_by', null)

  const recentSessionIds = await listRecentSessionIds(supabase, sessionId, userId)

  const [memoriesResult, summariesResult, messagesResult] = await Promise.all([
    memoriesQuery,
    recentSessionIds.length
      ? supabase
          .from('session_summaries')
          .select('*')
          .in('session_id', recentSessionIds)
          .order('created_at', { ascending: false })
          .limit(3)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('chat_messages')
      .select('role, content')
      .eq('session_id', sessionId)
      .eq('is_compacted', false)
      .order('created_at', { ascending: true })
  ])

  if (memoriesResult.error) {
    throw createError({
      statusCode: 500,
      statusMessage: memoriesResult.error.message
    })
  }

  if (summariesResult.error) {
    throw createError({
      statusCode: 500,
      statusMessage: summariesResult.error.message
    })
  }

  if (messagesResult.error) {
    throw createError({
      statusCode: 500,
      statusMessage: messagesResult.error.message
    })
  }

  const messages = (messagesResult.data || [])
    .filter(message => message.role === 'user' || message.role === 'assistant' || message.role === 'system')
    .map(message => ({
      role: message.role,
      content: message.content
    })) as ChatContextMessage[]

  const systemPrompt = buildSystemPrompt({
    memories: (memoriesResult.data || []) as Database['public']['Tables']['memories']['Row'][],
    summaries: (summariesResult.data || []) as Database['public']['Tables']['session_summaries']['Row'][],
    currentView
  })

  return {
    systemPrompt,
    messages,
    tokenEstimate: estimateTokens(systemPrompt, messages)
  }
}
