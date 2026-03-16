<script setup lang="ts">
import type { PlanRecord } from '../../../shared/types/task-engine'
import { formatRelativeTime } from '../../utils/taskEngine'

const { data, status, error, refresh } = await useFetch<PlanRecord[]>('/api/plans', {
  default: () => []
})

const plans = computed(() => (data.value || []).map((plan) => {
  const nodeCount = plan.plan_json?.nodes?.length ?? 0
  return { ...plan, nodeCount }
}))
</script>

<template>
  <DashboardPage title="Workflows">
    <div class="space-y-6">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 class="text-base font-semibold text-highlighted">
            Workflow library
          </h2>
          <p class="mt-1 text-sm text-muted">
            Reusable workflow templates. Create once, attach to any task.
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
          <UButton to="/plans/new" icon="i-lucide-plus">
            New workflow
          </UButton>
        </div>
      </div>

      <UAlert
        v-if="error"
        color="error"
        variant="soft"
        title="Could not load workflows"
        :description="error.message"
      />

      <div v-else-if="status === 'pending'" class="grid gap-4 xl:grid-cols-2">
        <div
          v-for="index in 4"
          :key="index"
          class="h-56 animate-pulse rounded-xl border border-default bg-elevated/40"
        />
      </div>

      <PageEmptyState
        v-else-if="!plans.length"
        title="No workflows yet"
        description="Create a reusable workflow from a prompt, then attach it to tasks."
        icon="i-lucide-workflow"
        action-label="Create a workflow"
        action-to="/plans/new"
        action-icon="i-lucide-plus"
      />

      <div v-else class="grid gap-4 xl:grid-cols-2">
        <UCard
          v-for="plan in plans"
          :key="plan.id"
          class="border border-default"
        >
          <div class="space-y-4">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div class="space-y-2">
                <NuxtLink :to="`/plans/${plan.id}`" class="text-base font-semibold text-highlighted hover:text-primary">
                  {{ plan.title }}
                </NuxtLink>
                <div class="flex flex-wrap items-center gap-2">
                  <UBadge color="neutral" variant="outline">
                    v{{ plan.version }}
                  </UBadge>
                  <UBadge color="primary" variant="soft">
                    {{ plan.nodeCount }} {{ plan.nodeCount === 1 ? 'step' : 'steps' }}
                  </UBadge>
                  <UBadge v-if="plan.task_id" color="info" variant="soft">
                    Linked to task
                  </UBadge>
                </div>
              </div>

              <UButton
                color="neutral"
                variant="ghost"
                :to="`/plans/${plan.id}`"
                trailing-icon="i-lucide-arrow-right"
              >
                Open
              </UButton>
            </div>

            <p v-if="plan.description" class="line-clamp-2 text-sm text-muted">
              {{ plan.description }}
            </p>
            <p v-else-if="plan.prompt" class="line-clamp-2 text-sm text-muted">
              {{ plan.prompt }}
            </p>

            <div class="grid gap-3 text-sm text-toned sm:grid-cols-2">
              <div>
                <p class="font-medium text-highlighted">
                  Created
                </p>
                <p>{{ formatRelativeTime(plan.created_at) }}</p>
              </div>
              <div>
                <p class="font-medium text-highlighted">
                  Updated
                </p>
                <p>{{ formatRelativeTime(plan.updated_at) }}</p>
              </div>
            </div>
          </div>
        </UCard>
      </div>
    </div>
  </DashboardPage>
</template>
