<script setup lang="ts">
const route = useRoute()

const runId = computed(() => route.params.id as string)
</script>

<template>
  <DashboardPage :title="`Run ${runId}`">
    <PageEmptyState
      title="Run inspector placeholder"
      description="This route is reserved for the run timeline, node execution details, and logs."
      icon="i-lucide-list-tree"
    />
  </DashboardPage>
</template>
