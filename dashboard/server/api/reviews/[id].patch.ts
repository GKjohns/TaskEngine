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
  comments: z.string().trim().nullable().optional(),
  artifact_id: z.string().uuid().nullable().optional(),
  artifact_content: z.string().nullable().optional()
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

  if (body.status === 'edited' && body.artifact_id && body.artifact_content !== undefined) {
    const { error: artifactError } = await client
      .from('artifacts')
      .update({
        content: body.artifact_content,
        storage_path: null
      })
      .eq('id', body.artifact_id)

    if (artifactError) {
      throw createError({
        statusCode: 500,
        statusMessage: artifactError.message
      })
    }
  }

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
