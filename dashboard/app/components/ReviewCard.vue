<script setup lang="ts">
import type { ArtifactRecord, ReviewRecord } from '../../shared/types/task-engine'
import { formatDateTime, reviewStatusColorMap } from '../utils/taskEngine'

type ReviewArtifact = Pick<ArtifactRecord, 'id' | 'title' | 'type' | 'content' | 'description' | 'storage_path' | 'created_at'> & {
  task_title?: string | null
  produced_by_run_id?: string | null
  download_url?: string | null
}

interface ReviewCardReview extends ReviewRecord {
  task_id: string | null
  task_title: string
  review_message: string | null
  node_key: string | null
  node_type: string | null
  output_artifact: ReviewArtifact | null
}

const props = defineProps<{
  review: ReviewCardReview
  pending?: boolean
  resolved?: boolean
}>()

const emit = defineEmits<{
  resolve: [payload: { id: string, status: 'approved' | 'rejected' | 'edited', comments?: string | null, artifactId?: string | null, artifactContent?: string | null }]
}>()

const isEditing = ref(false)
const editorComment = ref('')
const editedContent = ref('')

watch(() => props.review.id, () => {
  isEditing.value = false
  editorComment.value = ''
  editedContent.value = props.review.output_artifact?.content || ''
}, { immediate: true })

const canEditArtifact = computed(() => Boolean(props.review.output_artifact?.content))

function startEditing() {
  editedContent.value = props.review.output_artifact?.content || ''
  editorComment.value = props.review.comments || ''
  isEditing.value = true
}

function cancelEditing() {
  isEditing.value = false
  editorComment.value = ''
  editedContent.value = props.review.output_artifact?.content || ''
}
</script>

<template>
  <div
    class="rounded-2xl p-5"
    :class="resolved ? 'bg-elevated/20 opacity-90' : 'bg-elevated/30'"
  >
    <div class="space-y-4">
      <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div class="space-y-1">
          <p class="font-semibold text-highlighted">
            {{ review.task_title }}
          </p>
          <p v-if="review.review_message" class="text-sm text-muted">
            {{ review.review_message }}
          </p>
          <p class="text-xs text-dimmed">
            {{ review.node_key ? `${review.node_key} · ${review.node_type}` : 'Step details unavailable' }}
          </p>
        </div>

        <UBadge :color="reviewStatusColorMap[review.status]" variant="soft">
          {{ review.status }}
        </UBadge>
      </div>

      <div class="grid gap-3 text-sm text-muted sm:grid-cols-2">
        <p>Created {{ formatDateTime(review.created_at) }}</p>
        <p>Resolved {{ formatDateTime(review.resolved_at) }}</p>
      </div>

      <div v-if="review.comments && !isEditing">
        <p class="mb-2 text-xs font-medium tracking-wide text-muted uppercase">
          Review note
        </p>
        <ContentRenderer :content="review.comments" compact />
      </div>

      <div v-if="review.output_artifact" class="space-y-2">
        <p class="text-sm font-medium text-highlighted">
          Draft document
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <NuxtLink :to="`/artifacts/${review.output_artifact.id}`" class="text-sm text-primary hover:underline">
            {{ review.output_artifact.title }}
          </NuxtLink>
          <UBadge color="neutral" variant="soft" size="xs">
            {{ review.output_artifact.type }}
          </UBadge>
        </div>
        <ArtifactPreview
          :artifact="{ ...review.output_artifact, task_title: review.task_title }"
          compact
          surface="plain"
          :show-header="false"
          :show-footer="false"
          :show-actions="false"
        />
      </div>

      <div
        v-if="review.status === 'pending' && isEditing && review.output_artifact"
        class="space-y-3 rounded-xl bg-info/5 p-4"
      >
        <div>
          <p class="text-sm font-medium text-highlighted">
            Edit before approving
          </p>
          <p class="mt-1 text-sm text-muted">
            Make the changes you want captured in the document, then resolve this review with the edited version.
          </p>
        </div>

        <UFormField label="Updated content">
          <UTextarea
            v-model="editedContent"
            class="w-full"
            :rows="12"
            autoresize
          />
        </UFormField>

        <UFormField label="Comment (optional)">
          <UTextarea
            v-model="editorComment"
            class="w-full"
            :rows="3"
            autoresize
            placeholder="Summarize what you changed or what the team should know."
          />
        </UFormField>

        <div class="flex flex-wrap gap-2">
          <UButton
            color="primary"
            size="sm"
            :loading="pending"
            @click="emit('resolve', {
              id: review.id,
              status: 'edited',
              comments: editorComment || null,
              artifactId: review.output_artifact.id,
              artifactContent: editedContent
            })"
          >
            Approve edited version
          </UButton>
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            :disabled="pending"
            @click="cancelEditing"
          >
            Cancel
          </UButton>
        </div>
      </div>

      <div v-if="review.status === 'pending' && !isEditing" class="flex flex-wrap gap-2">
        <UButton
          color="success"
          size="sm"
          :loading="pending"
          @click="emit('resolve', { id: review.id, status: 'approved' })"
        >
          Approve
        </UButton>
        <UButton
          v-if="canEditArtifact"
          color="primary"
          variant="soft"
          size="sm"
          :loading="pending"
          @click="startEditing"
        >
          Edit before approve
        </UButton>
        <UButton
          color="error"
          variant="soft"
          size="sm"
          :loading="pending"
          @click="emit('resolve', { id: review.id, status: 'rejected' })"
        >
          Reject
        </UButton>
      </div>
    </div>
  </div>
</template>
