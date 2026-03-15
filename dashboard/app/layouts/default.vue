<script setup lang="ts">
const route = useRoute()
const open = ref(false)
const { pendingReviewCount } = useDashboard()

const links = [
  { id: 'tasks', label: 'Tasks', icon: 'i-lucide-list-checks', to: '/tasks' },
  { id: 'runs', label: 'Runs', icon: 'i-lucide-play-circle', to: '/runs' },
  { id: 'artifacts', label: 'Artifacts', icon: 'i-lucide-file-text', to: '/artifacts' },
  { id: 'reviews', label: 'Reviews', icon: 'i-lucide-message-circle-warning', to: '/reviews' },
  { id: 'jobs', label: 'Jobs', icon: 'i-lucide-clock', to: '/jobs' }
] as const

function isActiveLink(path: string) {
  return route.path === path || route.path.startsWith(`${path}/`)
}
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
        <div class="flex w-full items-center justify-center px-1">
          <AppLogo :size="collapsed ? 24 : 32" :show-wordmark="!collapsed" />
        </div>
      </template>

      <template #default="{ collapsed }">
        <nav class="space-y-1 px-2 py-2">
          <UTooltip
            v-for="link in links"
            :key="link.id"
            :text="link.label"
            :disabled="!collapsed"
            :content="{ side: 'right' }"
          >
            <NuxtLink
              :to="link.to"
              class="flex items-center justify-between rounded-lg px-3 py-2 text-sm transition"
              :class="[
                isActiveLink(link.to)
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted hover:bg-elevated hover:text-highlighted',
                collapsed ? 'justify-center px-2' : ''
              ]"
              @click="open = false"
            >
              <div class="flex min-w-0 items-center" :class="collapsed ? 'w-full justify-center' : 'gap-3'">
                <UIcon :name="link.icon" class="size-4 shrink-0" />
                <span v-if="!collapsed" class="truncate">{{ link.label }}</span>
              </div>

              <UBadge
                v-if="!collapsed && link.id === 'reviews' && pendingReviewCount"
                color="warning"
                variant="soft"
                size="xs"
              >
                {{ pendingReviewCount }}
              </UBadge>
            </NuxtLink>
          </UTooltip>
        </nav>
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
