<script setup lang="ts">
import type { ChatUiMessage } from '../composables/useGlobalChat'
import { formatRelativeTime } from '../utils/taskEngine'

const props = defineProps<{
  message: ChatUiMessage
}>()

const copied = ref(false)
const reasoningOpen = ref(false)

const hasContent = computed(() => Boolean(props.message.content.trim()))
const hasReasoning = computed(() => Boolean(props.message.reasoning.trim()))

watch(() => props.message.reasoning, (val) => {
  if (val && !hasContent.value && props.message.isStreaming) {
    reasoningOpen.value = true
  }
})

watch(hasContent, (val) => {
  if (val) reasoningOpen.value = false
})

async function copyMessage() {
  if (!hasContent.value || !import.meta.client) {
    return
  }

  try {
    await navigator.clipboard.writeText(props.message.content)
    copied.value = true
    window.setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch {
    // Ignore clipboard failures.
  }
}
</script>

<template>
  <div class="flex justify-start">
    <article class="max-w-[92%] space-y-3 rounded-2xl bg-default px-4 py-3">
      <div v-if="message.toolSteps.length" class="space-y-2">
        <ChatToolCall
          v-for="step in message.toolSteps"
          :key="step.id"
          :step="step"
        />
      </div>

      <div v-if="hasReasoning" class="space-y-1">
        <button
          class="flex items-center gap-1.5 text-xs text-muted hover:text-default transition-colors"
          @click="reasoningOpen = !reasoningOpen"
        >
          <UIcon
            :name="reasoningOpen ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
            class="size-3.5 shrink-0"
          />
          <span>Reasoning</span>
          <span
            v-if="message.isStreaming && !hasContent"
            class="size-1.5 rounded-full bg-primary animate-pulse"
          />
        </button>
        <p
          v-show="reasoningOpen"
          class="max-h-48 overflow-y-auto pl-5 text-sm leading-relaxed text-muted/80"
        >
          {{ message.reasoning }}
        </p>
      </div>

      <ReadOnlyMarkdown
        v-if="hasContent"
        :content="message.content"
        surface="plain"
      />

      <div
        v-else-if="message.isStreaming && !hasReasoning"
        class="flex items-center gap-2 rounded-xl bg-elevated/40 px-3 py-2 text-sm text-muted"
      >
        <span class="flex gap-1">
          <span class="size-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
          <span class="size-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
          <span class="size-1.5 animate-bounce rounded-full bg-primary" />
        </span>
        Thinking
      </div>

      <UAlert
        v-if="message.error"
        color="error"
        variant="soft"
        title="Chat error"
        :description="message.error"
      />

      <div class="flex items-center justify-between gap-3">
        <p class="text-[11px] text-muted">
          {{ formatRelativeTime(message.createdAt) }}
        </p>

        <UButton
          v-if="hasContent"
          :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
          color="neutral"
          variant="ghost"
          size="xs"
          @click="copyMessage"
        >
          {{ copied ? 'Copied' : 'Copy' }}
        </UButton>
      </div>
    </article>
  </div>
</template>
