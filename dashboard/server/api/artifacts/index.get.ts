import { createServiceClient } from '../../utils/supabase'

export default defineEventHandler(async (event) => {
  const client = createServiceClient()
  const query = getQuery(event)

  let request = client
    .from('artifacts')
    .select('*')
    .order('created_at', { ascending: false })

  if (typeof query.task_id === 'string' && query.task_id) {
    request = request.eq('task_id', query.task_id)
  }

  if (typeof query.run_id === 'string' && query.run_id) {
    request = request.eq('created_by_run_id', query.run_id)
  }

  const { data, error } = await request

  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message
    })
  }

  return data
})
