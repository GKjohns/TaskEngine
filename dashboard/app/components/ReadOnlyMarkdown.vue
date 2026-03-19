<script setup lang="ts">
import { Mathematics } from '@tiptap/extension-mathematics'

type ContentFormat = 'markdown' | 'text' | 'json' | 'csv'

const props = withDefaults(defineProps<{
  content?: string | null
  format?: ContentFormat
  mono?: boolean
  surface?: 'subtle' | 'plain'
}>(), {
  content: '',
  format: 'markdown',
  mono: false,
  surface: 'subtle'
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
const editorBaseClass = computed(() => props.surface === 'plain'
  ? 'min-h-0 bg-transparent !px-0 !py-0'
  : 'min-h-0 rounded-xl bg-elevated/40 !px-6 !py-6')
const mathExtensions = [
  Mathematics.configure({
    katexOptions: {
      strict: 'ignore',
      throwOnError: false
    }
  })
]
</script>

<template>
  <ClientOnly>
    <UEditor
      :model-value="renderedContent"
      content-type="markdown"
      :editable="false"
      :image="false"
      :mention="false"
      :extensions="mathExtensions"
      :ui="{
        root: 'w-full',
        base: editorBaseClass,
        content: editorContentClass
      }"
    />

    <template #fallback>
      <div :class="props.surface === 'plain' ? 'text-sm text-muted' : 'rounded-xl bg-elevated/40 p-4 text-sm text-muted'">
        Loading content...
      </div>
    </template>
  </ClientOnly>
</template>
