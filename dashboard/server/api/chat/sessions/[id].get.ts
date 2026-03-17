import type { Database } from '../../../../shared/types/database'
import { getRequestUserId } from '../../../utils/requestUser'
import { createServiceClient } from '../../../utils/supabase'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Session id is required'
    })
  }

  const client = createServiceClient()
  const userId = await getRequestUserId(event)

  let sessionQuery = client
    .from('chat_sessions')
    .select('*')
    .eq('id', id)

  sessionQuery = userId
    ? sessionQuery.eq('created_by', userId)
    : sessionQuery.is('created_by', null)

  const { data: sessionData, error: sessionError } = await sessionQuery.single()

  const session = sessionData as Database['public']['Tables']['chat_sessions']['Row'] | null

  if (sessionError || !session) {
    throw createError({
      statusCode: sessionError?.code === 'PGRST116' ? 404 : 500,
      statusMessage: sessionError?.code === 'PGRST116' ? 'Chat session not found' : sessionError?.message || 'Chat session not found'
    })
  }

  const { data: messagesData, error: messagesError } = await client
    .from('chat_messages')
    .select('*')
    .eq('session_id', id)
    .eq('is_compacted', false)
    .order('created_at', { ascending: true })

  if (messagesError) {
    throw createError({
      statusCode: 500,
      statusMessage: messagesError.message
    })
  }

  return {
    ...session,
    messages: (messagesData || []) as Database['public']['Tables']['chat_messages']['Row'][]
  }
})
