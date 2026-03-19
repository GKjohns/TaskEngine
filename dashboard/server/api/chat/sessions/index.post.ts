import { z } from 'zod'
import type { Database } from '../../../../shared/types/database'
import { readValidatedBody } from '../../../utils/http'
import { getRequestUserId } from '../../../utils/requestUser'
import { createServiceClient } from '../../../utils/supabase'

const createSessionSchema = z.object({
  message: z.string().trim().min(1)
})

function deriveFallbackTitle(message: string) {
  return message
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?]+$/, '')
    .slice(0, 80)
}

export default defineEventHandler(async (event) => {
  const client = createServiceClient()
  const userId = await getRequestUserId(event)
  const body = await readValidatedBody(event, createSessionSchema)

  const { data, error } = await client
    .from('chat_sessions')
    .insert({
      title: deriveFallbackTitle(body.message) || 'Untitled conversation',
      created_by: userId
    })
    .select('id, title, created_at, updated_at')
    .single()

  if (error || !data) {
    throw createError({
      statusCode: 500,
      statusMessage: error?.message || 'Failed to create chat session'
    })
  }

  const session = data as Pick<Database['public']['Tables']['chat_sessions']['Row'], 'id' | 'title' | 'created_at' | 'updated_at'>

  const { error: messageError } = await client
    .from('chat_messages')
    .insert({
      session_id: session.id,
      role: 'user',
      content: body.message
    })

  if (messageError) {
    await client
      .from('chat_sessions')
      .delete()
      .eq('id', session.id)

    throw createError({
      statusCode: 500,
      statusMessage: messageError.message || 'Failed to create initial chat message'
    })
  }

  return session
})
