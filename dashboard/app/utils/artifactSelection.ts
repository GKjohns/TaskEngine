import type { ArtifactRecord } from '../../shared/types/task-engine'

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'how',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'of',
  'on',
  'or',
  'our',
  'that',
  'the',
  'their',
  'them',
  'these',
  'this',
  'to',
  'use',
  'using',
  'we',
  'with',
  'you',
  'your'
])

const DOCUMENT_HINT_PATTERNS = [
  /\battached\b/i,
  /\bupload(?:ed)?\b/i,
  /\binput\b/i,
  /\bdocument(?:s)?\b/i,
  /\breport(?:s)?\b/i,
  /\bnotes\b/i,
  /\bcsv\b/i,
  /\bjson\b/i,
  /\bdataset\b/i,
  /\bfeedback\b/i,
  /\binventory\b/i,
  /\border(?:s)?\b/i,
  /\blog(?:s)?\b/i,
  /\bstatement\b/i,
  /\bsurvey\b/i
]

function normalizeText(value: string | null | undefined) {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function toTokens(value: string | null | undefined) {
  return normalizeText(value)
    .split(' ')
    .filter(token => token.length >= 3 && !STOP_WORDS.has(token))
}

function uniqueTokens(value: string | null | undefined) {
  return [...new Set(toTokens(value))]
}

function countTokenHits(haystack: string, tokens: string[]) {
  return tokens.reduce((count, token) => (
    haystack.includes(token) ? count + 1 : count
  ), 0)
}

function buildSearchContext(input: {
  title?: string | null
  prompt?: string | null
  planTitle?: string | null
  planPrompt?: string | null
}) {
  return [input.title, input.prompt, input.planTitle, input.planPrompt]
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .join(' ')
}

function getArtifactScore(artifact: ArtifactRecord, query: string, queryTokens: string[]) {
  if (!queryTokens.length) {
    return 0
  }

  const titleText = normalizeText(artifact.title)
  const descriptionText = normalizeText(artifact.description)
  const contentText = normalizeText((artifact.content || '').slice(0, 2000))
  const fullText = `${titleText} ${descriptionText} ${contentText}`.trim()

  let score = 0

  score += countTokenHits(titleText, queryTokens) * 5
  score += countTokenHits(descriptionText, queryTokens) * 3
  score += countTokenHits(contentText, queryTokens) * 1

  if (query.includes(artifact.type)) {
    score += 4
  }

  const exactTitleTokens = uniqueTokens(artifact.title)
  const overlap = exactTitleTokens.filter(token => queryTokens.includes(token)).length
  if (overlap >= 2) {
    score += 6
  }

  if (fullText.includes(query) && query.length >= 12) {
    score += 8
  }

  return score
}

export function suggestArtifactIds(input: {
  artifacts: ArtifactRecord[]
  title?: string | null
  prompt?: string | null
  planTitle?: string | null
  planPrompt?: string | null
  limit?: number
}) {
  const query = buildSearchContext(input)
  const queryTokens = uniqueTokens(query)

  if (!queryTokens.length) {
    return []
  }

  return [...input.artifacts]
    .map(artifact => ({
      id: artifact.id,
      score: getArtifactScore(artifact, normalizeText(query), queryTokens)
    }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit ?? 4)
    .map(entry => entry.id)
}

export function taskLikelyNeedsDocuments(input: {
  title?: string | null
  prompt?: string | null
  planTitle?: string | null
  planPrompt?: string | null
}) {
  const text = buildSearchContext(input)

  return DOCUMENT_HINT_PATTERNS.some(pattern => pattern.test(text))
}
