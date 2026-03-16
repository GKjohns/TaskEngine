import type {
  ArtifactRecord,
  JobStatus,
  NodeRunRecord,
  NodeRunStatus,
  PlanNode,
  PlanNodeType,
  ReviewStatus,
  RunStatus,
  TaskStatus
} from '../../shared/types/task-engine'

export const taskStatusColorMap: Record<TaskStatus, 'success' | 'warning' | 'neutral'> = {
  active: 'success',
  paused: 'warning',
  archived: 'neutral'
}

export const runStatusColorMap: Record<RunStatus, 'neutral' | 'primary' | 'warning' | 'success' | 'error'> = {
  pending: 'neutral',
  running: 'primary',
  waiting_review: 'warning',
  completed: 'success',
  failed: 'error',
  cancelled: 'neutral'
}

export const nodeRunStatusColorMap: Record<NodeRunStatus, 'neutral' | 'primary' | 'warning' | 'success' | 'error'> = {
  pending: 'neutral',
  running: 'primary',
  waiting_review: 'warning',
  completed: 'success',
  failed: 'error',
  skipped: 'neutral'
}

export const jobStatusColorMap: Record<JobStatus, 'neutral' | 'primary' | 'warning' | 'success' | 'error'> = {
  idle: 'neutral',
  scheduled: 'primary',
  running: 'primary',
  waiting_review: 'warning',
  paused: 'warning',
  completed: 'success',
  failed: 'error'
}

export const reviewStatusColorMap: Record<ReviewStatus, 'warning' | 'success' | 'error' | 'info'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
  edited: 'info'
}

export const artifactTypeColorMap: Record<ArtifactRecord['type'], 'primary' | 'neutral' | 'info' | 'success'> = {
  markdown: 'primary',
  text: 'neutral',
  json: 'info',
  csv: 'success'
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return 'Not yet'
  }

  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))
}

export function formatRelativeTime(value: string | null | undefined) {
  if (!value) {
    return 'Not yet'
  }

  const date = new Date(value)
  const diffMs = date.getTime() - Date.now()
  const absMs = Math.abs(diffMs)
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 1000 * 60 * 60 * 24 * 365],
    ['month', 1000 * 60 * 60 * 24 * 30],
    ['day', 1000 * 60 * 60 * 24],
    ['hour', 1000 * 60 * 60],
    ['minute', 1000 * 60],
    ['second', 1000]
  ]

  for (const [unit, unitMs] of units) {
    if (absMs >= unitMs || unit === 'second') {
      return rtf.format(Math.round(diffMs / unitMs), unit)
    }
  }

  return formatDateTime(value)
}

export function formatDuration(start: string | null | undefined, end: string | null | undefined) {
  if (!start) {
    return 'Not started'
  }

  const startMs = new Date(start).getTime()
  const endMs = end ? new Date(end).getTime() : Date.now()
  const diffMs = Math.max(0, endMs - startMs)
  const totalSeconds = Math.round(diffMs / 1000)

  if (totalSeconds < 60) {
    return `${totalSeconds}s`
  }

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  if (minutes < 60) {
    return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60

  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`
}

export function formatRelativeCount(value: number, singular: string, plural = `${singular}s`) {
  if (value === 1) {
    return `1 ${singular}`
  }

  return `${value} ${plural}`
}

export function truncateText(value: unknown, maxLength = 120) {
  if (typeof value !== 'string') {
    return ''
  }

  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength - 1)}...`
}

export function formatJson(value: string | Record<string, unknown> | unknown[] | null | undefined) {
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2)
    } catch {
      return value
    }
  }

  if (value === null || value === undefined) {
    return ''
  }

  return JSON.stringify(value, null, 2)
}

export function parseCsvRows(content: string | null | undefined) {
  if (!content?.trim()) {
    return []
  }

  const lines = content
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)

  if (!lines.length) {
    return []
  }

  const rows = lines.map(line => line.split(',').map(cell => cell.trim()))
  const headers = rows[0]

  if (!headers) {
    return []
  }

  return rows.slice(1).map((cells, index) => {
    const record: Record<string, string> = {
      _row: String(index + 1)
    }

    headers.forEach((header, cellIndex) => {
      record[header || `column_${cellIndex + 1}`] = cells[cellIndex] || ''
    })

    return record
  })
}

export function topologicallySortNodes(nodes: PlanNode[]) {
  const nodeMap = new Map(nodes.map(node => [node.id, node]))
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const sorted: PlanNode[] = []

  function visit(nodeId: string) {
    if (visited.has(nodeId)) {
      return
    }

    if (visiting.has(nodeId)) {
      return
    }

    const node = nodeMap.get(nodeId)

    if (!node) {
      return
    }

    visiting.add(nodeId)

    for (const dependency of node.depends_on) {
      visit(dependency)
    }

    visiting.delete(nodeId)
    visited.add(nodeId)
    sorted.push(node)
  }

  for (const node of nodes) {
    visit(node.id)
  }

  return sorted
}

export function nodeTypeIcon(type: PlanNodeType) {
  const icons: Record<PlanNodeType, string> = {
    agent_transform: 'i-lucide-sparkles',
    agent_code: 'i-lucide-code',
    llm_classify: 'i-lucide-tags',
    llm_extract: 'i-lucide-scan-text',
    llm_summarize: 'i-lucide-scroll-text',
    llm_transform: 'i-lucide-wand-sparkles',
    retrieve: 'i-lucide-database-zap',
    http_fetch: 'i-lucide-globe',
    branch: 'i-lucide-git-branch',
    wait: 'i-lucide-timer',
    review: 'i-lucide-message-circle-warning',
    emit: 'i-lucide-file-output',
    notify: 'i-lucide-bell'
  }

  return icons[type]
}

export function nodeTypeBadgeColor(type: PlanNodeType): 'primary' | 'success' | 'neutral' | 'info' {
  if (type.startsWith('agent_')) {
    return 'primary'
  }

  if (type.startsWith('llm_')) {
    return 'success'
  }

  if (type === 'http_fetch') {
    return 'info'
  }

  return 'neutral'
}

export function summarizeNode(node: PlanNode) {
  if (node.prompt) return truncateText(node.prompt, 120)
  if (node.message) return truncateText(node.message, 120)
  if (node.retrieve_config) {
    const parts = [
      node.retrieve_config.match ? `title: ${node.retrieve_config.match}` : '',
      node.retrieve_config.task_id ? 'task-scoped' : '',
      node.retrieve_config.time_window ? `window: ${node.retrieve_config.time_window}` : '',
      node.retrieve_config.types?.length ? `types: ${node.retrieve_config.types.join(', ')}` : ''
    ].filter(Boolean)
    return parts.length ? `Retrieve ${parts.join(' · ')}` : 'Retrieve dynamic artifacts'
  }
  if (node.url) return `Fetch: ${truncateText(node.url, 90)}`
  if (node.source) return `Source: ${node.source}`
  if (node.condition) return `Condition: ${node.condition}`
  if (node.duration) return `Duration: ${node.duration}`
  if (node.artifact_title) return `Fetched artifact: ${node.artifact_title}`
  if (node.title) return `Output: ${node.title}`
  return node.description
}

export function getArtifactMap(artifacts: ArtifactRecord[]) {
  return new Map(artifacts.map(artifact => [artifact.id, artifact]))
}

export function resolveNodeArtifacts(nodeRun: NodeRunRecord, artifactMap: Map<string, ArtifactRecord>) {
  const inputIds = Array.isArray(nodeRun.input_refs) ? nodeRun.input_refs : []
  const outputIds = Array.isArray(nodeRun.output_refs) ? nodeRun.output_refs : []

  return {
    inputArtifacts: inputIds
      .map(id => typeof id === 'string' ? artifactMap.get(id) : null)
      .filter((artifact): artifact is ArtifactRecord => Boolean(artifact)),
    outputArtifacts: outputIds
      .map(id => typeof id === 'string' ? artifactMap.get(id) : null)
      .filter((artifact): artifact is ArtifactRecord => Boolean(artifact))
  }
}
