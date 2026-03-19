<script setup lang="ts">
import type { ArtifactRecord, TaskRecord } from '../../../shared/types/task-engine'
import { artifactTypeColorMap, formatDateTime } from '../../utils/taskEngine'

type ArtifactListItem = ArtifactRecord & {
  task_title?: string | null
  produced_by_run_id?: string | null
  download_url?: string | null
}

const typeFilter = ref<'all' | ArtifactRecord['type']>('all')
const taskFilter = ref<'all' | string>('all')
const searchQuery = ref('')
const viewMode = ref<'cards' | 'list'>('cards')

const artifactQuery = computed(() => ({
  ...(typeFilter.value !== 'all' ? { type: typeFilter.value } : {}),
  ...(taskFilter.value !== 'all' ? { task_id: taskFilter.value } : {}),
  ...(searchQuery.value.trim() ? { q: searchQuery.value.trim() } : {})
}))

const { data, status, error, refresh } = await useFetch<ArtifactListItem[]>('/api/artifacts', {
  query: artifactQuery,
  default: () => []
})

const { data: tasks } = await useFetch<TaskRecord[]>('/api/tasks', {
  default: () => []
})
</script>

<template>
  <DashboardPage title="Documents" content-width="wide">
    <div class="space-y-6">
      <div class="flex items-center justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold text-highlighted">
            Document library
          </h2>
          <p class="mt-1 text-sm text-muted">
            Search document contents, switch between card and list views, and jump back to the task or run that produced each output.
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

      <div class="rounded-2xl border border-default bg-elevated/20 p-4">
        <div class="flex flex-col gap-4 xl:flex-row xl:items-end">
          <UFormField label="Search" class="min-w-0 flex-1">
          <UInput
            v-model="searchQuery"
            class="w-full"
            icon="i-lucide-search"
            placeholder="Search titles, descriptions, and inline content"
          />
        </UFormField>

          <div class="grid gap-3 sm:grid-cols-2 xl:flex xl:items-end">
            <UFormField label="Type" class="sm:w-52">
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

            <UFormField label="Task" class="sm:w-60">
              <USelect
                v-model="taskFilter"
                :items="[
                  { label: 'All tasks', value: 'all' },
                  ...((tasks || []).map(task => ({ label: task.title, value: task.id })))
                ]"
                class="w-full"
              />
            </UFormField>

            <UFormField label="View" class="sm:w-fit">
              <div class="flex rounded-lg border border-default p-1">
                <button
                  type="button"
                  class="flex-1 rounded-md px-3 py-2 text-sm transition"
                  :class="viewMode === 'cards' ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-elevated/60'"
                  @click="viewMode = 'cards'"
                >
                  Cards
                </button>
                <button
                  type="button"
                  class="flex-1 rounded-md px-3 py-2 text-sm transition"
                  :class="viewMode === 'list' ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-elevated/60'"
                  @click="viewMode = 'list'"
                >
                  List
                </button>
              </div>
            </UFormField>
          </div>
        </div>
      </div>

      <UAlert
        v-if="error"
        color="error"
        variant="soft"
        title="Could not load documents"
        :description="error.message"
      />

      <div v-else-if="status === 'pending'" class="grid gap-4 xl:grid-cols-2">
        <div
          v-for="index in 4"
          :key="index"
          class="h-64 animate-pulse rounded-xl border border-default bg-elevated/40"
        />
      </div>

      <PageEmptyState
        v-else-if="!data?.length"
        title="No documents in this view"
        description="Adjust the filters or run a task that produces a document."
        icon="i-lucide-file-text"
        action-label="Create a task"
        action-to="/tasks/new"
        action-icon="i-lucide-plus"
      />

      <div v-else-if="viewMode === 'cards'" class="grid gap-4 xl:grid-cols-2">
        <ArtifactPreview
          v-for="artifact in data"
          :key="artifact.id"
          :artifact="artifact"
        />
      </div>

      <div v-else class="overflow-hidden rounded-xl border border-default">
        <NuxtLink
          v-for="artifact in data"
          :key="artifact.id"
          :to="`/artifacts/${artifact.id}`"
          class="flex items-center gap-4 border-b border-default px-4 py-3 transition last:border-b-0 hover:bg-elevated/60"
        >
          <UIcon name="i-lucide-file-text" class="size-4 shrink-0 text-muted" />

          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-highlighted">
              {{ artifact.title }}
            </p>
            <p class="truncate text-xs text-dimmed">
              {{ artifact.task_title ? `Produced by ${artifact.task_title}` : artifact.description || 'No description' }}
            </p>
          </div>

          <UBadge :color="artifactTypeColorMap[artifact.type]" variant="soft" class="shrink-0">
            {{ artifact.type }}
          </UBadge>

          <span class="shrink-0 text-xs tabular-nums text-dimmed">
            {{ formatDateTime(artifact.created_at) }}
          </span>
        </NuxtLink>
      </div>
    </div>
  </DashboardPage>
</template>
