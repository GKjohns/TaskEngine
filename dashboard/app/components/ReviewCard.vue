<script setup lang="ts">
import type { ArtifactRecord, ReviewRecord } from '../../shared/types/task-engine'
import { formatDateTime, reviewStatusColorMap } from '../utils/taskEngine'

interface ReviewCardReview extends ReviewRecord {
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

defineProps<{
  review: ReviewCardReview
  outputArtifact?: ArtifactRecord | null
  pending?: boolean
}>()

const emit = defineEmits<{
  resolve: [payload: { id: string, status: 'approved' | 'rejected' | 'edited' }]
}>()
</script>

<template>
  <UCard class="border border-default">
    <div class="space-y-4">
      <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p class="font-semibold text-highlighted">
            {{ review.runs?.tasks?.title || review.id }}
          </p>
          <p class="mt-1 text-sm text-muted">
            {{ review.node_runs?.node_key ? `${review.node_runs.node_key} · ${review.node_runs.node_type}` : 'Node details unavailable' }}
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

      <div v-if="review.comments">
        <ContentRenderer :content="review.comments" compact />
      </div>

      <div v-if="outputArtifact" class="space-y-2">
        <p class="text-sm font-medium text-highlighted">
          Pending output
        </p>
        <ArtifactPreview :artifact="outputArtifact" compact />
      </div>

      <div v-if="review.status === 'pending'" class="flex flex-wrap gap-2">
        <UButton
          color="success"
          size="sm"
          :loading="pending"
          @click="emit('resolve', { id: review.id, status: 'approved' })"
        >
          Approve
        </UButton>
        <UButton
          color="info"
          variant="soft"
          size="sm"
          :loading="pending"
          @click="emit('resolve', { id: review.id, status: 'edited' })"
        >
          Request edits
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
  </UCard>
</template>
