import { createServiceClient } from '../../utils/supabase'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Plan id is required'
    })
  }

  const client = createServiceClient()

  const { data, error } = await client
    .from('plans')
    .select('*, tasks:tasks!plan_id(id, title, status, trigger_type), runs(id, status, started_at, completed_at)')
    .eq('id', id)
    .single()

  if (error) {
    throw createError({
      statusCode: error.code === 'PGRST116' ? 404 : 500,
      statusMessage: error.code === 'PGRST116' ? 'Plan not found' : error.message
    })
  }

  return data
})
