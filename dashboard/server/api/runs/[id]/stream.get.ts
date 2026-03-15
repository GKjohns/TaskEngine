import { createServiceClient } from '../../../utils/supabase'

interface RunStreamSnapshot {
  status: string
}

async function loadRunSnapshot(runId: string): Promise<RunStreamSnapshot & Record<string, unknown>> {
  const client = createServiceClient()

  const { data, error } = await client
    .from('runs')
    .select(`
      *,
      tasks(title, prompt),
      plans(plan_json, version),
      node_runs(*),
      reviews(*)
    `)
    .eq('id', runId)
    .single()

  if (error || !data) {
    throw createError({
      statusCode: error?.code === 'PGRST116' ? 404 : 500,
      statusMessage: error?.code === 'PGRST116' ? 'Run not found' : error?.message || 'Run not found'
    })
  }

  return data
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Run id is required'
    })
  }

  const stream = createEventStream(event)
  let lastPayload = ''

  const pushSnapshot = async () => {
    const run = await loadRunSnapshot(id)
    const payload = JSON.stringify({
      type: 'run_update',
      data: run
    })

    if (payload !== lastPayload) {
      lastPayload = payload
      await stream.push(payload)
    }

    return run
  }

  const initialRun = await pushSnapshot()

  if (['completed', 'failed', 'cancelled'].includes(initialRun.status)) {
    await stream.close()
    return stream.send()
  }

  const interval = setInterval(async () => {
    try {
      const run = await pushSnapshot()

      if (['completed', 'failed', 'cancelled'].includes(run.status)) {
        clearInterval(interval)
        await stream.close()
      }
    } catch {
      clearInterval(interval)
      await stream.close()
    }
  }, 2000)

  event.node.req.on('close', () => {
    clearInterval(interval)
    stream.close()
  })

  return stream.send()
})
