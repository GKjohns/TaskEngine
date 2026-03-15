import { createServiceClient } from '../../utils/supabase'

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

  const latestCompletedRunByTask = new Map<string, string>()

  for (const task of data) {
    const latestCompletedRun = (task.runs || [])
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
    return data.map(task => ({
      ...task,
      latest_output_artifact: null
    }))
  }

  const { data: artifacts, error: artifactsError } = await client
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

  const artifactByRunId = new Map<string, typeof artifacts[number]>()

  for (const artifact of artifacts || []) {
    if (artifact.created_by_run_id && !artifactByRunId.has(artifact.created_by_run_id)) {
      artifactByRunId.set(artifact.created_by_run_id, artifact)
    }
  }

  return data.map(task => ({
    ...task,
    latest_output_artifact: artifactByRunId.get(latestCompletedRunByTask.get(task.id) || '') || null
  }))
})
