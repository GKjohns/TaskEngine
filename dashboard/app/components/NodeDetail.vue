<script setup lang="ts">
import type { ArtifactRecord, NodeRunRecord, PlanNode } from '../../shared/types/task-engine'
import {
  formatDateTime,
  formatDuration,
  nodeRunStatusColorMap,
  nodeTypeBadgeColor,
  truncateText
} from '../utils/taskEngine'

const expandedCalls = ref(new Set<number>())

const props = defineProps<{
  nodeRun: NodeRunRecord
  node?: PlanNode | null
  inputArtifacts?: ArtifactRecord[]
  outputArtifacts?: ArtifactRecord[]
}>()

const logs = computed<Record<string, unknown>>(() => props.nodeRun.logs || {})
const toolCalls = computed(() => Array.isArray(logs.value.tool_calls) ? logs.value.tool_calls as Array<Record<string, unknown>> : [])
const perArtifactCalls = computed(() => Array.isArray(logs.value.calls) ? logs.value.calls as Array<Record<string, unknown>> : [])
const errorMessage = computed(() => typeof logs.value.error === 'string' ? logs.value.error : '')
</script>

<template>
  <UCard class="border border-default">
    <details class="group">
      <summary class="cursor-pointer list-none">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div class="space-y-2">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-semibold text-highlighted">{{ nodeRun.node_key }}</span>
              <UBadge :color="nodeTypeBadgeColor(nodeRun.node_type)" variant="subtle">
                {{ nodeRun.node_type }}
              </UBadge>
              <UBadge :color="nodeRunStatusColorMap[nodeRun.status]" variant="soft">
                {{ nodeRun.status }}
              </UBadge>
            </div>
            <p class="text-sm text-muted">
              {{ node?.description || 'Execution record for this node.' }}
            </p>
          </div>

          <div class="text-sm text-muted">
            {{ formatDuration(nodeRun.started_at, nodeRun.completed_at) }}
          </div>
        </div>
      </summary>

      <div class="mt-4 space-y-5 border-t border-default pt-4">
        <div class="grid gap-3 text-sm text-muted sm:grid-cols-2 xl:grid-cols-4">
          <p>Started {{ formatDateTime(nodeRun.started_at) }}</p>
          <p>Completed {{ formatDateTime(nodeRun.completed_at) }}</p>
          <p>Inputs {{ inputArtifacts?.length || 0 }}</p>
          <p>Outputs {{ outputArtifacts?.length || 0 }}</p>
        </div>

        <UAlert
          v-if="errorMessage"
          color="error"
          variant="soft"
          title="Node failed"
          :description="errorMessage"
        />

        <div v-if="inputArtifacts?.length" class="space-y-3">
          <h4 class="text-sm font-medium text-highlighted">
            Input artifacts
          </h4>
          <div class="grid gap-3 lg:grid-cols-2">
            <ArtifactPreview
              v-for="artifact in inputArtifacts"
              :key="artifact.id"
              :artifact="artifact"
              compact
            />
          </div>
        </div>

        <div v-if="outputArtifacts?.length" class="space-y-3">
          <h4 class="text-sm font-medium text-highlighted">
            Output artifacts
          </h4>
          <div class="grid gap-3 lg:grid-cols-2">
            <ArtifactPreview
              v-for="artifact in outputArtifacts"
              :key="artifact.id"
              :artifact="artifact"
              compact
            />
          </div>
        </div>

        <div v-if="toolCalls.length" class="space-y-3">
          <h4 class="text-sm font-medium text-highlighted">
            Tool calls
          </h4>
          <div class="space-y-2">
            <div
              v-for="(call, index) in toolCalls"
              :key="`${String(call.name || 'tool')}-${index}`"
              class="rounded-xl border border-default bg-elevated/40 text-sm overflow-hidden"
            >
              <button
                class="flex w-full items-center justify-between gap-2 p-3 text-left hover:bg-elevated/60 transition-colors cursor-pointer"
                @click="expandedCalls.has(index) ? expandedCalls.delete(index) : expandedCalls.add(index)"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <UIcon
                    name="i-lucide-chevron-right"
                    class="size-3.5 text-muted transition-transform"
                    :class="{ 'rotate-90': expandedCalls.has(index) }"
                  />
                  <span class="font-medium text-highlighted">{{ call.name || 'tool' }}</span>
                  <UBadge :color="call.isError ? 'error' : 'neutral'" variant="soft">
                    {{ call.isError ? 'error' : 'ok' }}
                  </UBadge>
                </div>
                <span v-if="!expandedCalls.has(index)" class="text-xs text-muted truncate max-w-xs">
                  {{ truncateText(String(call.output || ''), 60) }}
                </span>
              </button>

              <div v-if="expandedCalls.has(index)" class="border-t border-default p-3 space-y-3">
                <div class="space-y-1.5">
                  <p class="text-xs font-medium text-muted uppercase tracking-wide">
                    Input
                  </p>
                  <JsonViewer
                    v-if="call.input && typeof call.input === 'object'"
                    :data="call.input as Record<string, unknown>"
                    compact
                  />
                  <ContentRenderer
                    v-else
                    :content="String(call.input ?? '')"
                    compact
                  />
                </div>
                <div class="space-y-1.5">
                  <p class="text-xs font-medium text-muted uppercase tracking-wide">
                    Output
                  </p>
                  <ContentRenderer
                    :content="String(call.output || '')"
                    compact
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="perArtifactCalls.length" class="space-y-3">
          <h4 class="text-sm font-medium text-highlighted">
            Per-artifact execution
          </h4>
          <div class="space-y-2">
            <div
              v-for="(call, index) in perArtifactCalls"
              :key="`${String(call.artifact_id || index)}-${index}`"
              class="rounded-xl border border-default bg-elevated/40 p-3 text-sm text-muted"
            >
              <p class="font-medium text-highlighted">
                {{ call.artifact_title || call.artifact_id || `Artifact ${index + 1}` }}
              </p>
              <p class="mt-1">
                Iterations: {{ call.iterations || 0 }}
              </p>
              <p class="mt-1">
                Tool calls: {{ Array.isArray(call.tool_calls) ? call.tool_calls.length : 0 }}
              </p>
            </div>
          </div>
        </div>

        <div class="space-y-3">
          <h4 class="text-sm font-medium text-highlighted">
            Raw logs
          </h4>
          <JsonViewer :data="logs" />
        </div>
      </div>
    </details>
  </UCard>
</template>
