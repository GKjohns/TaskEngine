<script setup lang="ts">
const route = useRoute()

const taskId = computed(() => route.params.id as string)
</script>

<template>
  <DashboardPage :title="`Task ${taskId}`">
    <PageEmptyState
      title="Task detail placeholder"
      description="This view will show task metadata and the generated plan graph once Sprint 1 work is in place."
      icon="i-lucide-workflow"
    />
  </DashboardPage>
</template>
