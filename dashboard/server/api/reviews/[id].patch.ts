import { z } from 'zod'
import type { ReviewRecord } from '../../../shared/types/task-engine'
import { readValidatedBody } from '../../utils/http'
import { inngest } from '../../utils/inngest'
import { createServiceClient } from '../../utils/supabase'

interface ResolvedReviewRecord extends ReviewRecord {
  node_runs?: {
    run_id: string
  } | null
}

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

  const review = data as ResolvedReviewRecord | null

  if (error || !review) {
    throw createError({
      statusCode: error?.code === 'PGRST116' ? 404 : 500,
      statusMessage: error?.code === 'PGRST116' ? 'Review not found' : error?.message || 'Review not found'
    })
  }

  await inngest.send({
    name: 'task-engine/review.resolved',
    data: {
      reviewId: review.id,
      runId: review.node_runs?.run_id,
      status: body.status,
      comments: body.comments ?? null
    }
  })

  return review
})
