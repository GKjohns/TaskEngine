<script setup lang="ts">
defineProps<{
  size?: number
  showWordmark?: boolean
}>()
</script>

<template>
  <div class="flex items-center gap-1.5">
    <svg
      :width="size ?? 24"
      :height="size ?? 24"
      viewBox="0 0 80 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect
        x="12"
        y="14"
        width="36"
        height="10"
        rx="2"
        fill="var(--ui-primary)"
      />
      <rect
        x="12"
        y="35"
        width="36"
        height="10"
        rx="2"
        fill="var(--ui-primary)"
      />
      <rect
        x="12"
        y="56"
        width="36"
        height="10"
        rx="2"
        fill="var(--ui-primary)"
      />
      <polygon points="58,30 58,54 72,42" fill="var(--ui-primary)" />
    </svg>

    <span
      v-if="showWordmark !== false"
      class="text-base font-bold tracking-tight"
      style="color: var(--ui-primary)"
    >
      Task Engine
    </span>
  </div>
</template>
