import { z } from 'zod'
import { readValidatedBody } from '../../utils/http'
import { createServiceClient } from '../../utils/supabase'

const updateTaskSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  prompt: z.string().trim().min(1).optional(),
  trigger_type: z.enum(['manual', 'scheduled', 'heartbeat']).optional(),
  schedule_config: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(['active', 'paused', 'archived']).optional()
}).refine(value => Object.keys(value).length > 0, 'At least one field is required')

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Task id is required'
    })
  }

  const body = await readValidatedBody(event, updateTaskSchema)
  const client = createServiceClient()

  const { data, error } = await client
    .from('tasks')
    .update(body)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    throw createError({
      statusCode: error.code === 'PGRST116' ? 404 : 500,
      statusMessage: error.code === 'PGRST116' ? 'Task not found' : error.message
    })
  }

  return data
})
