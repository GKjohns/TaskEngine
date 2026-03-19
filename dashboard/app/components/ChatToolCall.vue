<script setup lang="ts">
import type { ChatToolStep } from '../composables/useGlobalChat'
import { truncateText } from '../utils/taskEngine'

const props = defineProps<{
  step: ChatToolStep
}>()

const expanded = ref(false)

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

const hasDetails = computed(() => {
  return Boolean(props.step.output && props.step.output.trim() && props.step.output.trim().length > 120)
})

const actionLink = computed(() => {
  const output = props.step.output || ''

  if (props.step.name === 'run_task') {
    const runId = output.match(/Started run ([a-z0-9-]+)/i)?.[1]

    if (runId) {
      return {
        to: `/runs/${runId}`,
        label: 'Open run'
      }
    }
  }

  if (props.step.name === 'create_task') {
    const taskId = output.match(/\(([a-z0-9-]+)\)\./i)?.[1]

    if (taskId) {
      return {
        to: `/tasks/${taskId}`,
        label: 'Open task'
      }
    }
  }

  if (props.step.name === 'resolve_review' && props.step.status === 'done') {
    return {
      to: '/reviews',
      label: 'Open reviews'
    }
  }

  return null
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

    <div
      v-if="step.output && (hasDetails || actionLink)"
      class="mt-3 flex flex-wrap items-center gap-2 border-t border-default/70 pt-3"
    >
      <UButton
        v-if="hasDetails"
        color="neutral"
        variant="ghost"
        size="xs"
        :icon="expanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        @click="expanded = !expanded"
      >
        {{ expanded ? 'Hide details' : 'View details' }}
      </UButton>

      <UButton
        v-if="actionLink"
        :to="actionLink.to"
        color="primary"
        variant="soft"
        size="xs"
        icon="i-lucide-arrow-up-right"
      >
        {{ actionLink.label }}
      </UButton>
    </div>

    <pre
      v-if="expanded && step.output"
      class="mt-3 overflow-x-auto rounded-lg bg-default px-3 py-2 text-[11px] leading-5 text-muted whitespace-pre-wrap"
    >{{ step.output }}</pre>
  </div>
</template>
