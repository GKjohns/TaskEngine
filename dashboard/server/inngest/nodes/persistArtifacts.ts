import type { ArtifactType } from '../../../shared/types/task-engine'
import type { NodeExecutionContext, RuntimeArtifact } from './types'

const INLINE_LIMIT = 50_000

const fileExtensions: Record<ArtifactType, string> = {
  markdown: 'md',
  text: 'txt',
  json: 'json',
  csv: 'csv'
}

const contentTypes: Record<ArtifactType, string> = {
  markdown: 'text/markdown',
  text: 'text/plain',
  json: 'application/json',
  csv: 'text/csv'
}

function sanitizeSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'artifact'
}

function getReferencedArtifactId(metadata?: Record<string, unknown>) {
  const candidate = metadata?.artifact_id ?? metadata?.source_id
  return typeof candidate === 'string' ? candidate : null
}

export async function persistExecutionArtifacts(
  artifacts: RuntimeArtifact[],
  context: NodeExecutionContext
): Promise<string[]> {
  const artifactIds: string[] = []

  for (const [index, artifact] of artifacts.entries()) {
    const existingId = getReferencedArtifactId(artifact.metadata)

    if (existingId) {
      artifactIds.push(existingId)
      continue
    }

    let storagePath: string | null = null
    let content: string | null = artifact.content

    if (content.length > INLINE_LIMIT) {
      const ext = fileExtensions[artifact.type]
      const safeTitle = sanitizeSegment(artifact.title)
      const objectPath = `${context.taskId}/${context.runId}/${context.nodeRunId}/${index + 1}-${safeTitle}.${ext}`

      const { error: uploadError } = await context.supabase.storage
        .from('artifacts')
        .upload(objectPath, content, {
          contentType: contentTypes[artifact.type],
          upsert: false
        })

      if (uploadError) {
        throw new Error(uploadError.message)
      }

      storagePath = objectPath
      content = null
    }

    const { data, error } = await context.supabase
      .from('artifacts')
      .insert({
        type: artifact.type,
        title: artifact.title,
        content,
        metadata_json: artifact.metadata || {},
        storage_path: storagePath,
        task_id: context.taskId,
        created_by_run_id: context.runId,
        created_by_node_id: context.nodeRunId,
        description: artifact.description || null
      })
      .select('id')
      .single()

    if (error || !data) {
      throw new Error(error?.message || 'Failed to persist runtime artifact')
    }

    artifactIds.push(data.id)
  }

  return artifactIds
}
