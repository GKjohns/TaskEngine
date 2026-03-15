import type {
  FunctionTool,
  ResponseCreateParamsNonStreaming,
  ResponseFunctionToolCall,
  ResponseInputItem
} from 'openai/resources/responses/responses'
import type { AgentTool, NodeExecutionContext } from './types'

interface AgentLoopConfig {
  model: string
  instructions: string
  input: string | ResponseInputItem[]
  tools: AgentTool[]
  maxIterations: number
  reasoning: { effort: 'low' | 'medium' | 'high' }
  context: NodeExecutionContext
}

interface AgentLoopToolCall {
  name: string
  input: unknown
  output: string
  isError: boolean
}

interface AgentLoopResult {
  output: string
  iterations: number
  toolCalls: AgentLoopToolCall[]
  tokens: { input: number, output: number, reasoning: number }
}

function isFunctionCall(item: { type: string }): item is ResponseFunctionToolCall {
  return item.type === 'function_call'
}

function parseToolArguments(rawArguments: string) {
  if (!rawArguments.trim()) {
    return {}
  }

  const parsed = JSON.parse(rawArguments)

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Tool arguments must be a JSON object')
  }

  return parsed as Record<string, unknown>
}

export async function runAgentLoop(config: AgentLoopConfig): Promise<AgentLoopResult> {
  const collectedToolCalls: AgentLoopResult['toolCalls'] = []
  const totalTokens = { input: 0, output: 0, reasoning: 0 }
  const toolDefs: FunctionTool[] = config.tools.map(tool => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: true
  }))

  let previousResponseId: string | null = null
  let iterations = 0
  let currentInput: AgentLoopConfig['input'] = config.input
  let lastOutputText = ''

  while (iterations < config.maxIterations) {
    iterations++

    const requestParams: ResponseCreateParamsNonStreaming = {
      model: config.model,
      instructions: config.instructions,
      input: currentInput,
      reasoning: config.reasoning,
      tools: toolDefs.length > 0 ? toolDefs : undefined,
      previous_response_id: previousResponseId,
      store: true
    }

    const response = await config.context.openai.responses.create(requestParams)

    previousResponseId = response.id
    lastOutputText = response.output_text || lastOutputText
    totalTokens.input += response.usage?.input_tokens || 0
    totalTokens.output += response.usage?.output_tokens || 0
    totalTokens.reasoning += response.usage?.output_tokens_details?.reasoning_tokens || 0

    const functionCalls = response.output.filter(isFunctionCall)

    if (functionCalls.length === 0) {
      return {
        output: response.output_text,
        iterations,
        toolCalls: collectedToolCalls,
        tokens: totalTokens
      }
    }

    const toolResults: ResponseInputItem[] = []

    for (const call of functionCalls) {
      const tool = config.tools.find(candidate => candidate.name === call.name)
      let parsedInput: Record<string, unknown> | null = null
      let loggedInput: unknown = call.arguments
      let output: string
      let isError = false

      if (!tool) {
        output = `Error: Unknown tool "${call.name}".`
        isError = true
      } else {
        try {
          parsedInput = parseToolArguments(call.arguments)
          loggedInput = parsedInput
          output = await tool.run(parsedInput, config.context)
        } catch (error) {
          output = `Error: ${error instanceof Error ? error.message : 'Unknown tool execution error'}`
          isError = true
        }
      }

      collectedToolCalls.push({
        name: call.name,
        input: loggedInput,
        output,
        isError
      })

      toolResults.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output
      })
    }

    currentInput = toolResults
  }

  const output = lastOutputText
    ? `${lastOutputText}\n\n[Agent reached max iterations (${config.maxIterations}).]`
    : `[Agent reached max iterations (${config.maxIterations}). Last output may be incomplete.]`

  return {
    output,
    iterations,
    toolCalls: collectedToolCalls,
    tokens: totalTokens
  }
}
