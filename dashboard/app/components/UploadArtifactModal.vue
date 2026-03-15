<script setup lang="ts">
import { z } from 'zod'
import type { ArtifactRecord } from '../../shared/types/task-engine'

const emit = defineEmits<{
  created: [artifact: ArtifactRecord]
}>()

const open = ref(false)
const pending = ref(false)
const errorMessage = ref('')

const artifactSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  type: z.enum(['markdown', 'text', 'json', 'csv']),
  content: z.string().trim().min(1, 'Content is required')
})

type ArtifactFormState = z.output<typeof artifactSchema>

const form = reactive<ArtifactFormState>({
  title: '',
  type: 'markdown',
  content: ''
})

const typeOptions = [
  { label: 'Markdown', value: 'markdown' },
  { label: 'Text', value: 'text' },
  { label: 'JSON', value: 'json' },
  { label: 'CSV', value: 'csv' }
]

function resetForm() {
  form.title = ''
  form.type = 'markdown'
  form.content = ''
  errorMessage.value = ''
}

async function submit() {
  pending.value = true
  errorMessage.value = ''

  try {
    const artifact = await $fetch<ArtifactRecord>('/api/artifacts', {
      method: 'POST',
      body: {
        type: form.type,
        title: form.title,
        content: form.content
      }
    })

    emit('created', artifact)
    open.value = false
    resetForm()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Failed to create artifact.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Upload artifact" description="Add a document, dataset, or any text content to the artifact library.">
    <UButton icon="i-lucide-upload" color="neutral" variant="soft" @click="open = true">
      Upload
    </UButton>

    <template #body>
      <UForm :schema="artifactSchema" :state="form" class="space-y-4" @submit="submit">
        <UAlert
          v-if="errorMessage"
          color="error"
          variant="soft"
          :description="errorMessage"
        />

        <UFormField name="title" label="Title" required>
          <UInput v-model="form.title" class="w-full" placeholder="March Cupping Notes" />
        </UFormField>

        <UFormField name="type" label="Type" required>
          <USelect v-model="form.type" :items="typeOptions" value-key="value" class="w-full" />
        </UFormField>

        <UFormField name="content" label="Content" required>
          <UTextarea
            v-model="form.content"
            class="w-full"
            :rows="10"
            autoresize
            placeholder="Paste your content here..."
          />
        </UFormField>
      </UForm>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="ghost" @click="open = false">
          Cancel
        </UButton>
        <UButton icon="i-lucide-upload" :loading="pending" :disabled="!form.title.trim() || !form.content.trim()" @click="submit">
          Upload artifact
        </UButton>
      </div>
    </template>
  </UModal>
</template>
