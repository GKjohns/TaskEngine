<script setup lang="ts">
import { z } from 'zod'
import type { TaskTriggerType } from '../../../shared/types/task-engine'

const router = useRouter()

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
    description: 'Create the task and run it only when you explicitly trigger execution.'
  },
  {
    label: 'Scheduled',
    value: 'scheduled',
    description: 'Create a durable job that should execute on a recurring schedule.'
  },
  {
    label: 'Heartbeat',
    value: 'heartbeat',
    description: 'Use a recurring heartbeat to check for new work or upstream changes.'
  }
]

const form = reactive<TaskFormState>({
  title: '',
  prompt: '',
  trigger_type: 'manual' as TaskTriggerType,
  next_run_at: ''
})

const pending = ref(false)
const errorMessage = ref('')

async function submit() {
  pending.value = true
  errorMessage.value = ''

  try {
    const schedule_config = form.trigger_type === 'manual' || !form.next_run_at
      ? {}
      : {
          next_run_at: new Date(form.next_run_at).toISOString()
        }

    const response = await $fetch<{ task: { id: string } }>('/api/tasks', {
      method: 'POST',
      body: {
        title: form.title,
        prompt: form.prompt,
        trigger_type: form.trigger_type,
        schedule_config
      }
    })

    await router.push(`/tasks/${response.task.id}`)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Something went wrong while creating the task.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <DashboardPage title="New Task">
    <div class="mx-auto max-w-4xl space-y-6">
      <div>
        <h2 class="text-base font-semibold text-highlighted">
          Describe the work once
        </h2>
        <p class="mt-1 text-sm text-muted">
          Sprint 1 turns a natural-language request into a stored task, a generated plan, and the initial job record.
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
        <UForm
          :schema="taskSchema"
          :state="form"
          class="space-y-6"
          @submit="submit"
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
              description="Describe the outcome you want so the planner can generate the right graph."
            >
              <UTextarea
                id="task-prompt"
                v-model="form.prompt"
                class="w-full"
                :rows="10"
                autoresize
                placeholder="Summarize this week's reports, extract key risks, and draft a short brief for review."
              />
            </UFormField>

            <UFormField
              name="trigger_type"
              label="Trigger mode"
              description="This controls the initial job that gets created alongside the task."
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
              description="Stored as `schedule_config.next_run_at` so the runtime can pick up the first scheduled execution."
              required
            >
              <UInput
                id="task-next-run"
                v-model="form.next_run_at"
                type="datetime-local"
                class="w-full"
              />
            </UFormField>

            <div class="rounded-xl border border-default bg-elevated/40 p-4">
              <p class="text-sm font-medium text-highlighted">
                What happens on submit
              </p>
              <ul class="mt-3 space-y-2 text-sm text-muted">
                <li>Create the task record in Supabase.</li>
                <li>Call OpenAI to generate a structured execution plan.</li>
                <li>Store plan version 1 and create the initial job record.</li>
              </ul>
            </div>
          </div>

          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <UButton color="neutral" variant="ghost" to="/tasks">
              Cancel
            </UButton>
            <UButton type="submit" icon="i-lucide-wand-sparkles" :loading="pending">
              Generate task plan
            </UButton>
          </div>
        </UForm>
      </UCard>
    </div>
  </DashboardPage>
</template>
