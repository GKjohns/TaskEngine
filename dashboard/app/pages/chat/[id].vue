<script setup lang="ts">
const route = useRoute()

const sessionId = computed(() => {
  return typeof route.params.id === 'string' ? route.params.id : null
})
</script>

<template>
  <UDashboardPanel
    class="min-h-0"
    :ui="{ body: 'p-0 sm:p-0 overscroll-none' }"
  >
    <template #header>
      <UDashboardNavbar title="Chat" :toggle="false">
        <template #leading>
          <UDashboardSidebarCollapse class="hidden lg:inline-flex" />
          <UDashboardSidebarToggle class="lg:hidden" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <ChatPageWorkspace :session-id="sessionId" />
    </template>
  </UDashboardPanel>
</template>
