import { z } from 'zod'
import { readValidatedBody } from '../../utils/http'
import { createPendingRunForTask, sendRunStartEvent } from '../../utils/runDispatch'
import { createServiceClient } from '../../utils/supabase'

const createRunSchema = z.object({
  task_id: z.string().uuid()
})

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, createRunSchema)
  const client = createServiceClient()

  const { run, planId, jobId } = await createPendingRunForTask(client, body.task_id)

  await sendRunStartEvent({
    runId: run.id,
    planId,
    taskId: body.task_id,
    jobId
  })

  return run
})
