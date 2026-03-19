<script setup lang="ts">
import type { ToolEntityDetail } from '../utils/chatToolParsers'
import { statusColor } from '../utils/chatToolParsers'

const props = defineProps<{
  entity: ToolEntityDetail
}>()

const typeIcons: Record<string, string> = {
  task: 'i-lucide-square-check-big',
  artifact: 'i-lucide-file-text',
  run: 'i-lucide-play',
  review: 'i-lucide-message-circle-warning',
  memory: 'i-lucide-brain'
}

const linkLabels: Record<string, string> = {
  task: 'Open task',
  artifact: 'Open document',
  run: 'Open run',
  review: 'View reviews'
}

const skipLabels = new Set(['Status', 'Type'])

const metaText = computed(() => {
  return props.entity.meta
    .filter(m => m.label && !skipLabels.has(m.label))
    .map(m => m.value)
    .join(' · ')
})

const descriptionText = computed(() => {
  const items = props.entity.meta.filter(m => !m.label)
  return items.length ? items.map(m => m.value).join(' ') : null
})
</script>

<template>
  <div class="mt-2 flex items-start gap-2">
    <UIcon
      :name="typeIcons[entity.type] || 'i-lucide-box'"
      class="mt-0.5 size-3.5 shrink-0 text-muted"
    />
    <div class="min-w-0 flex-1">
      <p class="text-xs font-medium text-highlighted leading-tight break-words">
        {{ entity.title }}
      </p>
      <div class="mt-0.5 flex items-center justify-between gap-2">
        <div class="flex min-w-0 flex-wrap items-center gap-1.5">
          <UBadge
            v-if="entity.status"
            :color="statusColor(entity.status)"
            variant="soft"
            size="xs"
          >
            {{ entity.status.replace(/_/g, ' ') }}
          </UBadge>
          <span v-if="metaText" class="truncate text-[11px] text-muted">
            {{ metaText }}
          </span>
        </div>
        <NuxtLink
          v-if="entity.link"
          :to="entity.link"
          class="shrink-0 inline-flex items-center gap-0.5 text-[11px] font-medium text-primary hover:underline"
        >
          {{ linkLabels[entity.type] || 'Open' }}
          <UIcon name="i-lucide-arrow-up-right" class="size-3" />
        </NuxtLink>
      </div>
      <p
        v-if="descriptionText"
        class="mt-0.5 truncate text-[11px] text-muted"
      >
        {{ descriptionText }}
      </p>
    </div>
  </div>
</template>
