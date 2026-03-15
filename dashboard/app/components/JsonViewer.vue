<script setup lang="ts">
const props = withDefaults(defineProps<{
  data: string | Record<string, unknown> | unknown[] | null | undefined
  maxCollapsedLines?: number
  compact?: boolean
}>(), {
  maxCollapsedLines: 30,
  compact: false
})

const parsed = computed(() => {
  if (typeof props.data === 'string') {
    try {
      return { value: JSON.parse(props.data), valid: true }
    } catch {
      return { value: null, valid: false }
    }
  }

  return { value: props.data, valid: props.data !== null && props.data !== undefined }
})

const rawInput = computed(() => {
  if (typeof props.data === 'string') {
    return props.data
  }

  if (props.data === null || props.data === undefined) {
    return ''
  }

  return JSON.stringify(props.data)
})

const prettyJson = computed(() => {
  if (!parsed.value.valid) {
    return rawInput.value
  }

  return JSON.stringify(parsed.value.value, null, 2)
})

const lineCount = computed(() => prettyJson.value.split('\n').length)
const isLarge = computed(() => lineCount.value > props.maxCollapsedLines)

const showCode = ref(false)
const expanded = ref(false)
const copied = ref(false)

function highlightJson(json: string): string {
  const escaped = json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  return escaped.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    (match) => {
      let cls = 'json-number'

      if (/^"/.test(match)) {
        cls = /:$/.test(match) ? 'json-key' : 'json-string'
      } else if (/true|false/.test(match)) {
        cls = 'json-boolean'
      } else if (/null/.test(match)) {
        cls = 'json-null'
      }

      return `<span class="${cls}">${match}</span>`
    }
  )
}

const highlightedPretty = computed(() => highlightJson(prettyJson.value))
const highlightedRaw = computed(() => highlightJson(rawInput.value))

async function copyToClipboard() {
  try {
    await navigator.clipboard.writeText(prettyJson.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    // Clipboard API not available
  }
}
</script>

<template>
  <div class="rounded-xl border border-default bg-elevated/40 overflow-hidden">
    <div
      class="flex items-center justify-between gap-2 border-b border-default bg-elevated/20"
      :class="compact ? 'px-2.5 py-1.5' : 'px-3 py-2'"
    >
      <UBadge color="info" variant="soft" size="xs">
        JSON
      </UBadge>

      <div class="flex items-center gap-1">
        <UButton
          :icon="showCode ? 'i-lucide-braces' : 'i-lucide-file-code'"
          color="neutral"
          variant="ghost"
          size="xs"
          @click="showCode = !showCode"
        >
          {{ showCode ? 'Pretty' : 'Code' }}
        </UButton>
        <UButton
          :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
          color="neutral"
          variant="ghost"
          size="xs"
          @click="copyToClipboard"
        >
          {{ copied ? 'Copied' : 'Copy' }}
        </UButton>
      </div>
    </div>

    <div
      class="overflow-auto"
      :class="[
        compact ? 'p-3' : 'p-4',
        isLarge && !expanded ? 'max-h-96' : ''
      ]"
    >
      <pre
        v-if="showCode"
        class="font-mono text-xs leading-5 whitespace-pre-wrap break-all"
        v-html="highlightedRaw"
      />
      <pre
        v-else
        class="font-mono text-sm whitespace-pre-wrap break-all"
        v-html="highlightedPretty"
      />
    </div>

    <button
      v-if="isLarge && !expanded"
      class="w-full border-t border-default px-3 py-2 text-center text-xs text-muted hover:text-highlighted hover:bg-elevated/60 transition-colors cursor-pointer"
      @click="expanded = true"
    >
      Show all {{ lineCount }} lines
    </button>
  </div>
</template>
