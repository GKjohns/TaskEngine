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

  let deleteQuery = client
    .from('chat_sessions')
    .delete()
    .eq('id', id)
    .select('id, title, created_at, updated_at')

  deleteQuery = userId
    ? deleteQuery.eq('created_by', userId)
    : deleteQuery.is('created_by', null)

  const { data, error } = await deleteQuery.single()

  if (error || !data) {
    throw createError({
      statusCode: error?.code === 'PGRST116' ? 404 : 500,
      statusMessage: error?.code === 'PGRST116' ? 'Chat session not found' : error?.message || 'Chat session not found'
    })
  }

  return data as Pick<Database['public']['Tables']['chat_sessions']['Row'], 'id' | 'title' | 'created_at' | 'updated_at'>
})
