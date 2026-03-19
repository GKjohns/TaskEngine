<script setup lang="ts">
import type { ChatViewContext } from '../composables/useGlobalChat'
import { formatRelativeTime, truncateText } from '../utils/taskEngine'

const route = useRoute()
const draft = ref('')

const {
  isOpen,
  sessions,
  currentSessionId,
  currentSession,
  messages,
  error,
  isLoadingSessions,
  isLoadingSession,
  isSending,
  chatStatus,
  queuedCount,
  initialize,
  loadSession,
  switchSession,
  startDraftSession,
  sendMessage,
  retryMessage,
  stopChat,
  closeChat
} = useGlobalChat()

const sessionOptions = computed(() => {
  return sessions.value.map(session => ({
    label: truncateText(session.title || 'Untitled conversation', 42),
    value: session.id,
    description: formatRelativeTime(session.updated_at)
  }))
})

const currentContext = computed<ChatViewContext | null>(() => {
  const taskId = typeof route.params.id === 'string' ? route.params.id : undefined

  if (route.path.startsWith('/tasks/') && taskId) {
    return {
      kind: 'task',
      id: taskId,
      label: `task ${taskId}`
    }
  }

  if (route.path.startsWith('/artifacts/') && taskId) {
    return {
      kind: 'artifact',
      id: taskId,
      label: `artifact ${taskId}`
    }
  }

  if (route.path.startsWith('/runs/') && taskId) {
    return {
      kind: 'run',
      id: taskId,
      label: `run ${taskId}`
    }
  }

  if (route.path === '/reviews') {
    return {
      kind: 'page',
      label: 'the reviews page'
    }
  }

  return null
})

const contextLabel = computed(() => {
  if (!currentContext.value) {
    return null
  }

  if (currentContext.value.kind === 'page') {
    return 'Viewing reviews'
  }

  return `Viewing ${currentContext.value.label}`
})

const currentTitle = computed(() => {
  return currentSession.value?.title || (currentSessionId.value ? 'Untitled conversation' : 'New chat')
})

const isBusy = computed(() => isLoadingSessions.value || isLoadingSession.value)
const isControlsDisabled = computed(() => isLoadingSession.value || isSending.value)

const helperText = computed(() => {
  if (isSending.value) {
    return queuedCount.value
      ? `${queuedCount.value} queued. Agent is responding.`
      : 'Agent is responding.'
  }
  return 'Enter to send. Shift+Enter for a new line.'
})

async function onSessionChange(sessionId: string | number | Record<string, unknown> | null) {
  if (typeof sessionId !== 'string') {
    return
  }

  await switchSession(sessionId)
}

async function startNewChat() {
  startDraftSession()
  draft.value = ''
}

async function handlePromptSubmit(event: Event) {
  event.preventDefault()
  const outgoing = draft.value.trim()
  if (!outgoing) return
  draft.value = ''
  const didSend = await sendMessage(outgoing, {
    context: currentContext.value
  })
  if (!didSend) {
    draft.value = outgoing
  }
}

async function retryAssistantMessage(messageId: string) {
  await retryMessage(messageId)
}

async function retryCurrentSessionLoad() {
  if (!currentSessionId.value) {
    await initialize()
    return
  }

  await loadSession(currentSessionId.value)
}

watch(isOpen, (open) => {
  if (open) {
    void initialize()
  }
})
</script>

<template>
  <USlideover
    v-model:open="isOpen"
    side="right"
    title="TaskEngine chat"
    description="Ask about tasks, activity, reviews, and documents from anywhere in the dashboard."
    :close="false"
    :ui="{
      content: 'w-full sm:max-w-[420px] p-0',
      body: 'p-0'
    }"
  >
    <template #content>
      <div class="flex h-full min-h-0 flex-col bg-default">
        <header class="border-b border-default px-4 py-4">
          <div class="flex items-start gap-3">
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-semibold text-highlighted">
                {{ currentTitle }}
              </p>
              <p class="mt-1 text-xs text-muted">
                Ask about tasks, activity, reviews, or documents from anywhere in the dashboard.
              </p>
            </div>

            <div class="flex shrink-0 items-center gap-1">
              <UButton
                to="/chat/memory"
                color="neutral"
                variant="ghost"
                size="sm"
                icon="i-lucide-brain"
              />
              <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                icon="i-lucide-plus"
                :disabled="isControlsDisabled"
                @click="startNewChat"
              />
              <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                icon="i-lucide-x"
                @click="closeChat"
              />
            </div>
          </div>

          <div class="mt-3">
            <USelectMenu
              :model-value="currentSessionId || undefined"
              :items="sessionOptions"
              value-key="value"
              label-key="label"
              color="neutral"
              variant="subtle"
              :search-input="false"
              :loading="isLoadingSessions"
              :disabled="isControlsDisabled"
              placeholder="Recent conversations"
              class="w-full"
              @update:model-value="onSessionChange"
            />
          </div>
        </header>

        <UAlert
          v-if="error"
          color="error"
          variant="soft"
          class="mx-4 mt-4"
          title="Chat unavailable"
          :description="error"
        />

        <UChatMessages
          should-auto-scroll
          :status="chatStatus"
          :spacing-offset="120"
          class="flex-1 min-h-0"
        >
          <template #indicator />

          <template v-if="isBusy && !messages.length">
            <div class="space-y-3 px-4 pt-4">
              <div class="h-20 animate-pulse rounded-3xl bg-elevated/40" />
              <div class="ml-auto h-16 w-[80%] animate-pulse rounded-3xl bg-primary/10" />
              <div class="h-24 animate-pulse rounded-3xl bg-elevated/40" />
            </div>
          </template>

          <template v-else-if="messages.length">
            <div class="space-y-4 px-4">
              <template v-for="message in messages" :key="message.id">
                <ChatMessageUser
                  v-if="message.role === 'user'"
                  :message="message"
                />
                <ChatMessageAssistant
                  v-else
                  :message="message"
                  @retry="retryAssistantMessage"
                />
              </template>
            </div>
          </template>

          <div
            v-else-if="error && currentSessionId && !isBusy"
            class="mx-4 rounded-2xl border border-error/30 bg-error/5 px-4 py-5"
          >
            <div class="flex items-start gap-3">
              <div class="mt-0.5 flex size-8 items-center justify-center rounded-lg bg-error/10 text-error">
                <UIcon name="i-lucide-message-square-warning" class="size-4" />
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-highlighted">
                  Could not load this conversation
                </p>
                <p class="mt-1 text-sm text-muted">
                  {{ error }}
                </p>
                <UButton
                  color="error"
                  variant="soft"
                  size="xs"
                  icon="i-lucide-rotate-cw"
                  class="mt-3"
                  @click="retryCurrentSessionLoad"
                >
                  Retry
                </UButton>
              </div>
            </div>
          </div>

          <div
            v-else
            class="mx-4 rounded-2xl border border-dashed border-default bg-elevated/20 px-4 py-5 text-sm text-muted"
          >
            <p class="font-medium text-highlighted">
              Start a conversation
            </p>
            <p class="mt-2">
              The assistant can look up tasks, inspect runs, search documents, manage reviews, and remember preferences for later.
            </p>
          </div>
        </UChatMessages>

        <UChatPrompt
          v-model="draft"
          variant="subtle"
          placeholder="Ask anything or give an instruction..."
          :disabled="isLoadingSession"
          class="rounded-b-none"
          @submit="handlePromptSubmit"
        >
          <template v-if="contextLabel" #header>
            <div class="flex items-center gap-2 text-xs text-muted">
              <UBadge color="neutral" variant="soft" size="xs">
                Context
              </UBadge>
              <span class="truncate">{{ contextLabel }}</span>
            </div>
          </template>

          <template #footer>
            <span class="text-[11px] text-muted">{{ helperText }}</span>

            <UChatPromptSubmit
              :status="chatStatus"
              color="neutral"
              size="sm"
              @stop="stopChat"
            />
          </template>
        </UChatPrompt>
      </div>
    </template>
  </USlideover>
</template>
