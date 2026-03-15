import { createServiceClient } from '../../utils/supabase'

export default defineEventHandler(async () => {
  const client = createServiceClient()

  const { data, error } = await client
    .from('plans')
    .select('id, title, description, prompt, plan_json, version, task_id, created_by, created_at, updated_at')
    .order('updated_at', { ascending: false })

  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message
    })
  }

  return data
})
