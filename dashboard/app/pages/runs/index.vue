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
  <DashboardPage title="Runs">
    <div class="space-y-6">
      <div class="flex items-center justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold text-highlighted">
            Run history
          </h2>
          <p class="mt-1 text-sm text-muted">
            Filter completed and in-flight executions, then jump into the run inspector for the detailed graph.
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
        title="Could not load runs"
        :description="error.message"
      />

      <PageEmptyState
        v-else-if="!visibleRuns.length && status !== 'pending'"
        title="No runs in this view"
        description="Change the status filter or trigger a task to create a new run."
        icon="i-lucide-play-circle"
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
              <p class="text-sm text-muted">
                {{ formatRelativeTime(run.started_at || run.completed_at) }}
              </p>
              <p class="text-sm text-muted">
                {{ run.plans?.version ? `Plan v${run.plans.version}` : 'No plan version attached' }} · {{ formatDuration(run.started_at, run.completed_at) }}
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
