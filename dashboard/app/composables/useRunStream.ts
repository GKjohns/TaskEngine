import type { NodeRunRecord, ReviewRecord, RunRecord } from '../../shared/types/task-engine'

interface RunStreamPayload extends RunRecord {
  node_runs?: NodeRunRecord[]
  reviews?: ReviewRecord[]
}

export function useRunStream(runId: MaybeRefOrGetter<string>, options?: {
  enabled?: MaybeRefOrGetter<boolean>
}) {
  const status = ref<RunRecord['status'] | null>(null)
  const nodeRuns = ref<NodeRunRecord[]>([])
  const reviews = ref<ReviewRecord[]>([])
  const error = ref<string | null>(null)
  const connected = ref(false)

  let eventSource: EventSource | null = null

  function disconnect() {
    connected.value = false
    eventSource?.close()
    eventSource = null
  }

  function connect() {
    if (!import.meta.client) {
      return
    }

    const id = toValue(runId)
    const enabled = options?.enabled ? toValue(options.enabled) : true

    disconnect()

    if (!enabled || !id) {
      return
    }

    eventSource = new EventSource(`/api/runs/${id}/stream`)
    connected.value = true
    error.value = null

    eventSource.onmessage = (event) => {
      const payload = JSON.parse(event.data) as { type: string, data: RunStreamPayload }

      if (payload.type !== 'run_update') {
        return
      }

      status.value = payload.data.status
      nodeRuns.value = payload.data.node_runs || []
      reviews.value = payload.data.reviews || []

      if (['completed', 'failed', 'cancelled'].includes(payload.data.status)) {
        disconnect()
      }
    }

    eventSource.onerror = () => {
      error.value = 'Run stream disconnected.'
      disconnect()
    }
  }

  if (import.meta.client) {
    watch(
      [() => toValue(runId), () => options?.enabled ? toValue(options.enabled) : true],
      () => connect(),
      { immediate: true }
    )

    onUnmounted(() => disconnect())
  }

  return {
    status,
    nodeRuns,
    reviews,
    error,
    connected,
    connect,
    disconnect
  }
}
