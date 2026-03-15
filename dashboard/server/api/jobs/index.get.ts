import type { JobStatus } from '../../../shared/types/task-engine'
import { createServiceClient } from '../../utils/supabase'

const jobStatuses = new Set<JobStatus>(['idle', 'scheduled', 'running', 'waiting_review', 'paused', 'completed', 'failed'])

export default defineEventHandler(async (event) => {
  const client = createServiceClient()
  const query = getQuery(event)

  let request = client
    .from('jobs')
    .select('*, tasks(title, trigger_type, status), runs:current_run_id(id, status, started_at)')
    .order('next_run_at', { ascending: true, nullsFirst: false })

  if (typeof query.status === 'string' && jobStatuses.has(query.status as JobStatus)) {
    request = request.eq('status', query.status as JobStatus)
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
