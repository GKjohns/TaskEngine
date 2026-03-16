import type { Database } from '../../../shared/types/database'
import { createServiceClient } from '../../utils/supabase'

type TaskListRow = Database['public']['Tables']['tasks']['Row'] & {
  current_plan: {
    id: string
    title: string
    version: number
  } | null
  plans: Array<{
    id: string
    version: number
    created_at: string
  }>
  runs: Array<Pick<Database['public']['Tables']['runs']['Row'], 'id' | 'status' | 'started_at' | 'completed_at'>>
  jobs: Array<Pick<Database['public']['Tables']['jobs']['Row'], 'id' | 'job_type' | 'status' | 'next_run_at' | 'last_run_at' | 'last_error'>>
}

export default defineEventHandler(async () => {
  const client = createServiceClient()

  const { data, error } = await client
    .from('tasks')
    .select('*, current_plan:plans!plan_id(id, title, version), plans!task_id(id, version, created_at), runs(id, status, started_at, completed_at), jobs(id, job_type, status, next_run_at, last_run_at, last_error)')
    .order('created_at', { ascending: false })

  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message
    })
  }

  if (!data?.length) {
    return data
  }

  const tasks = data as TaskListRow[]
  const latestCompletedRunByTask = new Map<string, string>()

  for (const task of tasks) {
    const latestCompletedRun = task.runs
      .filter(run => run.status === 'completed')
      .sort((a, b) => {
        const aTime = new Date(a.completed_at || a.started_at || 0).getTime()
        const bTime = new Date(b.completed_at || b.started_at || 0).getTime()
        return bTime - aTime
      })[0]

    if (latestCompletedRun?.id) {
      latestCompletedRunByTask.set(task.id, latestCompletedRun.id)
    }
  }

  const completedRunIds = [...new Set(latestCompletedRunByTask.values())]

  if (!completedRunIds.length) {
    return tasks.map(task => ({
      ...task,
      latest_output_artifact: null
    }))
  }

  const { data: artifactsData, error: artifactsError } = await client
    .from('artifacts')
    .select('*')
    .in('created_by_run_id', completedRunIds)
    .order('created_at', { ascending: false })

  if (artifactsError) {
    throw createError({
      statusCode: 500,
      statusMessage: artifactsError.message
    })
  }

  const artifacts = (artifactsData || []) as Database['public']['Tables']['artifacts']['Row'][]
  const artifactByRunId = new Map<string, Database['public']['Tables']['artifacts']['Row']>()

  for (const artifact of artifacts) {
    if (artifact.created_by_run_id && !artifactByRunId.has(artifact.created_by_run_id)) {
      artifactByRunId.set(artifact.created_by_run_id, artifact)
    }
  }

  return tasks.map(task => ({
    ...task,
    latest_output_artifact: artifactByRunId.get(latestCompletedRunByTask.get(task.id) || '') || null
  }))
})
