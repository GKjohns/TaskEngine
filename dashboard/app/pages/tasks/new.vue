<script setup lang="ts">
import { z } from 'zod'
import type { ArtifactRecord, Plan, PlanRecord, TaskTriggerType } from '../../../shared/types/task-engine'
import { artifactTypeColorMap } from '../../utils/taskEngine'
import { suggestArtifactIds, taskLikelyNeedsDocuments } from '../../utils/artifactSelection'

const router = useRouter()
const route = useRoute()

const preselectedPlanId = computed(() => route.query.plan_id as string | undefined)

const taskSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200, 'Title is too long'),
  prompt: z.string().trim().min(1, 'Prompt is required'),
  trigger_type: z.enum(['manual', 'scheduled', 'heartbeat']),
  next_run_at: z.string()
}).superRefine((value, ctx) => {
  if (value.trigger_type !== 'manual' && !value.next_run_at) {
    ctx.addIssue({
      code: 'custom',
      path: ['next_run_at'],
      message: 'Next run time is required for scheduled and heartbeat tasks.'
    })
  }
})

type TaskFormState = z.output<typeof taskSchema>

const triggerOptions: Array<{ label: string, value: TaskTriggerType, description: string }> = [
  {
    label: 'Manual',
    value: 'manual',
    description: 'Run it only when you explicitly trigger execution.'
  },
  {
    label: 'Scheduled',
    value: 'scheduled',
    description: 'Create a durable job that executes on a recurring schedule.'
  },
  {
    label: 'Heartbeat',
    value: 'heartbeat',
    description: 'Use a recurring heartbeat to check for new work or changes.'
  }
]

type PlanSource = 'existing' | 'generate'

const planSource = ref<PlanSource>(preselectedPlanId.value ? 'existing' : 'generate')
const selectedPlanId = ref<string | null>(preselectedPlanId.value || null)
const selectedArtifactIds = ref<string[]>([])
const artifactSelectionMode = ref<'suggested' | 'manual'>('suggested')

const form = reactive<TaskFormState>({
  title: '',
  prompt: '',
  trigger_type: 'manual' as TaskTriggerType,
  next_run_at: ''
})

const pending = ref(false)
const creating = ref(false)
const errorMessage = ref('')
const generatedPlan = ref<Plan | null>(null)
const validationErrors = ref<string[]>([])

const { data: existingPlans, status: plansLoadStatus } = useFetch<PlanRecord[]>('/api/plans', {
  default: () => []
})

const { data: artifacts, status: artifactsLoadStatus } = useFetch<ArtifactRecord[]>('/api/artifacts', {
  default: () => []
})

function toggleArtifact(id: string) {
  artifactSelectionMode.value = 'manual'
  const index = selectedArtifactIds.value.indexOf(id)
  if (index > -1) {
    selectedArtifactIds.value.splice(index, 1)
  } else {
    selectedArtifactIds.value.push(id)
  }
}

const selectedExistingPlan = computed(() =>
  (existingPlans.value || []).find(p => p.id === selectedPlanId.value) || null
)

const suggestedArtifactIds = computed(() => suggestArtifactIds({
  artifacts: artifacts.value || [],
  title: form.title,
  prompt: form.prompt,
  planTitle: selectedExistingPlan.value?.title,
  planPrompt: selectedExistingPlan.value?.prompt
}))

const promptNeedsDocuments = computed(() => taskLikelyNeedsDocuments({
  title: form.title,
  prompt: form.prompt,
  planTitle: selectedExistingPlan.value?.title,
  planPrompt: selectedExistingPlan.value?.prompt
}))

const canPreview = computed(() => {
  if (planSource.value === 'existing') {
    return form.title.trim() && form.prompt.trim() && selectedPlanId.value
  }
  return form.title.trim() && form.prompt.trim()
})

const readyToCreate = computed(() => {
  if (planSource.value === 'existing') {
    return form.title.trim() && form.prompt.trim() && selectedPlanId.value
  }
  return form.title.trim() && form.prompt.trim() && generatedPlan.value
})

watch(preselectedPlanId, async (id) => {
  if (id) {
    planSource.value = 'existing'
    selectedPlanId.value = id

    const plan = (existingPlans.value || []).find(p => p.id === id)
    if (plan) {
      form.title = form.title || plan.title
      form.prompt = form.prompt || plan.prompt || ''
    }
  }
}, { immediate: true })

watch(() => existingPlans.value, (plans) => {
  if (preselectedPlanId.value && plans?.length) {
    const plan = plans.find(p => p.id === preselectedPlanId.value)
    if (plan && !form.title) {
      form.title = plan.title
      form.prompt = plan.prompt || ''
    }
  }
})

watch(suggestedArtifactIds, (ids) => {
  if (artifactSelectionMode.value !== 'suggested') {
    return
  }

  selectedArtifactIds.value = [...ids]
}, { immediate: true })

function applySuggestedArtifacts() {
  artifactSelectionMode.value = 'suggested'
  selectedArtifactIds.value = [...suggestedArtifactIds.value]
}

function clearArtifactSelection() {
  artifactSelectionMode.value = 'manual'
  selectedArtifactIds.value = []
}

function buildScheduleConfig() {
  return form.trigger_type === 'manual' || !form.next_run_at
    ? {}
    : {
        next_run_at: new Date(form.next_run_at).toISOString()
      }
}

async function generatePreview() {
  if (planSource.value === 'existing') {
    await createTask()
    return
  }

  pending.value = true
  errorMessage.value = ''

  try {
    const response = await $fetch<{ plan: Plan, validation_errors: string[] }>('/api/plans/preview', {
      method: 'POST',
      body: { prompt: form.prompt }
    })

    generatedPlan.value = response.plan
    validationErrors.value = response.validation_errors || []
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Something went wrong while generating the plan preview.'
  } finally {
    pending.value = false
  }
}

async function createTask() {
  creating.value = true
  errorMessage.value = ''

  try {
    const body: Record<string, unknown> = {
      title: form.title,
      prompt: form.prompt,
      trigger_type: form.trigger_type,
      schedule_config: buildScheduleConfig(),
      input_artifact_ids: selectedArtifactIds.value
    }

    if (planSource.value === 'existing' && selectedPlanId.value) {
      body.plan_id = selectedPlanId.value
    } else if (generatedPlan.value) {
      body.plan_json = generatedPlan.value
    }

    const response = await $fetch<{ task: { id: string } }>('/api/tasks', {
      method: 'POST',
      body
    })

    await router.push(`/tasks/${response.task.id}`)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Something went wrong while creating the task.'
  } finally {
    creating.value = false
  }
}

function selectPlan(plan: PlanRecord) {
  selectedPlanId.value = plan.id
  if (!form.title) form.title = plan.title
  if (!form.prompt) form.prompt = plan.prompt || ''
}
</script>

<template>
  <DashboardPage title="New Task">
    <div class="mx-auto max-w-4xl space-y-6">
      <div>
        <h2 class="text-base font-semibold text-highlighted">
          Create a task
        </h2>
        <p class="mt-1 text-sm text-muted">
          Pick an existing workflow from the library or generate a new one from a prompt.
        </p>
      </div>

      <UAlert
        v-if="errorMessage"
        color="error"
        variant="soft"
        title="Task creation failed"
        :description="errorMessage"
      />

      <UCard class="border border-default">
        <div class="space-y-4">
          <div>
            <p class="text-sm font-medium text-highlighted">
              Input documents
            </p>
            <p class="mt-1 text-xs text-muted">
              Select the data this task should process. These documents are fed directly into the workflow's first steps.
            </p>
          </div>

          <UAlert
            v-if="suggestedArtifactIds.length"
            color="info"
            variant="soft"
            title="Suggested documents"
            :description="`We found ${suggestedArtifactIds.length} likely match${suggestedArtifactIds.length !== 1 ? 'es' : ''} based on the task prompt and workflow.`"
          >
            <template #actions>
              <UButton size="xs" color="info" variant="soft" @click="applySuggestedArtifacts">
                Use suggested
              </UButton>
              <UButton size="xs" color="neutral" variant="ghost" @click="clearArtifactSelection">
                Clear
              </UButton>
            </template>
          </UAlert>

          <UAlert
            v-if="promptNeedsDocuments && !selectedArtifactIds.length"
            color="warning"
            variant="soft"
            title="This task probably needs document context"
            description="Pick the documents this task should use. If you leave this empty, scheduled runs may execute without the files the prompt is referring to."
          />

          <div v-if="artifactsLoadStatus === 'pending'" class="flex items-center justify-center py-6">
            <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin text-muted" />
          </div>

          <div v-else-if="artifacts?.length" class="max-h-72 space-y-1.5 overflow-y-auto">
            <button
              v-for="artifact in artifacts"
              :key="artifact.id"
              type="button"
              class="flex w-full items-start gap-3 rounded-lg border p-3 text-left transition"
              :class="selectedArtifactIds.includes(artifact.id)
                ? 'border-primary bg-primary/5'
                : 'border-default hover:border-primary/40 hover:bg-elevated/60'"
              @click="toggleArtifact(artifact.id)"
            >
              <div
                class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border transition"
                :class="selectedArtifactIds.includes(artifact.id)
                  ? 'border-primary bg-primary text-white'
                  : 'border-default'"
              >
                <UIcon v-if="selectedArtifactIds.includes(artifact.id)" name="i-lucide-check" class="size-3" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <p class="truncate text-sm font-medium text-highlighted">
                    {{ artifact.title }}
                  </p>
                  <UBadge :color="artifactTypeColorMap[artifact.type]" variant="soft" size="xs">
                    {{ artifact.type }}
                  </UBadge>
                  <UBadge
                    v-if="suggestedArtifactIds.includes(artifact.id)"
                    color="info"
                    variant="soft"
                    size="xs"
                  >
                    Suggested
                  </UBadge>
                </div>
                <p v-if="artifact.description" class="mt-0.5 truncate text-xs text-muted">
                  {{ artifact.description }}
                </p>
              </div>
            </button>
          </div>

          <div v-else class="rounded-lg border border-default bg-elevated/40 p-4 text-center">
            <p class="text-sm text-muted">
              No documents are available yet. You can upload one from the documents page.
            </p>
          </div>

          <div v-if="selectedArtifactIds.length" class="rounded-lg bg-primary/5 px-3 py-2 text-sm text-primary">
            {{ selectedArtifactIds.length }} document{{ selectedArtifactIds.length !== 1 ? 's' : '' }} selected as input
          </div>
        </div>
      </UCard>

      <UCard class="border border-default">
        <div class="space-y-6">
          <div>
            <p class="text-sm font-medium text-highlighted">
              Workflow source
            </p>
            <p class="mt-1 text-xs text-muted">
              Choose whether to attach an existing workflow or create a fresh one from a prompt.
            </p>
            <div class="mt-3 grid gap-3 md:grid-cols-2">
              <button
                type="button"
                class="rounded-xl border p-4 text-left transition"
                :class="planSource === 'existing'
                  ? 'border-primary bg-primary/5'
                  : 'border-default hover:border-primary/50 hover:bg-elevated/60'"
                @click="planSource = 'existing'"
              >
                <div class="flex items-center gap-2">
                  <UIcon name="i-lucide-library" class="size-4 text-primary" />
                  <p class="font-medium text-highlighted">
                    Use existing workflow
                  </p>
                </div>
                <p class="mt-2 text-sm text-muted">
                  Pick a workflow from the workflow library.
                </p>
              </button>
              <button
                type="button"
                class="rounded-xl border p-4 text-left transition"
                :class="planSource === 'generate'
                  ? 'border-primary bg-primary/5'
                  : 'border-default hover:border-primary/50 hover:bg-elevated/60'"
                @click="planSource = 'generate'; selectedPlanId = null"
              >
                <div class="flex items-center gap-2">
                  <UIcon name="i-lucide-wand-sparkles" class="size-4 text-primary" />
                  <p class="font-medium text-highlighted">
                    Generate new workflow
                  </p>
                </div>
                <p class="mt-2 text-sm text-muted">
                  Describe what you need and the AI will build a workflow.
                </p>
              </button>
            </div>
          </div>

          <div v-if="planSource === 'existing'" class="space-y-3">
            <p class="text-sm font-medium text-highlighted">
              Select a workflow
            </p>

            <div v-if="plansLoadStatus === 'pending'" class="flex items-center justify-center py-6">
              <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin text-muted" />
            </div>

            <div v-else-if="existingPlans?.length" class="max-h-60 space-y-1.5 overflow-y-auto">
              <button
                v-for="p in existingPlans"
                :key="p.id"
                type="button"
                class="flex w-full items-start gap-3 rounded-lg border p-3 text-left transition"
                :class="selectedPlanId === p.id
                  ? 'border-primary bg-primary/5'
                  : 'border-default hover:border-primary/40 hover:bg-elevated/60'"
                @click="selectPlan(p)"
              >
                <div
                  class="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border transition"
                  :class="selectedPlanId === p.id
                    ? 'border-primary bg-primary'
                    : 'border-default'"
                >
                  <div v-if="selectedPlanId === p.id" class="size-1.5 rounded-full bg-white" />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <p class="truncate text-sm font-medium text-highlighted">
                      {{ p.title }}
                    </p>
                    <UBadge color="neutral" variant="outline" size="xs">
                      v{{ p.version }}
                    </UBadge>
                    <UBadge color="primary" variant="soft" size="xs">
                      {{ p.plan_json?.nodes?.length ?? 0 }} steps
                    </UBadge>
                  </div>
                  <p v-if="p.description" class="mt-0.5 truncate text-xs text-muted">
                    {{ p.description }}
                  </p>
                </div>
              </button>
            </div>

            <div v-else class="rounded-lg border border-default bg-elevated/40 p-4 text-center">
              <p class="text-sm text-muted">
                No workflows are in the library yet.
              </p>
              <UButton class="mt-2" size="sm" to="/plans/new">
                Create a workflow
              </UButton>
            </div>

            <PlanGraph
              v-if="selectedExistingPlan"
              :nodes="selectedExistingPlan.plan_json.nodes"
              class="mt-4"
            />
          </div>
        </div>
      </UCard>

      <UCard class="border border-default">
        <UForm
          :schema="taskSchema"
          :state="form"
          class="space-y-6"
          @submit="generatePreview"
        >
          <div class="grid gap-6">
            <UFormField
              name="title"
              label="Title"
              required
              description="A short label for the task in the dashboard."
            >
              <UInput
                id="task-title"
                v-model="form.title"
                class="w-full"
                placeholder="Weekly report brief"
              />
            </UFormField>

            <UFormField
              name="prompt"
              label="Prompt"
              required
              :description="planSource === 'generate'
                ? 'Describe the outcome you want so the planner can generate the right graph.'
                : 'Context for the task. The selected plan defines the workflow.'"
            >
              <UTextarea
                id="task-prompt"
                v-model="form.prompt"
                class="w-full"
                :rows="6"
                autoresize
                placeholder="Summarize this week's reports, extract key risks, and draft a short brief for review."
              />
            </UFormField>

            <UFormField
              name="trigger_type"
              label="Trigger mode"
              description="Controls when and how the task executes."
              required
            >
              <div class="grid gap-3 md:grid-cols-3">
                <button
                  v-for="option in triggerOptions"
                  :key="option.value"
                  type="button"
                  class="rounded-xl border p-4 text-left transition"
                  :class="form.trigger_type === option.value
                    ? 'border-primary bg-primary/5'
                    : 'border-default hover:border-primary/50 hover:bg-elevated/60'"
                  @click="form.trigger_type = option.value"
                >
                  <p class="font-medium text-highlighted">
                    {{ option.label }}
                  </p>
                  <p class="mt-2 text-sm text-muted">
                    {{ option.description }}
                  </p>
                </button>
              </div>
            </UFormField>

            <UFormField
              v-if="form.trigger_type !== 'manual'"
              name="next_run_at"
              label="Next run at"
              required
            >
              <UInput
                id="task-next-run"
                v-model="form.next_run_at"
                type="datetime-local"
                class="w-full"
              />
            </UFormField>
          </div>

          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <UButton color="neutral" variant="ghost" to="/tasks">
              Cancel
            </UButton>
            <UButton
              v-if="planSource === 'existing'"
              type="submit"
              icon="i-lucide-check"
              :loading="creating"
              :disabled="!readyToCreate"
            >
              Create task
            </UButton>
            <UButton
              v-else
              type="submit"
              icon="i-lucide-wand-sparkles"
              :loading="pending"
              :disabled="!canPreview"
            >
              Generate plan preview
            </UButton>
          </div>
        </UForm>
      </UCard>

      <UCard v-if="planSource === 'generate' && generatedPlan" class="border border-default">
        <div class="space-y-5">
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 class="text-base font-semibold text-highlighted">
                Generated plan
              </h3>
              <p class="mt-1 text-sm text-muted">
                Review the planned node graph before creating the task.
              </p>
            </div>

            <div class="flex flex-wrap gap-2">
              <UButton
                color="neutral"
                variant="soft"
                :loading="pending"
                @click="generatePreview"
              >
                Re-generate
              </UButton>
              <UButton icon="i-lucide-check" :loading="creating" @click="createTask">
                Create task
              </UButton>
            </div>
          </div>

          <UAlert
            v-if="validationErrors.length"
            color="warning"
            variant="soft"
            title="Plan validation warnings"
            :description="validationErrors.join(' ')"
          />

          <PlanGraph :nodes="generatedPlan.nodes" />
        </div>
      </UCard>
    </div>
  </DashboardPage>
</template>
