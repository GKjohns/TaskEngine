import { PLAN_NODE_TYPES } from '../../../shared/types/task-engine'
import { branch, emit, notify, retrieve, review, unsupportedAgentNode, wait } from './infrastructure'
import { llmClassify, llmExtract, llmSummarize, llmTransform } from './llm'
import { registerNodeExecutor } from './registry'

let registered = false

export function ensureNodeExecutorsRegistered() {
  if (registered) {
    return
  }

  registerNodeExecutor('llm_summarize', llmSummarize)
  registerNodeExecutor('llm_classify', llmClassify)
  registerNodeExecutor('llm_extract', llmExtract)
  registerNodeExecutor('llm_transform', llmTransform)
  registerNodeExecutor('retrieve', retrieve)
  registerNodeExecutor('emit', emit)
  registerNodeExecutor('review', review)
  registerNodeExecutor('branch', branch)
  registerNodeExecutor('notify', notify)
  registerNodeExecutor('wait', wait)

  for (const nodeType of PLAN_NODE_TYPES) {
    if (nodeType === 'agent_transform' || nodeType === 'agent_code') {
      registerNodeExecutor(nodeType, unsupportedAgentNode)
    }
  }

  registered = true
}
