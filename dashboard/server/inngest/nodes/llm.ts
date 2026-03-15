import type { ResponseTextConfig } from 'openai/resources/responses/responses'
import type { ArtifactType, PlanNode } from '../../../shared/types/task-engine'
import { joinArtifactInputs, renderArtifactInput } from './input'
import type { NodeExecutionContext, NodeExecutor, NodeExecutorResult } from './types'

interface LlmCallConfig {
  model: string
  instructions: string
  reasoning?: { effort: 'low' | 'medium' | 'high' }
  textFormat?: ResponseTextConfig['format']
  artifactType?: ArtifactType
  title?: string
}

async function runLlmNode(
  node: PlanNode,
  context: NodeExecutionContext,
  buildCall: (inputText: string, artifactTitle?: string) => LlmCallConfig
): Promise<NodeExecutorResult> {
  const perArtifact = node.per_artifact === true && context.inputArtifacts.length > 0

  if (perArtifact) {
    const artifacts = []
    const calls: Array<Record<string, unknown>> = []

    for (const artifact of context.inputArtifacts) {
      const inputText = renderArtifactInput(artifact)
      const callConfig = buildCall(inputText, artifact.title)
      const response = await context.openai.responses.create({
        model: callConfig.model,
        instructions: callConfig.instructions,
        input: inputText,
        reasoning: callConfig.reasoning,
        text: callConfig.textFormat ? { format: callConfig.textFormat } : undefined
      })

      artifacts.push({
        title: callConfig.title || `${artifact.title} result`,
        content: response.output_text,
        type: callConfig.artifactType || 'markdown'
      })
      calls.push({
        artifact: artifact.title,
        usage: response.usage || null
      })
    }

    return {
      artifacts,
      logs: {
        model: artifacts.length > 0 ? buildCall('', context.inputArtifacts[0]?.title).model : 'unknown',
        per_artifact: true,
        calls
      }
    }
  }

  const inputText = context.inputArtifacts.length
    ? joinArtifactInputs(context.inputArtifacts)
    : (node.prompt || '')
  const callConfig = buildCall(inputText)
  const response = await context.openai.responses.create({
    model: callConfig.model,
    instructions: callConfig.instructions,
    input: inputText,
    reasoning: callConfig.reasoning,
    text: callConfig.textFormat ? { format: callConfig.textFormat } : undefined
  })

  return {
    artifacts: [{
      title: callConfig.title || 'Result',
      content: response.output_text,
      type: callConfig.artifactType || 'markdown'
    }],
    logs: {
      model: callConfig.model,
      per_artifact: false,
      usage: response.usage || null
    }
  }
}

export const llmSummarize: NodeExecutor = async (node, context) => runLlmNode(node, context, () => ({
  model: 'gpt-5-mini',
  instructions: [
    'Summarize the provided content into a concise, readable markdown output.',
    node.max_length ? `Keep the summary under ${node.max_length} words.` : '',
    node.prompt || ''
  ].filter(Boolean).join('\n\n'),
  reasoning: { effort: 'medium' },
  artifactType: 'markdown',
  title: 'Summary'
}))

export const llmClassify: NodeExecutor = async (node, context) => runLlmNode(node, context, () => ({
  model: 'gpt-5-nano',
  instructions: node.prompt || 'Classify the provided content.',
  reasoning: { effort: 'low' },
  textFormat: {
    type: 'json_schema',
    name: 'classification_result',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        label: {
          type: 'string',
          enum: node.labels || []
        },
        confidence: {
          type: 'number'
        },
        reasoning: {
          type: 'string'
        }
      },
      required: ['label', 'confidence', 'reasoning'],
      additionalProperties: false
    }
  },
  artifactType: 'json',
  title: 'Classification'
}))

export const llmExtract: NodeExecutor = async (node, context) => runLlmNode(node, context, () => ({
  model: 'gpt-5-mini',
  instructions: node.prompt || 'Extract the most important structured facts from the provided content.',
  reasoning: { effort: 'medium' },
  textFormat: {
    type: 'json_schema',
    name: 'extraction_result',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'string'
          }
        },
        summary: {
          type: 'string'
        }
      },
      required: ['items', 'summary'],
      additionalProperties: false
    }
  },
  artifactType: 'json',
  title: 'Extraction'
}))

export const llmTransform: NodeExecutor = async (node, context) => runLlmNode(node, context, () => ({
  model: 'gpt-5-mini',
  instructions: [
    'Transform the provided content according to the instructions below.',
    node.prompt || ''
  ].filter(Boolean).join('\n\n'),
  reasoning: { effort: 'medium' },
  artifactType: 'markdown',
  title: 'Transformation'
}))
