<script setup lang="ts">
const props = withDefaults(defineProps<{
  sessionId?: string | null
}>(), {
  sessionId: null
})

const router = useRouter()
const scrollContainer = ref<HTMLElement | null>(null)
const draft = ref('')
const historyOpen = ref(false)
const deletingId = ref<string | null>(null)

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
  initialize,
  loadSession,
  newSession,
  deleteSession,
  sendMessage
} = useGlobalChat()

const isBusy = computed(() => isLoadingSessions.value || isLoadingSession.value)
const isConversationVisible = computed(() => Boolean(currentSessionId.value))
const currentTitle = computed(() => currentSession.value?.title || (currentSessionId.value ? 'Untitled conversation' : 'Chat'))

async function syncRequestedSession() {
  await initialize()

  if (!props.sessionId) {
    return
  }

  if (props.sessionId === currentSessionId.value && messages.value.length) {
    return
  }

  const didLoad = await loadSession(props.sessionId)

  if (!didLoad) {
    await router.replace('/chat')
  }
}

async function handleSelectSession(sessionId: string) {
  const didLoad = await loadSession(sessionId)

  if (!didLoad) {
    return
  }

  historyOpen.value = false
  await router.replace(`/chat/${sessionId}`)
}

async function handleNewChat() {
  const session = await newSession()
  draft.value = ''
  historyOpen.value = false
  await router.replace(`/chat/${session.id}`)
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
    await router.replace('/chat')
  }
}

async function submitMessage(message = draft.value) {
  const outgoing = message.trim()

  if (!outgoing) {
    return
  }

  draft.value = ''
  const didSend = await sendMessage(outgoing)

  if (!didSend) {
    draft.value = outgoing
  }
}

async function useStarterPrompt(prompt: string) {
  draft.value = prompt
  await submitMessage(prompt)
}

function scrollToBottom() {
  if (!scrollContainer.value) {
    return
  }

  scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight
}

watch(
  () => props.sessionId,
  () => {
    void syncRequestedSession()
  },
  { immediate: true }
)

watch(
  () => [messages.value.length, messages.value.at(-1)?.content, messages.value.at(-1)?.toolSteps.length],
  async () => {
    if (!isConversationVisible.value) {
      return
    }

    await nextTick()
    scrollToBottom()
  }
)
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <h2 class="text-base font-semibold text-highlighted">
          {{ currentTitle }}
        </h2>
        <p class="mt-1 max-w-2xl text-sm text-muted">
          Ask about tasks, runs, reviews, and documents without leaving the dashboard context.
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <UButton
          color="neutral"
          variant="soft"
          icon="i-lucide-history"
          :loading="isLoadingSessions"
          @click="historyOpen = true"
        >
          History
        </UButton>
        <UButton
          icon="i-lucide-plus"
          :loading="isLoadingSession"
          @click="handleNewChat"
        >
          New chat
        </UButton>
      </div>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      title="Chat unavailable"
      :description="error"
    />

    <div
      v-if="isConversationVisible"
      class="flex min-h-[70vh] flex-col overflow-hidden rounded-3xl border border-default bg-default"
    >
      <div
        ref="scrollContainer"
        class="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5 sm:px-6"
      >
        <template v-if="isBusy && !messages.length">
          <div class="space-y-3">
            <div class="h-24 animate-pulse rounded-2xl bg-elevated/40" />
            <div class="ml-auto h-20 w-[75%] animate-pulse rounded-2xl bg-primary/10" />
            <div class="h-28 animate-pulse rounded-2xl bg-elevated/40" />
          </div>
        </template>

        <template v-else-if="messages.length">
          <template v-for="message in messages" :key="message.id">
            <ChatMessageUser
              v-if="message.role === 'user'"
              :message="message"
            />
            <ChatMessageAssistant
              v-else
              :message="message"
            />
          </template>
        </template>

        <div
          v-else
          class="mx-auto max-w-2xl rounded-3xl border border-dashed border-default bg-elevated/20 px-6 py-10 text-center"
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
      </div>

      <ChatInput
        v-model="draft"
        :disabled="isLoadingSession || isSending"
        :loading="isSending"
        @submit="submitMessage()"
      />
    </div>

    <div
      v-else
      class="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(320px,0.65fr)]"
    >
      <div class="rounded-3xl border border-default bg-default p-6 sm:p-8">
        <div class="max-w-2xl">
          <div class="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <UIcon name="i-lucide-message-square-more" class="size-6" />
          </div>
          <h3 class="mt-4 text-xl font-semibold text-highlighted">
            Ask about your workspace
          </h3>
          <p class="mt-3 text-sm leading-6 text-muted">
            Chat can inspect tasks, summarize recent activity, pull up reviews, search documents, and remember lightweight preferences for future sessions.
          </p>
        </div>

        <div class="mt-6 flex flex-wrap gap-2">
          <UButton icon="i-lucide-plus" @click="handleNewChat">
            Start new chat
          </UButton>
          <UButton
            color="neutral"
            variant="soft"
            icon="i-lucide-history"
            @click="historyOpen = true"
          >
            Open history
          </UButton>
        </div>

        <div class="mt-8">
          <p class="text-xs font-medium tracking-wide text-muted uppercase">
            Starter prompts
          </p>
          <div class="mt-3 grid gap-3">
            <button
              v-for="prompt in starterPrompts"
              :key="prompt"
              type="button"
              class="rounded-2xl border border-default bg-elevated/20 px-4 py-3 text-left text-sm text-highlighted transition hover:border-primary/30 hover:bg-primary/5"
              @click="useStarterPrompt(prompt)"
            >
              {{ prompt }}
            </button>
          </div>
        </div>
      </div>

      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-medium text-highlighted">
            Recent conversations
          </h3>
          <span class="text-xs text-muted">
            {{ groupedSessions.length ? 'Grouped by recency' : 'No history yet' }}
          </span>
        </div>

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
  </div>
</template>
