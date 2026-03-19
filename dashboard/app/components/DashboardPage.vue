<script setup lang="ts">
const props = withDefaults(defineProps<{
  title: string
  contentWidth?: 'full' | 'wide' | 'narrow'
}>(), {
  contentWidth: 'full'
})

const contentClass = computed(() => {
  switch (props.contentWidth) {
    case 'narrow':
      return 'mx-auto w-full max-w-5xl'
    case 'wide':
      return 'mx-auto w-full max-w-6xl'
    default:
      return 'w-full'
  }
})
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
      <div :class="contentClass">
        <slot />
      </div>
    </template>
  </UDashboardPanel>
</template>
