import { createServiceClient } from '../../utils/supabase'
import type { Database } from '../../../shared/types/database'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Artifact id is required'
    })
  }

  const client = createServiceClient()

  const { data, error } = await client
    .from('artifacts')
    .select('*')
    .eq('id', id)
    .single()

  const artifact = data as Database['public']['Tables']['artifacts']['Row'] | null

  if (error || !artifact) {
    throw createError({
      statusCode: error?.code === 'PGRST116' ? 404 : 500,
      statusMessage: error?.code === 'PGRST116' ? 'Artifact not found' : error?.message || 'Artifact not found'
    })
  }

  if (artifact.storage_path && !artifact.content) {
    const { data: urlData, error: urlError } = await client.storage
      .from('artifacts')
      .createSignedUrl(artifact.storage_path, 3600)

    if (urlError) {
      throw createError({
        statusCode: 500,
        statusMessage: urlError.message
      })
    }

    return {
      ...artifact,
      download_url: urlData?.signedUrl || null
    }
  }

  return artifact
})
