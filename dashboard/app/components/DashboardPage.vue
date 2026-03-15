<script setup lang="ts">
defineProps<{
  title: string
}>()
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar :title="title" :toggle="false">
        <template #leading>
          <UDashboardSidebarCollapse class="hidden lg:inline-flex" />
          <UDashboardSidebarToggle class="lg:hidden" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <slot />
    </template>
  </UDashboardPanel>
</template>
