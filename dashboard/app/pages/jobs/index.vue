<script setup lang="ts">
import type { JobRecord } from '../../../shared/types/task-engine'
import { formatDateTime } from '../../utils/taskEngine'

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

const statusColorMap = {
  idle: 'neutral',
  scheduled: 'primary',
  running: 'primary',
  waiting_review: 'warning',
  paused: 'warning',
  completed: 'success',
  failed: 'error'
} as const

const pendingJobId = ref<string | null>(null)
const actionError = ref('')

const { data, status, error, refresh } = await useFetch<JobListItem[]>('/api/jobs', {
  default: () => []
})

function getResumeStatus(job: JobListItem) {
  return job.job_type === 'one_off' ? 'idle' : 'scheduled'
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
            Manual, scheduled, and heartbeat jobs now expose their runtime state and can be paused or resumed from the dashboard.
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
        v-else-if="!data.length && status !== 'pending'"
        title="No jobs configured yet"
        description="Create a task to generate its durable job record."
        icon="i-lucide-clock"
      />

      <div v-else class="space-y-3">
        <UCard
          v-for="job in data"
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
                  <UBadge :color="statusColorMap[job.status]" variant="soft">
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
                  <p>Last run: {{ formatDateTime(job.last_run_at) }}</p>
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
                  v-if="job.status !== 'paused' && job.status !== 'running' && job.status !== 'waiting_review'"
                  color="warning"
                  variant="soft"
                  :loading="pendingJobId === job.id"
                  @click="updateJob(job, 'paused')"
                >
                  Pause
                </UButton>
                <UButton
                  v-if="job.status === 'paused' || job.status === 'failed'"
                  color="primary"
                  :loading="pendingJobId === job.id"
                  @click="updateJob(job, getResumeStatus(job))"
                >
                  Resume
                </UButton>
              </div>
            </div>
          </div>
        </UCard>
      </div>
    </div>
  </DashboardPage>
</template>
