import { createSharedComposable } from '@vueuse/core'
import type { Database } from '../../shared/types/database'

export interface ChatSessionSummary extends Pick<
  Database['public']['Tables']['chat_sessions']['Row'],
  'id' | 'title' | 'created_at' | 'updated_at'
> {
  summary?: string | null
}

type ChatMessageRow = Database['public']['Tables']['chat_messages']['Row']

export interface ChatViewContext {
  kind: 'task' | 'artifact' | 'run' | 'page'
  label: string
  id?: string
}

export interface ChatToolCallEvent {
  type: 'tool-call'
  name: string
  arguments: string
}

export interface ChatToolResultEvent {
  type: 'tool-result'
  name: string
  output: string
}

export interface ChatTextDeltaEvent {
  type: 'text-delta'
  delta: string
}

export interface ChatTitleEvent {
  type: 'title'
  title: string
}

export interface ChatErrorEvent {
  type: 'error'
  message: string
}

export interface ChatDoneEvent {
  type: 'done'
  fullText: string
}

export type ChatStreamEvent = ChatToolCallEvent | ChatToolResultEvent | ChatTextDeltaEvent | ChatTitleEvent | ChatErrorEvent | ChatDoneEvent

export interface ChatToolStep {
  id: string
  name: string
  arguments: string
  output: string | null
  status: 'pending' | 'done'
}

export interface ChatUiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  toolSteps: ChatToolStep[]
  isStreaming: boolean
  error: string | null
}

export interface ChatSessionGroup {
  key: string
  label: string
  sessions: ChatSessionSummary[]
}

interface ChatSessionDetail extends ChatSessionSummary {
  messages: ChatMessageRow[]
}

function makeLocalId(prefix: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function sortSessions(sessions: ChatSessionSummary[]) {
  return [...sessions].sort((a, b) => {
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  })
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function getSessionGroupMeta(value: string) {
  const sessionDate = new Date(value)
  const today = startOfDay(new Date())
  const targetDay = startOfDay(sessionDate)
  const dayDiff = Math.round((today.getTime() - targetDay.getTime()) / (1000 * 60 * 60 * 24))

  if (dayDiff <= 0) {
    return { key: 'today', label: 'Today' }
  }

  if (dayDiff === 1) {
    return { key: 'yesterday', label: 'Yesterday' }
  }

  if (dayDiff < 7) {
    return { key: 'last-7-days', label: 'Last 7 Days' }
  }

  const monthKey = `${sessionDate.getFullYear()}-${sessionDate.getMonth()}`
  const sameYear = sessionDate.getFullYear() === today.getFullYear()

  return {
    key: monthKey,
    label: new Intl.DateTimeFormat('en', {
      month: 'long',
      year: sameYear ? undefined : 'numeric'
    }).format(sessionDate)
  }
}

function groupSessions(sessions: ChatSessionSummary[]) {
  const groups: ChatSessionGroup[] = []
  const groupIndex = new Map<string, ChatSessionGroup>()

  for (const session of sortSessions(sessions)) {
    const { key, label } = getSessionGroupMeta(session.updated_at)
    const existingGroup = groupIndex.get(key)

    if (existingGroup) {
      existingGroup.sessions.push(session)
      continue
    }

    const nextGroup: ChatSessionGroup = {
      key,
      label,
      sessions: [session]
    }

    groupIndex.set(key, nextGroup)
    groups.push(nextGroup)
  }

  return groups
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function normalizeToolSteps(toolCalls: unknown[], toolResults: unknown[]) {
  const parsedResults = Array.isArray(toolResults)
    ? toolResults.map(item => asRecord(item)).filter((item): item is Record<string, unknown> => Boolean(item))
    : []
  const usedResultIndexes = new Set<number>()

  const steps = Array.isArray(toolCalls)
    ? toolCalls
        .map(item => asRecord(item))
        .filter((item): item is Record<string, unknown> => Boolean(item))
        .map((call) => {
          const name = asString(call.name)
          const matchingResultIndex = parsedResults.findIndex((result, index) => {
            return !usedResultIndexes.has(index) && asString(result.name) === name
          })
          const matchingResult = matchingResultIndex >= 0 ? parsedResults[matchingResultIndex] : null

          if (matchingResultIndex >= 0) {
            usedResultIndexes.add(matchingResultIndex)
          }

          return {
            id: makeLocalId('tool'),
            name,
            arguments: asString(call.arguments),
            output: matchingResult ? asString(matchingResult.output) : null,
            status: matchingResult ? 'done' as const : 'pending' as const
          }
        })
    : []

  for (const [index, result] of parsedResults.entries()) {
    if (usedResultIndexes.has(index)) {
      continue
    }

    steps.push({
      id: makeLocalId('tool'),
      name: asString(result.name) || 'tool',
      arguments: '',
      output: asString(result.output),
      status: 'done'
    })
  }

  return steps
}

function toUiMessage(message: ChatMessageRow): ChatUiMessage | null {
  if (message.role !== 'user' && message.role !== 'assistant') {
    return null
  }

  return {
    id: message.id,
    role: message.role,
    content: message.content || '',
    createdAt: message.created_at,
    toolSteps: message.role === 'assistant'
      ? normalizeToolSteps(message.tool_calls, message.tool_results)
      : [],
    isStreaming: false,
    error: null
  }
}

function parseEventData(block: string): ChatStreamEvent | null {
  const data = block
    .split('\n')
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trimStart())
    .join('\n')

  if (!data.trim()) {
    return null
  }

  return JSON.parse(data) as ChatStreamEvent
}

const useSharedGlobalChat = createSharedComposable(() => {
  const sessions = useState<ChatSessionSummary[]>('chat:sessions', () => [])
  const currentSessionId = useState<string | null>('chat:current-session-id', () => null)
  const messages = useState<ChatUiMessage[]>('chat:messages', () => [])
  const isOpen = useState('chat:is-open', () => false)
  const initialized = useState('chat:initialized', () => false)
  const isLoadingSessions = useState('chat:is-loading-sessions', () => false)
  const isLoadingSession = useState('chat:is-loading-session', () => false)
  const isSending = useState('chat:is-sending', () => false)
  const error = useState<string | null>('chat:error', () => null)

  let activeRequestId = 0
  let abortController: AbortController | null = null

  const currentSession = computed(() => {
    return sessions.value.find(session => session.id === currentSessionId.value) || null
  })
  const groupedSessions = computed(() => groupSessions(sessions.value))

  function replaceSessions(nextSessions: ChatSessionSummary[]) {
    sessions.value = sortSessions(nextSessions)
  }

  function upsertSession(session: ChatSessionSummary) {
    const existing = sessions.value.find(candidate => candidate.id === session.id)

    if (existing) {
      Object.assign(existing, session)
      replaceSessions(sessions.value)
      return
    }

    replaceSessions([session, ...sessions.value])
  }

  function clearMessages() {
    messages.value = []
  }

  function clearCurrentSession() {
    currentSessionId.value = null
    clearMessages()
  }

  function abortActiveStream() {
    abortController?.abort()
    abortController = null
  }

  function updateMessage(messageId: string, updater: (message: ChatUiMessage) => void) {
    const target = messages.value.find(message => message.id === messageId)

    if (target) {
      updater(target)
    }
  }

  function setCurrentSession(session: ChatSessionSummary | null) {
    currentSessionId.value = session?.id || null
    if (session) {
      upsertSession(session)
    }
  }

  async function refreshSessions() {
    isLoadingSessions.value = true

    try {
      const nextSessions = await $fetch<ChatSessionSummary[]>('/api/chat/sessions')
      replaceSessions(nextSessions)
      error.value = null

      if (currentSessionId.value && !nextSessions.some(session => session.id === currentSessionId.value)) {
        clearCurrentSession()
      }

      return true
    } catch (fetchError) {
      error.value = fetchError instanceof Error ? fetchError.message : 'Failed to load chat sessions.'
      return false
    } finally {
      isLoadingSessions.value = false
    }
  }

  async function initialize() {
    if (initialized.value) {
      return
    }

    const didInitialize = await refreshSessions()

    if (didInitialize) {
      initialized.value = true
    }
  }

  async function loadSession(sessionId: string) {
    if (!sessionId) {
      return false
    }

    abortActiveStream()
    isSending.value = false
    isLoadingSession.value = true

    try {
      const session = await $fetch<ChatSessionDetail>(`/api/chat/sessions/${sessionId}`)
      setCurrentSession(session)
      messages.value = session.messages
        .map(message => toUiMessage(message))
        .filter((message): message is ChatUiMessage => Boolean(message))
      error.value = null
      return true
    } catch (fetchError) {
      error.value = fetchError instanceof Error ? fetchError.message : 'Failed to load this chat session.'
      return false
    } finally {
      isLoadingSession.value = false
    }
  }

  async function switchSession(sessionId: string) {
    if (!sessionId || sessionId === currentSessionId.value) {
      return false
    }

    return loadSession(sessionId)
  }

  async function newSession() {
    abortActiveStream()
    isSending.value = false
    isLoadingSession.value = true

    try {
      const session = await $fetch<ChatSessionSummary>('/api/chat/sessions', {
        method: 'POST'
      })

      setCurrentSession(session)
      clearMessages()
      error.value = null

      return session
    } catch (fetchError) {
      error.value = fetchError instanceof Error ? fetchError.message : 'Failed to create a new chat.'
      throw fetchError
    } finally {
      isLoadingSession.value = false
    }
  }

  function toggle(nextState?: boolean) {
    isOpen.value = typeof nextState === 'boolean' ? nextState : !isOpen.value

    if (isOpen.value) {
      void initialize()
    }
  }

  function openChat() {
    toggle(true)
  }

  function closeChat() {
    toggle(false)
  }

  async function deleteSession(sessionId: string) {
    if (!sessionId) {
      return false
    }

    try {
      await $fetch<ChatSessionSummary>(`/api/chat/sessions/${sessionId}`, {
        method: 'DELETE'
      })

      replaceSessions(sessions.value.filter(session => session.id !== sessionId))

      if (currentSessionId.value === sessionId) {
        abortActiveStream()
        isSending.value = false
        clearCurrentSession()
      }

      error.value = null
      return true
    } catch (deleteError) {
      error.value = deleteError instanceof Error ? deleteError.message : 'Failed to delete this chat session.'
      return false
    }
  }

  function handleToolCall(messageId: string, event: ChatToolCallEvent) {
    updateMessage(messageId, (message) => {
      message.toolSteps.push({
        id: makeLocalId('tool'),
        name: event.name,
        arguments: event.arguments,
        output: null,
        status: 'pending'
      })
    })
  }

  function handleToolResult(messageId: string, event: ChatToolResultEvent) {
    updateMessage(messageId, (message) => {
      const pendingStep = [...message.toolSteps]
        .reverse()
        .find(step => step.name === event.name && step.status === 'pending')

      if (pendingStep) {
        pendingStep.output = event.output
        pendingStep.status = 'done'
        return
      }

      message.toolSteps.push({
        id: makeLocalId('tool'),
        name: event.name,
        arguments: '',
        output: event.output,
        status: 'done'
      })
    })
  }

  function handleStreamEvent(messageId: string, event: ChatStreamEvent | null) {
    if (!event) {
      return
    }

    if (event.type === 'text-delta') {
      updateMessage(messageId, (message) => {
        message.content += event.delta
      })
      return
    }

    if (event.type === 'tool-call') {
      handleToolCall(messageId, event)
      return
    }

    if (event.type === 'tool-result') {
      handleToolResult(messageId, event)
      return
    }

    if (event.type === 'title') {
      if (currentSession.value) {
        upsertSession({
          ...currentSession.value,
          title: event.title,
          updated_at: new Date().toISOString()
        })
      }
      return
    }

    if (event.type === 'error') {
      updateMessage(messageId, (message) => {
        message.error = event.message
      })
      error.value = event.message
      return
    }

    if (event.type === 'done') {
      updateMessage(messageId, (message) => {
        message.isStreaming = false
        if (!message.content.trim() && event.fullText.trim()) {
          message.content = event.fullText
        }
      })
    }
  }

  async function sendMessage(content: string, options?: { context?: ChatViewContext | null }) {
    if (!import.meta.client) {
      return false
    }

    const message = content.trim()
    if (!message || isSending.value) {
      return false
    }

    error.value = null
    let session = currentSession.value

    let assistantMessageId = ''
    let didAppendMessages = false
    let requestId = 0

    try {
      if (!session) {
        session = await newSession()
      }

      const userMessage: ChatUiMessage = {
        id: makeLocalId('user'),
        role: 'user',
        content: message,
        createdAt: new Date().toISOString(),
        toolSteps: [],
        isStreaming: false,
        error: null
      }

      assistantMessageId = makeLocalId('assistant')

      messages.value = [
        ...messages.value,
        userMessage,
        {
          id: assistantMessageId,
          role: 'assistant',
          content: '',
          createdAt: new Date().toISOString(),
          toolSteps: [],
          isStreaming: true,
          error: null
        }
      ]
      didAppendMessages = true

      if (session) {
        upsertSession({
          ...session,
          title: session.title,
          updated_at: new Date().toISOString()
        })
      }

      isSending.value = true
      requestId = ++activeRequestId
      abortController = new AbortController()

      const response = await fetch(`/api/chat/sessions/${session?.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message,
          context: options?.context || undefined
        }),
        signal: abortController.signal
      })

      if (!response.ok || !response.body) {
        const responseText = await response.text()
        throw new Error(responseText || 'Failed to stream chat response.')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replace(/\r\n/g, '\n')

        let boundary = buffer.indexOf('\n\n')

        while (boundary >= 0) {
          const block = buffer.slice(0, boundary).trim()
          buffer = buffer.slice(boundary + 2)

          if (block) {
            handleStreamEvent(assistantMessageId, parseEventData(block))
          }

          boundary = buffer.indexOf('\n\n')
        }

        if (done) {
          const trailingBlock = buffer.trim()
          if (trailingBlock) {
            handleStreamEvent(assistantMessageId, parseEventData(trailingBlock))
          }
          break
        }
      }

      await refreshSessions()
      return true
    } catch (sendError) {
      if (requestId && requestId !== activeRequestId) {
        return false
      }

      if (sendError instanceof DOMException && sendError.name === 'AbortError') {
        return false
      }

      const messageText = sendError instanceof Error ? sendError.message : 'Failed to send chat message.'

      if (didAppendMessages && assistantMessageId) {
        updateMessage(assistantMessageId, (assistantMessage) => {
          assistantMessage.isStreaming = false
          assistantMessage.error = messageText
        })
      }

      error.value = messageText
      return false
    } finally {
      if (!requestId || requestId === activeRequestId) {
        isSending.value = false
        abortController = null
      }
    }
  }

  return {
    isOpen,
    sessions,
    groupedSessions,
    currentSessionId,
    currentSession,
    messages,
    error,
    isLoadingSessions,
    isLoadingSession,
    isSending,
    initialize,
    refreshSessions,
    loadSession,
    switchSession,
    newSession,
    deleteSession,
    sendMessage,
    toggle,
    openChat,
    closeChat
  }
})

export function useGlobalChat() {
  return useSharedGlobalChat()
}
