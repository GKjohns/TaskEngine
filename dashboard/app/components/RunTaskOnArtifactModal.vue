<script setup lang="ts">
import type { PlanRecord, RunRecord, TaskRecord } from '../../shared/types/task-engine'
import { taskStatusColorMap } from '../utils/taskEngine'

const props = defineProps<{
  artifactId: string
}>()

const router = useRouter()
const open = ref(false)
const pending = ref(false)
const errorMessage = ref('')
const selectedTaskId = ref<string | null>(null)

interface TaskWithPlan extends TaskRecord {
  current_plan?: Pick<PlanRecord, 'id' | 'title' | 'version'> | null
  plans?: PlanRecord[]
}

const { data: tasks, status: loadingStatus, refresh: loadTasks } = useLazyFetch<TaskWithPlan[]>('/api/tasks', {
  default: () => [],
  immediate: false
})

watch(open, (isOpen) => {
  if (isOpen) {
    loadTasks()
  }
})

const activeTasks = computed(() =>
  (tasks.value || []).filter(t => t.status === 'active' && (t.plan_id || t.current_plan || t.plans?.length))
)

watch(open, (isOpen) => {
  if (isOpen) {
    selectedTaskId.value = null
    errorMessage.value = ''
  }
})

async function startRun() {
  if (!selectedTaskId.value) return

  pending.value = true
  errorMessage.value = ''

  try {
    const run = await $fetch<RunRecord>('/api/runs', {
      method: 'POST',
      body: {
        task_id: selectedTaskId.value,
        artifact_ids: [props.artifactId]
      }
    })

    open.value = false
    await router.push(`/runs/${run.id}`)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Failed to start the run.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Run a task on this artifact" description="Pick a task to execute with this artifact as input.">
    <UButton icon="i-lucide-play" variant="soft" @click="open = true">
      Run a task
    </UButton>

    <template #body>
      <div class="space-y-4">
        <UAlert
          v-if="errorMessage"
          color="error"
          variant="soft"
          :description="errorMessage"
        />

        <div v-if="loadingStatus === 'pending'" class="flex items-center justify-center py-8">
          <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin text-muted" />
        </div>

        <div v-else-if="activeTasks.length" class="max-h-80 space-y-1.5 overflow-y-auto">
          <button
            v-for="task in activeTasks"
            :key="task.id"
            type="button"
            class="flex w-full items-start gap-3 rounded-lg border p-3 text-left transition"
            :class="selectedTaskId === task.id
              ? 'border-primary bg-primary/5'
              : 'border-default hover:border-primary/40 hover:bg-elevated/60'"
            @click="selectedTaskId = task.id"
          >
            <div class="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border transition"
              :class="selectedTaskId === task.id
                ? 'border-primary bg-primary'
                : 'border-default'"
            >
              <div v-if="selectedTaskId === task.id" class="size-1.5 rounded-full bg-white" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <p class="truncate text-sm font-medium text-highlighted">
                  {{ task.title }}
                </p>
                <UBadge :color="taskStatusColorMap[task.status]" variant="soft" size="xs">
                  {{ task.status }}
                </UBadge>
              </div>
              <p class="mt-0.5 line-clamp-2 text-xs text-muted">
                {{ task.prompt }}
              </p>
            </div>
          </button>
        </div>

        <div v-else class="rounded-lg border border-default bg-elevated/40 p-4 text-center">
          <p class="text-sm text-muted">
            No active tasks with plans available.
          </p>
          <UButton class="mt-2" size="sm" to="/tasks/new">
            Create a task
          </UButton>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="ghost" @click="open = false">
          Cancel
        </UButton>
        <UButton icon="i-lucide-play" :loading="pending" :disabled="!selectedTaskId" @click="startRun">
          Run task
        </UButton>
      </div>
    </template>
  </UModal>
</template>
