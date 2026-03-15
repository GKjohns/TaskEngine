import { createServiceClient } from '../../utils/supabase'
import type { ArtifactType } from '../../../shared/types/task-engine'

const artifactTypes: ArtifactType[] = ['markdown', 'text', 'json', 'csv']

export default defineEventHandler(async (event) => {
  const client = createServiceClient()
  const query = getQuery(event)

  let request = client
    .from('artifacts')
    .select('*')
    .order('created_at', { ascending: false })

  if (typeof query.task_id === 'string' && query.task_id) {
    request = request.eq('task_id', query.task_id)
  }

  if (typeof query.run_id === 'string' && query.run_id) {
    request = request.eq('created_by_run_id', query.run_id)
  }

  if (typeof query.type === 'string' && artifactTypes.includes(query.type as ArtifactType)) {
    request = request.eq('type', query.type as ArtifactType)
  }

  if (typeof query.ids === 'string' && query.ids.trim()) {
    const ids = query.ids
      .split(',')
      .map(id => id.trim())
      .filter(Boolean)

    if (ids.length) {
      request = request.in('id', ids)
    }
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
