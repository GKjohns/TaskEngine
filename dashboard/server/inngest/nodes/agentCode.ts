import { joinArtifactInputs, renderArtifactInput } from './input'
import { runAgentLoop } from './agentLoop'
import { agentCodeTools } from './tools'
import type { NodeExecutor } from './types'

const MODEL = 'gpt-5.4'

function inferOutputType(output: string): 'json' | 'text' {
  try {
    JSON.parse(output)
    return 'json'
  } catch {
    return 'text'
  }
}

function defaultOutputTitle(nodeTitle: string | null, sourceTitle?: string) {
  if (nodeTitle) {
    return sourceTitle ? `${nodeTitle} - ${sourceTitle}` : nodeTitle
  }

  return sourceTitle ? `${sourceTitle} result` : 'Agent Code Result'
}

function buildInstructions(prompt: string | null) {
  return [
    'You are a code execution agent in Task Engine.',
    'Use Python for calculations, parsing, and data processing when it helps complete the task.',
    'Assume a constrained runtime: prefer the Python standard library and avoid third-party packages unless the task explicitly proves they are available.',
    'Prefer testing code on a small sample before processing the full input, then summarize the final result clearly.',
    prompt || 'No additional task instructions were provided.'
  ].join('\n\n')
}

export const agentCode: NodeExecutor = async (node, context) => {
  if (node.per_artifact && context.inputArtifacts.length > 0) {
    const artifacts = []
    const calls: Array<Record<string, unknown>> = []

    for (const artifact of context.inputArtifacts) {
      const result = await runAgentLoop({
        model: MODEL,
        instructions: buildInstructions(node.prompt),
        input: renderArtifactInput(artifact),
        tools: agentCodeTools,
        maxIterations: 15,
        reasoning: { effort: 'high' },
        context
      })

      artifacts.push({
        title: defaultOutputTitle(node.title, artifact.title),
        content: result.output,
        type: inferOutputType(result.output)
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
    tools: agentCodeTools,
    maxIterations: 15,
    reasoning: { effort: 'high' },
    context
  })

  return {
    artifacts: [{
      title: defaultOutputTitle(node.title),
      content: result.output,
      type: inferOutputType(result.output)
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
