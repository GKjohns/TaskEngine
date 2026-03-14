import { createClient } from '@supabase/supabase-js'

// During single-user local development, all server-side DB access uses the service role.
export function createServiceClient() {
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set')
  }

  return createClient(supabaseUrl, serviceRoleKey)
}

export const createDatabaseClient = createServiceClient
