<script setup lang="ts">
import type { NodeRunRecord, PlanNode } from '../../shared/types/task-engine'
import {
  nodeRunStatusColorMap,
  nodeTypeBadgeColor,
  nodeTypeIcon,
  summarizeNode,
  topologicallySortNodes
} from '../utils/taskEngine'

const props = defineProps<{
  nodes: PlanNode[]
  nodeRuns?: NodeRunRecord[]
  activeNodeId?: string | null
}>()

const emit = defineEmits<{
  select: [nodeId: string]
}>()

const sortedNodes = computed(() => topologicallySortNodes(props.nodes || []))
const nodeRunMap = computed(() => new Map((props.nodeRuns || []).map(nodeRun => [nodeRun.node_key, nodeRun])))

function selectNode(nodeId: string) {
  emit('select', nodeId)
}
</script>

<template>
  <div class="space-y-4">
    <div
      v-for="(node, index) in sortedNodes"
      :key="node.id"
      class="flex items-start gap-4"
    >
      <div class="flex w-10 flex-col items-center">
        <div
          class="flex size-10 items-center justify-center rounded-full border bg-elevated"
          :class="{
            'border-info/40 bg-info/8': node.type === 'http_fetch',
            'border-default': node.type !== 'http_fetch',
            'ring-2 ring-primary/40': activeNodeId === node.id
          }"
        >
          <UIcon
            :name="nodeTypeIcon(node.type)"
            class="size-4"
            :class="node.type === 'http_fetch' ? 'text-info' : 'text-toned'"
          />
        </div>
        <div
          v-if="index < sortedNodes.length - 1"
          class="mt-2 h-10 w-px bg-default"
        />
      </div>

      <button
        type="button"
        class="w-full text-left"
        @click="selectNode(node.id)"
      >
        <UCard
          class="border border-default transition"
          :class="{
            'border-primary bg-primary/5': activeNodeId === node.id
          }"
        >
          <div class="space-y-3">
            <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div class="space-y-2">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-semibold text-highlighted">{{ node.id }}</span>
                  <UBadge :color="nodeTypeBadgeColor(node.type)" variant="soft">
                    {{ node.type }}
                  </UBadge>
                  <UBadge :color="node.per_artifact ? 'info' : 'neutral'" variant="outline">
                    {{ node.per_artifact ? 'Per artifact' : 'Batch' }}
                  </UBadge>
                </div>

                <p class="text-sm text-muted">
                  {{ summarizeNode(node) }}
                </p>
              </div>

              <UBadge
                v-if="nodeRunMap.get(node.id)"
                :color="nodeRunStatusColorMap[nodeRunMap.get(node.id)!.status]"
                variant="soft"
              >
                {{ nodeRunMap.get(node.id)!.status }}
              </UBadge>
            </div>

            <p class="text-xs text-toned">
              {{ node.depends_on.length ? `Depends on: ${node.depends_on.join(', ')}` : 'Root node' }}
            </p>
          </div>
        </UCard>
      </button>
    </div>
  </div>
</template>
