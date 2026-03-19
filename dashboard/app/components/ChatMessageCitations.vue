<script setup lang="ts">
import type { WebCitation } from '../utils/chatToolParsers'

defineProps<{
  citations: WebCitation[]
}>()
</script>

<template>
  <div v-if="citations.length" class="space-y-2">
    <p class="text-[11px] font-medium uppercase tracking-wide text-muted">
      Sources
    </p>
    <div class="flex flex-wrap gap-2">
      <a
        v-for="citation in citations"
        :key="citation.url"
        :href="citation.url"
        target="_blank"
        rel="noreferrer"
        class="inline-flex max-w-full items-center gap-1.5 rounded-full border border-default bg-elevated/40 px-2.5 py-1 text-[11px] text-primary transition-colors hover:bg-elevated"
      >
        <span class="truncate">{{ citation.label }}</span>
        <UIcon name="i-lucide-arrow-up-right" class="size-3 shrink-0" />
      </a>
    </div>
  </div>
</template>
