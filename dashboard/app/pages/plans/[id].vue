<script setup lang="ts">
import type { PlanRecord, RunRecord, TaskRecord } from '../../../shared/types/task-engine'
import {
  formatDateTime,
  formatDuration,
  formatRelativeTime,
  runStatusColorMap,
  taskStatusColorMap
} from '../../utils/taskEngine'

interface PlanDetail extends PlanRecord {
  tasks?: Array<Pick<TaskRecord, 'id' | 'title' | 'status' | 'trigger_type'>>
  runs?: Array<Pick<RunRecord, 'id' | 'status' | 'started_at' | 'completed_at'>>
}

const route = useRoute()
const router = useRouter()
const planId = computed(() => route.params.id as string)

const { data, status, error, refresh } = await useFetch<PlanDetail>(`/api/plans/${planId.value}`, {
  key: `plan-${planId.value}`
})

const selectedNodeId = ref<string | null>(null)

const plan = computed(() => data.value)
const nodes = computed(() => plan.value?.plan_json?.nodes || [])
const selectedNode = computed(() => nodes.value.find(n => n.id === selectedNodeId.value) || nodes.value[0] || null)
const runs = computed(() => [...(plan.value?.runs || [])].sort((a, b) => {
  const aTime = a.started_at ? new Date(a.started_at).getTime() : 0
  const bTime = b.started_at ? new Date(b.started_at).getTime() : 0
  return bTime - aTime
}))
const tasks = computed(() => plan.value?.tasks || [])

watch(nodes, (n) => {
  if (!selectedNodeId.value || !n.some(node => node.id === selectedNodeId.value)) {
    selectedNodeId.value = n[0]?.id || null
  }
}, { immediate: true })

function navigateToCreateTask() {
  router.push({ path: '/tasks/new', query: { plan_id: planId.value } })
}
</script>

<template>
  <DashboardPage :title="plan?.title || `Plan ${planId}`">
    <div class="space-y-6">
      <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div class="space-y-2">
          <div class="flex flex-wrap items-center gap-2">
            <UBadge color="neutral" variant="outline">
              v{{ plan?.version }}
            </UBadge>
            <UBadge color="primary" variant="soft">
              {{ nodes.length }} {{ nodes.length === 1 ? 'node' : 'nodes' }}
            </UBadge>
            <UBadge v-if="plan?.task_id" color="info" variant="soft">
              Linked to task
            </UBadge>
          </div>
          <p v-if="plan?.description" class="text-sm text-muted">
            {{ plan.description }}
          </p>
        </div>

        <div class="flex flex-wrap gap-2">
          <UButton
            color="neutral"
            variant="soft"
            icon="i-lucide-refresh-cw"
            :loading="status === 'pending'"
            @click="refresh()"
          >
            Refresh
          </UButton>
          <UButton icon="i-lucide-plus" @click="navigateToCreateTask">
            Create task from plan
          </UButton>
        </div>
      </div>

      <UAlert
        v-if="error"
        color="error"
        variant="soft"
        title="Could not load plan"
        :description="error.message"
      />

      <UCard v-if="plan?.prompt" class="border border-default">
        <div class="space-y-4">
          <div>
            <h2 class="text-base font-semibold text-highlighted">
              Source prompt
            </h2>
            <p class="mt-1 text-sm text-muted">
              The prompt used to generate this workflow.
            </p>
          </div>

          <ContentRenderer :content="plan.prompt" />
        </div>
      </UCard>

      <div v-if="nodes.length" class="grid gap-4 xl:grid-cols-[1fr,0.9fr]">
        <UCard class="border border-default">
          <div class="space-y-5">
            <div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 class="text-base font-semibold text-highlighted">
                  Plan graph
                </h2>
                <p class="mt-1 text-sm text-muted">
                  The execution DAG for this plan, showing node dependencies and whether each runs per artifact or in batch.
                </p>
              </div>
              <UBadge color="neutral" variant="outline">
                {{ formatDateTime(plan?.created_at) }}
              </UBadge>
            </div>

            <PlanGraph
              :nodes="nodes"
              :active-node-id="selectedNodeId"
              @select="selectedNodeId = $event"
            />
          </div>
        </UCard>

        <UCard class="border border-default">
          <div v-if="selectedNode" class="space-y-4">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="text-base font-semibold text-highlighted">
                {{ selectedNode.id }}
              </h2>
              <UBadge color="neutral" variant="outline">
                {{ selectedNode.type }}
              </UBadge>
              <UBadge :color="selectedNode.per_artifact ? 'info' : 'neutral'" variant="soft">
                {{ selectedNode.per_artifact ? 'Per artifact' : 'Batch' }}
              </UBadge>
            </div>

            <p class="text-sm text-muted">
              {{ selectedNode.description }}
            </p>

            <div class="space-y-3 text-sm">
              <p class="text-muted">
                {{ selectedNode.depends_on.length ? `Depends on: ${selectedNode.depends_on.join(', ')}` : 'Root node' }}
              </p>

              <div v-if="selectedNode.prompt" class="space-y-1.5">
                <p class="text-xs font-medium text-muted uppercase tracking-wide">
                  Prompt
                </p>
                <ContentRenderer :content="selectedNode.prompt" compact />
              </div>

              <div v-if="selectedNode.message" class="space-y-1.5">
                <p class="text-xs font-medium text-muted uppercase tracking-wide">
                  Review message
                </p>
                <ContentRenderer :content="selectedNode.message" compact />
              </div>

              <p v-if="selectedNode.source" class="text-muted">
                Source: {{ selectedNode.source }}
              </p>
              <p v-if="selectedNode.condition" class="text-muted">
                <span class="font-medium">Condition:</span>
                <code class="ml-1 rounded bg-elevated px-1.5 py-0.5 font-mono text-xs">{{ selectedNode.condition }}</code>
              </p>
              <p v-if="selectedNode.duration" class="text-muted">
                Duration: {{ selectedNode.duration }}
              </p>
              <p v-if="selectedNode.title" class="text-muted">
                Output title: {{ selectedNode.title }}
              </p>
            </div>
          </div>
        </UCard>
      </div>

      <div class="grid gap-4 xl:grid-cols-2">
        <UCard class="border border-default">
          <div class="space-y-4">
            <div class="flex items-center justify-between gap-3">
              <h2 class="text-base font-semibold text-highlighted">
                Tasks using this plan
              </h2>
            </div>

            <PageEmptyState
              v-if="!tasks.length"
              title="No tasks yet"
              description="Create a task to start running this plan on a schedule or manually."
              icon="i-lucide-list-checks"
            />

            <div v-else class="space-y-2">
              <NuxtLink
                v-for="task in tasks"
                :key="task.id"
                :to="`/tasks/${task.id}`"
                class="flex items-center justify-between rounded-lg border border-default p-3 transition hover:border-primary/50 hover:bg-elevated/60"
              >
                <div class="flex items-center gap-3">
                  <p class="text-sm font-medium text-highlighted">
                    {{ task.title }}
                  </p>
                  <UBadge :color="taskStatusColorMap[task.status]" variant="soft" size="xs">
                    {{ task.status }}
                  </UBadge>
                </div>
                <UIcon name="i-lucide-arrow-right" class="size-4 text-muted" />
              </NuxtLink>
            </div>
          </div>
        </UCard>

        <UCard class="border border-default">
          <div class="space-y-4">
            <div class="flex items-center justify-between gap-3">
              <h2 class="text-base font-semibold text-highlighted">
                Recent runs
              </h2>
            </div>

            <PageEmptyState
              v-if="!runs.length"
              title="No runs yet"
              description="Runs will appear here once a task executes this plan."
              icon="i-lucide-play-circle"
            />

            <div v-else class="space-y-2">
              <NuxtLink
                v-for="run in runs.slice(0, 6)"
                :key="run.id"
                :to="`/runs/${run.id}`"
                class="flex items-center justify-between rounded-lg border border-default p-3 transition hover:border-primary/50 hover:bg-elevated/60"
              >
                <div class="space-y-1">
                  <p class="text-sm font-medium text-highlighted">
                    {{ run.id.slice(0, 8) }}
                  </p>
                  <p class="text-xs text-muted">
                    {{ formatRelativeTime(run.started_at) }} · {{ formatDuration(run.started_at, run.completed_at) }}
                  </p>
                </div>
                <UBadge :color="runStatusColorMap[run.status]" variant="soft" size="xs">
                  {{ run.status }}
                </UBadge>
              </NuxtLink>
            </div>
          </div>
        </UCard>
      </div>
    </div>
  </DashboardPage>
</template>
