<script setup lang="ts">
import type { ReviewRecord } from '../../../shared/types/task-engine'
import { formatDateTime } from '../../utils/taskEngine'

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

const statusColorMap = {
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
  edited: 'info'
} as const

const pendingReviewId = ref<string | null>(null)
const actionError = ref('')

const { data, status, error, refresh } = await useFetch<ReviewListItem[]>('/api/reviews', {
  default: () => []
})

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
    await refresh()
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
            Review nodes now pause active runs until you approve, reject, or send them back for edits.
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
        <UCard
          v-for="review in data"
          :key="review.id"
          class="border border-default"
        >
          <div class="space-y-3">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p class="font-medium text-highlighted">
                  {{ review.runs?.tasks?.title || review.id }}
                </p>
                <p class="mt-1 text-sm text-muted">
                  {{ review.node_runs?.node_key ? `${review.node_runs.node_key} · ${review.node_runs.node_type}` : 'Node details unavailable' }}
                </p>
              </div>

              <UBadge :color="statusColorMap[review.status]" variant="soft">
                {{ review.status }}
              </UBadge>
            </div>

            <div class="text-sm text-muted">
              <p>
                Created {{ formatDateTime(review.created_at) }}
              </p>
              <p>
                Resolved {{ formatDateTime(review.resolved_at) }}
              </p>
              <p v-if="review.comments">
                Comments: {{ review.comments }}
              </p>
            </div>

            <div v-if="review.status === 'pending'" class="flex flex-wrap gap-2">
              <UButton
                color="success"
                :loading="pendingReviewId === review.id"
                @click="resolveReview(review.id, 'approved')"
              >
                Approve
              </UButton>
              <UButton
                color="info"
                variant="soft"
                :loading="pendingReviewId === review.id"
                @click="resolveReview(review.id, 'edited')"
              >
                Request edits
              </UButton>
              <UButton
                color="error"
                variant="soft"
                :loading="pendingReviewId === review.id"
                @click="resolveReview(review.id, 'rejected')"
              >
                Reject
              </UButton>
            </div>
          </div>
        </UCard>
      </div>
    </div>
  </DashboardPage>
</template>
