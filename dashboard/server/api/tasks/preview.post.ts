import { z } from 'zod'
import { validatePlan } from '../../utils/graphUtils'
import { readValidatedBody } from '../../utils/http'
import { useOpenAI } from '../../utils/openai'
import { generatePlan } from '../../utils/planGenerator'

const previewTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  prompt: z.string().trim().min(1),
  trigger_type: z.enum(['manual', 'scheduled', 'heartbeat']).default('manual'),
  schedule_config: z.record(z.string(), z.unknown()).default({})
})

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, previewTaskSchema)
  const openai = useOpenAI()

  const plan = await generatePlan(openai, body.prompt, {
    triggerType: body.trigger_type
  })
  const validationErrors = validatePlan(plan)

  return {
    plan,
    validation_errors: validationErrors
  }
})
