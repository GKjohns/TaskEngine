import { z } from 'zod'
import type { Database } from '../../../shared/types/database'
import type { Plan } from '../../../shared/types/task-engine'
import { validatePlan } from '../../utils/graphUtils'
import { readValidatedBody } from '../../utils/http'
import { useOpenAI } from '../../utils/openai'
import { generatePlan } from '../../utils/planGenerator'
import { createServiceClient } from '../../utils/supabase'

const planPreviewSchema = z.object({
  nodes: z.array(z.record(z.string(), z.unknown()))
})

const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  prompt: z.string().trim().min(1),
  trigger_type: z.enum(['manual', 'scheduled', 'heartbeat']).default('manual'),
  schedule_config: z.record(z.string(), z.unknown()).default({}),
  plan_id: z.string().uuid().optional(),
  plan_json: planPreviewSchema.optional(),
  input_artifact_ids: z.array(z.string().uuid()).default([])
})

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, createTaskSchema)
  const client = createServiceClient()

  let planId = body.plan_id || null
  let plan = null
  let validationErrors: string[] = []

  if (planId) {
    const { data: existing, error: existingError } = await client
      .from('plans')
      .select('*')
      .eq('id', planId)
      .single()

    if (existingError || !existing) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Selected plan not found'
      })
    }

    plan = existing
  } else {
    const planJson = (body.plan_json as Plan | undefined) || await generatePlan(useOpenAI(), body.prompt)
    validationErrors = validatePlan(planJson)

    const { data: newPlan, error: planError } = await client
      .from('plans')
      .insert({
        title: body.title,
        prompt: body.prompt,
        plan_json: planJson,
        version: 1
      })
      .select()
      .single()

    if (planError || !newPlan) {
      throw createError({
        statusCode: 500,
        statusMessage: planError?.message || 'Failed to create plan'
      })
    }

    plan = newPlan
    planId = newPlan.id
  }

  const { data: taskData, error: taskError } = await client
    .from('tasks')
    .insert({
      title: body.title,
      prompt: body.prompt,
      plan_id: planId,
      trigger_type: body.trigger_type,
      schedule_config: body.schedule_config,
      input_artifact_ids: body.input_artifact_ids
    })
    .select()
    .single()

  const task = taskData as Database['public']['Tables']['tasks']['Row'] | null

  if (taskError || !task) {
    throw createError({
      statusCode: 500,
      statusMessage: taskError?.message || 'Failed to create task'
    })
  }

  if (!plan.task_id) {
    await client
      .from('plans')
      .update({ task_id: task.id })
      .eq('id', planId!)
  }

  const jobType = body.trigger_type === 'scheduled'
    ? 'scheduled'
    : body.trigger_type === 'heartbeat'
      ? 'heartbeat'
      : 'one_off'

  const jobStatus = body.trigger_type === 'manual' ? 'idle' : 'scheduled'

  const { data: jobData, error: jobError } = await client
    .from('jobs')
    .insert({
      task_id: task.id,
      job_type: jobType,
      status: jobStatus,
      next_run_at: typeof body.schedule_config.next_run_at === 'string'
        ? body.schedule_config.next_run_at
        : null
    })
    .select()
    .single()

  const job = jobData as Database['public']['Tables']['jobs']['Row'] | null

  if (jobError || !job) {
    throw createError({
      statusCode: 500,
      statusMessage: jobError?.message || 'Failed to create job'
    })
  }

  return {
    task,
    plan,
    job,
    validation_errors: validationErrors
  }
})
