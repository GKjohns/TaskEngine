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
    output_artifact: Pick<ArtifactRecord, 'id' | 'title' | 'type' | 'content' | 'description' | 'storage_path' | 'created_at' | 'created_by_node_id'> | null
  }
}>()
</script>

<template>
  <article class="rounded-2xl bg-elevated/30 p-3.5 sm:p-4">
    <div class="flex items-start gap-3">
      <UIcon name="i-lucide-check-circle" class="mt-0.5 size-4 shrink-0 text-[var(--color-success-500)]" />
      <div class="min-w-0 flex-1">
        <div class="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
          <p class="truncate text-sm font-medium text-highlighted">
            {{ item.task_title }}
          </p>
          <span class="shrink-0 text-xs text-dimmed">{{ formatRelativeTime(item.completed_at) }}</span>
        </div>
        <p class="mt-0.5 text-sm text-muted">
          {{ item.summary }}
        </p>
        <div v-if="item.output_artifact" class="mt-3 space-y-2">
          <div class="flex flex-wrap items-center gap-2">
            <NuxtLink
              :to="`/artifacts/${item.output_artifact.id}`"
              class="flex items-center gap-1.5 text-sm text-primary hover:underline"
              :aria-label="`Open document ${item.output_artifact.title}`"
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

          <ArtifactPreview
            :artifact="{ ...item.output_artifact, task_title: item.task_title }"
            compact
            surface="plain"
            :show-header="false"
            :show-footer="false"
            :show-actions="false"
          />

          <div class="flex flex-wrap gap-2">
            <UButton
              color="neutral"
              variant="soft"
              size="sm"
              :to="`/artifacts/${item.output_artifact.id}`"
              :aria-label="`View document ${item.output_artifact.title}`"
            >
              View document
            </UButton>
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              :to="`/runs/${item.run_id}`"
              :aria-label="`Open activity ${item.run_id}`"
            >
              Open activity
            </UButton>
          </div>
        </div>
      </div>
    </div>
  </article>
</template>
