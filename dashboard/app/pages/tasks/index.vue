<script setup lang="ts">
import type { ArtifactRecord, JobRecord, PlanRecord, RunRecord, TaskRecord } from '../../../shared/types/task-engine'
import {
  formatDateTime,
  formatRelativeCount,
  formatRelativeTime,
  taskStatusColorMap
} from '../../utils/taskEngine'

interface TaskListItem extends TaskRecord {
  current_plan?: Pick<PlanRecord, 'id' | 'title' | 'version'> | null
  plans?: Array<{
    id: string
    version: number
    created_at: string
  }>
  runs?: Array<Pick<RunRecord, 'id' | 'status' | 'started_at' | 'completed_at'>>
  jobs?: Array<Pick<JobRecord, 'id' | 'job_type' | 'status' | 'next_run_at' | 'last_run_at' | 'last_error'>>
  latest_output_artifact?: ArtifactRecord | null
}

const triggerColorMap = {
  manual: 'neutral',
  scheduled: 'primary',
  heartbeat: 'info'
} as const

const filters = ['all', 'active', 'paused', 'archived'] as const
const activeFilter = ref<'all' | 'active' | 'paused' | 'archived'>('active')
const pendingTaskId = ref<string | null>(null)
const actionError = ref('')

const { data, status, error, refresh } = await useFetch<TaskListItem[]>('/api/tasks', {
  default: () => []
})

const tasks = computed(() => (data.value || []).map((task) => {
  const plans = [...(task.plans || [])].sort((a, b) => b.version - a.version)
  const runs = [...(task.runs || [])].sort((a, b) => {
    const aTime = a.started_at ? new Date(a.started_at).getTime() : 0
    const bTime = b.started_at ? new Date(b.started_at).getTime() : 0
    return bTime - aTime
  })

  const currentPlan = task.current_plan || (plans[0] ? { id: plans[0].id, title: null, version: plans[0].version } : null)

  return {
    ...task,
    currentPlan,
    latestPlanVersion: currentPlan?.version ?? plans[0]?.version ?? null,
    latestRun: runs[0] ?? null,
    primaryJob: (task.jobs || [])[0] ?? null,
    planCount: plans.length,
    runCount: runs.length
  }
}))

const visibleTasks = computed(() => tasks.value.filter(task =>
  activeFilter.value === 'all' ? true : task.status === activeFilter.value
))

async function updateTask(taskId: string, payload: Partial<Pick<TaskRecord, 'status'>>) {
  pendingTaskId.value = taskId
  actionError.value = ''

  try {
    await $fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      body: payload
    })
    await refresh()
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : 'Failed to update the task.'
  } finally {
    pendingTaskId.value = null
  }
}

async function onRunStarted() {
  await refresh()
}
</script>

<template>
  <DashboardPage title="Tasks">
    <div class="space-y-6">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 class="text-base font-semibold text-highlighted">
            Your task library
          </h2>
          <p class="mt-1 text-sm text-muted">
            Filter active work, inspect the latest workflow version, and launch activity directly from one view.
          </p>
        </div>

        <div class="flex items-center gap-3">
          <UButton
            color="neutral"
            variant="soft"
            icon="i-lucide-refresh-cw"
            :loading="status === 'pending'"
            @click="refresh()"
          >
            Refresh
          </UButton>
          <UButton to="/tasks/new" icon="i-lucide-plus">
            New task
          </UButton>
        </div>
      </div>

      <div class="flex flex-wrap gap-2">
        <UButton
          v-for="filter in filters"
          :key="filter"
          color="neutral"
          size="sm"
          :variant="activeFilter === filter ? 'solid' : 'soft'"
          @click="activeFilter = filter"
        >
          {{ filter }}
        </UButton>
      </div>

      <UAlert
        v-if="error"
        color="error"
        variant="soft"
        title="Could not load tasks"
        :description="error.message"
      />
      <UAlert
        v-else-if="actionError"
        color="error"
        variant="soft"
        title="Task action failed"
        :description="actionError"
      />

      <PageEmptyState
        v-else-if="!visibleTasks.length && status !== 'pending'"
        title="No tasks in this view"
        description="Create a task or switch filters to see more work."
        icon="i-lucide-list-checks"
      />

      <div v-else class="grid gap-4 xl:grid-cols-2">
        <UCard
          v-for="task in visibleTasks"
          :key="task.id"
          class="border border-default"
        >
          <div class="space-y-4">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div class="space-y-2">
                <NuxtLink :to="`/tasks/${task.id}`" class="text-base font-semibold text-highlighted hover:text-primary">
                  {{ task.title }}
                </NuxtLink>
                <div class="flex flex-wrap items-center gap-2">
                  <UBadge :color="taskStatusColorMap[task.status]" variant="soft">
                    {{ task.status }}
                  </UBadge>
                  <UBadge :color="triggerColorMap[task.trigger_type]" variant="subtle">
                    {{ task.trigger_type }}
                  </UBadge>
                  <NuxtLink
                    v-if="task.currentPlan"
                    :to="`/plans/${task.currentPlan.id}`"
                    class="hover:opacity-80 transition"
                    @click.stop
                  >
                    <UBadge color="primary" variant="outline">
                      {{ task.currentPlan.title || `Workflow v${task.latestPlanVersion}` }}
                    </UBadge>
                  </NuxtLink>
                  <UBadge v-else color="neutral" variant="outline">
                    No workflow yet
                  </UBadge>
                </div>
              </div>

              <UButton
                color="neutral"
                variant="ghost"
                :to="`/tasks/${task.id}`"
                trailing-icon="i-lucide-arrow-right"
              >
                Open
              </UButton>
            </div>

            <p class="line-clamp-3 text-sm text-muted">
              {{ task.prompt }}
            </p>

            <div v-if="task.latest_output_artifact" class="space-y-2">
              <p class="text-sm font-medium text-highlighted">
                Latest completed output
              </p>
              <div class="flex flex-wrap items-center gap-2">
                <NuxtLink :to="`/artifacts/${task.latest_output_artifact.id}`" class="text-sm text-primary hover:underline">
                  {{ task.latest_output_artifact.title }}
                </NuxtLink>
                <UBadge color="neutral" variant="soft" size="xs">
                  {{ task.latest_output_artifact.type }}
                </UBadge>
              </div>
              <ArtifactPreview
                :artifact="task.latest_output_artifact"
                compact
                surface="plain"
                :show-header="false"
                :show-footer="false"
                :show-actions="false"
              />
            </div>

            <div class="grid gap-3 text-sm text-toned sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <p class="font-medium text-highlighted">
                  Created
                </p>
                <p>{{ formatDateTime(task.created_at) }}</p>
              </div>
              <div>
                <p class="font-medium text-highlighted">
                  Latest run
                </p>
                <p>{{ task.latestRun ? `${task.latestRun.status} · ${formatRelativeTime(task.latestRun.started_at)}` : 'No activity yet' }}</p>
              </div>
              <div>
                <p class="font-medium text-highlighted">
                  Next schedule
                </p>
                <p>{{ formatDateTime(task.primaryJob?.next_run_at) }}</p>
              </div>
              <div>
                <p class="font-medium text-highlighted">
                  Workflows
                </p>
                <p>{{ formatRelativeCount(task.planCount, 'version') }}</p>
              </div>
              <div>
                <p class="font-medium text-highlighted">
                  Activity
                </p>
                <p>{{ formatRelativeCount(task.runCount, 'activity item', 'activity items') }}</p>
              </div>
              <div>
                <p class="font-medium text-highlighted">
                  Latest schedule
                </p>
                <p>{{ task.primaryJob?.status || 'Not scheduled' }}</p>
              </div>
            </div>

            <div class="flex flex-wrap gap-2 border-t border-default pt-4">
              <RunTaskModal
                v-if="task.status !== 'archived' && task.latestPlanVersion"
                :task-id="task.id"
                :task-artifact-ids="task.input_artifact_ids"
                :task-title="task.title"
                :task-prompt="task.prompt"
                compact
                @started="onRunStarted"
              />
              <UButton
                v-if="task.status === 'active' && (task.trigger_type !== 'manual' || ['scheduled', 'running', 'waiting_review'].includes(task.primaryJob?.status ?? ''))"
                color="warning"
                variant="soft"
                size="sm"
                :loading="pendingTaskId === task.id"
                @click="updateTask(task.id, { status: 'paused' })"
              >
                Pause
              </UButton>
              <UButton
                v-if="task.status === 'paused'"
                color="success"
                variant="soft"
                size="sm"
                :loading="pendingTaskId === task.id"
                @click="updateTask(task.id, { status: 'active' })"
              >
                Resume
              </UButton>
              <UButton
                v-if="task.status === 'archived'"
                color="success"
                variant="soft"
                size="sm"
                :loading="pendingTaskId === task.id"
                @click="updateTask(task.id, { status: 'active' })"
              >
                Restore
              </UButton>
              <UButton
                v-if="task.status !== 'archived'"
                color="neutral"
                variant="soft"
                size="sm"
                :loading="pendingTaskId === task.id"
                @click="updateTask(task.id, { status: 'archived' })"
              >
                Archive
              </UButton>
            </div>
          </div>
        </UCard>
      </div>
    </div>
  </DashboardPage>
</template>
