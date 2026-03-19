import type {
  ResponseFunctionWebSearch,
  ResponseOutputItem,
  Tool,
  WebSearchTool
} from 'openai/resources/responses/responses'

const DEFAULT_SOURCE_LIMIT = 5

export const openAIWebSearchTool: WebSearchTool = {
  type: 'web_search',
  search_context_size: 'medium'
}

export const openAIWebTools: Tool[] = [openAIWebSearchTool]

export const openAIWebSearchInclude = ['web_search_call.action.sources'] as const

export interface OpenAIWebToolSummary {
  name: string
  arguments: string
  output: string
  isError: boolean
}

export function isWebSearchCall(item: ResponseOutputItem): item is ResponseFunctionWebSearch {
  return item.type === 'web_search_call'
}

function stringifyArguments(value: Record<string, unknown>) {
  return JSON.stringify(value)
}

function formatSources(sources?: Array<{ url: string }> | null) {
  if (!sources?.length) {
    return ''
  }

  return [
    'Sources:',
    ...sources
      .slice(0, DEFAULT_SOURCE_LIMIT)
      .map(source => `- ${source.url}`)
  ].join('\n')
}

export function summarizeWebSearchCall(item: ResponseFunctionWebSearch): OpenAIWebToolSummary {
  const isError = item.status === 'failed'

  switch (item.action.type) {
    case 'search': {
      const queries = item.action.queries?.length
        ? item.action.queries
        : (item.action.query ? [item.action.query] : [])
      const queryText = queries.length ? queries.join(' | ') : 'web query'
      const sourcesText = formatSources(item.action.sources)

      return {
        name: 'web_search',
        arguments: stringifyArguments({ queries }),
        output: [
          isError ? `Web search failed for: ${queryText}` : `Web search completed for: ${queryText}`,
          sourcesText
        ].filter(Boolean).join('\n'),
        isError
      }
    }
    case 'open_page': {
      const url = item.action.url || 'unknown URL'

      return {
        name: 'web_search',
        arguments: stringifyArguments({ url }),
        output: isError ? `Open page failed: ${url}` : `Opened page: ${url}`,
        isError
      }
    }
    case 'find_in_page': {
      return {
        name: 'web_search',
        arguments: stringifyArguments({
          url: item.action.url,
          pattern: item.action.pattern
        }),
        output: isError
          ? `Find in page failed for "${item.action.pattern}" in ${item.action.url}`
          : `Searched ${item.action.url} for "${item.action.pattern}"`,
        isError
      }
    }
    default: {
      return {
        name: 'web_search',
        arguments: '{}',
        output: isError ? 'Web search call failed.' : 'Web search call completed.',
        isError
      }
    }
  }
}
