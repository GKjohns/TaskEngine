import type { Database } from '../../../shared/types/database'
import type { Plan } from '../../../shared/types/task-engine'
import { createServiceClient } from '../../utils/supabase'

type TaskDetailRow = Database['public']['Tables']['tasks']['Row'] & {
  current_plan: {
    id: string
    title: string
    plan_json: Plan
    version: number
    created_at: string
  } | null
  plans: Array<{
    id: string
    plan_json: Plan
    version: number
    created_at: string
  }>
  runs: Array<Pick<Database['public']['Tables']['runs']['Row'], 'id' | 'status' | 'started_at' | 'completed_at'>>
  jobs: Array<Pick<Database['public']['Tables']['jobs']['Row'], 'id' | 'job_type' | 'status' | 'next_run_at' | 'last_run_at' | 'last_error'>>
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Task id is required'
    })
  }

  const client = createServiceClient()

  const { data, error } = await client
    .from('tasks')
    .select('*, current_plan:plans!plan_id(id, title, plan_json, version, created_at), plans!task_id(id, plan_json, version, created_at), runs(id, status, started_at, completed_at), jobs(id, job_type, status, next_run_at, last_run_at, last_error)')
    .eq('id', id)
    .single()

  if (error) {
    throw createError({
      statusCode: error.code === 'PGRST116' ? 404 : 500,
      statusMessage: error.code === 'PGRST116' ? 'Task not found' : error.message
    })
  }

  const task = data as TaskDetailRow

  const latestCompletedRun = task.runs
    .filter(run => run.status === 'completed')
    .sort((a, b) => {
      const aTime = new Date(a.completed_at || a.started_at || 0).getTime()
      const bTime = new Date(b.completed_at || b.started_at || 0).getTime()
      return bTime - aTime
    })[0]

  if (!latestCompletedRun?.id) {
    return {
      ...task,
      latest_output_artifact: null
    }
  }

  const { data: artifacts, error: artifactsError } = await client
    .from('artifacts')
    .select('*')
    .eq('created_by_run_id', latestCompletedRun.id)
    .order('created_at', { ascending: false })
    .limit(1)

  if (artifactsError) {
    throw createError({
      statusCode: 500,
      statusMessage: artifactsError.message
    })
  }

  return {
    ...task,
    latest_output_artifact: artifacts?.[0] || null
  }
})
