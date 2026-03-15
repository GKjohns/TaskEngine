<script setup lang="ts">
import type { ArtifactRecord } from '../../shared/types/task-engine'
import { artifactTypeColorMap, formatDateTime, truncateText } from '../utils/taskEngine'

const props = withDefaults(defineProps<{
  artifact: ArtifactRecord
  compact?: boolean
}>(), {
  compact: false
})

const preview = computed(() => {
  if (!props.artifact.content) {
    return 'Stored in Supabase Storage.'
  }

  return truncateText(props.artifact.content.replace(/\s+/g, ' ').trim(), props.compact ? 100 : 180)
})
</script>

<template>
  <UCard class="border border-default" :ui="{ body: compact ? 'p-3 sm:p-3' : 'p-4 sm:p-4' }">
    <div class="space-y-3">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="truncate font-medium text-highlighted">
            {{ artifact.title }}
          </p>
          <p class="mt-1 text-xs text-muted">
            {{ formatDateTime(artifact.created_at) }}
          </p>
        </div>

        <UBadge :color="artifactTypeColorMap[artifact.type]" variant="soft">
          {{ artifact.type }}
        </UBadge>
      </div>

      <p v-if="artifact.description" class="text-sm text-muted">
        {{ artifact.description }}
      </p>
      <p class="text-sm text-dimmed" :class="{ 'line-clamp-2': artifact.description }">
        {{ preview }}
      </p>

      <div class="flex items-center justify-between gap-3 text-xs text-muted">
        <span>{{ artifact.created_by_node_id ? 'Runtime artifact' : 'Stored artifact' }}</span>
        <UButton
          color="neutral"
          variant="ghost"
          size="xs"
          :to="`/artifacts/${artifact.id}`"
        >
          Open
        </UButton>
      </div>
    </div>
  </UCard>
</template>
