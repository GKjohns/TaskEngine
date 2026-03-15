import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../shared/types/database'

let _serviceClient: ReturnType<typeof createClient<Database>> | null = null

export function createServiceClient() {
  if (_serviceClient) return _serviceClient

  const config = useRuntimeConfig()
  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set')
  }

  _serviceClient = createClient<Database>(config.supabaseUrl, config.supabaseServiceKey)
  return _serviceClient
}

export const createDatabaseClient = createServiceClient
