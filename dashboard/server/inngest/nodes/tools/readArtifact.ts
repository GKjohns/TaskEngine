import type { AgentTool } from '../types'

export const readArtifactTool: AgentTool = {
  name: 'read_artifact',
  description: 'Read the full content of an artifact by its ID.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The artifact UUID to read.'
      }
    },
    required: ['id'],
    additionalProperties: false
  },
  run: async (input, context) => {
    const artifactId = typeof input.id === 'string' ? input.id : ''

    if (!artifactId) {
      throw new Error('Artifact id is required')
    }

    const { data, error } = await context.supabase
      .from('artifacts')
      .select('title, content, type, storage_path')
      .eq('id', artifactId)
      .single()

    if (error) {
      throw new Error(error.message)
    }

    if (!data) {
      return 'Error: Artifact not found.'
    }

    if (data.content) {
      return `# ${data.title}\nType: ${data.type}\n\n${data.content}`
    }

    if (!data.storage_path) {
      return `# ${data.title}\nType: ${data.type}\n\n[Artifact has no inline content.]`
    }

    const { data: file, error: downloadError } = await context.supabase.storage
      .from('artifacts')
      .download(data.storage_path)

    if (downloadError) {
      throw new Error(downloadError.message)
    }

    const content = await file.text()
    return `# ${data.title}\nType: ${data.type}\n\n${content}`
  }
}
