<script setup lang="ts">
import type { ArtifactRecord, ReviewRecord } from '../../../shared/types/task-engine'

type ReviewArtifact = Pick<ArtifactRecord, 'id' | 'title' | 'type' | 'content' | 'description' | 'storage_path' | 'created_at'> & {
  task_title?: string | null
  produced_by_run_id?: string | null
  download_url?: string | null
}

interface ReviewListItem extends ReviewRecord {
  task_id: string | null
  task_title: string
  review_message: string | null
  node_key: string | null
  node_type: string | null
  output_artifact: ReviewArtifact | null
}

const pendingReviewId = ref<string | null>(null)
const actionError = ref('')
const taskFilter = ref<'all' | string>('all')
const { refreshPendingReviewCount } = useDashboard()

const { data, status, error, refresh } = await useFetch<ReviewListItem[]>('/api/reviews', {
  default: () => []
})

const taskFilterOptions = computed(() => {
  const taskMap = new Map<string, string>()

  for (const review of data.value || []) {
    if (review.task_id) {
      taskMap.set(review.task_id, review.task_title)
    }
  }

  return [
    { label: 'All tasks', value: 'all' },
    ...[...taskMap.entries()].map(([value, label]) => ({ label, value }))
  ]
})

const filteredReviews = computed(() => (data.value || []).filter(review =>
  taskFilter.value === 'all' || review.task_id === taskFilter.value
))

const pendingReviews = computed(() => filteredReviews.value.filter(review => review.status === 'pending'))
const resolvedReviews = computed(() => filteredReviews.value.filter(review => review.status !== 'pending'))

async function resolveReview(payload: {
  id: string
  status: 'approved' | 'rejected' | 'edited'
  comments?: string | null
  artifactId?: string | null
  artifactContent?: string | null
}) {
  pendingReviewId.value = payload.id
  actionError.value = ''

  try {
    await $fetch(`/api/reviews/${payload.id}`, {
      method: 'PATCH',
      body: {
        status: payload.status,
        comments: payload.comments ?? null,
        artifact_id: payload.artifactId ?? null,
        artifact_content: payload.artifactContent ?? null
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
      <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 class="text-base font-semibold text-highlighted">
            Review inbox
          </h2>
          <p class="mt-1 text-sm text-muted">
            Open the draft, make changes inline when needed, and resolve reviews without leaving the inbox.
          </p>
        </div>

        <div class="flex flex-col gap-2 sm:flex-row sm:items-end">
          <UFormField label="Filter by task">
            <USelect
              v-model="taskFilter"
              :items="taskFilterOptions"
              class="min-w-64"
            />
          </UFormField>
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
        v-else-if="status === 'pending'"
        title="Loading reviews"
        description="Gathering drafts that are waiting for your decision."
        icon="i-lucide-loader-circle"
      />

      <PageEmptyState
        v-else-if="!filteredReviews.length"
        title="No reviews in this view"
        description="Try a different task filter or wait for the next draft to pause for review."
        icon="i-lucide-message-circle-warning"
        action-label="Create a task"
        action-to="/tasks/new"
        action-icon="i-lucide-plus"
      />

      <template v-else>
        <section class="space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="text-xs font-medium tracking-wide text-muted uppercase">
              Pending
            </h3>
            <span class="text-xs text-dimmed">{{ pendingReviews.length }} waiting</span>
          </div>

          <PageEmptyState
            v-if="!pendingReviews.length"
            title="Inbox clear"
            description="Nothing is waiting for approval right now."
            icon="i-lucide-check-check"
          />

          <div v-else class="space-y-3">
            <ReviewCard
              v-for="review in pendingReviews"
              :key="review.id"
              :review="review"
              :pending="pendingReviewId === review.id"
              @resolve="resolveReview"
            />
          </div>
        </section>

        <section v-if="resolvedReviews.length" class="space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="text-xs font-medium tracking-wide text-muted uppercase">
              Resolved
            </h3>
            <span class="text-xs text-dimmed">{{ resolvedReviews.length }} completed</span>
          </div>

          <div class="space-y-3">
            <ReviewCard
              v-for="review in resolvedReviews"
              :key="review.id"
              :review="review"
              :resolved="true"
            />
          </div>
        </section>
      </template>
    </div>
  </DashboardPage>
</template>
