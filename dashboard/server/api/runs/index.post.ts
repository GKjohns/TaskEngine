import { z } from 'zod'
import { readValidatedBody } from '../../utils/http'
import { createPendingRunForTask, sendRunStartEvent } from '../../utils/runDispatch'
import { createServiceClient } from '../../utils/supabase'

const createRunSchema = z.object({
  task_id: z.string().uuid(),
  artifact_ids: z.array(z.string().uuid()).optional()
})

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, createRunSchema)
  const client = createServiceClient()
  const artifactIds = body.artifact_ids || []

  const { run, planId, jobId } = await createPendingRunForTask(client, body.task_id, null, artifactIds)

  await sendRunStartEvent({
    runId: run.id,
    planId,
    taskId: body.task_id,
    jobId,
    inputArtifactIds: run.input_artifact_ids
  })

  return run
})
