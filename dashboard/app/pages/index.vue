<script setup lang="ts">
import type { ArtifactRecord, RunRecord } from '../../shared/types/task-engine'
import { formatRelativeTime, truncateText } from '../utils/taskEngine'

type ReviewResolution = 'approved' | 'rejected'
type PendingReviewAction = { id: string, status: ReviewResolution, comments?: string | null }

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
    output_artifact: Pick<ArtifactRecord, 'id' | 'title' | 'type' | 'content' | 'description' | 'storage_path' | 'created_at' | 'created_by_node_id'> | null
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

type FailedRunItem = DashboardData['failedRuns'][number]

const { refreshPendingReviewCount } = useDashboard()
const toast = useToast()

const greeting = computed(() => {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
})

const actionError = ref('')
const pendingTaskId = ref<string | null>(null)
const pendingReviewAction = ref<PendingReviewAction | null>(null)
const deletingRunId = ref<string | null>(null)
const hasLoadedDashboard = ref(false)

const { data, refresh, status } = await useFetch<DashboardData>('/api/dashboard', {
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

watchEffect(() => {
  if (status.value !== 'pending') {
    hasLoadedDashboard.value = true
  }
})

const stats = computed(() => data.value.stats)
const visibleFailedRuns = computed(() => data.value.failedRuns)
const hasAttention = computed(() => data.value.pendingReviews.length > 0 || visibleFailedRuns.value.length > 0)
const visiblePendingReviews = computed(() => data.value.pendingReviews.slice(0, 2))
const hiddenPendingReviewCount = computed(() => Math.max(0, stats.value.pendingReviewCount - visiblePendingReviews.value.length))
const isFirstUseDashboard = computed(() => !hasAttention.value
  && !data.value.recentWork.length
  && !data.value.upcomingJobs.length
  && !data.value.manualTasks.length
  && stats.value.totalTasks === 0)
const showInitialSkeleton = computed(() => status.value === 'pending' && !hasLoadedDashboard.value)

function formatUpcomingRun(nextRunAt: string | null) {
  if (!nextRunAt) {
    return 'No upcoming schedule'
  }

  return `Scheduled ${formatRelativeTime(nextRunAt)}`
}

async function startTask(taskId: string, options: { navigateOnSuccess?: boolean } = {}) {
  pendingTaskId.value = taskId
  actionError.value = ''

  try {
    const run = await $fetch<RunRecord>('/api/runs', {
      method: 'POST',
      body: { task_id: taskId }
    })

    if (options.navigateOnSuccess !== false) {
      await navigateTo(`/runs/${run.id}`)
    }

    return run
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : 'Failed to start the task.'
    return null
  } finally {
    pendingTaskId.value = null
  }
}

function removeFailedRunFromDashboard(runId: string) {
  const nextFailedRuns = data.value.failedRuns.filter(run => run.id !== runId)

  if (nextFailedRuns.length === data.value.failedRuns.length) {
    return
  }

  data.value = {
    ...data.value,
    failedRuns: nextFailedRuns,
    stats: {
      ...data.value.stats,
      failedRunCount: Math.max(0, data.value.stats.failedRunCount - 1)
    }
  }
}

function incrementLiveRunCount() {
  data.value = {
    ...data.value,
    stats: {
      ...data.value.stats,
      liveRunCount: data.value.stats.liveRunCount + 1
    }
  }
}

async function retryFailedRun(run: FailedRunItem) {
  const nextRun = await startTask(run.task_id, { navigateOnSuccess: false })

  if (!nextRun) {
    return
  }

  removeFailedRunFromDashboard(run.id)
  incrementLiveRunCount()

  toast.add({
    title: 'Retry started',
    description: `${run.task_title} is queued again.`,
    color: 'primary',
    icon: 'i-lucide-rotate-cw'
  })

  await nextTick()
  focusPrimaryDashboardTarget()
}

async function deleteFailedRun(run: FailedRunItem) {
  deletingRunId.value = run.id
  actionError.value = ''

  try {
    await $fetch(`/api/runs/${run.id}`, {
      method: 'DELETE'
    })

    removeFailedRunFromDashboard(run.id)

    toast.add({
      title: 'Failed run deleted',
      description: `${run.task_title} was removed from the dashboard.`,
      color: 'primary',
      icon: 'i-lucide-trash-2'
    })

    await nextTick()
    focusPrimaryDashboardTarget()
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : 'Failed to delete the run.'
  } finally {
    deletingRunId.value = null
  }
}

async function resolveReview(payload: PendingReviewAction) {
  pendingReviewAction.value = payload
  actionError.value = ''

  try {
    await $fetch(`/api/reviews/${payload.id}`, {
      method: 'PATCH',
      body: {
        status: payload.status,
        comments: payload.comments ?? null
      }
    })

    await Promise.all([
      refresh(),
      refreshPendingReviewCount()
    ])
    await nextTick()
    focusPrimaryDashboardTarget()
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : 'Failed to update the review.'
  } finally {
    pendingReviewAction.value = null
  }
}

function focusPrimaryDashboardTarget() {
  if (!import.meta.client) {
    return
  }

  window.requestAnimationFrame(() => {
    document.querySelector<HTMLElement>('[data-review-shortcut-target="true"], [data-first-use-cta="true"], [data-all-caught-up="true"]')?.focus()
  })
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
      {{ greeting }}. Catch up on what changed, what needs review, and what is scheduled next.
    </p>

    <div v-if="showInitialSkeleton" class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div class="space-y-4">
        <div class="h-24 animate-pulse rounded-xl border border-default bg-elevated/40" />
        <div class="h-48 animate-pulse rounded-xl border border-default bg-elevated/40" />
        <div class="h-40 animate-pulse rounded-xl border border-default bg-elevated/40" />
        <div class="h-52 animate-pulse rounded-xl border border-default bg-elevated/40" />
      </div>
      <aside class="space-y-4">
        <div class="h-11 animate-pulse rounded-xl bg-elevated/50" />
        <div class="h-36 animate-pulse rounded-xl border border-default bg-elevated/40" />
        <div class="h-40 animate-pulse rounded-xl border border-default bg-elevated/40" />
        <div class="h-44 animate-pulse rounded-xl border border-default bg-elevated/40" />
      </aside>
    </div>

    <div v-else class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
      <!-- Main feed column -->
      <div class="min-w-0 space-y-5">
        <PageEmptyState
          v-if="isFirstUseDashboard"
          title="Describe the work you repeat"
          description="Task Engine is strongest when it takes repetitive paperwork off your plate. Start by creating one task and the home page will begin filling with drafts, reviews, and completed documents."
          icon="i-lucide-sparkles"
          action-label="Create your first task"
          action-to="/tasks/new"
          action-icon="i-lucide-plus"
        />

        <!-- Attention: pending reviews -->
        <section v-if="visiblePendingReviews.length" class="space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="text-xs font-medium tracking-wide text-muted uppercase">
              Needs your review
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

          <TransitionGroup name="review-card" tag="div" class="space-y-3">
            <ReviewPreviewCard
              v-for="(review, index) in visiblePendingReviews"
              :key="review.id"
              :review="review"
              :data-review-shortcut-target="index === 0 ? 'true' : undefined"
              :pending-status="pendingReviewAction?.id === review.id ? pendingReviewAction.status : null"
              @resolve="resolveReview"
            />
          </TransitionGroup>
        </section>

        <!-- Attention: failed runs -->
        <section v-if="visibleFailedRuns.length" class="space-y-2">
          <h3 class="text-xs font-medium tracking-wide text-muted uppercase">
            Needs attention
          </h3>

          <TransitionGroup name="failed-run" tag="div" class="space-y-2">
            <div
              v-for="run in visibleFailedRuns"
              :key="run.id"
              class="flex items-center gap-3 rounded-2xl bg-error/5 p-3"
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
                  size="sm"
                  icon="i-lucide-rotate-cw"
                  :loading="pendingTaskId === run.task_id"
                  :disabled="deletingRunId === run.id"
                  :aria-label="`Retry task ${run.task_title}`"
                  @click="retryFailedRun(run)"
                >
                  Retry
                </UButton>
                <UButton
                  color="error"
                  variant="ghost"
                  size="sm"
                  icon="i-lucide-trash-2"
                  :loading="deletingRunId === run.id"
                  :disabled="pendingTaskId === run.task_id"
                  :aria-label="`Delete failed run for ${run.task_title}`"
                  @click="deleteFailedRun(run)"
                >
                  Delete
                </UButton>
              </div>
            </div>
          </TransitionGroup>
        </section>

        <!-- All clear -->
        <div
          v-if="!hasAttention && !isFirstUseDashboard"
          data-all-caught-up="true"
          tabindex="-1"
          class="flex items-center gap-3 rounded-2xl bg-success/5 p-3 text-sm text-muted"
        >
          <UIcon name="i-lucide-check-circle" class="size-4 shrink-0 text-[var(--color-success-500)]" />
          All caught up. No reviews or issues are waiting on you right now.
        </div>

        <!-- Recent work feed -->
        <section class="space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="text-xs font-medium tracking-wide text-muted uppercase">
              Recent activity
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
            description="Once a task produces a document, you'll see the latest activity here."
            icon="i-lucide-file-output"
            action-label="Create a task"
            action-to="/tasks/new"
            action-icon="i-lucide-plus"
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
          data-first-use-cta="true"
        >
          New Task
        </UButton>

        <!-- Quick run -->
        <section v-if="data.manualTasks.length" class="space-y-2">
          <h3 class="text-xs font-medium tracking-wide text-muted uppercase">
            Quick actions
          </h3>
          <div class="space-y-1 rounded-2xl bg-elevated/30 p-1.5">
            <button
              v-for="task in data.manualTasks"
              :key="task.id"
              type="button"
              class="flex min-h-11 w-full items-center gap-2.5 rounded-xl p-2.5 text-left transition hover:bg-elevated/70"
              :disabled="pendingTaskId === task.id"
              :aria-label="`Run task ${task.title}`"
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
              Schedules
            </UButton>
          </div>

          <div v-if="!data.upcomingJobs.length" class="rounded-2xl bg-elevated/30 px-3 py-4 text-center text-xs text-muted">
            No schedules yet
          </div>

          <div v-else class="space-y-1 rounded-2xl bg-elevated/30 p-1.5">
            <div
              v-for="job in data.upcomingJobs"
              :key="job.id"
              class="rounded-xl px-3 py-2.5"
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
          <div class="space-y-1 rounded-2xl bg-elevated/30 p-1.5">
            <NuxtLink
              to="/tasks"
              class="flex items-center justify-between rounded-xl px-3 py-2.5 text-sm transition hover:bg-elevated/70"
            >
              <span class="text-muted">Tasks</span>
              <span class="tabular-nums text-highlighted">{{ stats.activeTasks }} active</span>
            </NuxtLink>
            <NuxtLink
              to="/artifacts"
              class="flex items-center justify-between rounded-xl px-3 py-2.5 text-sm transition hover:bg-elevated/70"
            >
              <span class="text-muted">Documents</span>
              <span class="tabular-nums text-highlighted">{{ stats.totalArtifacts }}</span>
            </NuxtLink>
            <NuxtLink
              to="/reviews"
              class="flex items-center justify-between rounded-xl px-3 py-2.5 text-sm transition hover:bg-elevated/70"
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
              class="flex items-center justify-between rounded-xl px-3 py-2.5 text-sm transition hover:bg-elevated/70"
            >
              <span class="text-muted">Activity</span>
              <span class="tabular-nums text-highlighted">{{ stats.completedRunCount }}</span>
            </NuxtLink>
            <NuxtLink
              to="/jobs"
              class="flex items-center justify-between rounded-xl px-3 py-2.5 text-sm transition hover:bg-elevated/70"
            >
              <span class="text-muted">Schedules</span>
              <span class="tabular-nums text-highlighted">{{ stats.scheduledJobCount }}</span>
            </NuxtLink>
          </div>
        </section>
      </aside>
    </div>
  </DashboardPage>
</template>

<style scoped>
.review-card-enter-active,
.review-card-leave-active {
  transition: all 0.2s ease;
}

.review-card-enter-from,
.review-card-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.failed-run-enter-active,
.failed-run-leave-active {
  transition: all 0.2s ease;
}

.failed-run-enter-from,
.failed-run-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
