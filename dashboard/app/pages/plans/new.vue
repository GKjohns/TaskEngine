<script setup lang="ts">
import { z } from 'zod'
import type { Plan } from '../../../shared/types/task-engine'

const router = useRouter()

const planSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200, 'Title is too long'),
  prompt: z.string().trim().min(1, 'Prompt is required'),
  description: z.string().trim().max(500).optional()
})

type PlanFormState = z.output<typeof planSchema>

const form = reactive<PlanFormState>({
  title: '',
  prompt: '',
  description: ''
})

const pending = ref(false)
const saving = ref(false)
const errorMessage = ref('')
const plan = ref<Plan | null>(null)
const validationErrors = ref<string[]>([])

const canPreview = computed(() => form.title.trim() && form.prompt.trim())

async function generatePreview() {
  pending.value = true
  errorMessage.value = ''

  try {
    const response = await $fetch<{ plan: Plan, validation_errors: string[] }>('/api/plans/preview', {
      method: 'POST',
      body: { prompt: form.prompt }
    })

    plan.value = response.plan
    validationErrors.value = response.validation_errors || []
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Something went wrong while generating the plan.'
  } finally {
    pending.value = false
  }
}

async function savePlan() {
  if (!plan.value) return

  saving.value = true
  errorMessage.value = ''

  try {
    const response = await $fetch<{ plan: { id: string } }>('/api/plans', {
      method: 'POST',
      body: {
        title: form.title,
        prompt: form.prompt,
        description: form.description || undefined,
        plan_json: plan.value
      }
    })

    await router.push(`/plans/${response.plan.id}`)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Something went wrong while saving the plan.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <DashboardPage title="New Plan">
    <div class="mx-auto max-w-4xl space-y-6">
      <div>
        <h2 class="text-base font-semibold text-highlighted">
          Design a reusable workflow
        </h2>
        <p class="mt-1 text-sm text-muted">
          Describe what the plan should do. The AI will generate an execution graph you can review, save, and attach to tasks later.
        </p>
      </div>

      <UAlert
        v-if="errorMessage"
        color="error"
        variant="soft"
        title="Plan creation failed"
        :description="errorMessage"
      />

      <UCard class="border border-default">
        <UForm
          :schema="planSchema"
          :state="form"
          class="space-y-6"
          @submit="generatePreview"
        >
          <div class="grid gap-6">
            <UFormField
              name="title"
              label="Title"
              required
              description="A short name for this plan in the library."
            >
              <UInput
                id="plan-title"
                v-model="form.title"
                class="w-full"
                placeholder="Weekly report summarizer"
              />
            </UFormField>

            <UFormField
              name="prompt"
              label="Prompt"
              required
              description="Describe the workflow you want so the planner can generate the right execution graph."
            >
              <UTextarea
                id="plan-prompt"
                v-model="form.prompt"
                class="w-full"
                :rows="10"
                autoresize
                placeholder="Summarize this week's reports, extract key risks, and draft a short brief for review."
              />
            </UFormField>

            <UFormField
              name="description"
              label="Description"
              description="Optional short description for the plan library."
            >
              <UInput
                id="plan-description"
                v-model="form.description"
                class="w-full"
                placeholder="Collects weekly data, summarizes, and sends for human review"
              />
            </UFormField>
          </div>

          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <UButton color="neutral" variant="ghost" to="/plans">
              Cancel
            </UButton>
            <UButton
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

      <UCard v-if="plan" class="border border-default">
        <div class="space-y-5">
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 class="text-base font-semibold text-highlighted">
                Generated plan
              </h3>
              <p class="mt-1 text-sm text-muted">
                Review the workflow graph before saving it to the library.
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
              <UButton icon="i-lucide-check" :loading="saving" @click="savePlan">
                Save plan
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

          <PlanGraph :nodes="plan.nodes" />
        </div>
      </UCard>
    </div>
  </DashboardPage>
</template>
