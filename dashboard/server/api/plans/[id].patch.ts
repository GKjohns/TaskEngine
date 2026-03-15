import { z } from 'zod'
import { readValidatedBody } from '../../utils/http'
import { createServiceClient } from '../../utils/supabase'

const updatePlanSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(500).nullable().optional()
})

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Plan id is required'
    })
  }

  const body = await readValidatedBody(event, updatePlanSchema)
  const client = createServiceClient()

  const { data, error } = await client
    .from('plans')
    .update(body)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    throw createError({
      statusCode: error.code === 'PGRST116' ? 404 : 500,
      statusMessage: error.code === 'PGRST116' ? 'Plan not found' : error.message
    })
  }

  return data
})
