import { createClient } from '@supabase/supabase-js'

let _serviceClient: ReturnType<typeof createClient> | null = null

export function createServiceClient() {
  if (_serviceClient) return _serviceClient

  const config = useRuntimeConfig()
  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set')
  }

  _serviceClient = createClient(config.supabaseUrl, config.supabaseServiceKey)
  return _serviceClient
}

export const createDatabaseClient = createServiceClient
