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

  return (data || []) as Database['public']['Tables']['memories']['Row'][]
})
