<script setup lang="ts">
import type { TaskRecord, RunRecord } from '../../../shared/types/task-engine'
import { formatDateTime, formatRelativeCount } from '../../utils/taskEngine'

interface TaskListItem extends TaskRecord {
  plans?: Array<{
    id: string
    version: number
    created_at: string
  }>
  runs?: Array<Pick<RunRecord, 'id' | 'status' | 'started_at' | 'completed_at'>>
}

const statusColorMap = {
  active: 'success',
  paused: 'warning',
  archived: 'neutral'
} as const

const triggerColorMap = {
  manual: 'neutral',
  scheduled: 'primary',
  heartbeat: 'info'
} as const

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

  return {
    ...task,
    latestPlanVersion: plans[0]?.version ?? null,
    latestRun: runs[0] ?? null,
    planCount: plans.length,
    runCount: runs.length
  }
}))
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
            Create a task from natural language, generate a plan, and inspect the latest run state from one place.
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

      <UAlert
        v-if="error"
        color="error"
        variant="soft"
        title="Could not load tasks"
        :description="error.message"
      />

      <PageEmptyState
        v-else-if="!tasks.length && status !== 'pending'"
        title="No tasks yet"
        description="Create your first task to generate a plan and prepare the engine for execution."
        icon="i-lucide-list-checks"
      />

      <div v-else class="grid gap-4 xl:grid-cols-2">
        <UCard
          v-for="task in tasks"
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
                  <UBadge :color="statusColorMap[task.status]" variant="soft">
                    {{ task.status }}
                  </UBadge>
                  <UBadge :color="triggerColorMap[task.trigger_type]" variant="subtle">
                    {{ task.trigger_type }}
                  </UBadge>
                  <UBadge color="neutral" variant="outline">
                    {{ task.latestPlanVersion ? `Plan v${task.latestPlanVersion}` : 'No plan yet' }}
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

            <div class="grid gap-3 text-sm text-toned sm:grid-cols-2">
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
                <p>{{ task.latestRun ? `${task.latestRun.status} · ${formatDateTime(task.latestRun.started_at)}` : 'No runs yet' }}</p>
              </div>
              <div>
                <p class="font-medium text-highlighted">
                  Plans
                </p>
                <p>{{ formatRelativeCount(task.planCount, 'version') }}</p>
              </div>
              <div>
                <p class="font-medium text-highlighted">
                  Runs
                </p>
                <p>{{ formatRelativeCount(task.runCount, 'run') }}</p>
              </div>
            </div>
          </div>
        </UCard>
      </div>
    </div>
  </DashboardPage>
</template>
