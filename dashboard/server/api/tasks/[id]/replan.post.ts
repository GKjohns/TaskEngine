import type { Database } from '../../../../shared/types/database'
import { validatePlan } from '../../../utils/graphUtils'
import { useOpenAI } from '../../../utils/openai'
import { generatePlan } from '../../../utils/planGenerator'
import { createServiceClient } from '../../../utils/supabase'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Task id is required'
    })
  }

  const client = createServiceClient()
  const openai = useOpenAI()

  const { data: taskData, error: taskError } = await client
    .from('tasks')
    .select('*')
    .eq('id', id)
    .single()

  const task = taskData as Database['public']['Tables']['tasks']['Row'] | null

  if (taskError || !task) {
    throw createError({
      statusCode: taskError?.code === 'PGRST116' ? 404 : 500,
      statusMessage: taskError?.code === 'PGRST116' ? 'Task not found' : taskError?.message || 'Task not found'
    })
  }

  const { data: plans, error: plansError } = await client
    .from('plans')
    .select('version')
    .eq('task_id', id)
    .order('version', { ascending: false })
    .limit(1)

  if (plansError) {
    throw createError({
      statusCode: 500,
      statusMessage: plansError.message
    })
  }

  const nextVersion = (plans?.[0]?.version || 0) + 1
  const planJson = await generatePlan(openai, task.prompt, {
    triggerType: task.trigger_type
  })
  const validationErrors = validatePlan(planJson)

  const { data: plan, error: planError } = await client
    .from('plans')
    .insert({
      title: task.title,
      prompt: task.prompt,
      task_id: id,
      plan_json: planJson,
      version: nextVersion,
      created_by: task.created_by
    })
    .select()
    .single()

  const createdPlan = plan as Database['public']['Tables']['plans']['Row'] | null

  if (planError || !createdPlan) {
    throw createError({
      statusCode: 500,
      statusMessage: planError?.message || 'Failed to create plan'
    })
  }

  await client
    .from('tasks')
    .update({ plan_id: createdPlan.id })
    .eq('id', id)

  return {
    plan: createdPlan,
    validation_errors: validationErrors
  }
})
