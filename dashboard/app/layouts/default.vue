<script setup lang="ts">
const route = useRoute()
const open = ref(false)
const { pendingReviewCount } = useDashboard()
const { isOpen: isChatOpen, openChat } = useGlobalChat()

const links = [
  { id: 'home', label: 'Home', icon: 'i-lucide-house', to: '/' },
  { id: 'chat', label: 'Chat', icon: 'i-lucide-message-square', to: '/chat' },
  { id: 'reviews', label: 'Reviews', icon: 'i-lucide-message-circle-warning', to: '/reviews' },
  { id: 'tasks', label: 'Tasks', icon: 'i-lucide-list-checks', to: '/tasks' },
  { id: 'plans', label: 'Workflows', icon: 'i-lucide-workflow', to: '/plans' },
  { id: 'jobs', label: 'Schedules', icon: 'i-lucide-clock-3', to: '/jobs' },
  { id: 'artifacts', label: 'Documents', icon: 'i-lucide-file-text', to: '/artifacts' },
  { id: 'runs', label: 'Activity', icon: 'i-lucide-play-circle', to: '/runs' }
] as const

function isActiveLink(path: string) {
  if (path === '/') return route.path === '/'
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
        <NuxtLink to="/" class="flex w-full items-center justify-center px-1">
          <AppLogo :size="collapsed ? 24 : 32" :show-wordmark="!collapsed" />
        </NuxtLink>
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

    <ChatSlideover />

    <div v-if="!isChatOpen && !route.path.startsWith('/chat')" class="pointer-events-none fixed right-5 bottom-5 z-20">
      <UTooltip text="Open chat (C)" :content="{ side: 'left' }">
        <UButton
          color="primary"
          size="lg"
          icon="i-lucide-message-square"
          class="pointer-events-auto rounded-full shadow-lg"
          @click="openChat"
        >
          Chat
        </UButton>
      </UTooltip>
    </div>
  </UDashboardGroup>
</template>
