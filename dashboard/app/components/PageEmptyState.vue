<script setup lang="ts">
defineProps<{
  title: string
  description: string
  icon?: string
  actionLabel?: string
  actionTo?: string
  actionIcon?: string
}>()
</script>

<template>
  <div class="rounded-2xl bg-elevated/35 p-6">
    <div class="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
      <UIcon :name="icon || 'i-lucide-info'" class="size-5" />
    </div>

    <h2 class="text-base font-semibold text-highlighted">
      {{ title }}
    </h2>
    <p class="mt-2 max-w-2xl text-sm text-muted">
      {{ description }}
    </p>

    <UButton
      v-if="actionLabel"
      :to="actionTo"
      :icon="actionIcon || 'i-lucide-arrow-right'"
      size="sm"
      class="mt-4"
    >
      {{ actionLabel }}
    </UButton>
  </div>
</template>
