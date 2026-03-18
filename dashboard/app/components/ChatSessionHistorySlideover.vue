<script setup lang="ts">
import type { ChatSessionGroup } from '../composables/useGlobalChat'

const open = defineModel<boolean>('open', { default: false })

defineProps<{
  groups: ChatSessionGroup[]
  currentSessionId?: string | null
  loading?: boolean
  deletingId?: string | null
}>()

const emit = defineEmits<{
  select: [sessionId: string]
  delete: [sessionId: string]
  create: []
}>()
</script>

<template>
  <USlideover
    v-model:open="open"
    side="right"
    title="Conversation history"
    description="Search recent chats, reopen a conversation, or remove one you no longer need."
    :ui="{
      content: 'w-full sm:max-w-[440px]',
      body: 'p-0'
    }"
  >
    <template #body>
      <div class="space-y-4 p-4">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="text-sm font-medium text-highlighted">
              Recent conversations
            </p>
            <p class="text-xs text-muted">
              History stays on demand so the main chat page can stay focused on the active thread.
            </p>
          </div>

          <UButton
            color="primary"
            variant="soft"
            icon="i-lucide-plus"
            @click="emit('create')"
          >
            New
          </UButton>
        </div>

        <ChatSessionHistoryList
          :groups="groups"
          :current-session-id="currentSessionId"
          :loading="loading"
          :deleting-id="deletingId"
          empty-title="No recent chats"
          empty-description="Start a new conversation and it will appear here."
          @select="emit('select', $event)"
          @delete="emit('delete', $event)"
        />
      </div>
    </template>
  </USlideover>
</template>
