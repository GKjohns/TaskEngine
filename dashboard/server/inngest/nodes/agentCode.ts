import { joinArtifactInputs, renderArtifactInput } from './input'
import { runAgentLoop } from './agentLoop'
import { describeAgentResult } from './describe'
import { agentCodeTools } from './tools'
import type { NodeExecutor } from './types'

const MODEL = 'gpt-5.4'
const AGENT_LOOP_TIMEOUT_MS = 300_000
const ARTIFACT_CREATED_RE = /^Artifact created: ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/

function extractCreatedArtifactIds(toolCalls: Array<Record<string, unknown>>): string[] {
  const ids: string[] = []

  for (const call of toolCalls) {
    if (call.name !== 'write_artifact' || call.isError === true || typeof call.output !== 'string') {
      continue
    }

    const match = call.output.match(ARTIFACT_CREATED_RE)
    if (match?.[1]) {
      ids.push(match[1])
    }
  }

  return ids
}

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

async function runAgentLoopWithTimeout<T>(promise: Promise<T>) {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Agent code node timed out after ${Math.round(AGENT_LOOP_TIMEOUT_MS / 1000)} seconds`))
      }, AGENT_LOOP_TIMEOUT_MS)
    })
  ])
}

export const agentCode: NodeExecutor = async (node, context) => {
  if (node.per_artifact && context.inputArtifacts.length > 0) {
    const artifacts = []
    const calls: Array<Record<string, unknown>> = []
    const descriptions: string[] = []

    for (const artifact of context.inputArtifacts) {
      const result = await runAgentLoopWithTimeout(runAgentLoop({
        model: MODEL,
        instructions: buildInstructions(node.prompt),
        input: renderArtifactInput(artifact),
        tools: agentCodeTools,
        maxIterations: 15,
        reasoning: { effort: 'low' },
        context
      }))

      const desc = describeAgentResult(result.output)
      artifacts.push({
        title: defaultOutputTitle(node.title, artifact.title),
        content: result.output,
        type: inferOutputType(result.output),
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
    tools: agentCodeTools,
    maxIterations: 15,
    reasoning: { effort: 'low' },
    context
  }))

  const description = describeAgentResult(result.output)
  const createdIds = extractCreatedArtifactIds(result.toolCalls)

  const artifacts = createdIds.length > 0
    ? createdIds.map(id => ({
      title: '',
      content: '',
      type: 'markdown' as const,
      metadata: { artifact_id: id }
    }))
    : [{
      title: defaultOutputTitle(node.title),
      content: result.output,
      type: inferOutputType(result.output),
      description
    }]

  return {
    artifacts,
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
