export interface ToolEntity {
  type: 'task' | 'artifact' | 'run' | 'review'
  id: string
  title: string
  status?: string
  link: string
}

export interface ToolEntityDetail extends ToolEntity {
  meta: Array<{ label: string; value: string }>
}

export interface ToolListResult {
  count: number
  entities: ToolEntity[]
}

export interface ToolRunAction {
  taskTitle: string
  runId: string
  status: string
}

type BadgeColor = 'primary' | 'secondary' | 'neutral' | 'error' | 'warning' | 'info' | 'success'

const statusColorMap: Record<string, BadgeColor> = {
  active: 'success', paused: 'warning', archived: 'neutral',
  pending: 'neutral', running: 'primary', waiting_review: 'warning',
  completed: 'success', failed: 'error', cancelled: 'neutral',
  approved: 'success', rejected: 'error', edited: 'info',
  markdown: 'primary', text: 'neutral', json: 'info', csv: 'success'
}

export function statusColor(status?: string): BadgeColor {
  return statusColorMap[status || ''] || 'neutral'
}

function kvLines(output: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const line of output.split('\n')) {
    const match = line.match(/^([A-Za-z ]+?):\s+(.+)$/)
    if (match) {
      map.set(match[1].trim().toLowerCase(), match[2].trim())
    }
  }
  return map
}

function titleAndId(value: string): { title: string; id: string } | null {
  const match = value.match(/^(.+?)\s+\(([a-f0-9-]{36})\)/i)
  return match ? { title: match[1], id: match[2] } : null
}

function splitItems(output: string): string[] {
  const lines = output.split('\n')
  const firstItemIndex = lines.findIndex(l => l.startsWith('- '))
  if (firstItemIndex < 0) return []

  const items: string[] = []
  let current = ''

  for (let i = firstItemIndex; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('- ')) {
      if (current) items.push(current)
      current = line.slice(2)
    } else if (line.startsWith('  ')) {
      current += '\n' + line.trim()
    }
  }
  if (current) items.push(current)
  return items
}

export function parseGetTask(output: string): ToolEntityDetail | null {
  const kv = kvLines(output)
  const parsed = titleAndId(kv.get('task') || '')
  if (!parsed) return null

  const meta: ToolEntityDetail['meta'] = []
  const status = kv.get('status')
  if (status) meta.push({ label: 'Status', value: status })
  const trigger = kv.get('trigger')
  if (trigger) meta.push({ label: 'Trigger', value: trigger })

  const plan = kv.get('current plan')
  if (plan && plan !== 'none') {
    const parts: string[] = []
    const vMatch = plan.match(/v(\d+)/)
    if (vMatch) parts.push(`v${vMatch[1]}`)
    const nMatch = plan.match(/(\d+) nodes/)
    if (nMatch) parts.push(`${nMatch[1]} nodes`)
    meta.push({ label: 'Plan', value: parts.length ? parts.join(' · ') : plan })
  }

  return { type: 'task', id: parsed.id, title: parsed.title, status, link: `/tasks/${parsed.id}`, meta }
}

export function parseGetArtifact(output: string): ToolEntityDetail | null {
  const kv = kvLines(output)
  const parsed = titleAndId(kv.get('artifact') || '')
  if (!parsed) return null

  const meta: ToolEntityDetail['meta'] = []
  const type = kv.get('type')
  if (type) meta.push({ label: 'Type', value: type })
  const created = kv.get('created')
  if (created) meta.push({ label: 'Created', value: created })
  const desc = kv.get('description')
  if (desc && desc !== 'n/a') meta.push({ label: '', value: desc })

  return {
    type: 'artifact', id: parsed.id, title: parsed.title,
    status: type || undefined, link: `/artifacts/${parsed.id}`, meta
  }
}

export function parseGetRun(output: string): ToolEntityDetail | null {
  const kv = kvLines(output)
  const runId = kv.get('run')
  if (!runId || !/^[a-f0-9-]{36}$/.test(runId)) return null

  const status = kv.get('status')
  const meta: ToolEntityDetail['meta'] = []
  if (status) meta.push({ label: 'Status', value: status })

  const planVersion = kv.get('plan version')
  const nodeRuns = kv.get('node runs')
  const details: string[] = []
  if (planVersion && planVersion !== 'unknown') details.push(`Plan v${planVersion}`)
  if (nodeRuns && nodeRuns !== '0') details.push(`${nodeRuns} steps`)
  if (details.length) meta.push({ label: 'Details', value: details.join(' · ') })

  const started = kv.get('started')
  if (started && started !== 'n/a') meta.push({ label: 'Started', value: started })

  return {
    type: 'run', id: runId, title: kv.get('task') || 'Run',
    status, link: `/runs/${runId}`, meta
  }
}

export function parseRunTask(output: string): ToolRunAction | null {
  const match = output.match(/^Started run ([a-f0-9-]+) for task "(.+?)"\.$/m)
  if (!match) return null
  const statusMatch = output.match(/^Status: (\w+)$/m)
  return { runId: match[1], taskTitle: match[2], status: statusMatch?.[1] || 'pending' }
}

export function parseCreateTask(output: string): ToolEntityDetail | null {
  const match = output.match(/^Created task "(.+?)" \(([a-f0-9-]+)\)\.$/m)
  if (!match) return null

  const kv = kvLines(output)
  const meta: ToolEntityDetail['meta'] = []
  const trigger = kv.get('trigger')
  if (trigger) meta.push({ label: 'Trigger', value: trigger })
  const plan = kv.get('plan')
  if (plan) {
    const nodeCount = plan.match(/(\d+) nodes/)
    if (nodeCount) meta.push({ label: 'Plan', value: `${nodeCount[1]} nodes` })
  }
  const validation = kv.get('plan validation')
  if (validation && validation !== 'no issues') {
    meta.push({ label: 'Warning', value: validation })
  }

  return { type: 'task', id: match[2], title: match[1], link: `/tasks/${match[2]}`, meta }
}

export function parseResolveReview(output: string): ToolEntityDetail | null {
  const match = output.match(/^Resolved review ([a-f0-9-]+)\.$/m)
  if (!match) return null

  const kv = kvLines(output)
  const status = kv.get('status')
  const meta: ToolEntityDetail['meta'] = []
  if (status) meta.push({ label: 'Status', value: status })
  const comments = kv.get('comments')
  if (comments && comments !== 'none') meta.push({ label: '', value: comments })

  return { type: 'review', id: match[1], title: 'Review resolved', status, link: '/reviews', meta }
}

export function parseListTasks(output: string): ToolListResult | null {
  const countMatch = output.match(/^Found (\d+) tasks?:/m)
  if (!countMatch) {
    if (output.includes('No tasks matched')) return { count: 0, entities: [] }
    return null
  }

  const entities: ToolEntity[] = []
  for (const item of splitItems(output)) {
    const parsed = titleAndId(item)
    if (!parsed) continue
    const statusMatch = item.match(/status: (\w+)/)
    entities.push({
      type: 'task', id: parsed.id, title: parsed.title,
      status: statusMatch?.[1], link: `/tasks/${parsed.id}`
    })
  }

  return { count: parseInt(countMatch[1]), entities }
}

export function parseListArtifacts(output: string): ToolListResult | null {
  const countMatch = output.match(/^Found (\d+) artifacts?:/m)
  if (!countMatch) {
    if (output.includes('No artifacts matched')) return { count: 0, entities: [] }
    return null
  }

  const entities: ToolEntity[] = []
  for (const item of splitItems(output)) {
    const parsed = titleAndId(item)
    if (!parsed) continue
    const typeMatch = item.match(/type: (\w+)/)
    entities.push({
      type: 'artifact', id: parsed.id, title: parsed.title,
      status: typeMatch?.[1], link: `/artifacts/${parsed.id}`
    })
  }

  return { count: parseInt(countMatch[1]), entities }
}

export function parseListRuns(output: string): ToolListResult | null {
  const countMatch = output.match(/^Found (\d+) runs?:/m)
  if (!countMatch) {
    if (output.includes('No runs matched')) return { count: 0, entities: [] }
    return null
  }

  const entities: ToolEntity[] = []
  for (const item of splitItems(output)) {
    const idMatch = item.match(/^([a-f0-9-]{36}): (.+?) \| (\w+)/)
    if (!idMatch) continue
    entities.push({
      type: 'run', id: idMatch[1], title: idMatch[2],
      status: idMatch[3], link: `/runs/${idMatch[1]}`
    })
  }

  return { count: parseInt(countMatch[1]), entities }
}

export function parseListReviews(output: string): ToolListResult | null {
  const countMatch = output.match(/^Found (\d+) \w+ reviews?:/m)
  if (!countMatch) {
    if (output.includes('No') && output.includes('reviews')) return { count: 0, entities: [] }
    return null
  }

  const entities: ToolEntity[] = []
  for (const item of splitItems(output)) {
    const idMatch = item.match(/^([a-f0-9-]{36})/)
    if (!idMatch) continue
    const taskMatch = item.match(/task: (.+?)(?:\n|$)/)
    const statusMatch = item.match(/status: (\w+)/)
    entities.push({
      type: 'review', id: idMatch[1], title: taskMatch?.[1] || 'Review',
      status: statusMatch?.[1], link: '/reviews'
    })
  }

  return { count: parseInt(countMatch[1]), entities }
}
