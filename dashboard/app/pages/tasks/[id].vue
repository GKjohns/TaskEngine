<script setup lang="ts">
import type { ArtifactRecord, JobRecord, PlanRecord, RunRecord, TaskRecord } from '../../../shared/types/task-engine'
import {
  artifactTypeColorMap,
  formatDateTime,
  formatDuration,
  formatRelativeTime,
  jobStatusColorMap,
  runStatusColorMap,
  taskStatusColorMap
} from '../../utils/taskEngine'
import { taskLikelyNeedsDocuments } from '../../utils/artifactSelection'

interface TaskDetail extends TaskRecord {
  current_plan?: Pick<PlanRecord, 'id' | 'title' | 'plan_json' | 'version' | 'created_at'> | null
  plans?: PlanRecord[]
  runs?: RunRecord[]
  jobs?: Array<Pick<JobRecord, 'id' | 'job_type' | 'status' | 'next_run_at' | 'last_run_at' | 'last_error'>>
  latest_output_artifact?: ArtifactRecord | null
}

const route = useRoute()
const router = useRouter()
const taskId = computed(() => route.params.id as string)

const triggerColorMap = {
  manual: 'neutral',
  scheduled: 'primary',
  heartbeat: 'info'
} as const

const { data, status, error, refresh } = await useFetch<TaskDetail>(`/api/tasks/${taskId.value}`, {
  key: `task-${taskId.value}`
})

const replanPending = ref(false)
const actionPending = ref(false)
const pageError = ref('')
const selectedNodeId = ref<string | null>(null)

const task = computed(() => data.value)

const taskArtifactIds = computed(() => {
  const ids = task.value?.input_artifact_ids
  return Array.isArray(ids) ? ids : []
})

const inputArtifactQuery = computed(() => taskArtifactIds.value.length
  ? { ids: taskArtifactIds.value.join(',') }
  : {})

const { data: inputArtifacts, refresh: refreshInputArtifacts } = await useFetch<ArtifactRecord[]>('/api/artifacts', {
  query: inputArtifactQuery,
  default: () => []
})

const activePlan = computed(() => {
  if (task.value?.current_plan) return task.value.current_plan
  const plans = [...(task.value?.plans || [])].sort((a, b) => b.version - a.version)
  return plans[0] ?? null
})

const promptNeedsDocuments = computed(() => taskLikelyNeedsDocuments({
  title: task.value?.title,
  prompt: task.value?.prompt,
  planTitle: activePlan.value?.title
}))

const runs = computed(() => [...(task.value?.runs || [])].sort((a, b) => {
  const aTime = a.started_at ? new Date(a.started_at).getTime() : 0
  const bTime = b.started_at ? new Date(b.started_at).getTime() : 0
  return bTime - aTime
}))
const jobs = computed(() => task.value?.jobs || [])
const selectedNode = computed(() => activePlan.value?.plan_json.nodes.find(node => node.id === selectedNodeId.value) || activePlan.value?.plan_json.nodes[0] || null)

watch(activePlan, (plan) => {
  if (!plan) {
    selectedNodeId.value = null
    return
  }

  if (!selectedNodeId.value || !plan.plan_json.nodes.some(node => node.id === selectedNodeId.value)) {
    selectedNodeId.value = plan.plan_json.nodes[0]?.id || null
  }
}, { immediate: true })

async function replanTask() {
  replanPending.value = true
  pageError.value = ''

  try {
    await $fetch(`/api/tasks/${taskId.value}/replan`, {
      method: 'POST'
    })
    await refresh()
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : 'Failed to generate a new plan version.'
  } finally {
    replanPending.value = false
  }
}

async function onRunStarted(run: RunRecord) {
  await refresh()
  await router.push(`/runs/${run.id}`)
}

async function onDocumentsSaved() {
  await Promise.all([
    refresh(),
    refreshInputArtifacts()
  ])
}

async function updateTaskStatus(nextStatus: TaskRecord['status']) {
  actionPending.value = true
  pageError.value = ''

  try {
    await $fetch(`/api/tasks/${taskId.value}`, {
      method: 'PATCH',
      body: { status: nextStatus }
    })
    await refresh()
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : 'Failed to update the task.'
  } finally {
    actionPending.value = false
  }
}
</script>

<template>
  <DashboardPage :title="task?.title || `Task ${taskId}`">
    <div class="space-y-6">
      <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div class="space-y-2">
          <div class="flex flex-wrap items-center gap-2">
            <UBadge v-if="task" :color="taskStatusColorMap[task.status]" variant="soft">
              {{ task.status }}
            </UBadge>
            <UBadge v-if="task" :color="triggerColorMap[task.trigger_type]" variant="subtle">
              {{ task.trigger_type }}
            </UBadge>
            <NuxtLink
              v-if="activePlan"
              :to="`/plans/${activePlan.id}`"
              class="hover:opacity-80 transition"
            >
              <UBadge color="primary" variant="outline">
                {{ activePlan.title || `Plan v${activePlan.version}` }}
              </UBadge>
            </NuxtLink>
            <UBadge v-else color="neutral" variant="outline">
              No plan yet
            </UBadge>
          </div>
          <p class="text-sm text-muted">
            Task detail with current plan, scheduling, and run history.
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
          <RunTaskModal
            :task-id="taskId"
            :task-artifact-ids="taskArtifactIds"
            :task-title="task?.title"
            :task-prompt="task?.prompt"
            :disabled="!activePlan"
            @started="onRunStarted"
          />
          <TaskInputArtifactsModal
            v-if="task"
            :task-id="taskId"
            :task-title="task.title"
            :task-prompt="task.prompt"
            :plan-title="activePlan?.title"
            :current-artifact-ids="taskArtifactIds"
            @saved="onDocumentsSaved"
          />
          <UButton icon="i-lucide-sparkles" :loading="replanPending" @click="replanTask">
            Replan
          </UButton>
          <UButton
            v-if="task?.status === 'active'"
            color="warning"
            variant="soft"
            :loading="actionPending"
            @click="updateTaskStatus('paused')"
          >
            Pause
          </UButton>
          <UButton
            v-if="task?.status === 'paused'"
            color="success"
            variant="soft"
            :loading="actionPending"
            @click="updateTaskStatus('active')"
          >
            Resume
          </UButton>
          <UButton
            v-if="task?.status !== 'archived'"
            color="neutral"
            variant="soft"
            :loading="actionPending"
            @click="updateTaskStatus('archived')"
          >
            Archive
          </UButton>
        </div>
      </div>

      <UAlert
        v-if="error"
        color="error"
        variant="soft"
        title="Could not load task details"
        :description="error.message"
      />
      <UAlert
        v-else-if="pageError"
        color="error"
        variant="soft"
        title="Task action failed"
        :description="pageError"
      />

      <UCard v-if="task?.prompt" class="border border-default">
        <div class="space-y-4">
          <div>
            <h2 class="text-base font-semibold text-highlighted">
              Task prompt
            </h2>
            <p class="mt-1 text-sm text-muted">
              The natural-language request that produced this task.
            </p>
          </div>

          <ContentRenderer :content="task.prompt" />
        </div>
      </UCard>

      <UAlert
        v-if="task && promptNeedsDocuments && !taskArtifactIds.length"
        color="warning"
        variant="soft"
        title="This task has no saved input documents"
        description="The prompt looks like it depends on uploaded files or reports. Add the right documents so future runs keep the context they need."
      />

      <UCard v-if="inputArtifacts?.length" class="border border-default">
        <div class="space-y-4">
          <div>
            <h2 class="text-base font-semibold text-highlighted">
              Input artifacts
            </h2>
            <p class="mt-1 text-sm text-muted">
              Data fed into this task's plan on each run.
            </p>
          </div>

          <div class="flex flex-wrap gap-2">
            <NuxtLink
              v-for="artifact in inputArtifacts"
              :key="artifact.id"
              :to="`/artifacts/${artifact.id}`"
              class="flex items-center gap-2 rounded-lg border border-default px-3 py-2 transition hover:border-primary/50 hover:bg-elevated/60"
            >
              <UBadge :color="artifactTypeColorMap[artifact.type]" variant="soft" size="xs">
                {{ artifact.type }}
              </UBadge>
              <span class="text-sm font-medium text-highlighted">{{ artifact.title }}</span>
            </NuxtLink>
          </div>
        </div>
      </UCard>

      <UCard v-if="task?.latest_output_artifact" class="border border-default">
        <div class="space-y-4">
          <div>
            <h2 class="text-base font-semibold text-highlighted">
              Latest completed output
            </h2>
            <p class="mt-1 text-sm text-muted">
              Most recent artifact generated by a completed run for this task.
            </p>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <NuxtLink :to="`/artifacts/${task.latest_output_artifact.id}`" class="text-sm text-primary hover:underline">
              {{ task.latest_output_artifact.title }}
            </NuxtLink>
            <UBadge :color="artifactTypeColorMap[task.latest_output_artifact.type]" variant="soft" size="xs">
              {{ task.latest_output_artifact.type }}
            </UBadge>
          </div>

          <ArtifactPreview
            :artifact="task.latest_output_artifact"
            surface="plain"
            :show-header="false"
            :show-footer="false"
            :show-actions="false"
          />
        </div>
      </UCard>

      <div v-if="task" class="grid gap-4 xl:grid-cols-[0.9fr,1.1fr]">
        <UCard class="border border-default">
          <div class="space-y-4">
            <div>
              <h2 class="text-base font-semibold text-highlighted">
                Task overview
              </h2>
            </div>

            <div class="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <p class="font-medium text-highlighted">
                  Created
                </p>
                <p class="text-muted">
                  {{ formatDateTime(task.created_at) }}
                </p>
              </div>
              <div>
                <p class="font-medium text-highlighted">
                  Updated
                </p>
                <p class="text-muted">
                  {{ formatDateTime(task.updated_at) }}
                </p>
              </div>
              <div>
                <p class="font-medium text-highlighted">
                  Plan
                </p>
                <NuxtLink
                  v-if="activePlan"
                  :to="`/plans/${activePlan.id}`"
                  class="text-primary hover:underline"
                >
                  {{ activePlan.title || `v${activePlan.version}` }}
                </NuxtLink>
                <p v-else class="text-muted">
                  None
                </p>
              </div>
              <div>
                <p class="font-medium text-highlighted">
                  Runs
                </p>
                <p class="text-muted">
                  {{ runs.length }}
                </p>
              </div>
            </div>
          </div>
        </UCard>

        <UCard class="border border-default">
          <div class="space-y-4">
            <div>
              <h2 class="text-base font-semibold text-highlighted">
                Scheduling
              </h2>
            </div>

            <div v-if="jobs.length" class="space-y-3">
              <div
                v-for="job in jobs"
                :key="job.id"
                class="rounded-xl bg-elevated/35 p-4"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <UBadge :color="jobStatusColorMap[job.status]" variant="soft">
                    {{ job.status }}
                  </UBadge>
                  <UBadge color="neutral" variant="outline">
                    {{ job.job_type }}
                  </UBadge>
                </div>
                <div class="mt-3 grid gap-2 text-sm text-muted sm:grid-cols-2">
                  <p>Next run: {{ formatDateTime(job.next_run_at) }}</p>
                  <p>Last run: {{ formatRelativeTime(job.last_run_at) }}</p>
                  <p v-if="job.last_error" class="sm:col-span-2">
                    Last error: {{ job.last_error }}
                  </p>
                </div>
              </div>
            </div>

            <p v-else class="text-sm text-muted">
              No jobs have been created yet.
            </p>
          </div>
        </UCard>
      </div>

      <div v-if="activePlan" class="grid gap-4 xl:grid-cols-[1fr,0.9fr]">
        <UCard class="border border-default">
          <div class="space-y-5">
            <div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 class="text-base font-semibold text-highlighted">
                  Plan graph
                </h2>
                <p class="mt-1 text-sm text-muted">
                  Current execution plan.
                  <NuxtLink :to="`/plans/${activePlan.id}`" class="text-primary hover:underline">
                    View full plan
                  </NuxtLink>
                </p>
              </div>
              <UBadge color="neutral" variant="outline">
                {{ formatDateTime(activePlan.created_at) }}
              </UBadge>
            </div>

            <PlanGraph
              :nodes="activePlan.plan_json.nodes"
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

      <UCard class="border border-default">
        <div class="space-y-4">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h2 class="text-base font-semibold text-highlighted">
                Recent runs
              </h2>
              <p class="mt-1 text-sm text-muted">
                Jump into the run inspector to follow node-by-node execution.
              </p>
            </div>
            <UButton color="neutral" variant="ghost" to="/runs">
              View all runs
            </UButton>
          </div>

          <PageEmptyState
            v-if="!runs.length"
            title="No runs yet"
            description="Use Run now to execute the latest plan."
            icon="i-lucide-play-circle"
          />

          <div v-else class="space-y-1 rounded-2xl bg-elevated/25 p-1.5">
            <NuxtLink
              v-for="run in runs.slice(0, 8)"
              :key="run.id"
              :to="`/runs/${run.id}`"
              class="block rounded-xl px-4 py-3 transition hover:bg-elevated/70"
            >
              <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div class="space-y-1">
                  <p class="font-medium text-highlighted">
                    {{ run.id }}
                  </p>
                  <p class="text-sm text-muted">
                    {{ formatRelativeTime(run.started_at || run.completed_at) }} · {{ formatDuration(run.started_at, run.completed_at) }}
                  </p>
                </div>
                <UBadge :color="runStatusColorMap[run.status]" variant="soft">
                  {{ run.status }}
                </UBadge>
              </div>
            </NuxtLink>
          </div>
        </div>
      </UCard>
    </div>
  </DashboardPage>
</template>
