import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../shared/types/database'

type ServiceClient = SupabaseClient<Database>

export interface ChatToolContext {
  supabase: ServiceClient
  userId: string | null
  sessionId: string
}

export interface ChatTool {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute: (args: Record<string, unknown>, ctx: ChatToolContext) => Promise<string>
}
