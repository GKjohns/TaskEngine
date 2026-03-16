<script setup lang="ts">
import type { ArtifactType } from '../../shared/types/task-engine'
import { artifactTypeColorMap, formatDateTime, parseCsvRows, truncateText } from '../utils/taskEngine'

type PreviewArtifact = {
  id: string
  type: ArtifactType
  title: string
  content: string | null
  description: string | null
  storage_path: string | null
  created_at: string
  created_by_node_id?: string | null
  task_title?: string | null
  produced_by_run_id?: string | null
  download_url?: string | null
}

const props = withDefaults(defineProps<{
  artifact: PreviewArtifact
  compact?: boolean
  showActions?: boolean
  showHeader?: boolean
  showFooter?: boolean
  surface?: 'card' | 'subtle' | 'plain'
}>(), {
  compact: false,
  showActions: true,
  showHeader: true,
  showFooter: true,
  surface: 'card'
})

const previewContent = computed(() => {
  const content = props.artifact.content?.trim()

  if (!content) {
    return ''
  }

  if (props.artifact.type === 'json') {
    try {
      const parsed = JSON.parse(content)

      if (Array.isArray(parsed)) {
        return `JSON document with ${parsed.length} item${parsed.length === 1 ? '' : 's'}.`
      }

      if (parsed && typeof parsed === 'object') {
        const keys = Object.keys(parsed)
        return `JSON document with ${keys.length} top-level field${keys.length === 1 ? '' : 's'}${keys.length ? `: ${keys.slice(0, 4).join(', ')}` : ''}.`
      }
    } catch {
      return truncateText(content.replace(/\s+/g, ' '), props.compact ? 120 : 180)
    }
  }

  if (props.artifact.type === 'csv') {
    const rows = parseCsvRows(content)
    const headers = Object.keys(rows[0] || {}).filter(key => key !== '_row')

    return rows.length
      ? `CSV document with ${rows.length} row${rows.length === 1 ? '' : 's'}${headers.length ? ` and columns ${headers.slice(0, 5).join(', ')}` : ''}.`
      : 'CSV document with headers but no data rows.'
  }

  const maxLines = props.artifact.type === 'markdown' ? 5 : 3

  return content
    .split(/\r?\n/)
    .filter(line => line.trim())
    .slice(0, maxLines)
    .join('\n')
})

const previewFormat = computed<'markdown' | 'text'>(() => props.artifact.type === 'markdown' ? 'markdown' : 'text')

const footerLabel = computed(() => {
  if (props.artifact.task_title) {
    return props.artifact.produced_by_run_id
      ? `Created by ${props.artifact.task_title} in activity ${props.artifact.produced_by_run_id}`
      : `Created by ${props.artifact.task_title}`
  }

  return props.artifact.created_by_node_id ? 'Created during workflow execution' : 'Stored document'
})

const canDownload = computed(() => Boolean(props.artifact.download_url || props.artifact.content))
const containerClass = computed(() => {
  const spacing = props.compact ? 'p-3 sm:p-3' : 'p-4 sm:p-4'

  if (props.surface === 'plain') {
    return spacing
  }

  if (props.surface === 'subtle') {
    return `rounded-xl bg-elevated/35 ${spacing}`
  }

  return `rounded-xl border border-default bg-default ${spacing}`
})

function getDownloadFileName(artifact: PreviewArtifact) {
  const extensionMap = {
    markdown: 'md',
    text: 'txt',
    json: 'json',
    csv: 'csv'
  } as const

  const safeTitle = (artifact.title || 'document')
    .trim()
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '') || 'document'

  return `${safeTitle}.${extensionMap[artifact.type]}`
}

function downloadArtifact() {
  if (!import.meta.client) {
    return
  }

  if (props.artifact.download_url) {
    window.open(props.artifact.download_url, '_blank', 'noopener,noreferrer')
    return
  }

  if (!props.artifact.content) {
    return
  }

  const blob = new Blob([props.artifact.content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = getDownloadFileName(props.artifact)
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div :class="containerClass">
    <div class="space-y-3">
      <div v-if="props.showHeader" class="flex items-start justify-between gap-3">
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

      <ReadOnlyMarkdown
        v-if="previewContent && previewFormat === 'markdown'"
        :content="previewContent"
        format="markdown"
        :surface="props.surface === 'plain' ? 'plain' : 'subtle'"
      />

      <div
        v-else-if="previewContent"
        class="rounded-xl bg-elevated/45 p-3"
      >
        <pre class="whitespace-pre-wrap break-words text-sm text-dimmed">{{ previewContent }}</pre>
      </div>

      <p v-else class="text-sm text-dimmed">
        Stored in Supabase Storage. Open the document for the full download.
      </p>

      <div v-if="props.showFooter" class="flex items-center justify-between gap-3 text-xs text-muted">
        <span class="truncate">{{ footerLabel }}</span>
        <div v-if="props.showActions" class="flex shrink-0 items-center gap-1">
          <UButton
            v-if="canDownload"
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-lucide-download"
            @click="downloadArtifact"
          >
            Download
          </UButton>
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            :aria-label="`Open document ${artifact.title}`"
            :to="`/artifacts/${artifact.id}`"
          >
            Open
          </UButton>
        </div>
      </div>
    </div>
  </div>
</template>
