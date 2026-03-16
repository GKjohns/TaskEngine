<script setup lang="ts">
import type { ArtifactRecord } from '../../shared/types/task-engine'
import { artifactTypeColorMap, truncateText } from '../utils/taskEngine'
import { suggestArtifactIds, taskLikelyNeedsDocuments } from '../utils/artifactSelection'

const props = defineProps<{
  taskId: string
  taskTitle?: string
  taskPrompt?: string
  planTitle?: string | null
  currentArtifactIds?: string[]
}>()

const emit = defineEmits<{
  saved: []
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
  prompt: props.taskPrompt,
  planTitle: props.planTitle
}))

const promptNeedsDocuments = computed(() => taskLikelyNeedsDocuments({
  title: props.taskTitle,
  prompt: props.taskPrompt,
  planTitle: props.planTitle
}))

watch(open, (isOpen) => {
  if (!isOpen) {
    return
  }

  errorMessage.value = ''
  selectedArtifactIds.value = props.currentArtifactIds?.length
    ? [...props.currentArtifactIds]
    : [...suggestedArtifactIds.value]
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

async function saveDocuments() {
  pending.value = true
  errorMessage.value = ''

  try {
    await $fetch(`/api/tasks/${props.taskId}`, {
      method: 'PATCH',
      body: {
        input_artifact_ids: selectedArtifactIds.value
      }
    })

    emit('saved')
    open.value = false
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Failed to update task documents.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Edit task documents"
    description="Choose the documents that should be included on future runs for this task."
  >
    <UButton color="neutral" variant="soft" icon="i-lucide-files">
      Edit documents
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
          v-else-if="!currentArtifactIds?.length && suggestedArtifactIds.length"
          color="info"
          variant="soft"
          title="Suggested documents ready"
          :description="`We found ${suggestedArtifactIds.length} likely match${suggestedArtifactIds.length !== 1 ? 'es' : ''} based on the task prompt.`"
        >
          <template #actions>
            <UButton size="xs" color="info" variant="soft" @click="applySuggestions">
              Use suggested
            </UButton>
          </template>
        </UAlert>

        <UAlert
          v-if="promptNeedsDocuments && !selectedArtifactIds.length"
          color="warning"
          variant="soft"
          title="This task probably needs document context"
          description="If this task runs on a schedule, saving the right documents here prevents future runs from starting without the context they expect."
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
            No documents are available yet.
          </p>
        </div>

        <div v-if="selectedArtifactIds.length" class="rounded-lg bg-primary/5 px-3 py-2 text-sm text-primary">
          {{ selectedArtifactIds.length }} document{{ selectedArtifactIds.length !== 1 ? 's' : '' }} saved for future runs
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="ghost" @click="open = false">
          Cancel
        </UButton>
        <UButton icon="i-lucide-save" :loading="pending" @click="saveDocuments">
          Save documents
        </UButton>
      </div>
    </template>
  </UModal>
</template>
