<script setup lang="ts">
import type { ArtifactRecord } from '../../shared/types/task-engine'
import { artifactTypeColorMap, formatRelativeTime } from '../utils/taskEngine'

type ReviewResolution = 'approved' | 'rejected'
type ReviewResolvePayload = { id: string, status: ReviewResolution, comments?: string | null }

const props = withDefaults(defineProps<{
  review: {
    id: string
    run_id: string
    created_at: string
    task_title: string
    review_message: string | null
    node_type: string | null
    output_artifact: Pick<ArtifactRecord, 'id' | 'title' | 'type' | 'content' | 'description' | 'storage_path'> | null
  }
  pendingStatus?: ReviewResolution | null
}>(), {
  pendingStatus: null
})

const emit = defineEmits<{
  resolve: [payload: ReviewResolvePayload]
}>()

const router = useRouter()
const isRejecting = ref(false)
const rejectComment = ref('')

watch(() => props.review.id, () => {
  cancelReject()
})

function cancelReject() {
  isRejecting.value = false
  rejectComment.value = ''
}

function openFullReview() {
  router.push(`/runs/${props.review.run_id}`)
}
</script>

<template>
  <article
    class="rounded-2xl bg-warning/5 p-3.5 sm:p-4"
    tabindex="0"
    @keydown.enter.prevent="openFullReview"
  >
    <div class="flex items-start gap-3">
      <UIcon name="i-lucide-message-circle-warning" class="mt-0.5 size-4 shrink-0 text-[var(--color-warning-500)]" />
      <div class="min-w-0 flex-1 space-y-2">
        <div class="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
          <p class="truncate text-sm font-medium text-highlighted">
            {{ review.task_title }}
          </p>
          <span class="shrink-0 text-xs text-dimmed">{{ formatRelativeTime(review.created_at) }}</span>
        </div>
        <p class="text-sm text-muted">
          {{ review.review_message || 'A document is ready for your review.' }}
        </p>

        <div v-if="review.output_artifact" class="space-y-2">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-file-text" class="size-3.5 shrink-0 text-muted" />
            <p class="min-w-0 flex-1 truncate text-sm text-highlighted">
              {{ review.output_artifact.title }}
            </p>
            <UBadge
              :color="artifactTypeColorMap[review.output_artifact.type]"
              variant="soft"
              size="xs"
            >
              {{ review.output_artifact.type }}
            </UBadge>
          </div>
          <ArtifactPreview
            :artifact="{ ...review.output_artifact, created_at: review.created_at, task_title: review.task_title }"
            compact
            surface="plain"
            :show-header="false"
            :show-footer="false"
            :show-actions="false"
          />
        </div>

        <div v-if="!isRejecting" class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <UButton
            color="success"
            size="sm"
            :loading="pendingStatus === 'approved'"
            :aria-label="`Approve review for ${review.task_title}`"
            @click="emit('resolve', { id: review.id, status: 'approved' })"
          >
            Approve
          </UButton>
          <UButton
            color="error"
            variant="soft"
            size="sm"
            :loading="pendingStatus === 'rejected'"
            :aria-label="`Reject review for ${review.task_title}`"
            @click="isRejecting = true"
          >
            Reject
          </UButton>
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            :aria-label="`Open full review for ${review.task_title}`"
            @click="openFullReview"
          >
            Review in full
          </UButton>
        </div>

        <div
          v-else
          class="space-y-3 rounded-lg border border-error/30 bg-error/5 p-3"
        >
          <UFormField label="Reject comment (optional)">
            <UTextarea
              v-model="rejectComment"
              class="w-full"
              :rows="3"
              autoresize
              placeholder="Add context for why this should be revised or stopped."
            />
          </UFormField>

          <div class="flex items-center gap-2">
            <UButton
              color="error"
              size="sm"
              :loading="pendingStatus === 'rejected'"
              :aria-label="`Confirm rejection for ${review.task_title}`"
              @click="emit('resolve', { id: review.id, status: 'rejected', comments: rejectComment || null })"
            >
              Confirm reject
            </UButton>
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              :disabled="Boolean(pendingStatus)"
              @click="cancelReject"
            >
              Cancel
            </UButton>
          </div>
        </div>
      </div>
    </div>
  </article>
</template>
