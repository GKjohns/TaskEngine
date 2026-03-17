import type { Database } from '../../../../shared/types/database'
import { getRequestUserId } from '../../../utils/requestUser'
import { createServiceClient } from '../../../utils/supabase'

export default defineEventHandler(async (event) => {
  const client = createServiceClient()
  const userId = await getRequestUserId(event)

  const { data, error } = await client
    .from('chat_sessions')
    .insert({
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

  return data as Pick<Database['public']['Tables']['chat_sessions']['Row'], 'id' | 'title' | 'created_at' | 'updated_at'>
})
