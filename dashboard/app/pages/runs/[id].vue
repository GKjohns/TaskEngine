<script setup lang="ts">
import type { NodeRunRecord, ReviewRecord, RunRecord } from '../../../shared/types/task-engine'
import { formatDateTime } from '../../utils/taskEngine'

interface RunDetail extends RunRecord {
  tasks?: { title: string, prompt: string } | null
  plans?: { version: number, plan_json: { nodes: Array<{ id: string, type: string }> } } | null
  node_runs?: NodeRunRecord[]
  reviews?: ReviewRecord[]
}

const route = useRoute()
const runId = computed(() => route.params.id as string)

const statusColorMap = {
  pending: 'neutral',
  running: 'primary',
  waiting_review: 'warning',
  completed: 'success',
  failed: 'error',
  cancelled: 'neutral'
} as const

const nodeStatusColorMap = {
  pending: 'neutral',
  running: 'primary',
  waiting_review: 'warning',
  completed: 'success',
  failed: 'error',
  skipped: 'neutral'
} as const

const { data, error, refresh, status } = await useFetch<RunDetail>(`/api/runs/${runId.value}`, {
  key: `run-${runId.value}`
})
</script>

<template>
  <DashboardPage :title="data?.tasks?.title || `Run ${runId}`">
    <div class="space-y-6">
      <div class="flex items-center justify-between gap-3">
        <div>
          <div class="flex flex-wrap items-center gap-2">
            <UBadge v-if="data" :color="statusColorMap[data.status]" variant="soft">
              {{ data.status }}
            </UBadge>
            <UBadge v-if="data?.plans?.version" color="neutral" variant="outline">
              {{ `Plan v${data.plans.version}` }}
            </UBadge>
          </div>
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
        title="Could not load run"
        :description="error.message"
      />

      <UCard v-if="data?.tasks?.prompt" class="border border-default">
        <div class="space-y-4">
          <div>
            <h2 class="text-base font-semibold text-highlighted">
              Source prompt
            </h2>
            <p class="mt-1 text-sm text-muted">
              The task prompt associated with this run.
            </p>
          </div>

          <ReadOnlyMarkdown :content="data.tasks.prompt" format="text" />
        </div>
      </UCard>

      <div v-if="data" class="grid gap-4 xl:grid-cols-[0.8fr,1.2fr]">
        <UCard class="border border-default">
          <div class="space-y-4">
            <h2 class="text-base font-semibold text-highlighted">
              Run summary
            </h2>

            <div class="space-y-2 text-sm text-muted">
              <p>
                Started {{ formatDateTime(data.started_at) }}
              </p>
              <p>
                Completed {{ formatDateTime(data.completed_at) }}
              </p>
              <p v-if="data.error_message">
                Error: {{ data.error_message }}
              </p>
              <p>
                {{ data.reviews?.length || 0 }} review record(s)
              </p>
            </div>
          </div>
        </UCard>

        <UCard class="border border-default">
          <div class="space-y-4">
            <h2 class="text-base font-semibold text-highlighted">
              Node runs
            </h2>

            <div v-if="data.node_runs?.length" class="space-y-3">
              <div
                v-for="nodeRun in data.node_runs"
                :key="nodeRun.id"
                class="rounded-xl border border-default p-4"
              >
                <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p class="font-medium text-highlighted">
                      {{ nodeRun.node_key }}
                    </p>
                    <p class="mt-1 text-sm text-muted">
                      {{ nodeRun.node_type }}
                    </p>
                  </div>

                  <UBadge :color="nodeStatusColorMap[nodeRun.status]" variant="soft">
                    {{ nodeRun.status }}
                  </UBadge>
                </div>
              </div>
            </div>

            <p v-else class="text-sm text-muted">
              No node runs have been recorded yet.
            </p>
          </div>
        </UCard>
      </div>
    </div>
  </DashboardPage>
</template>
