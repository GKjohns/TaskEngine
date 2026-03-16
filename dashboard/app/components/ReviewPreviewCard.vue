<script setup lang="ts">
import type { ArtifactRecord } from '../../shared/types/task-engine'
import { artifactTypeColorMap, formatRelativeTime, parseCsvRows, truncateText } from '../utils/taskEngine'

type ReviewResolution = 'approved' | 'rejected'
type ReviewResolvePayload = { id: string, status: ReviewResolution }

const props = withDefaults(defineProps<{
  review: {
    id: string
    run_id: string
    created_at: string
    task_title: string
    review_message: string | null
    node_type: string | null
    output_artifact: Pick<ArtifactRecord, 'id' | 'title' | 'type' | 'content' | 'description' | 'storage_path'> | null
  }
  pendingStatus?: ReviewResolution | null
}>(), {
  pendingStatus: null
})

const emit = defineEmits<{
  resolve: [payload: ReviewResolvePayload]
}>()

const artifactPreview = computed(() => {
  const artifact = props.review.output_artifact

  if (!artifact) {
    return 'No document preview is available yet.'
  }

  if (!artifact.content?.trim()) {
    return artifact.storage_path
      ? 'This document is stored in Supabase Storage. Open the full view to inspect it.'
      : 'No inline preview is available for this document yet.'
  }

  if (artifact.type === 'json') {
    try {
      const parsed = JSON.parse(artifact.content)

      if (Array.isArray(parsed)) {
        return `JSON array with ${parsed.length} item${parsed.length === 1 ? '' : 's'}.`
      }

      if (parsed && typeof parsed === 'object') {
        const keyCount = Object.keys(parsed).length
        return `JSON document with ${keyCount} top-level field${keyCount === 1 ? '' : 's'}.`
      }
    } catch {
      return truncateText(artifact.content.replace(/\s+/g, ' ').trim(), 180)
    }
  }

  if (artifact.type === 'csv') {
    const rows = parseCsvRows(artifact.content)
    const headers = Object.keys(rows[0] || {}).filter(key => key !== '_row')

    if (!rows.length) {
      return 'CSV document with headers but no data rows.'
    }

    return `CSV document with ${rows.length} row${rows.length === 1 ? '' : 's'} and columns ${headers.slice(0, 4).join(', ')}.`
  }

  const lines = artifact.content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, 3)

  return lines.join('\n') || truncateText(artifact.content.replace(/\s+/g, ' ').trim(), 180)
})
</script>

<template>
  <div class="rounded-xl border border-warning/30 bg-warning/5 p-3.5">
    <div class="flex items-start gap-3">
      <UIcon name="i-lucide-message-circle-warning" class="mt-0.5 size-4 shrink-0 text-[var(--color-warning-500)]" />
      <div class="min-w-0 flex-1 space-y-2">
        <div class="flex items-baseline justify-between gap-2">
          <p class="truncate text-sm font-medium text-highlighted">
            {{ review.task_title }}
          </p>
          <span class="shrink-0 text-xs text-dimmed">{{ formatRelativeTime(review.created_at) }}</span>
        </div>
        <p class="text-sm text-muted">
          {{ review.review_message || 'A document is ready for your review.' }}
        </p>

        <div v-if="review.output_artifact" class="rounded-lg border border-default bg-default/80 p-2.5">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-file-text" class="size-3.5 shrink-0 text-muted" />
            <p class="min-w-0 flex-1 truncate text-sm text-highlighted">
              {{ review.output_artifact.title }}
            </p>
            <UBadge
              :color="artifactTypeColorMap[review.output_artifact.type]"
              variant="soft"
              size="xs"
            >
              {{ review.output_artifact.type }}
            </UBadge>
          </div>
          <pre class="mt-1.5 line-clamp-3 whitespace-pre-wrap break-words text-xs leading-5 text-dimmed">{{ artifactPreview }}</pre>
        </div>

        <div class="flex items-center gap-2">
          <UButton
            color="success"
            size="xs"
            :loading="pendingStatus === 'approved'"
            @click="emit('resolve', { id: review.id, status: 'approved' })"
          >
            Approve
          </UButton>
          <UButton
            color="error"
            variant="soft"
            size="xs"
            :loading="pendingStatus === 'rejected'"
            @click="emit('resolve', { id: review.id, status: 'rejected' })"
          >
            Reject
          </UButton>
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            :to="`/runs/${review.run_id}`"
          >
            View full
          </UButton>
        </div>
      </div>
    </div>
  </div>
</template>
