<script setup lang="ts">
import type { ArtifactRecord } from '../../../shared/types/task-engine'
import { artifactTypeColorMap, formatDateTime, formatJson, parseCsvRows } from '../../utils/taskEngine'

const route = useRoute()
const artifactId = computed(() => route.params.id as string)

const { data, error, refresh, status } = await useFetch<ArtifactRecord>(`/api/artifacts/${artifactId.value}`, {
  key: `artifact-${artifactId.value}`
})

const effectiveType = computed<ArtifactRecord['type']>(() => {
  if (data.value?.type !== 'text' || !data.value.content) {
    return data.value?.type || 'text'
  }

  try {
    JSON.parse(data.value.content)
    return 'json'
  } catch {
    return 'text'
  }
})

const artifactContentFormat = computed(() => effectiveType.value === 'markdown' ? 'markdown' : effectiveType.value || 'text')
const formattedJson = computed(() => formatJson(data.value?.content || ''))
const csvRows = computed(() => parseCsvRows(data.value?.content || ''))
const csvHeaders = computed(() => csvRows.value[0] ? Object.keys(csvRows.value[0]).filter(key => key !== '_row') : [])
</script>

<template>
  <DashboardPage :title="data?.title || `Artifact ${artifactId}`">
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
        title="Could not load artifact"
        :description="error.message"
      />

      <div v-else-if="data" class="grid gap-4 xl:grid-cols-[0.8fr,1.2fr]">
        <UCard class="border border-default">
          <div class="space-y-3 text-sm text-muted">
            <h2 class="text-base font-semibold text-highlighted">
              Metadata
            </h2>
            <p>Created {{ formatDateTime(data.created_at) }}</p>
            <p>{{ data.storage_path ? `Storage path: ${data.storage_path}` : 'Stored inline in the database' }}</p>
            <p>{{ data.created_by_run_id ? `Run: ${data.created_by_run_id}` : 'No run recorded' }}</p>
            <p>{{ data.created_by_node_id ? `Node run: ${data.created_by_node_id}` : 'No node run recorded' }}</p>
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

            <pre
              v-else-if="data.content && effectiveType === 'json'"
              class="overflow-auto rounded-xl border border-default bg-elevated/40 p-4 text-sm"
            >{{ formattedJson }}</pre>

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

            <pre
              v-else-if="data.content"
              class="overflow-auto rounded-xl border border-default bg-elevated/40 p-4 text-sm whitespace-pre-wrap"
            >{{ data.content }}</pre>

            <p v-else class="text-sm text-muted">
              This artifact was stored in Supabase Storage. Use the download action to open the signed URL.
            </p>
          </div>
        </UCard>
      </div>
    </div>
  </DashboardPage>
</template>
