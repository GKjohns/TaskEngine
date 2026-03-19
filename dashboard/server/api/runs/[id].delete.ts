import { createServiceClient } from '../../utils/supabase'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Run id is required'
    })
  }

  const client = createServiceClient()
  const { data: run, error: runLookupError } = await client
    .from('runs')
    .select('id, status')
    .eq('id', id)
    .maybeSingle()

  if (runLookupError) {
    throw createError({
      statusCode: 500,
      statusMessage: runLookupError.message
    })
  }

  if (!run) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Run not found'
    })
  }

  if (run.status !== 'failed') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Only failed runs can be deleted from this endpoint.'
    })
  }

  const reviewsResult = await client
    .from('reviews')
    .delete()
    .eq('run_id', id)

  if (reviewsResult.error) {
    throw createError({
      statusCode: 500,
      statusMessage: reviewsResult.error.message
    })
  }

  const nodeRunsResult = await client
    .from('node_runs')
    .delete()
    .eq('run_id', id)

  if (nodeRunsResult.error) {
    throw createError({
      statusCode: 500,
      statusMessage: nodeRunsResult.error.message
    })
  }

  const runResult = await client
    .from('runs')
    .delete()
    .eq('id', id)

  if (runResult.error) {
    throw createError({
      statusCode: 500,
      statusMessage: runResult.error.message
    })
  }

  return { success: true }
})
