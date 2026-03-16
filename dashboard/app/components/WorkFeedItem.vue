<script setup lang="ts">
import type { ArtifactRecord } from '../../shared/types/task-engine'
import { artifactTypeColorMap, formatRelativeTime } from '../utils/taskEngine'

defineProps<{
  item: {
    run_id: string
    task_id: string
    task_title: string
    completed_at: string | null
    summary: string
    output_artifact: Pick<ArtifactRecord, 'id' | 'title' | 'type'> | null
  }
}>()
</script>

<template>
  <div class="rounded-xl border border-default p-3.5">
    <div class="flex items-start gap-3">
      <UIcon name="i-lucide-check-circle" class="mt-0.5 size-4 shrink-0 text-[var(--color-success-500)]" />
      <div class="min-w-0 flex-1">
        <div class="flex items-baseline justify-between gap-2">
          <p class="truncate text-sm font-medium text-highlighted">
            {{ item.task_title }}
          </p>
          <span class="shrink-0 text-xs text-dimmed">{{ formatRelativeTime(item.completed_at) }}</span>
        </div>
        <p class="mt-0.5 text-sm text-muted">
          {{ item.summary }}
        </p>
        <div v-if="item.output_artifact" class="mt-2 flex items-center gap-2">
          <NuxtLink
            :to="`/artifacts/${item.output_artifact.id}`"
            class="flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <UIcon name="i-lucide-file-text" class="size-3.5" />
            {{ item.output_artifact.title }}
          </NuxtLink>
          <UBadge
            :color="artifactTypeColorMap[item.output_artifact.type]"
            variant="soft"
            size="xs"
          >
            {{ item.output_artifact.type }}
          </UBadge>
        </div>
      </div>
    </div>
  </div>
</template>
