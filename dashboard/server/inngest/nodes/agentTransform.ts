import { joinArtifactInputs, renderArtifactInput } from './input'
import { runAgentLoop } from './agentLoop'
import { agentTransformTools } from './tools'
import type { NodeExecutor } from './types'

const MODEL = 'gpt-5.4'

function buildInstructions(prompt: string | null) {
  return [
    'You are an agent node in Task Engine.',
    'Complete the requested work using the available artifact tools when helpful.',
    'Reason step by step, use tools sequentially, and produce a clear final answer.',
    prompt || 'No additional task instructions were provided.'
  ].join('\n\n')
}

export const agentTransform: NodeExecutor = async (node, context) => {
  if (node.per_artifact && context.inputArtifacts.length > 0) {
    const artifacts = []
    const calls: Array<Record<string, unknown>> = []

    for (const artifact of context.inputArtifacts) {
      const result = await runAgentLoop({
        model: MODEL,
        instructions: buildInstructions(node.prompt),
        input: renderArtifactInput(artifact),
        tools: agentTransformTools,
        maxIterations: 10,
        reasoning: { effort: 'high' },
        context
      })

      artifacts.push({
        title: node.title ? `${node.title} - ${artifact.title}` : `${artifact.title} result`,
        content: result.output,
        type: 'markdown' as const
      })
      calls.push({
        artifact_id: artifact.id,
        artifact_title: artifact.title,
        iterations: result.iterations,
        tool_calls: result.toolCalls,
        tokens: result.tokens
      })
    }

    return {
      artifacts,
      logs: {
        model: MODEL,
        per_artifact: true,
        calls
      }
    }
  }

  const inputText = context.inputArtifacts.length
    ? joinArtifactInputs(context.inputArtifacts)
    : (node.prompt || '')

  const result = await runAgentLoop({
    model: MODEL,
    instructions: buildInstructions(node.prompt),
    input: inputText,
    tools: agentTransformTools,
    maxIterations: 10,
    reasoning: { effort: 'high' },
    context
  })

  return {
    artifacts: [{
      title: node.title || 'Agent Output',
      content: result.output,
      type: 'markdown'
    }],
    logs: {
      model: MODEL,
      per_artifact: false,
      iterations: result.iterations,
      tool_calls: result.toolCalls,
      tokens: result.tokens
    }
  }
}
