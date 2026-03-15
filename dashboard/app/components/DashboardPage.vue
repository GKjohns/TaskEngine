<script setup lang="ts">
defineProps<{
  title: string
  actionLabel?: string
  actionTo?: string
}>()
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar :title="title">
        <template #right>
          <UButton
            v-if="actionLabel && actionTo"
            :label="actionLabel"
            :to="actionTo"
            icon="i-lucide-plus"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <slot />
    </template>
  </UDashboardPanel>
</template>
