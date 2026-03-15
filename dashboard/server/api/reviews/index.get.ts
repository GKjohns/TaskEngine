import { createServiceClient } from '../../utils/supabase'
import type { ReviewStatus } from '../../../shared/types/task-engine'

const reviewStatuses = new Set<ReviewStatus>(['pending', 'approved', 'rejected', 'edited'])

export default defineEventHandler(async (event) => {
  const client = createServiceClient()
  const query = getQuery(event)

  let request = client
    .from('reviews')
    .select('*, runs(id, task_id, tasks(title)), node_runs(node_key, node_type)')
    .order('created_at', { ascending: false })

  if (typeof query.status === 'string' && reviewStatuses.has(query.status as ReviewStatus)) {
    const reviewStatus = query.status as ReviewStatus
    request = request.eq('status', reviewStatus)
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
