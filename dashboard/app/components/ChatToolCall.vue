<script setup lang="ts">
import type { ChatToolStep } from '../composables/useGlobalChat'
import { truncateText } from '../utils/taskEngine'

const props = defineProps<{
  step: ChatToolStep
}>()

const verbMap: Record<string, string> = {
  list_tasks: 'Checking tasks',
  get_task: 'Opening task details',
  run_task: 'Starting task run',
  list_artifacts: 'Searching documents',
  get_artifact: 'Opening document',
  list_runs: 'Checking activity',
  get_run: 'Opening run details',
  list_reviews: 'Checking reviews',
  resolve_review: 'Updating review',
  save_memory: 'Saving memory',
  list_memories: 'Checking memory',
  update_memory: 'Updating memory',
  delete_memory: 'Removing memory',
  create_task: 'Creating task',
  get_dashboard_summary: 'Checking dashboard'
}

const title = computed(() => {
  return verbMap[props.step.name] || props.step.name.replaceAll('_', ' ')
})

const summary = computed(() => {
  if (!props.step.output) {
    return props.step.status === 'pending' ? 'Working...' : 'Done'
  }

  return truncateText(props.step.output.replace(/\s+/g, ' ').trim(), 120)
})
</script>

<template>
  <div class="rounded-xl border border-default bg-elevated/40 px-3 py-2">
    <div class="flex items-center gap-2">
      <UIcon
        :name="step.status === 'pending' ? 'i-lucide-loader-circle' : 'i-lucide-check-circle-2'"
        class="size-4 shrink-0"
        :class="step.status === 'pending' ? 'animate-spin text-primary' : 'text-success'"
      />
      <div class="min-w-0">
        <p class="text-xs font-medium text-highlighted capitalize">
          {{ title }}
        </p>
        <p class="text-xs text-muted">
          {{ summary }}
        </p>
      </div>
    </div>
  </div>
</template>
