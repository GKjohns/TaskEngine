import type { AgentTool } from '../types'

export const searchArtifactsTool: AgentTool = {
  name: 'search_artifacts',
  description: 'Search artifacts in the current task by title or inline content keywords.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query.'
      }
    },
    required: ['query'],
    additionalProperties: false
  },
  run: async (input, context) => {
    const query = typeof input.query === 'string' ? input.query.trim().toLowerCase() : ''

    if (!query) {
      throw new Error('Search query is required')
    }

    const { data, error } = await context.supabase
      .from('artifacts')
      .select('id, title, type, created_at, content')
      .eq('task_id', context.taskId)
      .order('created_at', { ascending: false })
      .limit(25)

    if (error) {
      throw new Error(error.message)
    }

    const matches = (data || []).filter((artifact) => {
      const haystack = `${artifact.title}\n${artifact.content || ''}`.toLowerCase()
      return haystack.includes(query)
    })

    if (matches.length === 0) {
      return 'No artifacts found matching the query.'
    }

    return matches
      .slice(0, 10)
      .map(artifact => `- ${artifact.id}: "${artifact.title}" (${artifact.type}, ${artifact.created_at})`)
      .join('\n')
  }
}
