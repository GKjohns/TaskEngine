<script setup lang="ts">
import type { ChatSessionGroup, ChatSessionSummary } from '../composables/useGlobalChat'
import { formatDateTime, formatRelativeTime, truncateText } from '../utils/taskEngine'

const props = withDefaults(defineProps<{
  groups: ChatSessionGroup[]
  currentSessionId?: string | null
  loading?: boolean
  deletingId?: string | null
  emptyTitle?: string
  emptyDescription?: string
}>(), {
  currentSessionId: null,
  loading: false,
  deletingId: null,
  emptyTitle: 'No conversations yet',
  emptyDescription: 'Start a chat to build up your history.'
})

const emit = defineEmits<{
  select: [sessionId: string]
  delete: [sessionId: string]
}>()

const search = ref('')
const confirmOpen = ref(false)
const pendingDelete = ref<ChatSessionSummary | null>(null)

const filteredGroups = computed(() => {
  const query = search.value.trim().toLowerCase()

  if (!query) {
    return props.groups
  }

  return props.groups
    .map(group => ({
      ...group,
      sessions: group.sessions.filter((session) => {
        const title = (session.title || '').toLowerCase()
        const summary = (session.summary || '').toLowerCase()
        return title.includes(query) || summary.includes(query)
      })
    }))
    .filter(group => group.sessions.length)
})

function promptDelete(session: ChatSessionSummary) {
  pendingDelete.value = session
  confirmOpen.value = true
}

function selectSession(sessionId: string) {
  emit('select', sessionId)
}

function confirmDelete() {
  if (!pendingDelete.value) {
    return
  }

  emit('delete', pendingDelete.value.id)
}

function closeConfirm() {
  confirmOpen.value = false
  pendingDelete.value = null
}

watch(() => props.groups, (groups) => {
  if (!pendingDelete.value) {
    return
  }

  const stillExists = groups.some(group =>
    group.sessions.some(session => session.id === pendingDelete.value?.id)
  )

  if (!stillExists && props.deletingId !== pendingDelete.value.id) {
    closeConfirm()
  }
}, {
  deep: true
})

watch(confirmOpen, (isOpen) => {
  if (!isOpen && !props.deletingId) {
    pendingDelete.value = null
  }
})
</script>

<template>
  <div class="space-y-4">
    <UInput
      v-model="search"
      icon="i-lucide-search"
      color="neutral"
      variant="subtle"
      placeholder="Search conversation history"
      autocomplete="off"
    />

    <template v-if="loading && !groups.length">
      <div class="space-y-3">
        <div
          v-for="index in 3"
          :key="index"
          class="h-24 animate-pulse rounded-2xl bg-elevated/40"
        />
      </div>
    </template>

    <template v-else-if="filteredGroups.length">
      <section
        v-for="group in filteredGroups"
        :key="group.key"
        class="space-y-2"
      >
        <div class="flex items-center justify-between">
          <h3 class="text-xs font-medium tracking-wide text-muted uppercase">
            {{ group.label }}
          </h3>
          <span class="text-[11px] text-dimmed">
            {{ group.sessions.length }}
          </span>
        </div>

        <div class="space-y-2">
          <div
            v-for="session in group.sessions"
            :key="session.id"
            class="flex items-stretch gap-2"
          >
            <button
              type="button"
              class="min-w-0 flex-1 rounded-2xl border px-4 py-3 text-left transition"
              :class="session.id === currentSessionId
                ? 'border-primary bg-primary/5'
                : 'border-default bg-default hover:border-primary/30 hover:bg-elevated/40'"
              @click="selectSession(session.id)"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <p class="truncate text-sm font-medium text-highlighted">
                      {{ truncateText(session.title || 'Untitled conversation', 72) }}
                    </p>
                    <UBadge
                      v-if="session.id === currentSessionId"
                      color="primary"
                      variant="soft"
                      size="xs"
                    >
                      Active
                    </UBadge>
                  </div>

                  <p class="mt-1 line-clamp-2 text-xs text-muted">
                    {{ session.summary || 'No summary yet. Open the conversation to continue where you left off.' }}
                  </p>
                </div>
              </div>

              <p class="mt-3 text-[11px] text-dimmed">
                {{ formatRelativeTime(session.updated_at) }} · {{ formatDateTime(session.updated_at) }}
              </p>
            </button>

            <UButton
              color="neutral"
              variant="ghost"
              icon="i-lucide-trash-2"
              :loading="deletingId === session.id"
              :disabled="Boolean(deletingId)"
              class="self-start"
              @click="promptDelete(session)"
            />
          </div>
        </div>
      </section>
    </template>

    <PageEmptyState
      v-else-if="search.trim()"
      title="No matching conversations"
      description="Try a different title or summary keyword."
      icon="i-lucide-search-x"
    />

    <PageEmptyState
      v-else
      :title="emptyTitle"
      :description="emptyDescription"
      icon="i-lucide-message-square-more"
    />

    <UModal
      v-model:open="confirmOpen"
      title="Delete conversation"
      description="This removes the session history for this chat."
    >
      <template #body>
        <p class="text-sm text-muted">
          {{ pendingDelete?.title || 'Untitled conversation' }}
        </p>
      </template>

      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="Boolean(deletingId)"
            @click="closeConfirm"
          >
            Cancel
          </UButton>
          <UButton
            color="error"
            icon="i-lucide-trash-2"
            :loading="deletingId === pendingDelete?.id"
            @click="confirmDelete"
          >
            Delete
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
