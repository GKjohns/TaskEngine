<script setup lang="ts">
import type { ArtifactRecord, RunRecord } from '../../shared/types/task-engine'
import { artifactTypeColorMap, truncateText } from '../utils/taskEngine'
import { suggestArtifactIds, taskLikelyNeedsDocuments } from '../utils/artifactSelection'

const props = defineProps<{
  taskId: string
  taskArtifactIds?: string[]
  taskTitle?: string
  taskPrompt?: string
  disabled?: boolean
  compact?: boolean
}>()

const emit = defineEmits<{
  started: [run: RunRecord]
}>()

const open = ref(false)
const pending = ref(false)
const errorMessage = ref('')
const selectedArtifactIds = ref<string[]>([])

const { data: artifacts, status: loadingStatus } = await useFetch<ArtifactRecord[]>('/api/artifacts', {
  default: () => []
})

const suggestedArtifactIds = computed(() => suggestArtifactIds({
  artifacts: artifacts.value || [],
  title: props.taskTitle,
  prompt: props.taskPrompt
}))

const promptNeedsDocuments = computed(() => taskLikelyNeedsDocuments({
  title: props.taskTitle,
  prompt: props.taskPrompt
}))

watch(() => props.taskArtifactIds, (artifactIds) => {
  selectedArtifactIds.value = artifactIds?.length ? [...artifactIds] : []
}, { immediate: true })

watch(open, (isOpen) => {
  if (isOpen) {
    selectedArtifactIds.value = props.taskArtifactIds?.length
      ? [...props.taskArtifactIds]
      : [...suggestedArtifactIds.value]
    errorMessage.value = ''
  }
})

function toggleArtifact(id: string) {
  const index = selectedArtifactIds.value.indexOf(id)
  if (index > -1) {
    selectedArtifactIds.value.splice(index, 1)
  } else {
    selectedArtifactIds.value.push(id)
  }
}

function applySuggestions() {
  selectedArtifactIds.value = [...suggestedArtifactIds.value]
}

async function startRun() {
  pending.value = true
  errorMessage.value = ''

  try {
    const run = await $fetch<RunRecord>('/api/runs', {
      method: 'POST',
      body: {
        task_id: props.taskId,
        artifact_ids: selectedArtifactIds.value.length > 0 ? selectedArtifactIds.value : undefined
      }
    })

    emit('started', run)
    open.value = false
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Failed to start the run.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Run task"
    description="Review the input documents for this run. These are pre-selected from the task configuration."
  >
    <UButton
      color="primary"
      icon="i-lucide-play"
      :disabled="disabled"
      :size="compact ? 'sm' : 'md'"
      @click="open = true"
    >
      Run now
    </UButton>

    <template #body>
      <div class="space-y-4">
        <UAlert
          v-if="errorMessage"
          color="error"
          variant="soft"
          :description="errorMessage"
        />

        <UAlert
          v-else-if="!taskArtifactIds?.length && suggestedArtifactIds.length"
          color="info"
          variant="soft"
          title="Suggested documents selected"
          :description="`We pre-selected ${suggestedArtifactIds.length} likely match${suggestedArtifactIds.length !== 1 ? 'es' : ''} based on the task prompt.`"
        >
          <template #actions>
            <UButton
              size="xs"
              color="info"
              variant="soft"
              @click="applySuggestions"
            >
              Re-apply suggestions
            </UButton>
          </template>
        </UAlert>

        <UAlert
          v-if="promptNeedsDocuments && !selectedArtifactIds.length"
          color="warning"
          variant="soft"
          title="This run may be missing document context"
          description="If the task depends on uploaded files, select the right documents before starting the run."
        />

        <div v-if="loadingStatus === 'pending'" class="flex items-center justify-center py-8">
          <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin text-muted" />
        </div>

        <div v-else-if="artifacts?.length" class="space-y-2">
          <p class="text-sm font-medium text-highlighted">
            Select input documents
          </p>

          <div class="max-h-80 space-y-1.5 overflow-y-auto">
            <button
              v-for="artifact in artifacts"
              :key="artifact.id"
              type="button"
              class="flex w-full items-start gap-3 rounded-lg border p-3 text-left transition"
              :class="selectedArtifactIds.includes(artifact.id)
                ? 'border-primary bg-primary/5'
                : 'border-default hover:border-primary/40 hover:bg-elevated/60'"
              @click="toggleArtifact(artifact.id)"
            >
              <div
                class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border transition"
                :class="selectedArtifactIds.includes(artifact.id)
                  ? 'border-primary bg-primary text-white'
                  : 'border-default'"
              >
                <UIcon v-if="selectedArtifactIds.includes(artifact.id)" name="i-lucide-check" class="size-3" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <p class="truncate text-sm font-medium text-highlighted">
                    {{ artifact.title }}
                  </p>
                  <UBadge :color="artifactTypeColorMap[artifact.type]" variant="soft" size="xs">
                    {{ artifact.type }}
                  </UBadge>
                  <UBadge
                    v-if="suggestedArtifactIds.includes(artifact.id)"
                    color="info"
                    variant="soft"
                    size="xs"
                  >
                    Suggested
                  </UBadge>
                </div>
                <p v-if="artifact.content" class="mt-0.5 truncate text-xs text-muted">
                  {{ truncateText(artifact.content.replace(/\s+/g, ' ').trim(), 80) }}
                </p>
              </div>
            </button>
          </div>
        </div>

        <div v-else class="rounded-lg border border-default bg-elevated/40 p-4 text-center">
          <p class="text-sm text-muted">
            No documents are available yet. This task will run without pre-selected inputs.
          </p>
        </div>

        <div v-if="selectedArtifactIds.length" class="rounded-lg bg-primary/5 px-3 py-2 text-sm text-primary">
          {{ selectedArtifactIds.length }} document{{ selectedArtifactIds.length !== 1 ? 's' : '' }} selected as input
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="ghost" @click="open = false">
          Cancel
        </UButton>
        <UButton
          icon="i-lucide-play"
          :loading="pending"
          @click="startRun"
        >
          {{ selectedArtifactIds.length ? `Run with ${selectedArtifactIds.length} document${selectedArtifactIds.length !== 1 ? 's' : ''}` : 'Run without selection' }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
