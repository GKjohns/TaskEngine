<script setup lang="ts">
import type { JobRecord } from '../../../shared/types/task-engine'
import { formatDateTime, formatRelativeTime, jobStatusColorMap } from '../../utils/taskEngine'

interface JobListItem extends JobRecord {
  tasks?: {
    title: string
    trigger_type: string
    status: string
  } | null
  runs?: {
    id: string
    status: string
    started_at: string | null
  } | null
}

const filters = [
  { value: 'all', label: 'All' },
  { value: 'idle', label: 'Idle' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'running', label: 'Running' },
  { value: 'waiting_review', label: 'Waiting review' },
  { value: 'paused', label: 'Paused' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' }
] as const

type JobFilterValue = (typeof filters)[number]['value']

const activeFilter = ref<JobFilterValue>('all')
const pendingJobId = ref<string | null>(null)
const actionError = ref('')

const { data, status, error, refresh } = await useFetch<JobListItem[]>('/api/jobs', {
  default: () => []
})

const visibleJobs = computed(() => (data.value || []).filter(job =>
  activeFilter.value === 'all' ? true : job.status === activeFilter.value
))

function getResumeStatus(job: JobListItem) {
  return job.job_type === 'one_off' ? 'idle' : 'scheduled'
}

interface JobAction {
  key: 'run' | 'resume'
  label: string
  color?: 'primary' | 'neutral' | 'warning'
  variant?: 'solid' | 'soft'
  icon?: string
}

async function updateJob(job: JobListItem, nextStatus: 'idle' | 'scheduled' | 'paused') {
  pendingJobId.value = job.id
  actionError.value = ''

  try {
    await $fetch(`/api/jobs/${job.id}`, {
      method: 'PATCH',
      body: {
        status: nextStatus
      }
    })
    await refresh()
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : 'Failed to update the job.'
  } finally {
    pendingJobId.value = null
  }
}

async function runJob(job: JobListItem) {
  pendingJobId.value = job.id
  actionError.value = ''

  try {
    await $fetch('/api/runs', {
      method: 'POST',
      body: { task_id: job.task_id }
    })
    await refresh()
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : 'Failed to start the job run.'
  } finally {
    pendingJobId.value = null
  }
}

function getJobActions(job: JobListItem): JobAction[] {
  if (job.status === 'running' || job.status === 'waiting_review') {
    return []
  }

  if (job.job_type === 'one_off') {
    if (job.status === 'paused') {
      return [{ key: 'resume', label: 'Resume', color: 'primary' }]
    }

    return [{ key: 'run', label: job.status === 'failed' ? 'Retry' : 'Run now', icon: 'i-lucide-play' }]
  }

  if (job.status === 'paused') {
    return [{ key: 'resume', label: 'Resume schedule', color: 'primary' }]
  }

  if (job.status === 'failed') {
    return [
      { key: 'run', label: 'Retry now', icon: 'i-lucide-play' },
      { key: 'resume', label: 'Resume schedule', color: 'primary' }
    ]
  }

  return [{ key: 'run', label: 'Run now', icon: 'i-lucide-play' }]
}

async function handleJobAction(job: JobListItem, action: JobAction['key']) {
  if (action === 'run') {
    await runJob(job)
    return
  }

  await updateJob(job, getResumeStatus(job))
}
</script>

<template>
  <DashboardPage title="Jobs">
    <div class="space-y-6">
      <div class="flex items-center justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold text-highlighted">
            Job manager
          </h2>
          <p class="mt-1 text-sm text-muted">
            Track scheduled, waiting, failed, and paused jobs, then trigger or recover them from one view.
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
          :key="filter.value"
          color="neutral"
          size="sm"
          :variant="activeFilter === filter.value ? 'solid' : 'soft'"
          @click="activeFilter = filter.value"
        >
          {{ filter.label }}
        </UButton>
      </div>

      <UAlert
        v-if="error"
        color="error"
        variant="soft"
        title="Could not load jobs"
        :description="error.message"
      />
      <UAlert
        v-else-if="actionError"
        color="error"
        variant="soft"
        title="Job update failed"
        :description="actionError"
      />

      <PageEmptyState
        v-else-if="!visibleJobs.length && status !== 'pending'"
        title="No jobs in this view"
        description="Create a task or change the status filter to see more jobs."
        icon="i-lucide-clock"
      />

      <div v-else class="space-y-3">
        <UCard
          v-for="job in visibleJobs"
          :key="job.id"
          class="border border-default"
        >
          <div class="space-y-4">
            <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div class="space-y-2">
                <div class="flex flex-wrap items-center gap-2">
                  <p class="font-semibold text-highlighted">
                    {{ job.tasks?.title || job.id }}
                  </p>
                  <UBadge :color="jobStatusColorMap[job.status]" variant="soft">
                    {{ job.status }}
                  </UBadge>
                  <UBadge color="neutral" variant="outline">
                    {{ job.job_type }}
                  </UBadge>
                  <UBadge v-if="job.tasks?.trigger_type" color="neutral" variant="subtle">
                    {{ job.tasks.trigger_type }}
                  </UBadge>
                </div>

                <div class="space-y-1 text-sm text-muted">
                  <p>Next run: {{ formatDateTime(job.next_run_at) }}</p>
                  <p>Last run: {{ formatRelativeTime(job.last_run_at) }}</p>
                  <p v-if="job.last_error">
                    Last error: {{ job.last_error }}
                  </p>
                  <p v-if="job.runs?.id">
                    Current run:
                    <NuxtLink :to="`/runs/${job.runs.id}`" class="text-primary hover:text-primary/80">
                      {{ job.runs.id }}
                    </NuxtLink>
                  </p>
                </div>
              </div>

              <div class="flex flex-wrap gap-2">
                <UButton
                  v-for="action in getJobActions(job)"
                  :key="`${job.id}-${action.key}`"
                  :color="action.color || 'primary'"
                  :variant="action.variant || 'solid'"
                  size="sm"
                  :icon="action.icon"
                  :loading="pendingJobId === job.id"
                  @click="handleJobAction(job, action.key)"
                >
                  {{ action.label }}
                </UButton>
              </div>
            </div>
          </div>
        </UCard>
      </div>
    </div>
  </DashboardPage>
</template>
