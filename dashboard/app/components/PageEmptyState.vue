<script setup lang="ts">
defineProps<{
  title: string
  description: string
  icon?: string
}>()
</script>

<template>
  <div class="rounded-xl border border-default bg-elevated/40 p-6">
    <div class="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
      <UIcon :name="icon || 'i-lucide-info'" class="size-5" />
    </div>

    <h2 class="text-base font-semibold text-highlighted">
      {{ title }}
    </h2>
    <p class="mt-2 max-w-2xl text-sm text-muted">
      {{ description }}
    </p>
  </div>
</template>
