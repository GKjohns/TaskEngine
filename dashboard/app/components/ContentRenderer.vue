<script setup lang="ts">
type ContentFormat = 'auto' | 'json' | 'markdown' | 'text'

const props = withDefaults(defineProps<{
  content?: string | null
  format?: ContentFormat
  compact?: boolean
}>(), {
  content: '',
  format: 'auto',
  compact: false
})

function looksLikeJson(value: string): boolean {
  const trimmed = value.trim()
  if ((!trimmed.startsWith('{') && !trimmed.startsWith('[')) || trimmed.length < 2) {
    return false
  }

  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

function looksLikeMarkdown(value: string): boolean {
  const indicators = [
    /^#{1,6}\s/m,
    /\*\*.+?\*\*/,
    /\[.+?\]\(.+?\)/,
    /^```/m,
    /^[-*+]\s/m,
    /^\d+\.\s/m,
    /^>\s/m
  ]

  let matches = 0

  for (const pattern of indicators) {
    if (pattern.test(value)) {
      matches++
    }
  }

  return matches >= 2
}

const detectedFormat = computed<Exclude<ContentFormat, 'auto'>>(() => {
  if (props.format !== 'auto') {
    return props.format
  }

  const value = props.content?.trim() || ''

  if (!value) {
    return 'text'
  }

  if (looksLikeJson(value)) {
    return 'json'
  }

  if (looksLikeMarkdown(value)) {
    return 'markdown'
  }

  return 'text'
})
</script>

<template>
  <JsonViewer
    v-if="detectedFormat === 'json'"
    :data="content"
    :compact="compact"
  />

  <ReadOnlyMarkdown
    v-else-if="detectedFormat === 'markdown'"
    :content="content!"
  />

  <div
    v-else
    class="rounded-xl border border-default bg-elevated/40 text-sm"
    :class="compact ? 'p-3' : 'p-4'"
  >
    <pre class="whitespace-pre-wrap break-words">{{ content }}</pre>
  </div>
</template>
