<script setup lang="ts">
const route = useRoute()

const sessionId = computed(() => {
  return typeof route.params.id === 'string' ? route.params.id : null
})
</script>

<template>
  <DashboardPage title="Chat">
    <ChatPageWorkspace :session-id="sessionId" />
  </DashboardPage>
</template>
