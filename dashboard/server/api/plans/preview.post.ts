import { z } from 'zod'
import { validatePlan } from '../../utils/graphUtils'
import { readValidatedBody } from '../../utils/http'
import { useOpenAI } from '../../utils/openai'
import { generatePlan } from '../../utils/planGenerator'

const previewPlanSchema = z.object({
  prompt: z.string().trim().min(1)
})

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, previewPlanSchema)
  const openai = useOpenAI()

  const plan = await generatePlan(openai, body.prompt)
  const validationErrors = validatePlan(plan)

  return {
    plan,
    validation_errors: validationErrors
  }
})
