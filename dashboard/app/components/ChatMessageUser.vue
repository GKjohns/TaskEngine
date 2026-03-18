<script setup lang="ts">
import type { ChatUiMessage } from '../composables/useGlobalChat'
import { formatRelativeTime } from '../utils/taskEngine'

defineProps<{
  message: ChatUiMessage
}>()
</script>

<template>
  <div class="flex justify-end">
    <article class="max-w-[88%] rounded-2xl bg-primary/10 px-4 py-3 text-sm text-highlighted">
      <p class="whitespace-pre-wrap break-words">
        {{ message.content }}
      </p>
      <p class="mt-2 text-[11px] text-muted">
        {{ formatRelativeTime(message.createdAt) }}
      </p>
    </article>
  </div>
</template>
