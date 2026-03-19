<script setup lang="ts">
import type { Database } from '../../../shared/types/database'
import type { MemoryCategory } from '../../../shared/types/task-engine'
import { formatDateTime } from '../../utils/taskEngine'

type ChatMemory = Database['public']['Tables']['memories']['Row'] & {
  source_session_title?: string | null
}

const CATEGORY_ORDER: MemoryCategory[] = ['preference', 'workflow', 'decision', 'fact', 'general']

const categoryMeta: Record<MemoryCategory, { label: string, description: string }> = {
  preference: {
    label: 'Preferences',
    description: 'How the assistant should communicate or format results.'
  },
  workflow: {
    label: 'Workflows',
    description: 'Reusable ways of running or structuring work.'
  },
  decision: {
    label: 'Decisions',
    description: 'Choices that should stay consistent in future sessions.'
  },
  fact: {
    label: 'Facts',
    description: 'Durable details about people, teams, or project context.'
  },
  general: {
    label: 'General',
    description: 'Long-lived context that does not fit a narrower bucket.'
  }
}

const savingId = ref<string | null>(null)
const deletingId = ref<string | null>(null)
const editingId = ref<string | null>(null)
const actionError = ref('')
const draftContent = ref('')
const draftCategory = ref<MemoryCategory>('general')

const { data, status, error, refresh } = await useFetch<ChatMemory[]>('/api/chat/memories', {
  default: () => []
})

const groupedMemories = computed(() => {
  return CATEGORY_ORDER
    .map(category => ({
      category,
      label: categoryMeta[category].label,
      description: categoryMeta[category].description,
      memories: (data.value || []).filter(memory => memory.category === category)
    }))
    .filter(group => group.memories.length)
})

function beginEdit(memory: ChatMemory) {
  editingId.value = memory.id
  draftContent.value = memory.content
  draftCategory.value = memory.category
  actionError.value = ''
}

function cancelEdit() {
  editingId.value = null
  draftContent.value = ''
  draftCategory.value = 'general'
}

async function saveEdit(memoryId: string) {
  const content = draftContent.value.trim()

  if (!content) {
    actionError.value = 'Memory content cannot be empty.'
    return
  }

  savingId.value = memoryId
  actionError.value = ''

  try {
    await $fetch(`/api/chat/memories/${memoryId}`, {
      method: 'PATCH',
      body: {
        content,
        category: draftCategory.value
      }
    })
    await refresh()
    cancelEdit()
  } catch (saveError) {
    actionError.value = saveError instanceof Error ? saveError.message : 'Failed to update this memory.'
  } finally {
    savingId.value = null
  }
}

async function removeMemory(memoryId: string) {
  deletingId.value = memoryId
  actionError.value = ''

  try {
    await $fetch(`/api/chat/memories/${memoryId}`, {
      method: 'DELETE'
    })
    await refresh()

    if (editingId.value === memoryId) {
      cancelEdit()
    }
  } catch (deleteError) {
    actionError.value = deleteError instanceof Error ? deleteError.message : 'Failed to delete this memory.'
  } finally {
    deletingId.value = null
  }
}
</script>

<template>
  <DashboardPage title="Chat Memory" content-width="narrow">
    <div class="space-y-6">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div class="max-w-3xl">
          <h2 class="text-base font-semibold text-highlighted">
            Long-term memory
          </h2>
          <p class="mt-1 text-sm text-muted">
            Review what chat has remembered across sessions, tighten wording when a memory drifts, and remove anything that should stop influencing future conversations.
          </p>
        </div>

        <div class="flex flex-wrap gap-2">
          <UButton
            to="/chat"
            color="neutral"
            variant="soft"
            icon="i-lucide-message-square"
          >
            Back to chat
          </UButton>
          <UButton
            color="neutral"
            variant="soft"
            icon="i-lucide-refresh-cw"
            :loading="status === 'pending'"
            @click="refresh()"
          >
            Refresh
          </UButton>
        </div>
      </div>

      <UAlert
        v-if="error"
        color="error"
        variant="soft"
        title="Could not load memories"
        :description="error.message"
      />

      <UAlert
        v-else-if="actionError"
        color="error"
        variant="soft"
        title="Memory action failed"
        :description="actionError"
      />

      <PageEmptyState
        v-else-if="status === 'pending'"
        title="Loading memories"
        description="Pulling together the long-term context the assistant can reuse."
        icon="i-lucide-loader-circle"
      />

      <PageEmptyState
        v-else-if="!groupedMemories.length"
        title="No saved memories yet"
        description="Tell chat to remember a preference or decision, then come back here to manage it."
        icon="i-lucide-brain"
        action-label="Open chat"
        action-to="/chat"
        action-icon="i-lucide-message-square"
      />

      <template v-else>
        <section
          v-for="group in groupedMemories"
          :key="group.category"
          class="space-y-3"
        >
          <div class="flex items-center justify-between gap-3">
            <div>
              <h3 class="text-sm font-medium text-highlighted">
                {{ group.label }}
              </h3>
              <p class="mt-1 text-xs text-muted">
                {{ group.description }}
              </p>
            </div>
            <span class="text-xs text-dimmed">
              {{ group.memories.length }}
            </span>
          </div>

          <div class="space-y-3">
            <article
              v-for="memory in group.memories"
              :key="memory.id"
              class="rounded-3xl border border-default bg-default p-5"
            >
              <template v-if="editingId === memory.id">
                <div class="mx-auto max-w-xl space-y-4">
                  <UFormField label="Memory">
                    <UTextarea
                      v-model="draftContent"
                      autoresize
                      :rows="2"
                      :maxrows="8"
                      class="w-full"
                    />
                  </UFormField>

                  <UFormField label="Category">
                    <USelect
                      v-model="draftCategory"
                      :items="CATEGORY_ORDER.map(category => ({
                        label: categoryMeta[category].label,
                        value: category
                      }))"
                      class="w-full"
                    />
                  </UFormField>

                  <div class="flex flex-wrap items-center justify-between gap-3">
                    <p class="text-xs text-muted">
                      Created {{ formatDateTime(memory.created_at) }}
                    </p>

                    <div class="flex flex-wrap gap-2">
                      <UButton
                        color="neutral"
                        variant="ghost"
                        :disabled="Boolean(savingId)"
                        @click="cancelEdit"
                      >
                        Cancel
                      </UButton>
                      <UButton
                        icon="i-lucide-save"
                        :loading="savingId === memory.id"
                        @click="saveEdit(memory.id)"
                      >
                        Save
                      </UButton>
                    </div>
                  </div>
                </div>
              </template>

              <template v-else>
                <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <UBadge color="primary" variant="soft" size="xs">
                        {{ group.label }}
                      </UBadge>
                      <span class="text-xs text-muted">
                        Updated {{ formatDateTime(memory.updated_at) }}
                      </span>
                    </div>

                    <p class="mt-3 text-sm leading-6 text-highlighted">
                      {{ memory.content }}
                    </p>

                    <div class="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted">
                      <span>Created {{ formatDateTime(memory.created_at) }}</span>
                      <NuxtLink
                        v-if="memory.source_session_id"
                        :to="`/chat/${memory.source_session_id}`"
                        class="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        <UIcon name="i-lucide-link" class="size-3.5" />
                        {{ memory.source_session_title || 'Open source session' }}
                      </NuxtLink>
                    </div>
                  </div>

                  <div class="flex shrink-0 flex-wrap gap-2">
                    <UButton
                      color="neutral"
                      variant="soft"
                      icon="i-lucide-pencil"
                      @click="beginEdit(memory)"
                    >
                      Edit
                    </UButton>
                    <UButton
                      color="error"
                      variant="soft"
                      icon="i-lucide-trash-2"
                      :loading="deletingId === memory.id"
                      @click="removeMemory(memory.id)"
                    >
                      Delete
                    </UButton>
                  </div>
                </div>
              </template>
            </article>
          </div>
        </section>
      </template>
    </div>
  </DashboardPage>
</template>
