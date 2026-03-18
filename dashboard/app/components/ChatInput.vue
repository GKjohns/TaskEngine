<script setup lang="ts">
const model = defineModel<string>({ default: '' })

const props = withDefaults(defineProps<{
  disabled?: boolean
  loading?: boolean
  contextLabel?: string | null
}>(), {
  disabled: false,
  loading: false,
  contextLabel: null
})

const emit = defineEmits<{
  submit: []
}>()

const isDisabled = computed(() => props.disabled || props.loading)

function submit() {
  if (isDisabled.value || !model.value.trim()) {
    return
  }

  emit('submit')
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey) {
    return
  }

  event.preventDefault()
  submit()
}
</script>

<template>
  <div class="space-y-3 border-t border-default px-4 py-4">
    <div v-if="contextLabel" class="flex items-center gap-2 text-xs text-muted">
      <UBadge color="neutral" variant="soft" size="xs">
        Context
      </UBadge>
      <span>{{ contextLabel }}</span>
    </div>

    <div class="flex items-end gap-2">
      <UTextarea
        v-model="model"
        class="flex-1"
        :rows="1"
        autoresize
        :maxrows="6"
        :disabled="isDisabled"
        placeholder="Ask anything or give an instruction..."
        @keydown="onKeydown"
      />

      <UButton
        color="primary"
        icon="i-lucide-arrow-up"
        square
        :loading="loading"
        :disabled="isDisabled || !model.trim()"
        @click="submit"
      />
    </div>

    <p class="text-[11px] text-muted">
      {{ loading ? 'Streaming response...' : 'Enter to send. Shift+Enter for a new line.' }}
    </p>
  </div>
</template>
