import type OpenAI from 'openai'
import type {
  FunctionTool,
  ResponseCreateParamsStreaming,
  ResponseFunctionToolCall,
  ResponseInputItem,
  ResponseOutputItem
} from 'openai/resources/responses/responses'
import type { ChatContextMessage } from './chatContext'
import type { ChatTool, ChatToolContext } from './chatToolTypes'

export interface ChatLoopConfig {
  openai: OpenAI
  model?: string
  systemPrompt: string
  messages: ChatContextMessage[]
  tools: ChatTool[]
  toolContext: ChatToolContext
  maxToolRounds?: number
}

export type ChatEvent = { type: 'text-delta', delta: string }
  | { type: 'tool-call', name: string, arguments: string }
  | { type: 'tool-result', name: string, output: string }
  | { type: 'error', message: string }
  | { type: 'done', fullText: string }

function isFunctionCall(item: ResponseOutputItem): item is ResponseFunctionToolCall {
  return item.type === 'function_call'
}

function toInputMessages(messages: ChatContextMessage[]): ResponseInputItem[] {
  return messages.map(message => ({
    type: 'message',
    role: message.role,
    content: message.content
  }))
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

async function collectResponseRound(
  config: ChatLoopConfig,
  input: ResponseInputItem[],
  toolDefs: FunctionTool[],
  fullText: { value: string },
  emit: (event: ChatEvent) => Promise<void>
) {
  const outputItems: ResponseOutputItem[] = []
  const functionCalls: ResponseFunctionToolCall[] = []

  const request: ResponseCreateParamsStreaming = {
    stream: true,
    model: config.model || 'gpt-5-mini',
    instructions: config.systemPrompt,
    input,
    tools: toolDefs.length ? toolDefs : undefined,
    text: {
      verbosity: 'low'
    }
  }

  const stream = await config.openai.responses.create(request)

  for await (const event of stream) {
    switch (event.type) {
      case 'response.output_text.delta':
        fullText.value += event.delta
        await emit({
          type: 'text-delta',
          delta: event.delta
        })
        break
      case 'response.output_item.done':
        outputItems.push(event.item)

        if (isFunctionCall(event.item)) {
          functionCalls.push(event.item)
          await emit({
            type: 'tool-call',
            name: event.item.name,
            arguments: event.item.arguments
          })
        }
        break
      case 'error':
        throw new Error(event.message)
      case 'response.failed':
        throw new Error('OpenAI response failed')
      default:
        break
    }
  }

  return {
    outputItems,
    functionCalls
  }
}

export async function* runChatLoop(config: ChatLoopConfig): AsyncGenerator<ChatEvent> {
  const toolDefs: FunctionTool[] = config.tools.map(tool => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: false
  }))

  const fullText = { value: '' }
  let conversationInput = toInputMessages(config.messages)
  const maxToolRounds = config.maxToolRounds ?? 3

  try {
    for (let toolRound = 0; toolRound < maxToolRounds; toolRound++) {
      const emittedEvents: ChatEvent[] = []
      const emit = async (event: ChatEvent) => {
        emittedEvents.push(event)
      }

      const round = await collectResponseRound(config, conversationInput, toolDefs, fullText, emit)

      for (const event of emittedEvents) {
        yield event
      }

      conversationInput = [...conversationInput, ...round.outputItems]

      if (!round.functionCalls.length) {
        yield {
          type: 'done',
          fullText: fullText.value
        }
        return
      }

      const toolOutputs: ResponseInputItem[] = []

      for (const call of round.functionCalls) {
        const tool = config.tools.find(candidate => candidate.name === call.name)
        let output: string

        if (!tool) {
          output = `Error: Unknown tool "${call.name}".`
        } else {
          try {
            const args = parseToolArguments(call.arguments)
            output = await tool.execute(args, config.toolContext)
          } catch (error) {
            output = `Error: ${error instanceof Error ? error.message : 'Unknown tool execution error'}`
          }
        }

        yield {
          type: 'tool-result',
          name: call.name,
          output
        }

        toolOutputs.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output
        })
      }

      conversationInput = [...conversationInput, ...toolOutputs]
    }

    yield {
      type: 'done',
      fullText: fullText.value
    }
  } catch (error) {
    yield {
      type: 'error',
      message: error instanceof Error ? error.message : 'Chat request failed'
    }
    yield {
      type: 'done',
      fullText: fullText.value
    }
  }
}
