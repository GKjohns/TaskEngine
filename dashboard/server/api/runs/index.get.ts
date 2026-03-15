import { createServiceClient } from '../../utils/supabase'
import type { RunStatus } from '../../../shared/types/task-engine'

const runStatuses = new Set<RunStatus>(['pending', 'running', 'waiting_review', 'completed', 'failed', 'cancelled'])

export default defineEventHandler(async (event) => {
  const client = createServiceClient()
  const query = getQuery(event)

  let request = client
    .from('runs')
    .select('*, tasks(title), plans(version)')
    .order('started_at', { ascending: false, nullsFirst: false })

  if (typeof query.task_id === 'string' && query.task_id) {
    request = request.eq('task_id', query.task_id)
  }

  if (typeof query.status === 'string' && runStatuses.has(query.status as RunStatus)) {
    const runStatus = query.status as RunStatus
    request = request.eq('status', runStatus)
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
