<script setup lang="ts">
import type { RunRecord } from '../../../shared/types/task-engine'
import { formatDuration, formatRelativeTime, runStatusColorMap } from '../../utils/taskEngine'

interface RunListItem extends RunRecord {
  tasks?: { title: string } | null
  plans?: { version: number } | null
}

const filters = ['all', 'running', 'waiting_review', 'completed', 'failed', 'cancelled'] as const
const activeFilter = ref<(typeof filters)[number]>('all')

const { data, status, error, refresh } = await useFetch<RunListItem[]>('/api/runs', {
  default: () => []
})

const visibleRuns = computed(() => (data.value || []).filter(run =>
  activeFilter.value === 'all' ? true : run.status === activeFilter.value
))
</script>

<template>
  <DashboardPage title="Activity" content-width="narrow">
    <div class="space-y-6">
      <div class="flex items-center justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold text-highlighted">
            Activity history
          </h2>
          <p class="mt-1 text-sm text-muted">
            Follow recent work as it moves from in progress to review and completion.
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
        title="Could not load activity"
        :description="error.message"
      />

      <div v-else-if="status === 'pending'" class="space-y-3">
        <div
          v-for="index in 4"
          :key="index"
          class="h-28 animate-pulse rounded-xl border border-default bg-elevated/40"
        />
      </div>

      <PageEmptyState
        v-else-if="!visibleRuns.length"
        title="No activity in this view"
        description="Change the status filter or run a task to create your first activity."
        icon="i-lucide-play-circle"
        action-label="Create a task"
        action-to="/tasks/new"
        action-icon="i-lucide-plus"
      />

      <div v-else class="space-y-3">
        <NuxtLink
          v-for="run in visibleRuns"
          :key="run.id"
          :to="`/runs/${run.id}`"
          class="block rounded-xl border border-default bg-default p-4 transition hover:border-primary/50 hover:bg-elevated/60"
        >
          <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div class="space-y-1">
              <p class="font-medium text-highlighted">
                {{ run.tasks?.title || run.id }}
              </p>
              <p v-if="run.description" class="text-sm text-muted line-clamp-2">
                {{ run.description }}
              </p>
              <p class="text-sm text-dimmed">
                {{ formatRelativeTime(run.started_at || run.completed_at) }}
                · {{ run.plans?.version ? `Workflow v${run.plans.version}` : 'No workflow version attached' }}
                · {{ formatDuration(run.started_at, run.completed_at) }}
              </p>
            </div>

            <UBadge :color="runStatusColorMap[run.status]" variant="soft">
              {{ run.status }}
            </UBadge>
          </div>
        </NuxtLink>
      </div>
    </div>
  </DashboardPage>
</template>
