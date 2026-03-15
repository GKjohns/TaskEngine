import { createServiceClient } from '../../utils/supabase'

export default defineEventHandler(async () => {
  const client = createServiceClient()

  const { data, error } = await client
    .from('tasks')
    .select('*, plans(id, version, created_at), runs(id, status, started_at, completed_at)')
    .order('created_at', { ascending: false })

  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message
    })
  }

  return data
})
