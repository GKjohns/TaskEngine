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
      content: 'flex h-full w-full flex-col sm:max-w-[440px]',
      body: 'min-h-0 flex-1 p-0'
    }"
  >
    <template #body>
      <div class="flex h-full min-h-0 flex-col">
        <div class="flex items-center justify-between gap-3 border-b border-default p-4">
          <div class="min-w-0">
            <p class="text-sm font-medium text-highlighted">
              Recent conversations
            </p>
            <p class="mt-1 text-xs text-muted">
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

        <UScrollArea
          class="min-h-0 flex-1"
          :ui="{ viewport: 'flex-col px-4 py-5' }"
        >
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
        </UScrollArea>
      </div>
    </template>
  </USlideover>
</template>
