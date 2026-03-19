import type { Database } from '../../../shared/types/database'
import { getRequestUserId } from '../../utils/requestUser'
import { createServiceClient } from '../../utils/supabase'

export default defineEventHandler(async (event) => {
  const client = createServiceClient()
  const userId = await getRequestUserId(event)

  let query = client
    .from('memories')
    .select('*')
    .order('updated_at', { ascending: false })

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

  const memories = (data || []) as Database['public']['Tables']['memories']['Row'][]
  const sourceSessionIds = [...new Set(memories
    .map(memory => memory.source_session_id)
    .filter((value): value is string => Boolean(value)))]

  if (!sourceSessionIds.length) {
    return memories.map(memory => ({
      ...memory,
      source_session_title: null
    }))
  }

  let sessionsQuery = client
    .from('chat_sessions')
    .select('id, title')
    .in('id', sourceSessionIds)

  sessionsQuery = userId
    ? sessionsQuery.eq('created_by', userId)
    : sessionsQuery.is('created_by', null)

  const { data: sessionsData, error: sessionsError } = await sessionsQuery

  if (sessionsError) {
    throw createError({
      statusCode: 500,
      statusMessage: sessionsError.message
    })
  }

  const titlesById = new Map((sessionsData || []).map(session => [session.id, session.title]))

  return memories.map(memory => ({
    ...memory,
    source_session_title: memory.source_session_id
      ? titlesById.get(memory.source_session_id) || null
      : null
  }))
})
