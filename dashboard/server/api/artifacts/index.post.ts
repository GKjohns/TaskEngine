import { z } from 'zod'
import { readValidatedBody } from '../../utils/http'
import { createServiceClient } from '../../utils/supabase'

const INLINE_LIMIT = 50_000

const createArtifactSchema = z.object({
  type: z.enum(['markdown', 'text', 'json', 'csv']).default('text'),
  title: z.string().trim().min(1).max(200),
  content: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  task_id: z.string().uuid().nullable().optional(),
  run_id: z.string().uuid().nullable().optional(),
  node_run_id: z.string().uuid().nullable().optional()
})

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, createArtifactSchema)
  const client = createServiceClient()

  let storagePath: string | null = null
  let content = body.content ?? null

  if (content && content.length > INLINE_LIMIT) {
    const safeTitle = body.title.replace(/[^\w.-]+/g, '_')
    const objectPath = `${body.task_id || 'uploads'}/${Date.now()}-${safeTitle}`

    const { error: uploadError } = await client.storage
      .from('artifacts')
      .upload(objectPath, content, { contentType: 'text/plain', upsert: false })

    if (uploadError) {
      throw createError({
        statusCode: 500,
        statusMessage: uploadError.message
      })
    }

    storagePath = objectPath
    content = null
  }

  const { data, error } = await client
    .from('artifacts')
    .insert({
      type: body.type,
      title: body.title,
      content,
      metadata_json: body.metadata,
      storage_path: storagePath,
      task_id: body.task_id ?? null,
      created_by_run_id: body.run_id ?? null,
      created_by_node_id: body.node_run_id ?? null
    })
    .select()
    .single()

  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message
    })
  }

  return data
})
