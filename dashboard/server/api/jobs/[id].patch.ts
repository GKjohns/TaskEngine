import { z } from 'zod'
import type { Database } from '../../../shared/types/database'
import { readValidatedBody } from '../../utils/http'
import { createServiceClient } from '../../utils/supabase'

const updateJobSchema = z.object({
  status: z.enum(['idle', 'scheduled', 'paused'])
})

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Job id is required'
    })
  }

  const body = await readValidatedBody(event, updateJobSchema)
  const client = createServiceClient()

  const { data: existingJob, error: existingJobError } = await client
    .from('jobs')
    .select('id, status, job_type')
    .eq('id', id)
    .single()

  const job = existingJob as Pick<Database['public']['Tables']['jobs']['Row'], 'id' | 'status' | 'job_type'> | null

  if (existingJobError || !job) {
    throw createError({
      statusCode: existingJobError?.code === 'PGRST116' ? 404 : 500,
      statusMessage: existingJobError?.code === 'PGRST116' ? 'Job not found' : existingJobError?.message || 'Job not found'
    })
  }

  if (job.status === 'running' || job.status === 'waiting_review') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Running jobs cannot be changed manually'
    })
  }

  const { data, error } = await client
    .from('jobs')
    .update({
      status: body.status,
      last_error: body.status === 'paused' ? job.status === 'failed' ? 'Paused after failure' : null : null
    })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message
    })
  }

  return data
})
