<script setup lang="ts">
type ContentFormat = 'markdown' | 'text' | 'json' | 'csv'

const props = withDefaults(defineProps<{
  content?: string | null
  format?: ContentFormat
  mono?: boolean
}>(), {
  content: '',
  format: 'markdown',
  mono: false
})

const renderedContent = computed(() => {
  const value = props.content?.trim() || ''

  if (!value) {
    return ''
  }

  if (props.format === 'markdown') {
    return value
  }

  if (props.format === 'json') {
    return `\`\`\`json\n${value}\n\`\`\``
  }

  if (props.format === 'csv') {
    return `\`\`\`csv\n${value}\n\`\`\``
  }

  if (props.mono) {
    return `\`\`\`text\n${value}\n\`\`\``
  }

  return value
})

const editorContentClass = computed(() => props.mono ? 'font-mono text-sm' : 'text-sm')
</script>

<template>
  <ClientOnly>
    <UEditor
      :model-value="renderedContent"
      content-type="markdown"
      :editable="false"
      :image="false"
      :mention="false"
      :ui="{
        root: 'w-full',
        base: 'min-h-0 rounded-xl border border-default bg-elevated/40',
        content: editorContentClass
      }"
    />

    <template #fallback>
      <div class="rounded-xl border border-default bg-elevated/40 p-4 text-sm text-muted">
        Loading content...
      </div>
    </template>
  </ClientOnly>
</template>
