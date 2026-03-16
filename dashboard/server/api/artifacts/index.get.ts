import { createServiceClient } from '../../utils/supabase'
import type { ArtifactType } from '../../../shared/types/task-engine'

const artifactTypes: ArtifactType[] = ['markdown', 'text', 'json', 'csv']

interface ArtifactRow {
  id: string
  type: ArtifactType
  title: string
  content: string | null
  metadata_json: Record<string, unknown>
  storage_path: string | null
  task_id: string | null
  created_by_run_id: string | null
  created_by_node_id: string | null
  created_at: string
  description: string | null
}

interface TaskRow {
  id: string
  title: string
}

interface RunRow {
  id: string
  task_id: string
}

function buildSignedDownloadName(title: string, type: ArtifactType) {
  const extensionMap: Record<ArtifactType, string> = {
    markdown: 'md',
    text: 'txt',
    json: 'json',
    csv: 'csv'
  }

  return `${title || 'artifact'}.${extensionMap[type]}`
}

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

  const searchQuery = typeof query.q === 'string' ? query.q.trim().toLowerCase() : ''

  const { data, error } = await request

  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message
    })
  }

  let artifacts = (data || []) as ArtifactRow[]

  if (searchQuery) {
    artifacts = artifacts.filter((artifact) => {
      const haystack = [
        artifact.title,
        artifact.description,
        artifact.content
      ]
        .filter((value): value is string => typeof value === 'string' && Boolean(value))
        .join('\n')
        .toLowerCase()

      return haystack.includes(searchQuery)
    })
  }

  const taskIds = [...new Set(artifacts.map(artifact => artifact.task_id).filter((id): id is string => Boolean(id)))]
  const runIds = [...new Set(artifacts.map(artifact => artifact.created_by_run_id).filter((id): id is string => Boolean(id)))]

  const tasksResult = taskIds.length
    ? await client
        .from('tasks')
        .select('id, title')
        .in('id', taskIds)
    : { data: [], error: null }

  const runsResult = runIds.length
    ? await client
        .from('runs')
        .select('id, task_id')
        .in('id', runIds)
    : { data: [], error: null }

  if (tasksResult.error) {
    throw createError({
      statusCode: 500,
      statusMessage: tasksResult.error.message
    })
  }

  if (runsResult.error) {
    throw createError({
      statusCode: 500,
      statusMessage: runsResult.error.message
    })
  }

  const taskById = new Map(((tasksResult.data || []) as TaskRow[]).map(task => [task.id, task.title]))
  const runById = new Map(((runsResult.data || []) as RunRow[]).map(run => [run.id, run]))

  return Promise.all(artifacts.map(async (artifact) => {
    let downloadUrl: string | null = null

    if (artifact.storage_path && !artifact.content) {
      const { data: urlData, error: urlError } = await client.storage
        .from('artifacts')
        .createSignedUrl(artifact.storage_path, 3600, {
          download: buildSignedDownloadName(artifact.title, artifact.type)
        })

      if (urlError) {
        throw createError({
          statusCode: 500,
          statusMessage: urlError.message
        })
      }

      downloadUrl = urlData?.signedUrl || null
    }

    const producedByRun = artifact.created_by_run_id ? runById.get(artifact.created_by_run_id) || null : null
    const producedByTaskId = artifact.task_id || producedByRun?.task_id || null

    return {
      ...artifact,
      task_title: producedByTaskId ? taskById.get(producedByTaskId) || null : null,
      produced_by_run_id: artifact.created_by_run_id || null,
      download_url: downloadUrl
    }
  }))
})
