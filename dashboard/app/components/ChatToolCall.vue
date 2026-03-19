<script setup lang="ts">
import type { ChatToolStep } from '../composables/useGlobalChat'
import { truncateText } from '../utils/taskEngine'
import {
  parseGetTask,
  parseGetArtifact,
  parseGetRun,
  parseRunTask,
  parseCreateTask,
  parseResolveReview,
  parseListTasks,
  parseListArtifacts,
  parseListRuns,
  parseListReviews
} from '../utils/chatToolParsers'

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

const entityDetail = computed(() => {
  if (!props.step.output) return null
  switch (props.step.name) {
    case 'get_task': return parseGetTask(props.step.output)
    case 'get_artifact': return parseGetArtifact(props.step.output)
    case 'get_run': return parseGetRun(props.step.output)
    case 'create_task': return parseCreateTask(props.step.output)
    case 'resolve_review': return parseResolveReview(props.step.output)
    default: return null
  }
})

const listResult = computed(() => {
  if (!props.step.output) return null
  switch (props.step.name) {
    case 'list_tasks': return parseListTasks(props.step.output)
    case 'list_artifacts': return parseListArtifacts(props.step.output)
    case 'list_runs': return parseListRuns(props.step.output)
    case 'list_reviews': return parseListReviews(props.step.output)
    default: return null
  }
})

const listEntityLabel = computed(() => {
  const labels: Record<string, string> = {
    list_tasks: 'task',
    list_artifacts: 'document',
    list_runs: 'run',
    list_reviews: 'review'
  }
  return labels[props.step.name] || 'result'
})

const runAction = computed(() => {
  if (!props.step.output || props.step.name !== 'run_task') return null
  return parseRunTask(props.step.output)
})

const fallbackSummary = computed(() => {
  if (!props.step.output) {
    return props.step.status === 'pending' ? 'Working...' : 'Done'
  }
  return truncateText(props.step.output.replace(/\s+/g, ' ').trim(), 120)
})

const fallbackActionLink = computed(() => {
  const output = props.step.output || ''

  if (props.step.name === 'run_task') {
    const runId = output.match(/Started run ([a-z0-9-]+)/i)?.[1]
    if (runId) return { to: `/runs/${runId}`, label: 'Open run' }
  }

  if (props.step.name === 'create_task') {
    const taskId = output.match(/\(([a-z0-9-]+)\)\./i)?.[1]
    if (taskId) return { to: `/tasks/${taskId}`, label: 'Open task' }
  }

  if (props.step.name === 'resolve_review' && props.step.status === 'done') {
    return { to: '/reviews', label: 'Open reviews' }
  }

  return null
})

const canShowRaw = computed(() => {
  return Boolean(props.step.output && props.step.output.trim().length > 80)
})
</script>

<template>
  <div class="max-w-sm rounded-xl border border-default bg-elevated/40 px-3 py-2">
    <div class="flex items-center gap-2">
      <UIcon
        :name="step.status === 'pending' ? 'i-lucide-loader-circle' : 'i-lucide-check-circle-2'"
        class="size-4 shrink-0"
        :class="step.status === 'pending' ? 'animate-spin text-primary' : 'text-success'"
      />
      <p class="min-w-0 flex-1 truncate text-xs font-medium text-highlighted capitalize">
        {{ title }}
      </p>
      <UTooltip v-if="canShowRaw" :text="expanded ? 'Hide raw output' : 'Raw output'">
        <button
          class="shrink-0 rounded p-0.5 text-muted/40 transition-colors hover:text-muted"
          @click="expanded = !expanded"
        >
          <UIcon
            :name="expanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
            class="size-3.5"
          />
        </button>
      </UTooltip>
    </div>

    <ChatToolCardEntity v-if="entityDetail" :entity="entityDetail" />
    <ChatToolCardList v-else-if="listResult" :list="listResult" :entity-label="listEntityLabel" />
    <ChatToolCardRunStatus v-else-if="runAction" :action="runAction" />

    <template v-else>
      <p class="mt-1 text-xs text-muted">
        {{ fallbackSummary }}
      </p>

      <div v-if="step.output && fallbackActionLink" class="mt-2">
        <UButton
          :to="fallbackActionLink.to"
          color="primary"
          variant="soft"
          size="xs"
          icon="i-lucide-arrow-up-right"
        >
          {{ fallbackActionLink.label }}
        </UButton>
      </div>
    </template>

    <pre
      v-if="expanded && step.output"
      class="mt-2 overflow-x-auto rounded-lg bg-default px-3 py-2 text-[11px] leading-5 text-muted whitespace-pre-wrap"
    >{{ step.output }}</pre>
  </div>
</template>
