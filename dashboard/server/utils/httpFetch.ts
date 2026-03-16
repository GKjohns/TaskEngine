import type { ArtifactType, HttpFetchMethod, HttpFetchResponseType } from '../../shared/types/task-engine'
import type { RuntimeArtifact } from '../inngest/nodes/types'

const REQUEST_TIMEOUT_MS = 15_000
const MAX_RESPONSE_CHARS = 100_000
const MAX_HTML_TEXT_CHARS = 50_000

function normalizeWhitespace(value: string) {
  return value
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

function htmlToReadableText(html: string) {
  return normalizeWhitespace(
    decodeHtmlEntities(
      html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<\/(p|div|section|article|main|header|footer|li|tr|h[1-6])>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
    )
  )
}

function truncateContent(value: string, limit: number) {
  if (value.length <= limit) {
    return {
      value,
      truncated: false
    }
  }

  return {
    value: `${value.slice(0, limit).trimEnd()}\n\n[truncated]`,
    truncated: true
  }
}

function deriveArtifactTitle(rawUrl: string) {
  try {
    const url = new URL(rawUrl)
    const path = url.pathname.replace(/\/+$/, '') || '/'
    return `${url.hostname}${path}`
  } catch {
    return rawUrl
  }
}

function mapResponseTypeToArtifactType(responseType: HttpFetchResponseType): ArtifactType {
  switch (responseType) {
    case 'json':
      return 'json'
    case 'csv':
      return 'csv'
    default:
      return 'text'
  }
}

export interface FetchHttpArtifactInput {
  url: string
  method: HttpFetchMethod
  headers?: Record<string, string> | null
  body?: string | null
  responseType: HttpFetchResponseType
  artifactTitle?: string | null
}

export interface FetchHttpArtifactResult {
  artifact: RuntimeArtifact
  logs: Record<string, unknown>
}

export async function fetchHttpArtifact(input: FetchHttpArtifactInput): Promise<FetchHttpArtifactResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(input.url, {
      method: input.method,
      headers: input.headers || undefined,
      body: input.method === 'POST' ? (input.body || '') : undefined,
      signal: controller.signal
    })

    const rawText = await response.text()

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`.trim())
    }

    let content = rawText
    let truncated = false

    if (input.responseType === 'json') {
      try {
        content = JSON.stringify(JSON.parse(rawText), null, 2)
      } catch {
        content = rawText
      }
      const truncatedResult = truncateContent(content, MAX_RESPONSE_CHARS)
      content = truncatedResult.value
      truncated = truncatedResult.truncated
    } else if (input.responseType === 'html_to_text') {
      const extracted = htmlToReadableText(rawText)
      const truncatedResult = truncateContent(extracted, MAX_HTML_TEXT_CHARS)
      content = truncatedResult.value
      truncated = truncatedResult.truncated
    } else {
      const truncatedResult = truncateContent(rawText, MAX_RESPONSE_CHARS)
      content = truncatedResult.value
      truncated = truncatedResult.truncated
    }

    const artifactType = mapResponseTypeToArtifactType(input.responseType)
    const title = input.artifactTitle?.trim() || deriveArtifactTitle(input.url)

    return {
      artifact: {
        title,
        content,
        type: artifactType,
        metadata: {
          source_url: input.url,
          method: input.method,
          response_type: input.responseType,
          response_status: response.status,
          content_type: response.headers.get('content-type'),
          truncated
        }
      },
      logs: {
        url: input.url,
        method: input.method,
        response_type: input.responseType,
        artifact_title: title,
        response_status: response.status,
        content_type: response.headers.get('content-type'),
        response_chars: rawText.length,
        output_chars: content.length,
        truncated
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`HTTP fetch timed out after ${REQUEST_TIMEOUT_MS / 1000}s`)
    }

    throw error
  } finally {
    clearTimeout(timeout)
  }
}
