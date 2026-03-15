<script setup lang="ts">
import type { ArtifactRecord, ReviewRecord } from '../../../shared/types/task-engine'

interface ReviewListItem extends ReviewRecord {
  runs?: {
    id: string
    task_id: string
    tasks?: { title: string } | null
  } | null
  node_runs?: {
    node_key: string
    node_type: string
  } | null
}

const pendingReviewId = ref<string | null>(null)
const actionError = ref('')
const { refreshPendingReviewCount } = useDashboard()

const { data, status, error, refresh } = await useFetch<ReviewListItem[]>('/api/reviews', {
  default: () => []
})

const { data: artifacts } = await useFetch<ArtifactRecord[]>('/api/artifacts', {
  default: () => []
})

function outputArtifactForReview(review: ReviewListItem) {
  return (artifacts.value || []).find(artifact => artifact.created_by_node_id === review.node_run_id) || null
}

async function resolveReview(reviewId: string, nextStatus: 'approved' | 'rejected' | 'edited') {
  pendingReviewId.value = reviewId
  actionError.value = ''

  try {
    await $fetch(`/api/reviews/${reviewId}`, {
      method: 'PATCH',
      body: {
        status: nextStatus
      }
    })
    await Promise.all([refresh(), refreshPendingReviewCount()])
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : 'Failed to resolve the review.'
  } finally {
    pendingReviewId.value = null
  }
}
</script>

<template>
  <DashboardPage title="Reviews">
    <div class="space-y-6">
      <div class="flex items-center justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold text-highlighted">
            Review inbox
          </h2>
          <p class="mt-1 text-sm text-muted">
            Pending review nodes pause runs until you approve, reject, or request another edit pass.
          </p>
        </div>

        <UButton
          color="neutral"
          variant="soft"
          icon="i-lucide-refresh-cw"
          :loading="status === 'pending'"
          @click="refresh()"
        >
          Refresh
        </UButton>
      </div>

      <UAlert
        v-if="error"
        color="error"
        variant="soft"
        title="Could not load reviews"
        :description="error.message"
      />
      <UAlert
        v-else-if="actionError"
        color="error"
        variant="soft"
        title="Review action failed"
        :description="actionError"
      />

      <PageEmptyState
        v-else-if="!data?.length && status !== 'pending'"
        title="No reviews waiting"
        description="Runs will appear here whenever a review node asks for human approval."
        icon="i-lucide-message-circle-warning"
      />

      <div v-else class="space-y-3">
        <ReviewCard
          v-for="review in data"
          :key="review.id"
          :review="review"
          :output-artifact="outputArtifactForReview(review)"
          :pending="pendingReviewId === review.id"
          @resolve="resolveReview($event.id, $event.status)"
        />
      </div>
    </div>
  </DashboardPage>
</template>
