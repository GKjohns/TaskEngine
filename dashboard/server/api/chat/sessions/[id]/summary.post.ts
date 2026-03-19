import { ensureSessionSummary } from '../../../../utils/chatCompaction'
import { useOpenAI } from '../../../../utils/openai'
import { getRequestUserId } from '../../../../utils/requestUser'
import { createServiceClient } from '../../../../utils/supabase'

export default defineEventHandler(async (event) => {
  const sessionId = getRouterParam(event, 'id')

  if (!sessionId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Session id is required'
    })
  }

  const client = createServiceClient()
  const userId = await getRequestUserId(event)

  let sessionQuery = client
    .from('chat_sessions')
    .select('id')
    .eq('id', sessionId)

  sessionQuery = userId
    ? sessionQuery.eq('created_by', userId)
    : sessionQuery.is('created_by', null)

  const { data: session, error: sessionError } = await sessionQuery.maybeSingle()

  if (sessionError) {
    throw createError({
      statusCode: 500,
      statusMessage: sessionError.message
    })
  }

  if (!session) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Chat session not found'
    })
  }

  return ensureSessionSummary({
    openai: useOpenAI(),
    supabase: client,
    sessionId
  })
})
