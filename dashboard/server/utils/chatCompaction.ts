import type OpenAI from 'openai'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../shared/types/database'

type ServiceClient = SupabaseClient<Database>
type ChatMessageSummaryRow = Pick<Database['public']['Tables']['chat_messages']['Row'], 'id' | 'role' | 'content' | 'created_at'>

export const CHAT_COMPACTION_THRESHOLD = 60000
export const CHAT_MESSAGES_TO_KEEP = 10
export const CHAT_SESSION_SUMMARY_MIN_MESSAGES = 6

function estimateTokens(text: string) {
  return Math.ceil(text.length / 4)
}

function buildTranscript(messages: Array<Pick<Database['public']['Tables']['chat_messages']['Row'], 'role' | 'content' | 'created_at'>>) {
  return messages
    .map(message => `[${message.created_at}] ${message.role.toUpperCase()}: ${message.content}`)
    .join('\n\n')
}

export async function summarizeChatMessages(params: {
  openai: OpenAI
  messages: ChatMessageSummaryRow[]
}) {
  const transcript = buildTranscript(params.messages)
  const response = await params.openai.responses.create({
    model: 'gpt-5-mini',
    instructions: [
      'Summarize the conversation for future context loading.',
      'Write 2-3 short paragraphs that capture the user intent, actions taken, decisions made, and unresolved follow-ups.',
      'Do not include filler. Preserve important preferences, named entities, and confirmed actions.'
    ].join('\n'),
    input: transcript,
    text: {
      verbosity: 'low'
    }
  })

  const summary = response.output_text?.trim()

  if (!summary) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to summarize chat history'
    })
  }

  return {
    summary,
    tokenEstimate: estimateTokens(transcript)
  }
}

export async function ensureSessionSummary(params: {
  openai: OpenAI
  supabase: ServiceClient
  sessionId: string
}) {
  const { openai, supabase, sessionId } = params

  const { count: existingSummaryCount, error: existingSummaryError } = await supabase
    .from('session_summaries')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)

  if (existingSummaryError) {
    throw createError({
      statusCode: 500,
      statusMessage: existingSummaryError.message
    })
  }

  if ((existingSummaryCount || 0) > 0) {
    return {
      created: false,
      reason: 'summary-exists'
    }
  }

  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, role, content, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })

  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message
    })
  }

  const messages = (data || []) as ChatMessageSummaryRow[]

  if (messages.length < CHAT_SESSION_SUMMARY_MIN_MESSAGES) {
    return {
      created: false,
      reason: 'not-enough-messages'
    }
  }

  const { summary, tokenEstimate } = await summarizeChatMessages({
    openai,
    messages
  })

  const { error: summaryError } = await supabase
    .from('session_summaries')
    .insert({
      session_id: sessionId,
      summary,
      message_count: messages.length,
      token_estimate: tokenEstimate
    })

  if (summaryError) {
    throw createError({
      statusCode: 500,
      statusMessage: summaryError.message
    })
  }

  return {
    created: true,
    summary,
    messageCount: messages.length
  }
}

export async function compactChatSession(params: {
  openai: OpenAI
  supabase: ServiceClient
  sessionId: string
}) {
  const { openai, supabase, sessionId } = params

  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, role, content, created_at')
    .eq('session_id', sessionId)
    .eq('is_compacted', false)
    .order('created_at', { ascending: true })

  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message
    })
  }

  const messages = data || []

  if (messages.length <= CHAT_MESSAGES_TO_KEEP) {
    return null
  }

  const messagesToCompact = messages.slice(0, Math.max(0, messages.length - CHAT_MESSAGES_TO_KEEP))

  if (!messagesToCompact.length) {
    return null
  }

  const { summary, tokenEstimate } = await summarizeChatMessages({
    openai,
    messages: messagesToCompact as ChatMessageSummaryRow[]
  })

  const { error: summaryError } = await supabase
    .from('session_summaries')
    .insert({
      session_id: sessionId,
      summary,
      message_count: messagesToCompact.length,
      token_estimate: tokenEstimate
    })

  if (summaryError) {
    throw createError({
      statusCode: 500,
      statusMessage: summaryError.message
    })
  }

  const { error: updateError } = await supabase
    .from('chat_messages')
    .update({ is_compacted: true })
    .in('id', messagesToCompact.map(message => message.id))

  if (updateError) {
    throw createError({
      statusCode: 500,
      statusMessage: updateError.message
    })
  }

  return {
    summary,
    compactedMessageCount: messagesToCompact.length
  }
}
