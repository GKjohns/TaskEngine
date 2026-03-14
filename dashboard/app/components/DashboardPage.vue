<script setup lang="ts">
defineProps<{
  title: string
  actionLabel?: string
  actionTo?: string
}>()
</script>

<template>
  <section class="min-h-screen">
    <header class="border-b border-default px-6 py-4">
      <div class="flex items-center justify-between gap-4">
        <div>
          <h1 class="text-xl font-semibold text-highlighted">
            {{ title }}
          </h1>
        </div>

        <UButton
          v-if="actionLabel && actionTo"
          :label="actionLabel"
          :to="actionTo"
          icon="i-lucide-plus"
        />
      </div>
    </header>

    <div class="p-6">
      <slot />
    </div>
  </section>
</template>
