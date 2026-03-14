<script setup lang="ts">
const route = useRoute()

const artifactId = computed(() => route.params.id as string)
</script>

<template>
  <DashboardPage :title="`Artifact ${artifactId}`">
    <PageEmptyState
      title="Artifact viewer placeholder"
      description="Artifact content, metadata, and download actions will render here in a later sprint."
      icon="i-lucide-file-search"
    />
  </DashboardPage>
</template>
