import { z } from 'zod'
import type { Plan } from '../../../shared/types/task-engine'
import { validatePlan } from '../../utils/graphUtils'
import { readValidatedBody } from '../../utils/http'
import { useOpenAI } from '../../utils/openai'
import { generatePlan } from '../../utils/planGenerator'
import { createServiceClient } from '../../utils/supabase'

const createPlanSchema = z.object({
  title: z.string().trim().min(1).max(200),
  prompt: z.string().trim().min(1),
  description: z.string().trim().max(500).optional(),
  trigger_type: z.enum(['manual', 'scheduled', 'heartbeat']).optional(),
  plan_json: z.object({
    nodes: z.array(z.record(z.string(), z.unknown()))
  }).optional()
})

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, createPlanSchema)
  const client = createServiceClient()

  const planJson = (body.plan_json as Plan | undefined) || await generatePlan(useOpenAI(), body.prompt, {
    triggerType: body.trigger_type
  })
  const validationErrors = validatePlan(planJson)

  const nodeCount = planJson.nodes?.length ?? 0
  const autoDescription = body.description || `${nodeCount}-node workflow generated from prompt`

  const { data: plan, error: planError } = await client
    .from('plans')
    .insert({
      title: body.title,
      description: autoDescription,
      prompt: body.prompt,
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

  return {
    plan,
    validation_errors: validationErrors
  }
})
