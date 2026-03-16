<script setup lang="ts">
import type { ArtifactRecord } from '../../../shared/types/task-engine'
import { artifactTypeColorMap, formatDateTime, parseCsvRows } from '../../utils/taskEngine'

const route = useRoute()
const artifactId = computed(() => route.params.id as string)

const { data, error, refresh, status } = await useFetch<ArtifactRecord>(`/api/artifacts/${artifactId.value}`, {
  key: `artifact-${artifactId.value}`
})

const effectiveType = computed<ArtifactRecord['type']>(() => {
  const storedType = data.value?.type || 'text'
  const content = data.value?.content?.trim()

  if (!content) {
    return storedType
  }

  if (storedType !== 'json' && (content.startsWith('{') || content.startsWith('['))) {
    try {
      JSON.parse(content)
      return 'json'
    } catch {
      // Not valid JSON, fall through
    }
  }

  return storedType
})

const artifactContentFormat = computed(() => effectiveType.value === 'markdown' ? 'markdown' : effectiveType.value || 'text')
const csvRows = computed(() => parseCsvRows(data.value?.content || ''))
const csvHeaders = computed(() => csvRows.value[0] ? Object.keys(csvRows.value[0]).filter(key => key !== '_row') : [])
</script>

<template>
  <DashboardPage :title="data?.title || `Document ${artifactId}`">
    <div class="space-y-6">
      <div class="flex items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <UBadge v-if="data" :color="artifactTypeColorMap[effectiveType]" variant="soft">
            {{ effectiveType }}
          </UBadge>
          <UBadge v-if="data && effectiveType !== data.type" color="neutral" variant="outline">
            stored as {{ data.type }}
          </UBadge>
          <UBadge v-if="data?.task_id" color="neutral" variant="outline">
            {{ `Task ${data.task_id}` }}
          </UBadge>
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
          <RunTaskOnArtifactModal v-if="data" :artifact-id="data.id" />
          <UButton
            v-if="data?.download_url"
            trailing-icon="i-lucide-arrow-up-right"
            :to="data.download_url"
            target="_blank"
          >
            Download
          </UButton>
        </div>
      </div>

      <UAlert
        v-if="error"
        color="error"
        variant="soft"
        title="Could not load document"
        :description="error.message"
      />

      <div v-else-if="data" class="grid gap-4 xl:grid-cols-[0.8fr,1.2fr]">
        <UCard class="border border-default">
          <div class="space-y-3 text-sm text-muted">
            <h2 class="text-base font-semibold text-highlighted">
              Metadata
            </h2>
            <p v-if="data.description" class="text-muted">
              {{ data.description }}
            </p>
            <p>Created {{ formatDateTime(data.created_at) }}</p>
            <p>{{ data.storage_path ? `Storage path: ${data.storage_path}` : 'Stored inline in the database' }}</p>
            <p>{{ data.created_by_run_id ? `Created during activity ${data.created_by_run_id}` : 'No activity recorded' }}</p>
            <p>{{ data.created_by_node_id ? `Created by step run ${data.created_by_node_id}` : 'No step run recorded' }}</p>
          </div>
        </UCard>

        <UCard class="border border-default">
          <div class="space-y-4">
            <h2 class="text-base font-semibold text-highlighted">
              Content
            </h2>

            <ReadOnlyMarkdown
              v-if="data.content && effectiveType === 'markdown'"
              :content="data.content"
              :format="artifactContentFormat"
            />

            <JsonViewer
              v-else-if="data.content && effectiveType === 'json'"
              :data="data.content"
            />

            <div v-else-if="data.content && effectiveType === 'csv'" class="overflow-x-auto rounded-xl border border-default">
              <table class="min-w-full divide-y divide-default text-sm">
                <thead class="bg-elevated/60">
                  <tr>
                    <th
                      v-for="header in csvHeaders"
                      :key="header"
                      class="whitespace-nowrap px-4 py-3 text-left font-medium text-highlighted"
                    >
                      {{ header }}
                    </th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-default">
                  <tr v-for="row in csvRows" :key="row._row">
                    <td
                      v-for="header in csvHeaders"
                      :key="`${row._row}-${header}`"
                      class="whitespace-nowrap px-4 py-3 text-muted"
                    >
                      {{ row[header] }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <ContentRenderer
              v-else-if="data.content"
              :content="data.content"
            />

            <p v-else class="text-sm text-muted">
              This document was stored in Supabase Storage. Use the download action to open the signed URL.
            </p>
          </div>
        </UCard>
      </div>
    </div>
  </DashboardPage>
</template>
