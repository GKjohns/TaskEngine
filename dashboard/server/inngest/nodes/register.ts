import { agentCode } from './agentCode'
import { agentTransform } from './agentTransform'
import { httpFetch } from './httpFetch'
import { branch, emit, notify, retrieve, review, wait } from './infrastructure'
import { llmClassify, llmExtract, llmSummarize, llmTransform } from './llm'
import { registerNodeExecutor } from './registry'

let registered = false

export function ensureNodeExecutorsRegistered() {
  if (registered) {
    return
  }

  registerNodeExecutor('agent_transform', agentTransform)
  registerNodeExecutor('agent_code', agentCode)
  registerNodeExecutor('llm_summarize', llmSummarize)
  registerNodeExecutor('llm_classify', llmClassify)
  registerNodeExecutor('llm_extract', llmExtract)
  registerNodeExecutor('llm_transform', llmTransform)
  registerNodeExecutor('retrieve', retrieve)
  registerNodeExecutor('http_fetch', httpFetch)
  registerNodeExecutor('emit', emit)
  registerNodeExecutor('review', review)
  registerNodeExecutor('branch', branch)
  registerNodeExecutor('notify', notify)
  registerNodeExecutor('wait', wait)

  registered = true
}
