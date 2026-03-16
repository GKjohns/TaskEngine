import type { ResponseTextConfig } from 'openai/resources/responses/responses'
import type { ArtifactType, PlanNode } from '../../../shared/types/task-engine'
import {
  describeClassifyResult,
  describeExtractResult,
  describeSummarizeResult,
  describeTransformResult
} from './describe'
import { joinArtifactInputs, renderArtifactInput } from './input'
import type { NodeExecutionContext, NodeExecutor, NodeExecutorResult } from './types'

type DescribeFn = (outputText: string, artifactTitle?: string) => string

interface LlmCallConfig {
  model: string
  instructions: string
  reasoning?: { effort: 'low' | 'medium' | 'high' }
  textFormat?: ResponseTextConfig['format']
  artifactType?: ArtifactType
  title?: string
  describe?: DescribeFn
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
    const descriptions: string[] = []

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

      const artifactDesc = callConfig.describe?.(response.output_text, artifact.title)
      artifacts.push({
        title: callConfig.title || `${artifact.title} result`,
        content: response.output_text,
        type: callConfig.artifactType || 'markdown',
        description: artifactDesc
      })
      descriptions.push(artifactDesc || '')
      calls.push({
        artifact: artifact.title,
        usage: response.usage || null
      })
    }

    const nodeDesc = descriptions.filter(Boolean).length > 1
      ? `Processed ${descriptions.length} artifacts: ${descriptions.filter(Boolean).slice(0, 3).join('; ')}`
      : descriptions[0] || undefined

    return {
      artifacts,
      description: nodeDesc,
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

  const description = callConfig.describe?.(response.output_text)

  return {
    artifacts: [{
      title: callConfig.title || 'Result',
      content: response.output_text,
      type: callConfig.artifactType || 'markdown',
      description
    }],
    description,
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
  title: 'Summary',
  describe: output => describeSummarizeResult(output)
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
  title: 'Classification',
  describe: (output, artifactTitle) => describeClassifyResult(output, artifactTitle)
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
  title: 'Extraction',
  describe: (output, artifactTitle) => describeExtractResult(output, artifactTitle)
}))

export const llmTransform: NodeExecutor = async (node, context) => runLlmNode(node, context, () => ({
  model: 'gpt-5-mini',
  instructions: [
    'Transform the provided content according to the instructions below.',
    node.prompt || ''
  ].filter(Boolean).join('\n\n'),
  reasoning: { effort: 'medium' },
  artifactType: 'markdown',
  title: 'Transformation',
  describe: output => describeTransformResult(output)
}))
