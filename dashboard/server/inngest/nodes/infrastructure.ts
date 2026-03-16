import type { NodeExecutor } from './types'
import {
  describeBranch,
  describeEmit,
  describeNotify,
  describeRetrieve,
  describeReview,
  describeWait
} from './describe'
import { joinArtifactInputs } from './input'
import type { Database } from '../../../shared/types/database'
import type { ArtifactType, RetrieveConfig, RetrieveTimeWindow } from '../../../shared/types/task-engine'

type ArtifactRow = Database['public']['Tables']['artifacts']['Row']

interface ResolvedRetrieveConfig {
  match: string | null
  taskId: string | null
  timeWindow: RetrieveTimeWindow | null
  contentSearch: string | null
  types: ArtifactType[] | null
  limit: number | null
  sort: 'newest' | 'oldest'
  format: 'structured' | 'legacy'
}

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

function toRuntimeArtifact(artifact: ArtifactRow) {
  return {
    title: artifact.title,
    content: artifact.content || '',
    type: artifact.type,
    metadata: {
      source_id: artifact.id
    }
  }
}

function normalizeRetrieveConfig(config: RetrieveConfig | null): ResolvedRetrieveConfig | null {
  if (!config) {
    return null
  }

  return {
    match: config.match || null,
    taskId: config.task_id || null,
    timeWindow: config.time_window || null,
    contentSearch: config.content_search || null,
    types: Array.isArray(config.types) && config.types.length ? config.types : null,
    limit: Number.isFinite(config.limit) && config.limit > 0 ? Math.floor(config.limit) : 10,
    sort: config.sort === 'oldest' ? 'oldest' : 'newest',
    format: 'structured'
  }
}

function resolveLegacyRetrieveConfig(source: string | null, filter: string | null): ResolvedRetrieveConfig | null {
  if (!source) {
    return null
  }

  return {
    match: source.startsWith('task:') ? null : source,
    taskId: source.startsWith('task:') ? source.replace('task:', '') : null,
    timeWindow: filter === 'last_7_days' ? '7d' : null,
    contentSearch: null,
    types: null,
    limit: null,
    sort: 'newest',
    format: 'legacy'
  }
}

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

async function resolveTimeWindowStart(
  context: Parameters<NodeExecutor>[1],
  timeWindow: RetrieveTimeWindow | null
) {
  if (!timeWindow) {
    return {
      startAt: null,
      effectiveWindow: null
    }
  }

  if (timeWindow === '24h') {
    return { startAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), effectiveWindow: '24h' as const }
  }

  if (timeWindow === '7d') {
    return { startAt: daysAgo(7), effectiveWindow: '7d' as const }
  }

  if (timeWindow === '30d') {
    return { startAt: daysAgo(30), effectiveWindow: '30d' as const }
  }

  const { data, error } = await context.supabase
    .from('tasks')
    .select('last_completed_run_at')
    .eq('id', context.taskId)
    .single()

  if (error) {
    throw new Error(error.message)
  }

  if (data?.last_completed_run_at) {
    return {
      startAt: data.last_completed_run_at,
      effectiveWindow: 'since_last_run' as const
    }
  }

  return {
    startAt: daysAgo(7),
    effectiveWindow: '7d' as const
  }
}

async function loadArtifactsByIds(
  context: Parameters<NodeExecutor>[1],
  artifactIds: string[]
) {
  if (!artifactIds.length) {
    return []
  }

  const { data, error } = await context.supabase
    .from('artifacts')
    .select('id, title, content, type, metadata_json, storage_path, created_at, task_id, created_by_run_id, created_by_node_id, description')
    .in('id', artifactIds)

  if (error) {
    throw new Error(error.message)
  }

  const artifactsById = new Map((data || []).map(artifact => [artifact.id, artifact]))

  return artifactIds
    .map(id => artifactsById.get(id))
    .filter((artifact): artifact is ArtifactRow => Boolean(artifact))
}

async function loadTaskInputArtifacts(context: Parameters<NodeExecutor>[1]) {
  const { data: task, error: taskError } = await context.supabase
    .from('tasks')
    .select('input_artifact_ids')
    .eq('id', context.taskId)
    .single()

  if (taskError) {
    throw new Error(taskError.message)
  }

  const artifactIds = Array.isArray(task?.input_artifact_ids)
    ? task.input_artifact_ids.filter((value): value is string => typeof value === 'string')
    : []

  return loadArtifactsByIds(context, artifactIds)
}

export const retrieve: NodeExecutor = async (node, context) => {
  const isRootNode = node.depends_on.length === 0
  const hasUserOverride = isRootNode && context.inputArtifacts.length > 0

  if (hasUserOverride) {
    const count = context.inputArtifacts.length
    return {
      artifacts: context.inputArtifacts.map(artifact => ({
        title: artifact.title,
        content: artifact.content || '',
        type: artifact.type,
        metadata: {
          source_id: artifact.id
        }
      })),
      description: describeRetrieve({
        count,
        fallbackSource: 'run_input'
      }),
      logs: {
        retrieved_count: count,
        source: 'run_input',
        filter: null,
        used_override: true
      }
    }
  }

  const config = normalizeRetrieveConfig(node.retrieve_config) || resolveLegacyRetrieveConfig(node.source, node.filter)

  if (!config) {
    const count = context.inputArtifacts.length
    return {
      artifacts: context.inputArtifacts.map(artifact => ({
        title: artifact.title,
        content: artifact.content || '',
        type: artifact.type,
        metadata: {
          source_id: artifact.id
        }
      })),
      description: describeRetrieve({ count }),
      logs: {
        retrieved_count: count,
        source: 'passthrough',
        filter: null
      }
    }
  }

  let query = context.supabase
    .from('artifacts')
    .select('id, title, content, type, metadata_json, storage_path, created_at, task_id, created_by_run_id, created_by_node_id, description')
    .order('created_at', { ascending: config.sort === 'oldest' })

  if (config.match) {
    query = query.ilike('title', `%${config.match}%`)
  }

  if (config.taskId) {
    query = query.eq('task_id', config.taskId)
  }

  if (config.types?.length) {
    query = query.in('type', config.types)
  }

  if (config.contentSearch) {
    query = query.ilike('content', `%${config.contentSearch}%`)
  }

  const timeWindow = await resolveTimeWindowStart(context, config.timeWindow)

  if (timeWindow.startAt) {
    query = query.gte('created_at', timeWindow.startAt)
  }

  if (config.limit) {
    query = query.limit(config.limit)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(error.message)
  }

  const results = data || []
  const count = results.length

  if (!count && isRootNode) {
    const fallbackArtifacts = await loadTaskInputArtifacts(context)

    if (fallbackArtifacts.length > 0) {
      return {
        artifacts: fallbackArtifacts.map(toRuntimeArtifact),
        description: describeRetrieve({
          count: fallbackArtifacts.length,
          fallbackSource: 'task_input_artifacts'
        }),
        logs: {
          retrieved_count: fallbackArtifacts.length,
          source: config.format === 'legacy' ? node.source : 'retrieve_config',
          filter: node.filter,
          config_format: config.format,
          match: config.match,
          task_id: config.taskId,
          time_window: config.timeWindow,
          effective_time_window: timeWindow.effectiveWindow,
          content_search: config.contentSearch,
          types: config.types,
          limit: config.limit,
          sort: config.sort,
          fallback_used: 'task_input_artifacts'
        }
      }
    }
  }

  return {
    artifacts: results.map(toRuntimeArtifact),
    description: describeRetrieve({
      count,
      source: node.source,
      match: config.match,
      taskId: config.taskId,
      timeWindow: timeWindow.effectiveWindow
    }),
    logs: {
      retrieved_count: count,
      source: node.source,
      filter: node.filter,
      config_format: config.format,
      match: config.match,
      task_id: config.taskId,
      time_window: config.timeWindow,
      effective_time_window: timeWindow.effectiveWindow,
      content_search: config.contentSearch,
      types: config.types,
      limit: config.limit,
      sort: config.sort
    }
  }
}

export const emit: NodeExecutor = async (node, context) => {
  const title = replaceTitleTokens(node.title || 'Output')
  const format = node.format || 'markdown'
  const content = joinArtifactInputs(context.inputArtifacts)

  return {
    artifacts: [{
      title,
      content,
      type: format
    }],
    description: describeEmit(title, format),
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
    description: describeReview(node.message),
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
    description: describeBranch(node.condition, outcome, selectedNode),
    logs: {
      condition: node.condition,
      outcome,
      selected_node: selectedNode,
      skipped_node: skippedNode
    }
  }
}

export const notify: NodeExecutor = async (node, context) => {
  const level = node.level || 'info'
  const preview = joinArtifactInputs(context.inputArtifacts).slice(0, 1000)

  return {
    artifacts: [],
    description: describeNotify(level, node.message),
    logs: {
      level,
      message: node.message || 'Notification generated',
      preview
    }
  }
}

export const wait: NodeExecutor = async (node, context) => ({
  artifacts: [],
  description: describeWait(node.duration),
  logs: {
    requested_duration: node.duration,
    wait_ms: parseDurationToMs(node.duration),
    input_count: context.inputArtifacts.length
  }
})
