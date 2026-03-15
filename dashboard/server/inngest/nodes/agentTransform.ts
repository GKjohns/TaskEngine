import { joinArtifactInputs, renderArtifactInput } from './input'
import { runAgentLoop } from './agentLoop'
import { describeAgentResult } from './describe'
import { agentTransformTools } from './tools'
import type { NodeExecutor } from './types'

const MODEL = 'gpt-5.4'
const AGENT_LOOP_TIMEOUT_MS = 120_000

function buildInstructions(prompt: string | null) {
  return [
    'You are an agent node in Task Engine.',
    'Complete the requested work using the available artifact tools when helpful.',
    'Reason step by step, use tools sequentially, and produce a clear final answer.',
    prompt || 'No additional task instructions were provided.'
  ].join('\n\n')
}

async function runAgentLoopWithTimeout<T>(promise: Promise<T>) {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Agent transform node timed out after ${Math.round(AGENT_LOOP_TIMEOUT_MS / 1000)} seconds`))
      }, AGENT_LOOP_TIMEOUT_MS)
    })
  ])
}

export const agentTransform: NodeExecutor = async (node, context) => {
  if (node.per_artifact && context.inputArtifacts.length > 0) {
    const artifacts = []
    const calls: Array<Record<string, unknown>> = []
    const descriptions: string[] = []

    for (const artifact of context.inputArtifacts) {
      const result = await runAgentLoopWithTimeout(runAgentLoop({
        model: MODEL,
        instructions: buildInstructions(node.prompt),
        input: renderArtifactInput(artifact),
        tools: agentTransformTools,
        maxIterations: 10,
        reasoning: { effort: 'high' },
        context
      }))

      const desc = describeAgentResult(result.output)
      artifacts.push({
        title: node.title ? `${node.title} - ${artifact.title}` : `${artifact.title} result`,
        content: result.output,
        type: 'markdown' as const,
        description: desc
      })
      descriptions.push(desc)
      calls.push({
        artifact_id: artifact.id,
        artifact_title: artifact.title,
        iterations: result.iterations,
        tool_calls: result.toolCalls,
        tokens: result.tokens
      })
    }

    const nodeDesc = descriptions.length > 1
      ? `Processed ${descriptions.length} artifacts: ${descriptions.slice(0, 3).join('; ')}`
      : descriptions[0] || undefined

    return {
      artifacts,
      description: nodeDesc,
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

  const result = await runAgentLoopWithTimeout(runAgentLoop({
    model: MODEL,
    instructions: buildInstructions(node.prompt),
    input: inputText,
    tools: agentTransformTools,
    maxIterations: 10,
    reasoning: { effort: 'high' },
    context
  }))

  const description = describeAgentResult(result.output)

  return {
    artifacts: [{
      title: node.title || 'Agent Output',
      content: result.output,
      type: 'markdown',
      description
    }],
    description,
    logs: {
      model: MODEL,
      per_artifact: false,
      iterations: result.iterations,
      tool_calls: result.toolCalls,
      tokens: result.tokens
    }
  }
}
