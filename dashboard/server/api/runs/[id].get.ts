import { createServiceClient } from '../../utils/supabase'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Run id is required'
    })
  }

  const client = createServiceClient()

  const { data, error } = await client
    .from('runs')
    .select(`
      *,
      tasks(title, prompt),
      plans(plan_json, version),
      node_runs(*),
      reviews(*)
    `)
    .eq('id', id)
    .single()

  if (error) {
    throw createError({
      statusCode: error.code === 'PGRST116' ? 404 : 500,
      statusMessage: error.code === 'PGRST116' ? 'Run not found' : error.message
    })
  }

  return data
})
