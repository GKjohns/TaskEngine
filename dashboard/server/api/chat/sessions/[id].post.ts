import { z } from 'zod'
import type { Database } from '../../../../shared/types/database'
import { compactChatSession, CHAT_COMPACTION_THRESHOLD } from '../../../utils/chatCompaction'
import { assembleChatContext } from '../../../utils/chatContext'
import { runChatLoop } from '../../../utils/chatLoop'
import { allChatTools } from '../../../utils/chatTools'
import { readValidatedBody } from '../../../utils/http'
import { useOpenAI } from '../../../utils/openai'
import { getRequestUserId } from '../../../utils/requestUser'
import { createServiceClient } from '../../../utils/supabase'

const sendMessageSchema = z.object({
  message: z.string().trim().min(1)
})

async function getScopedSession(
  client: ReturnType<typeof createServiceClient>,
  sessionId: string,
  userId: string | null
) {
  let query = client
    .from('chat_sessions')
    .select('*')
    .eq('id', sessionId)

  query = userId
    ? query.eq('created_by', userId)
    : query.is('created_by', null)

  const { data, error } = await query.maybeSingle()

  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message
    })
  }

  if (!data) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Chat session not found'
    })
  }

  return data as Database['public']['Tables']['chat_sessions']['Row']
}

async function touchSession(
  client: ReturnType<typeof createServiceClient>,
  sessionId: string,
  patch: Database['public']['Tables']['chat_sessions']['Update'] = {}
) {
  const { error } = await client
    .from('chat_sessions')
    .update({
      ...patch,
      updated_at: new Date().toISOString()
    })
    .eq('id', sessionId)

  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message
    })
  }
}

async function maybeGenerateTitle(params: {
  client: ReturnType<typeof createServiceClient>
  openai: ReturnType<typeof useOpenAI>
  sessionId: string
  userMessage: string
  assistantMessage: string
}) {
  const { client, openai, sessionId, userMessage, assistantMessage } = params

  if (!assistantMessage.trim()) {
    return null
  }

  const response = await openai.responses.create({
    model: 'gpt-5-nano',
    input: `Generate a concise 3-6 word title for this conversation.\n\nUser: ${userMessage}\nAssistant: ${assistantMessage}`,
    text: {
      verbosity: 'low'
    }
  })

  const title = response.output_text
    ?.trim()
    .replace(/^["']+|["']+$/g, '')
    .slice(0, 80)

  if (!title) {
    return null
  }

  await touchSession(client, sessionId, { title })
  return title
}

export default defineEventHandler(async (event) => {
  const sessionId = getRouterParam(event, 'id')

  if (!sessionId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Session id is required'
    })
  }

  const body = await readValidatedBody(event, sendMessageSchema)
  const client = createServiceClient()
  const openai = useOpenAI()
  const userId = await getRequestUserId(event)
  const session = await getScopedSession(client, sessionId, userId)

  const { error: userInsertError } = await client
    .from('chat_messages')
    .insert({
      session_id: sessionId,
      role: 'user',
      content: body.message
    })

  if (userInsertError) {
    throw createError({
      statusCode: 500,
      statusMessage: userInsertError.message
    })
  }

  await touchSession(client, sessionId)

  let context = await assembleChatContext(client, sessionId, userId)

  if (context.tokenEstimate > CHAT_COMPACTION_THRESHOLD) {
    await compactChatSession({
      openai,
      supabase: client,
      sessionId
    })

    context = await assembleChatContext(client, sessionId, userId)
  }

  const stream = createEventStream(event)
  const toolCalls: Array<Record<string, unknown>> = []
  const toolResults: Array<Record<string, unknown>> = []
  let finalText = ''
  let sawError = false
  let finalDonePayload: { type: 'done', fullText: string } | null = null

  void (async () => {
    try {
      for await (const chatEvent of runChatLoop({
        openai,
        model: 'gpt-5-mini',
        systemPrompt: context.systemPrompt,
        messages: context.messages,
        tools: allChatTools,
        toolContext: {
          supabase: client,
          userId,
          sessionId
        },
        maxToolRounds: 3
      })) {
        if (chatEvent.type === 'tool-call') {
          toolCalls.push({
            name: chatEvent.name,
            arguments: chatEvent.arguments
          })
        }

        if (chatEvent.type === 'tool-result') {
          toolResults.push({
            name: chatEvent.name,
            output: chatEvent.output
          })
        }

        if (chatEvent.type === 'error') {
          sawError = true
        }

        if (chatEvent.type === 'done') {
          finalText = chatEvent.fullText
          finalDonePayload = chatEvent
          continue
        }

        await stream.push(JSON.stringify(chatEvent))
      }

      if (finalText.trim()) {
        const { error: assistantInsertError } = await client
          .from('chat_messages')
          .insert({
            session_id: sessionId,
            role: 'assistant',
            content: finalText,
            tool_calls: toolCalls,
            tool_results: toolResults
          })

        if (assistantInsertError) {
          throw createError({
            statusCode: 500,
            statusMessage: assistantInsertError.message
          })
        }

        await touchSession(client, sessionId)
      }

      if (!session.title && finalText.trim()) {
        const title = await maybeGenerateTitle({
          client,
          openai,
          sessionId,
          userMessage: body.message,
          assistantMessage: finalText
        })

        if (title) {
          await stream.push(JSON.stringify({
            type: 'title',
            title
          }))
        }
      }

      await stream.push(JSON.stringify(finalDonePayload || {
        type: 'done',
        fullText: finalText
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to stream chat response'

      if (!sawError) {
        await stream.push(JSON.stringify({
          type: 'error',
          message
        }))
      }

      await stream.push(JSON.stringify({
        type: 'done',
        fullText: finalText
      }))
    } finally {
      await stream.close()
    }
  })()

  return stream.send()
})
