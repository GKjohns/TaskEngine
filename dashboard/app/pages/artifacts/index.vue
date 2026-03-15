<script setup lang="ts">
import type { ArtifactRecord } from '../../../shared/types/task-engine'
import { formatDateTime } from '../../utils/taskEngine'

const typeColorMap = {
  markdown: 'primary',
  text: 'neutral',
  json: 'info',
  csv: 'success'
} as const

const { data, status, error, refresh } = await useFetch<ArtifactRecord[]>('/api/artifacts', {
  default: () => []
})
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
            Sprint 1 includes the storage-backed artifact APIs, so the dashboard can already surface saved outputs.
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
        title="Could not load artifacts"
        :description="error.message"
      />

      <PageEmptyState
        v-else-if="!data?.length && status !== 'pending'"
        title="No artifacts yet"
        description="Generated documents and structured outputs will appear here once runs begin writing outputs."
        icon="i-lucide-file-text"
      />

      <div v-else class="grid gap-4 xl:grid-cols-2">
        <UCard
          v-for="artifact in data"
          :key="artifact.id"
          class="border border-default"
        >
          <div class="space-y-3">
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="font-medium text-highlighted">
                  {{ artifact.title }}
                </p>
                <p class="mt-1 text-sm text-muted">
                  {{ formatDateTime(artifact.created_at) }}
                </p>
              </div>

              <UBadge :color="typeColorMap[artifact.type]" variant="soft">
                {{ artifact.type }}
              </UBadge>
            </div>

            <p class="text-sm text-muted">
              {{ artifact.content ? artifact.content.slice(0, 180) : 'Stored in Supabase Storage' }}
            </p>

            <div class="flex items-center justify-between gap-3 text-sm text-muted">
              <span>{{ artifact.task_id ? `Task ${artifact.task_id}` : 'Unassigned artifact' }}</span>
              <UButton color="neutral" variant="ghost" :to="`/artifacts/${artifact.id}`">
                Open
              </UButton>
            </div>
          </div>
        </UCard>
      </div>
    </div>
  </DashboardPage>
</template>
