import type { PlanNodeType } from '../../../shared/types/task-engine'
import type { NodeExecutor } from './types'

const executors = new Map<PlanNodeType, NodeExecutor>()

export function registerNodeExecutor(type: PlanNodeType, executor: NodeExecutor) {
  executors.set(type, executor)
}

export function getNodeExecutor(type: PlanNodeType): NodeExecutor {
  const executor = executors.get(type)

  if (!executor) {
    throw new Error(`No executor registered for node type: ${type}`)
  }

  return executor
}
