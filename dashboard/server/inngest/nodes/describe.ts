/**
 * Utilities for generating short natural-language descriptions of node
 * executions and artifacts. These descriptions are displayed in the UI
 * so users can understand what happened without inspecting raw data.
 *
 * The functions here derive descriptions from output data that's already
 * available, avoiding extra LLM calls.
 */

export function firstSentence(text: string, maxLength = 140): string {
  const cleaned = text
    .replace(/^#+\s+/gm, '')
    .replace(/\*\*/g, '')
    .replace(/\n+/g, ' ')
    .trim()

  const match = cleaned.match(/^(.+?[.!?])\s/)
  if (match?.[1] && match[1].length <= maxLength) {
    return match[1]
  }

  if (cleaned.length <= maxLength) {
    return cleaned
  }

  return cleaned.slice(0, maxLength - 1).trimEnd() + '\u2026'
}

export function describeClassifyResult(outputText: string, artifactTitle?: string): string {
  try {
    const parsed = JSON.parse(outputText) as { label?: string, confidence?: number }
    const subject = artifactTitle ? `"${artifactTitle}"` : 'Input'
    const confidence = typeof parsed.confidence === 'number'
      ? ` (${Math.round(parsed.confidence * 100)}% confidence)`
      : ''
    return `${subject} classified as "${parsed.label || 'unknown'}"${confidence}`
  } catch {
    return 'Classified the input content'
  }
}

export function describeExtractResult(outputText: string, artifactTitle?: string): string {
  try {
    const parsed = JSON.parse(outputText) as { items?: unknown[], summary?: string }
    const count = Array.isArray(parsed.items) ? parsed.items.length : 0
    const source = artifactTitle ? ` from "${artifactTitle}"` : ''
    if (parsed.summary) {
      return firstSentence(parsed.summary)
    }
    return `Extracted ${count} item${count !== 1 ? 's' : ''}${source}`
  } catch {
    return 'Extracted structured data from the input'
  }
}

export function describeSummarizeResult(outputText: string): string {
  return firstSentence(outputText)
}

export function describeTransformResult(outputText: string): string {
  return firstSentence(outputText)
}

export function describeAgentResult(outputText: string): string {
  return firstSentence(outputText)
}

export function describeRetrieve(input: {
  count: number
  source?: string | null
  match?: string | null
  taskId?: string | null
  timeWindow?: string | null
  fallbackSource?: 'run_input' | 'task_input_artifacts' | null
}) {
  const { count, source, match, taskId, timeWindow, fallbackSource } = input

  if (fallbackSource === 'run_input') {
    return `Used ${count} manually selected artifact${count !== 1 ? 's' : ''}`
  }

  if (fallbackSource === 'task_input_artifacts') {
    return `Used ${count} saved task input artifact${count !== 1 ? 's' : ''} as fallback`
  }

  const parts: string[] = []

  if (match) {
    parts.push(`matching "${match}"`)
  } else if (source) {
    parts.push(`matching "${source}"`)
  }

  if (taskId) {
    parts.push('from a specific task')
  }

  if (timeWindow) {
    parts.push(`within ${timeWindow.replaceAll('_', ' ')}`)
  }

  const suffix = parts.length ? ` ${parts.join(' ')}` : ''
  return `Retrieved ${count} artifact${count !== 1 ? 's' : ''}${suffix}`
}

export function describeHttpFetch(title: string, url: string, responseType: string) {
  return `Fetched ${responseType} content from ${url} into "${title}"`
}

export function describeEmit(title: string, format: string): string {
  return `Emitted "${title}" as ${format}`
}

export function describeReview(message?: string | null): string {
  if (message) {
    return `Awaiting review: ${firstSentence(message, 100)}`
  }
  return 'Paused for human review'
}

export function describeBranch(condition: string | null, outcome: boolean, selectedNode: string | null): string {
  const cond = condition ? `"${condition}"` : 'condition'
  return `Evaluated ${cond}, selected "${selectedNode || (outcome ? 'true' : 'false')}" branch`
}

export function describeWait(duration: string | null): string {
  return duration ? `Waiting ${duration}` : 'Paused for a duration'
}

export function describeNotify(level: string, message?: string | null): string {
  const prefix = level === 'error' ? 'Error notification' : level === 'warning' ? 'Warning' : 'Notification'
  return message ? `${prefix}: ${firstSentence(message, 100)}` : prefix
}
