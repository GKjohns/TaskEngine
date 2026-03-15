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

const { data, status, error, refresh } = await useFetch<ReviewListItem[]>('/api/reviews', {
  default: () => []
})
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
            Human approval routes are not active yet, but the Sprint 1 APIs already expose queued and resolved review records.
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

      <PageEmptyState
        v-else-if="!data?.length && status !== 'pending'"
        title="No reviews waiting"
        description="Human checkpoints will appear here once review nodes start pausing runs."
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
          </div>
        </UCard>
      </div>
    </div>
  </DashboardPage>
</template>
