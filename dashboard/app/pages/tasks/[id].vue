<script setup lang="ts">
import type { JobRecord, PlanNode, PlanRecord, RunRecord, TaskRecord } from '../../../shared/types/task-engine'
import { formatDateTime } from '../../utils/taskEngine'

interface TaskDetail extends TaskRecord {
  plans?: PlanRecord[]
  runs?: RunRecord[]
  jobs?: Array<Pick<JobRecord, 'id' | 'job_type' | 'status' | 'next_run_at' | 'last_run_at' | 'last_error'>>
}

const route = useRoute()
const taskId = computed(() => route.params.id as string)

const triggerColorMap = {
  manual: 'neutral',
  scheduled: 'primary',
  heartbeat: 'info'
} as const

const taskStatusColorMap = {
  active: 'success',
  paused: 'warning',
  archived: 'neutral'
} as const

const runStatusColorMap = {
  pending: 'neutral',
  running: 'primary',
  waiting_review: 'warning',
  completed: 'success',
  failed: 'error',
  cancelled: 'neutral'
} as const

const jobStatusColorMap = {
  idle: 'neutral',
  scheduled: 'primary',
  running: 'primary',
  waiting_review: 'warning',
  paused: 'warning',
  completed: 'success',
  failed: 'error'
} as const

const { data, status, error, refresh } = await useFetch<TaskDetail>(`/api/tasks/${taskId.value}`, {
  key: `task-${taskId.value}`
})

const replanPending = ref(false)
const replanError = ref('')

const task = computed(() => data.value)
const plans = computed(() => [...(task.value?.plans || [])].sort((a, b) => b.version - a.version))
const latestPlan = computed(() => plans.value[0] ?? null)
const runs = computed(() => [...(task.value?.runs || [])].sort((a, b) => {
  const aTime = a.started_at ? new Date(a.started_at).getTime() : 0
  const bTime = b.started_at ? new Date(b.started_at).getTime() : 0
  return bTime - aTime
}))
const jobs = computed(() => task.value?.jobs || [])

function nodeDetails(node: PlanNode) {
  const details: string[] = []

  if (node.prompt) details.push(`Prompt: ${node.prompt}`)
  if (node.labels?.length) details.push(`Labels: ${node.labels.join(', ')}`)
  if (node.max_length) details.push(`Max length: ${node.max_length}`)
  if (node.source) details.push(`Source: ${node.source}`)
  if (node.filter) details.push(`Filter: ${node.filter}`)
  if (node.condition) details.push(`Condition: ${node.condition}`)
  if (node.if_true_node) details.push(`If true: ${node.if_true_node}`)
  if (node.if_false_node) details.push(`If false: ${node.if_false_node}`)
  if (node.duration) details.push(`Duration: ${node.duration}`)
  if (node.message) details.push(`Message: ${node.message}`)
  if (node.title) details.push(`Output title: ${node.title}`)
  if (node.format) details.push(`Format: ${node.format}`)
  if (node.level) details.push(`Level: ${node.level}`)

  return details
}

async function replanTask() {
  replanPending.value = true
  replanError.value = ''

  try {
    await $fetch(`/api/tasks/${taskId.value}/replan`, {
      method: 'POST'
    })
    await refresh()
  } catch (error) {
    replanError.value = error instanceof Error ? error.message : 'Failed to generate a new plan version.'
  } finally {
    replanPending.value = false
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
            <UBadge color="neutral" variant="outline">
              {{ latestPlan ? `Latest plan v${latestPlan.version}` : 'No plan yet' }}
            </UBadge>
          </div>

          <p v-if="task" class="max-w-4xl text-sm text-muted">
            {{ task.prompt }}
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
          <UButton icon="i-lucide-sparkles" :loading="replanPending" @click="replanTask">
            Replan
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
        v-else-if="replanError"
        color="error"
        variant="soft"
        title="Replan failed"
        :description="replanError"
      />

      <div v-if="task" class="grid gap-4 xl:grid-cols-[1.2fr,0.8fr]">
        <UCard class="border border-default">
          <div class="space-y-4">
            <div>
              <h2 class="text-base font-semibold text-highlighted">
                Task overview
              </h2>
              <p class="mt-1 text-sm text-muted">
                Core metadata for the natural-language task and the first runtime job created from it.
              </p>
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
                  Plan versions
                </p>
                <p class="text-muted">
                  {{ plans.length }}
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
                Jobs
              </h2>
              <p class="mt-1 text-sm text-muted">
                Every task gets a durable job record even before execution begins.
              </p>
            </div>

            <div v-if="jobs.length" class="space-y-3">
              <div
                v-for="job in jobs"
                :key="job.id"
                class="rounded-xl border border-default p-4"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <UBadge :color="jobStatusColorMap[job.status]" variant="soft">
                    {{ job.status }}
                  </UBadge>
                  <UBadge color="neutral" variant="outline">
                    {{ job.job_type }}
                  </UBadge>
                </div>
                <div class="mt-3 space-y-1 text-sm text-muted">
                  <p>
                    Next run: {{ formatDateTime(job.next_run_at) }}
                  </p>
                  <p>
                    Last run: {{ formatDateTime(job.last_run_at) }}
                  </p>
                  <p v-if="job.last_error">
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

      <UCard v-if="latestPlan" class="border border-default">
        <div class="space-y-5">
          <div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 class="text-base font-semibold text-highlighted">
                Generated plan
              </h2>
              <p class="mt-1 text-sm text-muted">
                Latest version created from the task prompt using the Sprint 1 multi-pass planner.
              </p>
            </div>
            <UBadge color="neutral" variant="outline">
              {{ formatDateTime(latestPlan.created_at) }}
            </UBadge>
          </div>

          <div class="space-y-4">
            <div
              v-for="node in latestPlan.plan_json.nodes"
              :key="node.id"
              class="rounded-xl border border-default p-4"
            >
              <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div class="space-y-2">
                  <div class="flex flex-wrap items-center gap-2">
                    <h3 class="font-semibold text-highlighted">
                      {{ node.id }}
                    </h3>
                    <UBadge color="primary" variant="subtle">
                      {{ node.type }}
                    </UBadge>
                    <UBadge :color="node.per_artifact ? 'info' : 'neutral'" variant="outline">
                      {{ node.per_artifact ? 'Per artifact' : 'Batch' }}
                    </UBadge>
                  </div>

                  <p class="text-sm text-muted">
                    {{ node.description }}
                  </p>
                </div>

                <UBadge color="neutral" variant="soft">
                  {{ node.depends_on.length ? `Depends on: ${node.depends_on.join(', ')}` : 'Root node' }}
                </UBadge>
              </div>

              <ul v-if="nodeDetails(node).length" class="mt-4 space-y-2 text-sm text-muted">
                <li v-for="detail in nodeDetails(node)" :key="detail">
                  {{ detail }}
                </li>
              </ul>
            </div>
          </div>
        </div>
      </UCard>

      <UCard v-if="runs.length" class="border border-default">
        <div class="space-y-4">
          <div>
            <h2 class="text-base font-semibold text-highlighted">
              Recent runs
            </h2>
            <p class="mt-1 text-sm text-muted">
              Execution details stay light in Sprint 1, but you can already inspect the run records tied to this task.
            </p>
          </div>

          <div class="space-y-3">
            <NuxtLink
              v-for="run in runs"
              :key="run.id"
              :to="`/runs/${run.id}`"
              class="block rounded-xl border border-default p-4 transition hover:border-primary/50 hover:bg-elevated/60"
            >
              <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div class="space-y-1">
                  <p class="font-medium text-highlighted">
                    {{ run.id }}
                  </p>
                  <p class="text-sm text-muted">
                    Started {{ formatDateTime(run.started_at) }}
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
