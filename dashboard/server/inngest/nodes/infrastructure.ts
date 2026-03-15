import type { NodeExecutor } from './types'
import { joinArtifactInputs } from './input'

function replaceTitleTokens(value: string) {
  const now = new Date()
  return value
    .replaceAll('{{date}}', now.toLocaleDateString())
    .replaceAll('{{datetime}}', now.toISOString())
}

function evaluateBranchCondition(condition: string | null, inputText: string, artifactCount: number) {
  const normalized = condition?.trim().toLowerCase() || ''

  if (!normalized) {
    return artifactCount > 0
  }

  if (normalized === 'has_input' || normalized === 'has input') {
    return artifactCount > 0
  }

  if (normalized === 'no_input' || normalized === 'no input') {
    return artifactCount === 0
  }

  const countMatch = normalized.match(/^artifact_count\s*(>=|>|<=|<|=)\s*(\d+)$/)

  if (countMatch) {
    const [, operator = '=', rawValue = '0'] = countMatch
    const value = Number.parseInt(rawValue, 10)

    switch (operator) {
      case '>':
        return artifactCount > value
      case '>=':
        return artifactCount >= value
      case '<':
        return artifactCount < value
      case '<=':
        return artifactCount <= value
      default:
        return artifactCount === value
    }
  }

  const containsMatch = normalized.match(/^contains:(.+)$/)

  if (containsMatch) {
    const [, searchTerm = ''] = containsMatch
    return inputText.toLowerCase().includes(searchTerm.trim())
  }

  return inputText.toLowerCase().includes(normalized)
}

export function parseDurationToMs(duration: string | null) {
  if (!duration) {
    return 0
  }

  const match = duration.trim().match(/^(\d+)\s*(ms|s|m|h|d)$/i)

  if (!match) {
    throw new Error(`Unsupported wait duration: ${duration}`)
  }

  const [, rawValue = '0', rawUnit = 'ms'] = match
  const value = Number.parseInt(rawValue, 10)
  const unit = rawUnit.toLowerCase()

  switch (unit) {
    case 'ms':
      return value
    case 's':
      return value * 1000
    case 'm':
      return value * 60_000
    case 'h':
      return value * 3_600_000
    case 'd':
      return value * 86_400_000
    default:
      return 0
  }
}

export const retrieve: NodeExecutor = async (node, context) => {
  let query = context.supabase
    .from('artifacts')
    .select('id, title, content, type, metadata_json, storage_path')
    .order('created_at', { ascending: false })

  if (node.source) {
    if (node.source.startsWith('task:')) {
      query = query.eq('task_id', node.source.replace('task:', ''))
    } else {
      query = query.ilike('title', `%${node.source}%`)
    }
  }

  if (node.filter === 'last_7_days') {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    query = query.gte('created_at', weekAgo)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(error.message)
  }

  return {
    artifacts: (data || []).map(artifact => ({
      title: artifact.title,
      content: artifact.content || '',
      type: artifact.type,
      metadata: {
        source_id: artifact.id
      }
    })),
    logs: {
      retrieved_count: data?.length || 0,
      source: node.source,
      filter: node.filter
    }
  }
}

export const emit: NodeExecutor = async (node, context) => {
  const title = replaceTitleTokens(node.title || 'Output')
  const content = joinArtifactInputs(context.inputArtifacts)

  return {
    artifacts: [{
      title,
      content,
      type: node.format || 'markdown'
    }],
    logs: {
      emitted_title: title,
      artifact_count: context.inputArtifacts.length
    }
  }
}

export const review: NodeExecutor = async (node, context) => {
  const { data, error } = await context.supabase
    .from('reviews')
    .insert({
      run_id: context.runId,
      node_run_id: context.nodeRunId,
      status: 'pending',
      comments: node.message || null
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(error?.message || 'Failed to create review record')
  }

  const runUpdate = await context.supabase
    .from('runs')
    .update({ status: 'waiting_review' })
    .eq('id', context.runId)

  if (runUpdate.error) {
    throw new Error(runUpdate.error.message)
  }

  return {
    artifacts: [],
    logs: {
      review_id: data.id,
      message: node.message || 'Review requested'
    }
  }
}

export const branch: NodeExecutor = async (node, context) => {
  const inputText = joinArtifactInputs(context.inputArtifacts)
  const outcome = evaluateBranchCondition(node.condition, inputText, context.inputArtifacts.length)
  const selectedNode = outcome ? node.if_true_node : node.if_false_node
  const skippedNode = outcome ? node.if_false_node : node.if_true_node

  return {
    artifacts: [],
    logs: {
      condition: node.condition,
      outcome,
      selected_node: selectedNode,
      skipped_node: skippedNode
    }
  }
}

export const notify: NodeExecutor = async (node, context) => {
  const preview = joinArtifactInputs(context.inputArtifacts).slice(0, 1000)

  return {
    artifacts: [],
    logs: {
      level: node.level || 'info',
      message: node.message || 'Notification generated',
      preview
    }
  }
}

export const wait: NodeExecutor = async (node, context) => ({
  artifacts: [],
  logs: {
    requested_duration: node.duration,
    wait_ms: parseDurationToMs(node.duration),
    input_count: context.inputArtifacts.length
  }
})
