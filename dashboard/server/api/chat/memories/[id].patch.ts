import { z } from 'zod'
import { readValidatedBody } from '../../../utils/http'
import { getRequestUserId } from '../../../utils/requestUser'
import { createServiceClient } from '../../../utils/supabase'

const updateMemorySchema = z.object({
  content: z.string().trim().min(1).optional(),
  category: z.enum(['preference', 'fact', 'decision', 'workflow', 'general']).optional(),
  source_session_id: z.string().uuid().nullable().optional()
}).refine(value => Object.keys(value).length > 0, 'At least one field is required')

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Memory id is required'
    })
  }

  const body = await readValidatedBody(event, updateMemorySchema)
  const client = createServiceClient()
  const userId = await getRequestUserId(event)

  if (body.source_session_id) {
    let sessionQuery = client
      .from('chat_sessions')
      .select('id')
      .eq('id', body.source_session_id)

    sessionQuery = userId
      ? sessionQuery.eq('created_by', userId)
      : sessionQuery.is('created_by', null)

    const { data: sourceSession, error: sourceSessionError } = await sessionQuery.single()

    if (sourceSessionError || !sourceSession) {
      throw createError({
        statusCode: sourceSessionError?.code === 'PGRST116' ? 404 : 500,
        statusMessage: sourceSessionError?.code === 'PGRST116' ? 'Source session not found' : sourceSessionError?.message || 'Source session not found'
      })
    }
  }

  let updateQuery = client
    .from('memories')
    .update(body)
    .eq('id', id)
    .select()

  updateQuery = userId
    ? updateQuery.eq('created_by', userId)
    : updateQuery.is('created_by', null)

  const { data, error } = await updateQuery.single()

  if (error || !data) {
    throw createError({
      statusCode: error?.code === 'PGRST116' ? 404 : 500,
      statusMessage: error?.code === 'PGRST116' ? 'Memory not found' : error?.message || 'Memory not found'
    })
  }

  return data
})
