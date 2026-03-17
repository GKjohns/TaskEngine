import type { H3Event } from 'h3'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../shared/types/database'

export async function getRequestUserId(event: H3Event): Promise<string | null> {
  const authorization = getHeader(event, 'authorization')

  if (!authorization) {
    return null
  }

  const [scheme, token] = authorization.split(' ')

  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Authorization header must use a Bearer token'
    })
  }

  const config = useRuntimeConfig()

  if (!config.supabaseUrl || !config.supabaseKey) {
    throw new Error('SUPABASE_URL and SUPABASE_KEY must be set')
  }

  const authClient = createClient<Database>(config.supabaseUrl, config.supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  })

  const { data, error } = await authClient.auth.getUser(token)

  if (error || !data.user) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Invalid access token'
    })
  }

  return data.user.id
}
