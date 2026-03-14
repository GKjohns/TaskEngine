<script setup lang="ts">
const route = useRoute()

const links = [{
  label: 'Tasks',
  icon: 'i-lucide-list-checks',
  to: '/tasks'
}, {
  label: 'Runs',
  icon: 'i-lucide-play-circle',
  to: '/runs'
}, {
  label: 'Artifacts',
  icon: 'i-lucide-file-text',
  to: '/artifacts'
}, {
  label: 'Reviews',
  icon: 'i-lucide-message-circle-warning',
  to: '/reviews'
}, {
  label: 'Jobs',
  icon: 'i-lucide-clock',
  to: '/jobs'
}]
</script>

<template>
  <div class="min-h-screen bg-default text-default lg:flex">
    <aside class="flex flex-col border-b border-default bg-elevated/40 lg:min-h-screen lg:w-72 lg:border-b-0 lg:border-r">
      <div class="px-6 py-5">
        <AppLogo :size="22" />
      </div>

      <nav class="space-y-1 px-3 pb-6">
        <NuxtLink
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors"
          :class="route.path === link.to || route.path.startsWith(`${link.to}/`)
            ? 'bg-primary/10 text-highlighted'
            : 'text-muted hover:bg-elevated hover:text-highlighted'"
        >
          <UIcon :name="link.icon" class="size-4" />
          <span>{{ link.label }}</span>
        </NuxtLink>
      </nav>

      <div class="mt-auto border-t border-default px-5 py-4">
        <UColorModeButton variant="ghost" color="neutral" />
      </div>
    </aside>

    <main class="min-w-0 flex-1">
      <slot />
    </main>
  </div>
</template>
