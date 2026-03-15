<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const open = ref(false)

const links: NavigationMenuItem[][] = [[{
  label: 'Tasks',
  icon: 'i-lucide-list-checks',
  to: '/tasks',
  onSelect: () => { open.value = false }
}, {
  label: 'Runs',
  icon: 'i-lucide-play-circle',
  to: '/runs',
  onSelect: () => { open.value = false }
}, {
  label: 'Artifacts',
  icon: 'i-lucide-file-text',
  to: '/artifacts',
  onSelect: () => { open.value = false }
}, {
  label: 'Reviews',
  icon: 'i-lucide-message-circle-warning',
  to: '/reviews',
  onSelect: () => { open.value = false }
}, {
  label: 'Jobs',
  icon: 'i-lucide-clock',
  to: '/jobs',
  onSelect: () => { open.value = false }
}]]
</script>

<template>
  <UDashboardGroup>
    <UDashboardSidebar
      id="default"
      v-model:open="open"
      collapsible
      resizable
      class="bg-elevated/25"
      :ui="{ footer: 'lg:border-t lg:border-default' }"
    >
      <template #header="{ collapsed }">
        <div class="flex items-center" :class="collapsed ? 'justify-center' : 'gap-2.5 px-1'">
          <AppLogo :size="collapsed ? 20 : 22" :show-wordmark="!collapsed" />
        </div>
      </template>

      <template #default="{ collapsed }">
        <UNavigationMenu
          :collapsed="collapsed"
          :items="links[0]"
          orientation="vertical"
          tooltip
        />
      </template>

      <template #footer="{ collapsed }">
        <div class="flex items-center" :class="collapsed ? 'justify-center' : ''">
          <UColorModeButton />
        </div>
      </template>
    </UDashboardSidebar>

    <slot />
  </UDashboardGroup>
</template>
