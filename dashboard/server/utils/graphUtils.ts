import type { Plan, PlanNode } from '../../shared/types/task-engine'

export function topoSort(nodes: PlanNode[]): PlanNode[] {
  const nodeMap = new Map(nodes.map(node => [node.id, node]))
  const done = new Set<string>()
  const inProgress = new Set<string>()
  const sorted: PlanNode[] = []

  function visit(id: string) {
    if (done.has(id)) {
      return
    }

    if (inProgress.has(id)) {
      throw new Error(`Cycle detected at node: ${id}`)
    }

    const node = nodeMap.get(id)
    if (!node) {
      throw new Error(`Unknown node: ${id}`)
    }

    inProgress.add(id)

    for (const dep of node.depends_on) {
      visit(dep)
    }

    inProgress.delete(id)
    done.add(id)
    sorted.push(node)
  }

  for (const node of nodes) {
    visit(node.id)
  }

  return sorted
}

export function validatePlan(plan: Plan): string[] {
  const errors: string[] = []
  const ids = new Set(plan.nodes.map(node => node.id))

  for (const node of plan.nodes) {
    for (const dep of node.depends_on) {
      if (!ids.has(dep)) {
        errors.push(`Node "${node.id}" depends on unknown node "${dep}"`)
      }
    }
  }

  try {
    topoSort(plan.nodes)
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Unknown plan validation error')
  }

  return errors
}
