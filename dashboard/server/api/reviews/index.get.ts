import { createServiceClient } from '../../utils/supabase'
import type { ReviewStatus } from '../../../shared/types/task-engine'

const reviewStatuses = new Set<ReviewStatus>(['pending', 'approved', 'rejected', 'edited'])

interface ReviewRun {
  id: string
  task_id: string
  tasks: { title: string } | { title: string }[] | null
}

interface ReviewNodeRun {
  node_key: string
  node_type: string
  description: string | null
  output_refs: unknown[]
}

interface ReviewRow {
  id: string
  run_id: string
  node_run_id: string
  status: ReviewStatus
  reviewer_id: string | null
  comments: string | null
  created_at: string
  resolved_at: string | null
  runs: ReviewRun | ReviewRun[] | null
  node_runs: ReviewNodeRun | ReviewNodeRun[] | null
}

interface ReviewArtifact {
  id: string
  type: 'markdown' | 'text' | 'json' | 'csv'
  title: string
  content: string | null
  description: string | null
  storage_path: string | null
  created_at: string
}

function unwrapSingle<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null
  }

  return value ?? null
}

function toStringArray(value: unknown[] | null | undefined) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

export default defineEventHandler(async (event) => {
  const client = createServiceClient()
  const query = getQuery(event)

  let request = client
    .from('reviews')
    .select('*, runs(id, task_id, tasks(title)), node_runs(node_key, node_type, description, output_refs)')
    .order('created_at', { ascending: false })

  if (typeof query.status === 'string' && reviewStatuses.has(query.status as ReviewStatus)) {
    const reviewStatus = query.status as ReviewStatus
    request = request.eq('status', reviewStatus)
  }

  if (typeof query.task_id === 'string' && query.task_id) {
    request = request.eq('runs.task_id', query.task_id)
  }

  const { data, error } = await request

  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message
    })
  }

  const reviews = (data || []) as ReviewRow[]
  const artifactIds = [...new Set(reviews.flatMap(review =>
    toStringArray(unwrapSingle(review.node_runs)?.output_refs)
  ))]

  let artifacts: ReviewArtifact[] = []

  if (artifactIds.length) {
    const { data: artifactData, error: artifactError } = await client
      .from('artifacts')
      .select('id, type, title, content, description, storage_path, created_at')
      .in('id', artifactIds)

    if (artifactError) {
      throw createError({
        statusCode: 500,
        statusMessage: artifactError.message
      })
    }

    artifacts = (artifactData || []) as ReviewArtifact[]
  }

  const artifactById = new Map(artifacts.map(artifact => [artifact.id, artifact]))

  return reviews.map((review) => {
    const run = unwrapSingle(review.runs)
    const task = unwrapSingle(run?.tasks)
    const nodeRun = unwrapSingle(review.node_runs)
    const outputArtifact = toStringArray(nodeRun?.output_refs)
      .map(id => artifactById.get(id) || null)
      .find((artifact): artifact is ReviewArtifact => Boolean(artifact)) || null

    return {
      ...review,
      task_id: run?.task_id || null,
      task_title: task?.title || 'Untitled task',
      review_message: nodeRun?.description || null,
      node_key: nodeRun?.node_key || null,
      node_type: nodeRun?.node_type || null,
      output_artifact: outputArtifact
    }
  })
})
