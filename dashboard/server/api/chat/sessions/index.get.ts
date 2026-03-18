import type { Database } from '../../../../shared/types/database'
import { getRequestUserId } from '../../../utils/requestUser'
import { createServiceClient } from '../../../utils/supabase'

export default defineEventHandler(async (event) => {
  const client = createServiceClient()
  const userId = await getRequestUserId(event)

  let query = client
    .from('chat_sessions')
    .select('id, title, created_at, updated_at')
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

  const sessions = (data || []) as Array<Pick<Database['public']['Tables']['chat_sessions']['Row'], 'id' | 'title' | 'created_at' | 'updated_at'>>
  const sessionIds = sessions.map(session => session.id)

  if (!sessionIds.length) {
    return sessions
  }

  const { data: summaryRows, error: summaryError } = await client
    .from('session_summaries')
    .select('session_id, summary, created_at')
    .in('session_id', sessionIds)
    .order('created_at', { ascending: false })

  if (summaryError) {
    throw createError({
      statusCode: 500,
      statusMessage: summaryError.message
    })
  }

  const summariesBySession = new Map<string, string>()

  for (const row of summaryRows || []) {
    if (!summariesBySession.has(row.session_id)) {
      summariesBySession.set(row.session_id, row.summary)
    }
  }

  return sessions.map(session => ({
    ...session,
    summary: summariesBySession.get(session.id) || null
  }))
})
