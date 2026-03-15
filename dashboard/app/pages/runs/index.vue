<script setup lang="ts">
import type { RunRecord } from '../../../shared/types/task-engine'
import { formatDateTime } from '../../utils/taskEngine'

interface RunListItem extends RunRecord {
  tasks?: { title: string } | null
  plans?: { version: number } | null
}

const statusColorMap = {
  pending: 'neutral',
  running: 'primary',
  waiting_review: 'warning',
  completed: 'success',
  failed: 'error',
  cancelled: 'neutral'
} as const

const { data, status, error, refresh } = await useFetch<RunListItem[]>('/api/runs', {
  default: () => []
})
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
            Sprint 1 exposes the run records and related task metadata even before the runtime is fully built.
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
        title="Could not load runs"
        :description="error.message"
      />

      <PageEmptyState
        v-else-if="!data?.length && status !== 'pending'"
        title="No runs yet"
        description="Runs will appear here once task execution starts in the next sprint."
        icon="i-lucide-play-circle"
      />

      <div v-else class="space-y-3">
        <NuxtLink
          v-for="run in data"
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
                Status recorded {{ formatDateTime(run.started_at || run.completed_at) }}
              </p>
              <p class="text-sm text-muted">
                {{ run.plans?.version ? `Plan v${run.plans.version}` : 'No plan version attached' }}
              </p>
            </div>

            <UBadge :color="statusColorMap[run.status]" variant="soft">
              {{ run.status }}
            </UBadge>
          </div>
        </NuxtLink>
      </div>
    </div>
  </DashboardPage>
</template>
