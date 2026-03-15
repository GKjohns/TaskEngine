import { createServiceClient } from '../../utils/supabase'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Task id is required'
    })
  }

  const client = createServiceClient()

  const { data, error } = await client
    .from('tasks')
    .select('*, plans(id, plan_json, version, created_at), runs(id, status, started_at, completed_at), jobs(id, job_type, status, next_run_at, last_run_at, last_error)')
    .eq('id', id)
    .single()

  if (error) {
    throw createError({
      statusCode: error.code === 'PGRST116' ? 404 : 500,
      statusMessage: error.code === 'PGRST116' ? 'Task not found' : error.message
    })
  }

  return data
})
