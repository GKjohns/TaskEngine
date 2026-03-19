<script setup lang="ts">
import type { ToolRunAction } from '../utils/chatToolParsers'
import { statusColor } from '../utils/chatToolParsers'

const props = defineProps<{
  action: ToolRunAction
}>()

const runStatus = ref(props.action.status)
let pollTimer: ReturnType<typeof setInterval> | null = null

const isTerminal = computed(() =>
  ['completed', 'failed', 'cancelled'].includes(runStatus.value)
)

async function checkStatus() {
  try {
    const data = await $fetch<{ status: string }>(`/api/runs/${props.action.runId}`)
    runStatus.value = data.status
    if (isTerminal.value) stopPolling()
  } catch {
    // Silently handle polling errors.
  }
}

function startPolling() {
  if (isTerminal.value || pollTimer) return
  pollTimer = setInterval(checkStatus, 4000)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

onMounted(async () => {
  if (!isTerminal.value) {
    await checkStatus()
    if (!isTerminal.value) startPolling()
  }
})

onUnmounted(stopPolling)
</script>

<template>
  <div class="mt-2 flex items-start gap-2">
    <UIcon name="i-lucide-play" class="mt-0.5 size-3.5 shrink-0 text-muted" />
    <div class="min-w-0 flex-1">
      <p class="text-xs font-medium text-highlighted leading-tight break-words">
        {{ action.taskTitle }}
      </p>
      <div class="mt-0.5 flex items-center justify-between gap-2">
        <div class="flex items-center gap-1.5">
          <UBadge :color="statusColor(runStatus)" variant="soft" size="xs">
            {{ runStatus.replace(/_/g, ' ') }}
          </UBadge>
          <span v-if="!isTerminal" class="flex gap-0.5">
            <span class="size-1 rounded-full bg-primary animate-pulse" />
            <span class="size-1 rounded-full bg-primary animate-pulse [animation-delay:150ms]" />
            <span class="size-1 rounded-full bg-primary animate-pulse [animation-delay:300ms]" />
          </span>
        </div>
        <NuxtLink
          :to="`/runs/${action.runId}`"
          class="shrink-0 inline-flex items-center gap-0.5 text-[11px] font-medium text-primary hover:underline"
        >
          Open run
          <UIcon name="i-lucide-arrow-up-right" class="size-3" />
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
