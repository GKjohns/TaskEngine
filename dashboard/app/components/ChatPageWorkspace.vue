<script setup lang="ts">
const props = withDefaults(defineProps<{
  sessionId?: string | null
}>(), {
  sessionId: null
})

const draft = ref('')
const historyOpen = ref(false)
const deletingId = ref<string | null>(null)
const promptContainer = ref<HTMLElement | null>(null)

const starterPrompts = [
  'Show me tasks that need attention this week.',
  'Summarize the latest run failures and likely causes.',
  'What reviews are waiting on me right now?'
]

const {
  groupedSessions,
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
  startDraftSession,
  deleteSession,
  sendMessage,
  retryMessage,
  stopChat
} = useGlobalChat()

const isBusy = computed(() => isLoadingSession.value)
const isConversationVisible = computed(() => Boolean(props.sessionId))
const hasLoadedRequestedSession = computed(() => {
  return Boolean(props.sessionId && currentSession.value?.id === props.sessionId && currentSessionId.value === props.sessionId)
})
const visibleMessages = computed(() => hasLoadedRequestedSession.value ? messages.value : [])
const currentTitle = computed(() => hasLoadedRequestedSession.value ? (currentSession.value?.title || 'Untitled conversation') : 'Untitled conversation')

const helperText = computed(() => {
  if (isSending.value) {
    return queuedCount.value
      ? `${queuedCount.value} queued. Agent is responding.`
      : 'Agent is responding.'
  }
  return 'Enter to send. Shift+Enter for a new line.'
})

async function focusPrompt() {
  await nextTick()

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      const input = promptContainer.value?.querySelector<HTMLElement>('textarea, input, [contenteditable="true"]')

      input?.scrollIntoView({ block: 'nearest' })
      input?.focus()
    })
  })
}

async function syncRequestedSession() {
  void initialize()

  if (!props.sessionId) {
    startDraftSession()
    return
  }

  if (hasLoadedRequestedSession.value) {
    return
  }

  const requestedSessionId = props.sessionId
  const didLoad = await loadSession(requestedSessionId)

  if (!didLoad && props.sessionId === requestedSessionId) {
    await navigateTo('/chat', { replace: true })
  }
}

async function handleSelectSession(sessionId: string) {
  historyOpen.value = false

  if (props.sessionId === sessionId) {
    return
  }

  await navigateTo(`/chat/${sessionId}`, { replace: true })
}

async function handleNewChat() {
  draft.value = ''
  historyOpen.value = false

  if (props.sessionId) {
    await navigateTo('/chat', { replace: true })
    await focusPrompt()
    return
  }

  startDraftSession()
  await focusPrompt()
}

async function handleDeleteSession(sessionId: string) {
  deletingId.value = sessionId
  const didDelete = await deleteSession(sessionId)
  deletingId.value = null

  if (!didDelete) {
    return
  }

  if (props.sessionId === sessionId) {
    historyOpen.value = false
    await navigateTo('/chat', { replace: true })
  }
}

async function handlePromptSubmit(event: Event) {
  event.preventDefault()
  const outgoing = draft.value.trim()
  if (!outgoing) return
  draft.value = ''
  const shouldNavigateToSession = !props.sessionId
  const didSend = await sendMessage(outgoing, {
    onSessionReady: (sessionId) => {
      if (!shouldNavigateToSession) {
        return
      }

      void navigateTo(`/chat/${sessionId}`, { replace: true })
    }
  })
  if (!didSend) {
    draft.value = outgoing
  }
}

async function retryAssistantMessage(messageId: string) {
  await retryMessage(messageId)
}

async function retryCurrentSessionLoad() {
  if (!props.sessionId) {
    await initialize()
    return
  }

  await loadSession(props.sessionId)
}

async function useStarterPrompt(prompt: string) {
  draft.value = ''
  const shouldNavigateToSession = !props.sessionId
  await sendMessage(prompt, {
    onSessionReady: (sessionId) => {
      if (!shouldNavigateToSession) {
        return
      }

      void navigateTo(`/chat/${sessionId}`, { replace: true })
    }
  })
}

watch(
  () => props.sessionId,
  () => {
    void syncRequestedSession()
  },
  { immediate: true }
)
</script>

<template>
  <!-- Conversation active: fill the panel body, only messages scroll -->
  <div v-if="isConversationVisible" class="flex h-full flex-col">
    <div class="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-4 border-b border-default bg-default/95 px-4 py-3 backdrop-blur sm:px-6">
      <h2 class="min-w-0 truncate text-sm font-semibold text-highlighted">
        {{ currentTitle }}
      </h2>

      <div class="flex shrink-0 items-center gap-1.5">
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
          icon="i-lucide-history"
          :loading="isLoadingSessions"
          @click="historyOpen = true"
        />
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-plus"
          @click="handleNewChat"
        />
      </div>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      class="mx-4 mt-3 shrink-0 sm:mx-6"
      title="Chat unavailable"
      :description="error"
    />

    <UContainer class="flex flex-1 flex-col gap-4 min-h-0 sm:gap-6">
      <UChatMessages
        should-auto-scroll
        :status="chatStatus"
        :spacing-offset="160"
        class="pb-4 sm:pb-6"
      >
        <template #indicator />

        <template v-if="isBusy && !visibleMessages.length">
          <div class="space-y-3 pt-8 sm:pt-10">
            <div class="h-24 animate-pulse rounded-3xl bg-elevated/40" />
            <div class="ml-auto h-20 w-[75%] animate-pulse rounded-3xl bg-primary/10" />
            <div class="h-28 animate-pulse rounded-3xl bg-elevated/40" />
          </div>
        </template>

        <template v-else-if="visibleMessages.length">
          <div class="space-y-4 pt-4 sm:pt-5">
            <template v-for="message in visibleMessages" :key="message.id">
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
          class="mx-auto max-w-2xl rounded-3xl border border-error/30 bg-error/5 px-6 py-8"
        >
          <div class="flex items-start gap-4">
            <div class="flex size-10 items-center justify-center rounded-2xl bg-error/10 text-error">
              <UIcon name="i-lucide-message-square-warning" class="size-5" />
            </div>
            <div class="min-w-0 flex-1">
              <h3 class="text-base font-semibold text-highlighted">
                Could not load this conversation
              </h3>
              <p class="mt-2 text-sm text-muted">
                {{ error }}
              </p>
              <UButton
                color="error"
                variant="soft"
                icon="i-lucide-rotate-cw"
                class="mt-4"
                @click="retryCurrentSessionLoad"
              >
                Retry
              </UButton>
            </div>
          </div>
        </div>

        <div
          v-else
          class="mx-auto mt-6 max-w-2xl rounded-3xl border border-dashed border-default bg-elevated/20 px-6 py-10 text-center sm:mt-8"
        >
          <div class="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <UIcon name="i-lucide-message-square" class="size-6" />
          </div>
          <h3 class="mt-4 text-lg font-semibold text-highlighted">
            Start the conversation
          </h3>
          <p class="mt-2 text-sm text-muted">
            Ask for task status, run summaries, review triage, or document lookups and the assistant will stream the response here.
          </p>
        </div>
      </UChatMessages>

      <div ref="promptContainer">
        <UChatPrompt
          v-model="draft"
          variant="subtle"
          placeholder="Ask anything or give an instruction..."
          :disabled="isLoadingSession"
          class="sticky bottom-0 z-10 rounded-b-none"
          @submit="handlePromptSubmit"
        >
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
    </UContainer>
  </div>

  <!-- No session: welcome screen (rendered inside DashboardPage with body padding) -->
  <div v-else class="flex h-full min-h-0 flex-col">
    <div class="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
      <div class="mx-auto flex max-w-6xl flex-col gap-4">
        <div class="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 class="text-base font-semibold text-highlighted">
              Chat
            </h2>
            <p class="mt-1 max-w-2xl text-sm text-muted">
              Ask about tasks, runs, reviews, and documents from one place.
            </p>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <UButton
              to="/chat/memory"
              color="neutral"
              variant="soft"
              icon="i-lucide-brain"
            >
              Memory
            </UButton>
            <UButton
              color="neutral"
              variant="soft"
              icon="i-lucide-history"
              :loading="isLoadingSessions"
              @click="historyOpen = true"
            >
              History
            </UButton>
          </div>
        </div>

        <div class="rounded-3xl border border-default bg-default p-4 sm:p-5 xl:hidden">
          <div class="flex items-start gap-3">
            <div class="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <UIcon name="i-lucide-message-square-more" class="size-4.5" />
            </div>

            <div class="min-w-0">
              <h3 class="text-sm font-semibold text-highlighted">
                Ask about your workspace
              </h3>
              <p class="mt-1 text-sm text-muted">
                Ask about tasks, runs, reviews, and documents. Open history if you want to jump back into an earlier chat.
              </p>
            </div>
          </div>
        </div>

        <div class="hidden gap-4 2xl:grid 2xl:grid-cols-[minmax(0,0.95fr)_minmax(320px,0.7fr)]">
          <div class="rounded-3xl border border-default bg-default p-5 sm:p-6">
            <div class="flex items-start gap-4">
              <div class="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <UIcon name="i-lucide-message-square-more" class="size-5" />
              </div>

              <div class="min-w-0 flex-1">
                <h3 class="text-lg font-semibold text-highlighted">
                  Ask about your workspace
                </h3>
                <p class="mt-2 max-w-2xl text-sm text-muted">
                  Chat can inspect tasks, summarize recent activity, pull up reviews, search documents, and remember lightweight preferences.
                </p>
              </div>
            </div>

            <div class="mt-5">
              <p class="text-xs font-medium tracking-wide text-muted uppercase">
                Starter prompts
              </p>
              <div class="mt-3 flex flex-wrap gap-2">
                <button
                  v-for="prompt in starterPrompts"
                  :key="prompt"
                  type="button"
                  class="rounded-full border border-default bg-elevated/20 px-4 py-2 text-left text-sm text-highlighted transition hover:border-primary/30 hover:bg-primary/5"
                  @click="useStarterPrompt(prompt)"
                >
                  {{ prompt }}
                </button>
              </div>
            </div>
          </div>

          <div class="min-h-0 space-y-3">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-medium text-highlighted">
                Recent conversations
              </h3>
              <span class="text-xs text-muted">
                {{ groupedSessions.length ? 'Grouped by recency' : 'No history yet' }}
              </span>
            </div>

            <div class="xl:max-h-[420px] xl:overflow-y-auto xl:pr-1">
              <ChatSessionHistoryList
                :groups="groupedSessions"
                :current-session-id="currentSessionId"
                :loading="isLoadingSessions"
                :deleting-id="deletingId"
                empty-title="No recent conversations"
                empty-description="Once you start chatting, your session history will show up here."
                @select="handleSelectSession"
                @delete="handleDeleteSession"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <div ref="promptContainer" class="px-4 pb-4 sm:px-6 sm:pb-5">
      <UChatPrompt
        v-model="draft"
        variant="subtle"
        placeholder="Ask anything or give an instruction..."
        class="rounded-b-none"
        @submit="handlePromptSubmit"
      >
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
  </div>

  <ChatSessionHistorySlideover
    v-model:open="historyOpen"
    :groups="groupedSessions"
    :current-session-id="currentSessionId"
    :loading="isLoadingSessions"
    :deleting-id="deletingId"
    @create="handleNewChat"
    @select="handleSelectSession"
    @delete="handleDeleteSession"
  />
</template>
