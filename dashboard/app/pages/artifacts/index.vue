<script setup lang="ts">
import type { ArtifactRecord, TaskRecord } from '../../../shared/types/task-engine'

const typeFilter = ref<'all' | ArtifactRecord['type']>('all')
const taskFilter = ref<'all' | string>('all')

const { data, status, error, refresh } = await useFetch<ArtifactRecord[]>('/api/artifacts', {
  default: () => []
})

const { data: tasks } = await useFetch<TaskRecord[]>('/api/tasks', {
  default: () => []
})

const visibleArtifacts = computed(() => (data.value || []).filter((artifact) => {
  const matchesType = typeFilter.value === 'all' || artifact.type === typeFilter.value
  const matchesTask = taskFilter.value === 'all' || artifact.task_id === taskFilter.value
  return matchesType && matchesTask
}))
</script>

<template>
  <DashboardPage title="Artifacts">
    <div class="space-y-6">
      <div class="flex items-center justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold text-highlighted">
            Artifact browser
          </h2>
          <p class="mt-1 text-sm text-muted">
            Browse generated outputs by type or task, then open a full artifact view for richer rendering.
          </p>
        </div>

        <div class="flex items-center gap-2">
          <UButton
            color="neutral"
            variant="soft"
            icon="i-lucide-refresh-cw"
            :loading="status === 'pending'"
            @click="refresh()"
          >
            Refresh
          </UButton>
          <UploadArtifactModal @created="refresh()" />
        </div>
      </div>

      <div class="grid gap-3 lg:grid-cols-2">
        <UFormField label="Type">
          <USelect
            v-model="typeFilter"
            :items="[
              { label: 'All types', value: 'all' },
              { label: 'Markdown', value: 'markdown' },
              { label: 'Text', value: 'text' },
              { label: 'JSON', value: 'json' },
              { label: 'CSV', value: 'csv' }
            ]"
            class="w-full"
          />
        </UFormField>

        <UFormField label="Task">
          <USelect
            v-model="taskFilter"
            :items="[
              { label: 'All tasks', value: 'all' },
              ...((tasks || []).map(task => ({ label: task.title, value: task.id })))
            ]"
            class="w-full"
          />
        </UFormField>
      </div>

      <UAlert
        v-if="error"
        color="error"
        variant="soft"
        title="Could not load artifacts"
        :description="error.message"
      />

      <PageEmptyState
        v-else-if="!visibleArtifacts.length && status !== 'pending'"
        title="No artifacts in this view"
        description="Change the filters or run a task that emits artifacts."
        icon="i-lucide-file-text"
      />

      <div v-else class="grid gap-4 xl:grid-cols-2">
        <ArtifactPreview
          v-for="artifact in visibleArtifacts"
          :key="artifact.id"
          :artifact="artifact"
        />
      </div>
    </div>
  </DashboardPage>
</template>
