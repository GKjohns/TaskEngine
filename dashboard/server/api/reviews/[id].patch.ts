import { z } from 'zod'
import { readValidatedBody } from '../../utils/http'
import { createServiceClient } from '../../utils/supabase'

const resolveReviewSchema = z.object({
  status: z.enum(['approved', 'rejected', 'edited']),
  comments: z.string().trim().nullable().optional()
})

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Review id is required'
    })
  }

  const body = await readValidatedBody(event, resolveReviewSchema)
  const client = createServiceClient()

  const { data, error } = await client
    .from('reviews')
    .update({
      status: body.status,
      comments: body.comments ?? null,
      resolved_at: new Date().toISOString()
    })
    .eq('id', id)
    .select('*, node_runs(run_id)')
    .single()

  if (error) {
    throw createError({
      statusCode: error.code === 'PGRST116' ? 404 : 500,
      statusMessage: error.code === 'PGRST116' ? 'Review not found' : error.message
    })
  }

  return data
})
