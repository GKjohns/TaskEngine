import type { ArtifactType, JobStatus, ReviewStatus, RunStatus, TaskStatus, TaskTriggerType } from '../../shared/types/task-engine'
import { createServiceClient } from '../utils/supabase'

interface DashboardTask {
  id: string
  title: string
  status: TaskStatus
  trigger_type: TaskTriggerType
  plan_id: string | null
  created_at: string
}

interface DashboardRun {
  id: string
  task_id: string
  status: RunStatus
  started_at: string | null
  completed_at: string | null
  error_message: string | null
  description: string | null
  tasks: { title: string } | null
}

interface DashboardReview {
  id: string
  run_id: string
  node_run_id: string
  status: ReviewStatus
  created_at: string
  runs: {
    id: string
    task_id: string
    tasks: { title: string } | null
  } | null
  node_runs: {
    node_key: string
    node_type: string
    description: string | null
    output_refs: unknown[]
  } | null
}

interface DashboardJob {
  id: string
  task_id: string
  job_type: string
  status: JobStatus
  next_run_at: string | null
  last_run_at: string | null
  last_error: string | null
  tasks: { title: string } | null
}

interface DashboardNodeRun {
  run_id: string
  completed_at: string | null
  output_refs: unknown[]
}

interface DashboardArtifact {
  id: string
  type: ArtifactType
  title: string
  content: string | null
  description: string | null
  storage_path: string | null
  task_id: string | null
  created_at: string
  created_by_run_id: string | null
}

interface DashboardReviewItem {
  id: string
  run_id: string
  node_run_id: string
  created_at: string
  task_title: string
  review_message: string | null
  node_type: string | null
  output_artifact: DashboardArtifact | null
}

interface DashboardRecentWorkItem {
  run_id: string
  task_id: string
  task_title: string
  completed_at: string | null
  summary: string
  output_artifact: DashboardArtifact | null
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

function createErrorFromMessage(message: string) {
  return createError({
    statusCode: 500,
    statusMessage: message
  })
}

function pickFirstArtifact(refs: unknown[] | null | undefined, artifactById: Map<string, DashboardArtifact>) {
  for (const id of toStringArray(refs)) {
    const artifact = artifactById.get(id)

    if (artifact) {
      return artifact
    }
  }

  return null
}

function buildWorkSummary(run: DashboardRun, artifact: DashboardArtifact | null) {
  const description = run.description?.trim()

  if (description) {
    return description
  }

  if (artifact?.title) {
    return `Completed and produced ${artifact.title}.`
  }

  return 'Completed work is ready to review.'
}

export default defineEventHandler(async () => {
  const client = createServiceClient()

  const [
    tasksResult,
    runsResult,
    reviewsResult,
    reviewCountResult,
    jobsResult,
    artifactCountResult
  ] = await Promise.all([
    client
      .from('tasks')
      .select('id, title, status, trigger_type, plan_id, created_at')
      .order('created_at', { ascending: false }),
    client
      .from('runs')
      .select('id, task_id, status, started_at, completed_at, error_message, description, tasks(title)')
      .order('started_at', { ascending: false, nullsFirst: false })
      .limit(60),
    client
      .from('reviews')
      .select('id, run_id, node_run_id, status, created_at, runs(id, task_id, tasks(title)), node_runs(node_key, node_type, description, output_refs)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(10),
    client
      .from('reviews')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),
    client
      .from('jobs')
      .select('id, task_id, job_type, status, next_run_at, last_run_at, last_error, tasks(title)')
      .order('next_run_at', { ascending: true, nullsFirst: false }),
    client
      .from('artifacts')
      .select('id', { count: 'exact', head: true })
  ])

  if (tasksResult.error) throw createErrorFromMessage(tasksResult.error.message)
  if (runsResult.error) throw createErrorFromMessage(runsResult.error.message)
  if (reviewsResult.error) throw createErrorFromMessage(reviewsResult.error.message)
  if (reviewCountResult.error) throw createErrorFromMessage(reviewCountResult.error.message)
  if (jobsResult.error) throw createErrorFromMessage(jobsResult.error.message)
  if (artifactCountResult.error) throw createErrorFromMessage(artifactCountResult.error.message)

  const tasks = (tasksResult.data || []) as DashboardTask[]
  const runs = (runsResult.data || []) as DashboardRun[]
  const reviews = (reviewsResult.data || []) as DashboardReview[]
  const jobs = (jobsResult.data || []) as DashboardJob[]

  const activeTasks = tasks.filter(task => task.status === 'active').length
  const pausedTasks = tasks.filter(task => task.status === 'paused').length
  const totalTasks = tasks.length
  const scheduledJobs = jobs.filter(job => job.status === 'scheduled' || job.status === 'running')
  const liveRuns = runs.filter(run => run.status === 'running' || run.status === 'waiting_review')
  const failedRuns = runs.filter(run => run.status === 'failed').slice(0, 5)
  const recentCompletedRuns = runs.filter(run => run.status === 'completed').slice(0, 12)
  const activeManualTasks = tasks
    .filter(task => task.status === 'active' && task.trigger_type === 'manual')
    .slice(0, 3)
    .map(task => ({
      id: task.id,
      title: task.title
    }))

  const pendingReviewArtifactIds = reviews.flatMap(review =>
    toStringArray(unwrapSingle(review.node_runs)?.output_refs)
  )
  const recentRunIds = recentCompletedRuns.map(run => run.id)

  let recentNodeRuns: DashboardNodeRun[] = []

  if (recentRunIds.length) {
    const { data, error } = await client
      .from('node_runs')
      .select('run_id, completed_at, output_refs')
      .in('run_id', recentRunIds)
      .order('completed_at', { ascending: false, nullsFirst: false })

    if (error) throw createErrorFromMessage(error.message)

    recentNodeRuns = (data || []) as DashboardNodeRun[]
  }

  const recentArtifactIds = recentNodeRuns.flatMap(nodeRun => toStringArray(nodeRun.output_refs))
  const artifactIds = [...new Set([...pendingReviewArtifactIds, ...recentArtifactIds])]

  let artifacts: DashboardArtifact[] = []

  if (artifactIds.length) {
    const { data, error } = await client
      .from('artifacts')
      .select('id, type, title, content, description, storage_path, task_id, created_at, created_by_run_id')
      .in('id', artifactIds)

    if (error) throw createErrorFromMessage(error.message)

    artifacts = (data || []) as DashboardArtifact[]
  }

  const artifactById = new Map(artifacts.map(artifact => [artifact.id, artifact]))
  const primaryArtifactByRunId = new Map<string, DashboardArtifact>()

  for (const nodeRun of recentNodeRuns) {
    if (primaryArtifactByRunId.has(nodeRun.run_id)) {
      continue
    }

    const artifact = pickFirstArtifact(nodeRun.output_refs, artifactById)

    if (artifact) {
      primaryArtifactByRunId.set(nodeRun.run_id, artifact)
    }
  }

  const pendingReviews: DashboardReviewItem[] = reviews.map((review) => {
    const run = unwrapSingle(review.runs)
    const task = unwrapSingle(run?.tasks)
    const nodeRun = unwrapSingle(review.node_runs)

    return {
      id: review.id,
      run_id: review.run_id,
      node_run_id: review.node_run_id,
      created_at: review.created_at,
      task_title: task?.title || 'Untitled task',
      review_message: nodeRun?.description || null,
      node_type: nodeRun?.node_type || null,
      output_artifact: pickFirstArtifact(nodeRun?.output_refs, artifactById)
    }
  })

  const recentWork: DashboardRecentWorkItem[] = recentCompletedRuns
    .map((run) => {
      const artifact = primaryArtifactByRunId.get(run.id) || null

      return {
        run_id: run.id,
        task_id: run.task_id,
        task_title: unwrapSingle(run.tasks)?.title || 'Untitled task',
        completed_at: run.completed_at,
        summary: buildWorkSummary(run, artifact),
        output_artifact: artifact
      }
    })
    .filter(item => Boolean(item.output_artifact))
    .slice(0, 8)

  const upcomingJobs = jobs
    .filter(job => job.next_run_at)
    .slice(0, 5)
    .map(job => ({
      id: job.id,
      task_id: job.task_id,
      status: job.status,
      next_run_at: job.next_run_at,
      title: unwrapSingle(job.tasks)?.title || 'Untitled task'
    }))

  return {
    stats: {
      activeTasks,
      pausedTasks,
      totalTasks,
      liveRunCount: liveRuns.length,
      completedRunCount: recentCompletedRuns.length,
      failedRunCount: failedRuns.length,
      pendingReviewCount: reviewCountResult.count || 0,
      totalArtifacts: artifactCountResult.count || 0,
      scheduledJobCount: scheduledJobs.length
    },
    failedRuns: failedRuns.map(run => ({
      id: run.id,
      task_id: run.task_id,
      task_title: unwrapSingle(run.tasks)?.title || 'Untitled task',
      error_message: run.error_message,
      started_at: run.started_at,
      completed_at: run.completed_at
    })),
    pendingReviews,
    recentWork,
    upcomingJobs,
    manualTasks: activeManualTasks
  }
})
