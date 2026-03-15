import OpenAI from 'openai'

let client: OpenAI | null = null

export function useOpenAI(): OpenAI {
  if (client) {
    return client
  }

  const { openaiApiKey } = useRuntimeConfig()
  if (!openaiApiKey) {
    throw createError({
      statusCode: 500,
      statusMessage: 'OPENAI_API_KEY is not configured'
    })
  }

  client = new OpenAI({ apiKey: openaiApiKey })
  return client
}
