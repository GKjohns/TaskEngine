import type { ArtifactType } from '../../../../shared/types/task-engine'
import type { AgentTool } from '../types'

const supportedFormats: ArtifactType[] = ['markdown', 'text', 'json', 'csv']

export const writeArtifactTool: AgentTool = {
  name: 'write_artifact',
  description: 'Create a new artifact with the given title, content, and format.',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Artifact title.'
      },
      content: {
        type: 'string',
        description: 'Artifact content.'
      },
      format: {
        type: 'string',
        enum: supportedFormats,
        description: 'Artifact content format.'
      }
    },
    required: ['title', 'content', 'format'],
    additionalProperties: false
  },
  run: async (input, context) => {
    const title = typeof input.title === 'string' ? input.title.trim() : ''
    const content = typeof input.content === 'string' ? input.content : ''
    const format = typeof input.format === 'string' ? input.format : ''

    if (!title) {
      throw new Error('Artifact title is required')
    }

    if (!supportedFormats.includes(format as ArtifactType)) {
      throw new Error(`Unsupported artifact format "${format}"`)
    }

    const { data, error } = await context.supabase
      .from('artifacts')
      .insert({
        type: format as ArtifactType,
        title,
        content,
        metadata_json: {
          source: 'agent_tool'
        },
        task_id: context.taskId,
        created_by_run_id: context.runId,
        created_by_node_id: context.nodeRunId
      })
      .select('id')
      .single()

    if (error || !data) {
      throw new Error(error?.message || 'Failed to create artifact')
    }

    return `Artifact created: ${data.id} ("${title}")`
  }
}
