import type { NodeExecutor } from './types'
import { describeHttpFetch } from './describe'
import { fetchHttpArtifact } from '../../utils/httpFetch'

export const httpFetch: NodeExecutor = async (node) => {
  if (!node.url) {
    throw new Error('http_fetch node is missing a url')
  }

  if (!node.response_type) {
    throw new Error('http_fetch node is missing a response_type')
  }

  const method = node.method || 'GET'
  const result = await fetchHttpArtifact({
    url: node.url,
    method,
    headers: node.headers,
    body: node.body,
    responseType: node.response_type,
    artifactTitle: node.artifact_title
  })

  return {
    artifacts: [result.artifact],
    description: describeHttpFetch(result.artifact.title, node.url, node.response_type),
    logs: result.logs
  }
}
