<script setup lang="ts">
import type { ArtifactRecord, NodeRunRecord, PlanNode, ReviewRecord, RunRecord } from '../../../shared/types/task-engine'
import {
  formatDateTime,
  formatDuration,
  getArtifactMap,
  resolveNodeArtifacts,
  runStatusColorMap
} from '../../utils/taskEngine'

interface RunDetail extends RunRecord {
  tasks?: { title: string, prompt: string } | null
  plans?: { version: number, plan_json: { nodes: PlanNode[] } } | null
  node_runs?: NodeRunRecord[]
  reviews?: ReviewRecord[]
}

const route = useRoute()
const runId = computed(() => route.params.id as string)
const { refreshPendingReviewCount } = useDashboard()

const { data, error, refresh, status } = await useFetch<RunDetail>(`/api/runs/${runId.value}`, {
  key: `run-${runId.value}`
})

const shouldStream = computed(() => ['pending', 'running', 'waiting_review'].includes(data.value?.status || ''))
const { status: streamedStatus, nodeRuns: streamedNodeRuns, reviews: streamedReviews, error: streamError } = useRunStream(runId, {
  enabled: shouldStream
})

const run = computed<RunDetail | null>(() => {
  if (!data.value) {
    return null
  }

  return {
    ...data.value,
    status: streamedStatus.value || data.value.status,
    node_runs: streamedNodeRuns.value.length ? streamedNodeRuns.value : (data.value.node_runs || []),
    reviews: streamedReviews.value.length ? streamedReviews.value : (data.value.reviews || [])
  }
})

const nodeRuns = computed(() => run.value?.node_runs || [])
const nodeDefinitions = computed(() => run.value?.plans?.plan_json.nodes || [])
const selectedNodeId = ref<string | null>(null)
const activeReviewId = ref<string | null>(null)
const pageError = ref('')

watch(nodeDefinitions, (nodes) => {
  if (!nodes.length) {
    selectedNodeId.value = null
    return
  }

  const hasSelectedNode = selectedNodeId.value && nodes.some(node => node.id === selectedNodeId.value)
  if (!hasSelectedNode) {
    selectedNodeId.value = nodes[0]?.id || null
  }
}, { immediate: true })

const selectedNodeRun = computed(() => nodeRuns.value.find(nodeRun => nodeRun.node_key === selectedNodeId.value) || null)
const selectedNodeDefinition = computed(() => nodeDefinitions.value.find(node => node.id === selectedNodeId.value) || null)

const artifactIds = computed(() => {
  const ids = new Set<string>()

  for (const nodeRun of nodeRuns.value) {
    for (const refId of [...(Array.isArray(nodeRun.input_refs) ? nodeRun.input_refs : []), ...(Array.isArray(nodeRun.output_refs) ? nodeRun.output_refs : [])]) {
      if (typeof refId === 'string') {
        ids.add(refId)
      }
    }
  }

  return [...ids]
})

const { data: artifactsData, refresh: refreshArtifacts } = await useFetch<ArtifactRecord[]>('/api/artifacts', {
  query: computed(() => artifactIds.value.length ? { ids: artifactIds.value.join(',') } : {}),
  default: () => []
})

const artifactMap = computed(() => getArtifactMap(artifactsData.value || []))
const selectedArtifacts = computed(() => selectedNodeRun.value
  ? resolveNodeArtifacts(selectedNodeRun.value, artifactMap.value)
  : { inputArtifacts: [], outputArtifacts: [] })

const currentPendingReview = computed(() => (run.value?.reviews || []).find(review => review.status === 'pending') || null)
const otherNodeRuns = computed(() => {
  if (!selectedNodeRun.value) {
    return nodeRuns.value
  }

  return nodeRuns.value.filter(item => item.id !== selectedNodeRun.value?.id)
})

async function resolveReview(nextStatus: 'approved' | 'rejected' | 'edited') {
  if (!currentPendingReview.value) {
    return
  }

  activeReviewId.value = currentPendingReview.value.id
  pageError.value = ''

  try {
    await $fetch(`/api/reviews/${currentPendingReview.value.id}`, {
      method: 'PATCH',
      body: { status: nextStatus }
    })
    await Promise.all([refresh(), refreshArtifacts(), refreshPendingReviewCount()])
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : 'Failed to resolve the review.'
  } finally {
    activeReviewId.value = null
  }
}
</script>

<template>
  <DashboardPage :title="run?.tasks?.title || `Run ${runId}`">
    <div class="space-y-6">
      <div class="flex items-center justify-between gap-3">
        <div class="space-y-2">
          <div class="flex flex-wrap items-center gap-2">
            <UBadge v-if="run" :color="runStatusColorMap[run.status]" variant="soft">
              {{ run.status }}
            </UBadge>
            <UBadge v-if="run?.plans?.version" color="neutral" variant="outline">
              {{ `Plan v${run.plans.version}` }}
            </UBadge>
          </div>
          <p class="text-sm text-muted">
            Inspect the run graph, node logs, artifacts, and review pauses as execution progresses.
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
        title="Could not load run"
        :description="error.message"
      />
      <UAlert
        v-else-if="pageError"
        color="error"
        variant="soft"
        title="Run action failed"
        :description="pageError"
      />
      <UAlert
        v-else-if="streamError"
        color="warning"
        variant="soft"
        title="Live updates disconnected"
        :description="streamError"
      />

      <UCard v-if="run?.tasks?.prompt" class="border border-default">
        <div class="space-y-4">
          <div>
            <h2 class="text-base font-semibold text-highlighted">
              Source prompt
            </h2>
            <p class="mt-1 text-sm text-muted">
              The originating task prompt for this run.
            </p>
          </div>

          <ContentRenderer :content="run.tasks.prompt" />
        </div>
      </UCard>

      <div v-if="run" class="grid gap-4 xl:grid-cols-[0.8fr,1.2fr]">
        <UCard class="border border-default">
          <div class="space-y-4">
            <h2 class="text-base font-semibold text-highlighted">
              Run summary
            </h2>

            <div class="space-y-2 text-sm text-muted">
              <p>Started {{ formatDateTime(run.started_at) }}</p>
              <p>Completed {{ formatDateTime(run.completed_at) }}</p>
              <p>Duration {{ formatDuration(run.started_at, run.completed_at) }}</p>
              <p>{{ run.reviews?.length || 0 }} review record(s)</p>
              <p v-if="run.error_message">
                Error: {{ run.error_message }}
              </p>
            </div>

            <div
              v-if="currentPendingReview"
              class="rounded-xl border border-warning/40 bg-warning/5 p-4"
            >
              <p class="font-medium text-highlighted">
                Review pending
              </p>
              <p class="mt-1 text-sm text-muted">
                This run is paused for human review and can be resumed from here.
              </p>
              <div class="mt-3 flex flex-wrap gap-2">
                <UButton
                  color="success"
                  size="sm"
                  :loading="activeReviewId === currentPendingReview.id"
                  @click="resolveReview('approved')"
                >
                  Approve
                </UButton>
                <UButton
                  color="info"
                  variant="soft"
                  size="sm"
                  :loading="activeReviewId === currentPendingReview.id"
                  @click="resolveReview('edited')"
                >
                  Request edits
                </UButton>
                <UButton
                  color="error"
                  variant="soft"
                  size="sm"
                  :loading="activeReviewId === currentPendingReview.id"
                  @click="resolveReview('rejected')"
                >
                  Reject
                </UButton>
              </div>
            </div>
          </div>
        </UCard>

        <UCard class="border border-default">
          <div class="space-y-4">
            <h2 class="text-base font-semibold text-highlighted">
              Plan graph
            </h2>

            <PlanGraph
              :nodes="nodeDefinitions"
              :node-runs="nodeRuns"
              :active-node-id="selectedNodeId"
              @select="selectedNodeId = $event"
            />
          </div>
        </UCard>
      </div>

      <UCard class="border border-default">
        <div class="space-y-4">
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 class="text-base font-semibold text-highlighted">
                Node execution detail
              </h2>
              <p class="mt-1 text-sm text-muted">
                Expand any node to inspect its inputs, outputs, logs, and tool activity.
              </p>
            </div>
            <p class="text-sm text-muted">
              {{ nodeRuns.length }} node run(s)
            </p>
          </div>

          <PageEmptyState
            v-if="!nodeRuns.length"
            title="No node runs yet"
            description="Node execution records will appear once the run starts processing the graph."
            icon="i-lucide-orbit"
          />

          <div v-else-if="selectedNodeRun" class="space-y-3">
            <NodeDetail
              :node-run="selectedNodeRun"
              :node="selectedNodeDefinition"
              :input-artifacts="selectedArtifacts.inputArtifacts"
              :output-artifacts="selectedArtifacts.outputArtifacts"
            />

            <div class="space-y-3">
              <NodeDetail
                v-for="nodeRun in otherNodeRuns"
                :key="nodeRun.id"
                :node-run="nodeRun"
                :node="nodeDefinitions.find(node => node.id === nodeRun.node_key) || null"
                :input-artifacts="resolveNodeArtifacts(nodeRun, artifactMap).inputArtifacts"
                :output-artifacts="resolveNodeArtifacts(nodeRun, artifactMap).outputArtifacts"
              />
            </div>
          </div>
        </div>
      </UCard>
    </div>
  </DashboardPage>
</template>
