<script setup lang="ts">
import type { ArtifactRecord, RunRecord } from '../../shared/types/task-engine'
import { formatRelativeTime, truncateText } from '../utils/taskEngine'

type ReviewResolution = 'approved' | 'rejected'
type PendingReviewAction = { id: string, status: ReviewResolution }

interface DashboardData {
  stats: {
    activeTasks: number
    pausedTasks: number
    totalTasks: number
    liveRunCount: number
    completedRunCount: number
    failedRunCount: number
    pendingReviewCount: number
    totalArtifacts: number
    scheduledJobCount: number
  }
  failedRuns: Array<{
    id: string
    task_id: string
    task_title: string
    error_message: string | null
    started_at: string | null
    completed_at: string | null
  }>
  pendingReviews: Array<{
    id: string
    run_id: string
    node_run_id: string
    created_at: string
    task_title: string
    review_message: string | null
    node_type: string | null
    output_artifact: Pick<ArtifactRecord, 'id' | 'title' | 'type' | 'content' | 'description' | 'storage_path'> | null
  }>
  recentWork: Array<{
    run_id: string
    task_id: string
    task_title: string
    completed_at: string | null
    summary: string
    output_artifact: Pick<ArtifactRecord, 'id' | 'title' | 'type'> | null
  }>
  upcomingJobs: Array<{
    id: string
    task_id: string
    status: string
    next_run_at: string | null
    title: string
  }>
  manualTasks: Array<{
    id: string
    title: string
  }>
}

const { refreshPendingReviewCount } = useDashboard()

const greeting = computed(() => {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
})

const actionError = ref('')
const pendingTaskId = ref<string | null>(null)
const pendingReviewAction = ref<PendingReviewAction | null>(null)

const { data, refresh } = await useFetch<DashboardData>('/api/dashboard', {
  default: (): DashboardData => ({
    stats: {
      activeTasks: 0,
      pausedTasks: 0,
      totalTasks: 0,
      liveRunCount: 0,
      completedRunCount: 0,
      failedRunCount: 0,
      pendingReviewCount: 0,
      totalArtifacts: 0,
      scheduledJobCount: 0
    },
    failedRuns: [],
    pendingReviews: [],
    recentWork: [],
    upcomingJobs: [],
    manualTasks: []
  })
})

const stats = computed(() => data.value.stats)
const hasAttention = computed(() => data.value.pendingReviews.length > 0 || data.value.failedRuns.length > 0)
const visiblePendingReviews = computed(() => data.value.pendingReviews.slice(0, 2))
const hiddenPendingReviewCount = computed(() => Math.max(0, stats.value.pendingReviewCount - visiblePendingReviews.value.length))

function formatUpcomingRun(nextRunAt: string | null) {
  if (!nextRunAt) {
    return 'No upcoming run scheduled'
  }

  return `Runs ${formatRelativeTime(nextRunAt)}`
}

async function startTask(taskId: string) {
  pendingTaskId.value = taskId
  actionError.value = ''

  try {
    const run = await $fetch<RunRecord>('/api/runs', {
      method: 'POST',
      body: { task_id: taskId }
    })

    await refresh()
    await navigateTo(`/runs/${run.id}`)
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : 'Failed to start the task.'
  } finally {
    pendingTaskId.value = null
  }
}

async function resolveReview(payload: PendingReviewAction) {
  pendingReviewAction.value = payload
  actionError.value = ''

  try {
    await $fetch(`/api/reviews/${payload.id}`, {
      method: 'PATCH',
      body: { status: payload.status }
    })

    await Promise.all([
      refresh(),
      refreshPendingReviewCount()
    ])
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : 'Failed to update the review.'
  } finally {
    pendingReviewAction.value = null
  }
}
</script>

<template>
  <DashboardPage title="Home">
    <UAlert
      v-if="actionError"
      color="error"
      variant="soft"
      :description="actionError"
      class="mb-4"
    />

    <p class="mb-5 text-sm text-muted">
      {{ greeting }}. Here's where things stand.
    </p>

    <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <!-- Main feed column -->
      <div class="min-w-0 space-y-5">
        <!-- Attention: pending reviews -->
        <section v-if="visiblePendingReviews.length" class="space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="text-xs font-medium tracking-wide text-muted uppercase">
              Pending reviews
            </h3>
            <UButton
              v-if="hiddenPendingReviewCount > 0"
              to="/reviews"
              color="neutral"
              variant="ghost"
              size="xs"
            >
              +{{ hiddenPendingReviewCount }} more
            </UButton>
          </div>

          <ReviewPreviewCard
            v-for="review in visiblePendingReviews"
            :key="review.id"
            :review="review"
            :pending-status="pendingReviewAction?.id === review.id ? pendingReviewAction.status : null"
            @resolve="resolveReview"
          />
        </section>

        <!-- Attention: failed runs -->
        <section v-if="data.failedRuns.length" class="space-y-2">
          <h3 class="text-xs font-medium tracking-wide text-muted uppercase">
            Failed
          </h3>

          <div class="divide-y divide-default rounded-xl border border-default">
            <div
              v-for="run in data.failedRuns"
              :key="run.id"
              class="flex items-center gap-3 p-3 first:rounded-t-xl last:rounded-b-xl"
            >
              <UIcon name="i-lucide-circle-x" class="size-4 shrink-0 text-[var(--color-error-500)]" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-highlighted">
                  {{ run.task_title }}
                </p>
                <p class="truncate text-xs text-muted">
                  {{ truncateText(run.error_message || 'No error details', 80) }} · {{ formatRelativeTime(run.completed_at || run.started_at) }}
                </p>
              </div>
              <div class="flex shrink-0 gap-1.5">
                <UButton
                  color="error"
                  variant="soft"
                  size="xs"
                  icon="i-lucide-rotate-cw"
                  :loading="pendingTaskId === run.task_id"
                  @click="startTask(run.task_id)"
                >
                  Retry
                </UButton>
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  :to="`/runs/${run.id}`"
                >
                  View
                </UButton>
              </div>
            </div>
          </div>
        </section>

        <!-- All clear -->
        <div
          v-if="!hasAttention"
          class="flex items-center gap-3 rounded-xl border border-default p-3 text-sm text-muted"
        >
          <UIcon name="i-lucide-check-circle" class="size-4 shrink-0 text-[var(--color-success-500)]" />
          All caught up. No reviews or issues pending.
        </div>

        <!-- Recent work feed -->
        <section class="space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="text-xs font-medium tracking-wide text-muted uppercase">
              Recent work
            </h3>
            <UButton
              to="/runs"
              color="neutral"
              variant="ghost"
              size="xs"
              trailing-icon="i-lucide-arrow-right"
            >
              All activity
            </UButton>
          </div>

          <PageEmptyState
            v-if="!data.recentWork.length"
            title="No completed work yet"
            description="Run a task to start building your feed."
            icon="i-lucide-file-output"
          />

          <div v-else class="space-y-3">
            <WorkFeedItem
              v-for="item in data.recentWork"
              :key="item.run_id"
              :item="item"
            />
          </div>
        </section>
      </div>

      <!-- Right sidebar -->
      <aside class="space-y-5">
        <!-- New task CTA -->
        <UButton
          to="/tasks/new"
          color="primary"
          block
          icon="i-lucide-plus"
        >
          New Task
        </UButton>

        <!-- Quick run -->
        <section v-if="data.manualTasks.length" class="space-y-2">
          <h3 class="text-xs font-medium tracking-wide text-muted uppercase">
            Quick run
          </h3>
          <div class="divide-y divide-default rounded-xl border border-default">
            <button
              v-for="task in data.manualTasks"
              :key="task.id"
              type="button"
              class="flex w-full items-center gap-2.5 p-2.5 text-left transition first:rounded-t-xl last:rounded-b-xl hover:bg-elevated/60"
              :disabled="pendingTaskId === task.id"
              @click="startTask(task.id)"
            >
              <UIcon name="i-lucide-play" class="size-3.5 shrink-0 text-muted" />
              <span class="min-w-0 flex-1 truncate text-sm text-highlighted">{{ task.title }}</span>
              <UIcon
                v-if="pendingTaskId === task.id"
                name="i-lucide-loader"
                class="size-3.5 shrink-0 animate-spin text-muted"
              />
            </button>
          </div>
        </section>

        <!-- Coming up -->
        <section class="space-y-2">
          <div class="flex items-center justify-between">
            <h3 class="text-xs font-medium tracking-wide text-muted uppercase">
              Coming up
            </h3>
            <UButton
              to="/jobs"
              color="neutral"
              variant="ghost"
              size="xs"
            >
              All
            </UButton>
          </div>

          <div v-if="!data.upcomingJobs.length" class="rounded-xl border border-dashed border-default px-3 py-4 text-center text-xs text-muted">
            No scheduled work
          </div>

          <div v-else class="divide-y divide-default rounded-xl border border-default">
            <div
              v-for="job in data.upcomingJobs"
              :key="job.id"
              class="px-3 py-2.5"
            >
              <p class="truncate text-sm text-highlighted">
                {{ job.title }}
              </p>
              <p class="text-xs text-muted">
                {{ formatUpcomingRun(job.next_run_at) }}
              </p>
            </div>
          </div>
        </section>

        <!-- Navigate -->
        <section class="space-y-2">
          <h3 class="text-xs font-medium tracking-wide text-muted uppercase">
            Navigate
          </h3>
          <div class="divide-y divide-default rounded-xl border border-default">
            <NuxtLink
              to="/tasks"
              class="flex items-center justify-between px-3 py-2.5 text-sm transition first:rounded-t-xl last:rounded-b-xl hover:bg-elevated/60"
            >
              <span class="text-muted">Tasks</span>
              <span class="tabular-nums text-highlighted">{{ stats.activeTasks }} active</span>
            </NuxtLink>
            <NuxtLink
              to="/artifacts"
              class="flex items-center justify-between px-3 py-2.5 text-sm transition first:rounded-t-xl last:rounded-b-xl hover:bg-elevated/60"
            >
              <span class="text-muted">Documents</span>
              <span class="tabular-nums text-highlighted">{{ stats.totalArtifacts }}</span>
            </NuxtLink>
            <NuxtLink
              to="/reviews"
              class="flex items-center justify-between px-3 py-2.5 text-sm transition first:rounded-t-xl last:rounded-b-xl hover:bg-elevated/60"
            >
              <span class="text-muted">Reviews</span>
              <UBadge
                v-if="stats.pendingReviewCount"
                color="warning"
                variant="soft"
                size="xs"
              >
                {{ stats.pendingReviewCount }}
              </UBadge>
              <span v-else class="tabular-nums text-highlighted">0</span>
            </NuxtLink>
            <NuxtLink
              to="/runs"
              class="flex items-center justify-between px-3 py-2.5 text-sm transition first:rounded-t-xl last:rounded-b-xl hover:bg-elevated/60"
            >
              <span class="text-muted">Activity</span>
              <span class="tabular-nums text-highlighted">{{ stats.completedRunCount }}</span>
            </NuxtLink>
          </div>
        </section>
      </aside>
    </div>
  </DashboardPage>
</template>
