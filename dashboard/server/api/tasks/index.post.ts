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
  plan_json: planPreviewSchema.optional()
})

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, createTaskSchema)
  const client = createServiceClient()
  const openai = body.plan_json ? null : useOpenAI()

  const { data: taskData, error: taskError } = await client
    .from('tasks')
    .insert({
      title: body.title,
      prompt: body.prompt,
      trigger_type: body.trigger_type,
      schedule_config: body.schedule_config
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

  const planJson = (body.plan_json as Plan | undefined) || await generatePlan(openai!, body.prompt)
  const validationErrors = validatePlan(planJson)

  const { data: plan, error: planError } = await client
    .from('plans')
    .insert({
      task_id: task.id,
      plan_json: planJson,
      version: 1
    })
    .select()
    .single()

  if (planError || !plan) {
    throw createError({
      statusCode: 500,
      statusMessage: planError?.message || 'Failed to create plan'
    })
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
