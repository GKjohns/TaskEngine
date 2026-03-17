import { z } from 'zod'
import type { Database } from '../../../shared/types/database'
import { readValidatedBody } from '../../utils/http'
import { getRequestUserId } from '../../utils/requestUser'
import { createServiceClient } from '../../utils/supabase'

const createMemorySchema = z.object({
  content: z.string().trim().min(1),
  category: z.enum(['preference', 'fact', 'decision', 'workflow', 'general']).default('general'),
  source_session_id: z.string().uuid().nullable().optional()
})

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, createMemorySchema)
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

  const { data, error } = await client
    .from('memories')
    .insert({
      content: body.content,
      category: body.category,
      source_session_id: body.source_session_id ?? null,
      created_by: userId
    })
    .select('id, content, category, source_session_id, created_at, updated_at')
    .single()

  if (error || !data) {
    throw createError({
      statusCode: 500,
      statusMessage: error?.message || 'Failed to create memory'
    })
  }

  return data as Pick<Database['public']['Tables']['memories']['Row'], 'id' | 'content' | 'category' | 'source_session_id' | 'created_at' | 'updated_at'>
})
