import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../shared/types/database'
import { inngest } from './inngest'

type ServiceClient = SupabaseClient<Database>

interface TriggerRunResult {
  run: Database['public']['Tables']['runs']['Row']
  planId: string
  jobId: string | null
}

export async function createPendingRunForTask(
  client: ServiceClient,
  taskId: string,
  preferredJobId?: string | null,
  inputArtifactIds?: string[]
): Promise<TriggerRunResult> {
  const { data: task, error: taskError } = await client
    .from('tasks')
    .select('plan_id, input_artifact_ids')
    .eq('id', taskId)
    .single()

  if (taskError || !task) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Task not found'
    })
  }

  let planId = task.plan_id

  if (!planId) {
    const { data: plan, error: planError } = await client
      .from('plans')
      .select('id')
      .eq('task_id', taskId)
      .order('version', { ascending: false })
      .limit(1)
      .single()

    if (planError || !plan) {
      throw createError({
        statusCode: 400,
        statusMessage: 'No plan exists for this task'
      })
    }

    planId = plan.id
  }

  let jobId = preferredJobId ?? null

  if (!jobId) {
    const { data: job, error: jobError } = await client
      .from('jobs')
      .select('id')
      .eq('task_id', taskId)
      .order('id', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (jobError) {
      throw createError({
        statusCode: 500,
        statusMessage: jobError.message
      })
    }

    jobId = job?.id || null
  }

  const resolvedArtifactIds = inputArtifactIds?.length
    ? inputArtifactIds
    : (Array.isArray(task.input_artifact_ids) ? task.input_artifact_ids as string[] : [])

  const { data: run, error: runError } = await client
    .from('runs')
    .insert({
      task_id: taskId,
      plan_id: planId,
      job_id: jobId,
      status: 'pending',
      input_artifact_ids: resolvedArtifactIds
    })
    .select()
    .single()

  const createdRun = run as Database['public']['Tables']['runs']['Row'] | null

  if (runError || !createdRun) {
    throw createError({
      statusCode: 500,
      statusMessage: runError?.message || 'Failed to create run'
    })
  }

  return {
    run: createdRun,
    planId,
    jobId
  }
}

export async function sendRunStartEvent(input: {
  runId: string
  planId: string
  taskId: string
  jobId: string | null
  inputArtifactIds?: string[]
}) {
  await inngest.send({
    name: 'task-engine/run.start',
    data: input
  })
}
