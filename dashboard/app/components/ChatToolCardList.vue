<script setup lang="ts">
import type { ToolListResult } from '../utils/chatToolParsers'
import { statusColor } from '../utils/chatToolParsers'

const props = defineProps<{
  list: ToolListResult
  entityLabel: string
}>()

const maxVisible = 5

const visibleEntities = computed(() => props.list.entities.slice(0, maxVisible))
const overflowCount = computed(() => Math.max(0, props.list.entities.length - maxVisible))
</script>

<template>
  <div class="mt-2">
    <template v-if="list.count > 0">
      <p class="mb-1 text-[11px] text-muted">
        {{ list.count }} {{ entityLabel }}{{ list.count !== 1 ? 's' : '' }}
      </p>
      <div class="space-y-px">
        <component
          :is="entity.link ? 'NuxtLink' : 'div'"
          v-for="entity in visibleEntities"
          :key="entity.id"
          v-bind="entity.link ? { to: entity.link } : {}"
          class="-mx-1.5 flex items-center justify-between gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-default/60"
        >
          <span class="min-w-0 text-xs text-highlighted break-words">{{ entity.title }}</span>
          <UBadge
            v-if="entity.status"
            :color="statusColor(entity.status)"
            variant="soft"
            size="xs"
            class="shrink-0"
          >
            {{ entity.status.replace(/_/g, ' ') }}
          </UBadge>
        </component>
      </div>
      <p v-if="overflowCount > 0" class="mt-1 px-1.5 text-[11px] text-muted">
        +{{ overflowCount }} more
      </p>
    </template>
    <p v-else class="text-[11px] text-muted">
      No {{ entityLabel }}s found
    </p>
  </div>
</template>
