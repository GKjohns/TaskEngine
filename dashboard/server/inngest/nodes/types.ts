import type { SupabaseClient } from '@supabase/supabase-js'
import type OpenAI from 'openai'
import type { Database } from '../../../shared/types/database'
import type { ArtifactType, PlanNode } from '../../../shared/types/task-engine'

export interface RuntimeArtifact {
  title: string
  content: string
  type: ArtifactType
  metadata?: Record<string, unknown>
}

export interface RuntimeInputArtifact {
  id: string
  title: string
  content: string | null
  type: ArtifactType
  metadata_json: Record<string, unknown>
  storage_path: string | null
}

export interface NodeExecutorResult {
  artifacts: RuntimeArtifact[]
  logs: Record<string, unknown>
}

export interface NodeExecutionContext {
  runId: string
  nodeRunId: string
  taskId: string
  inputArtifacts: RuntimeInputArtifact[]
  supabase: SupabaseClient<Database>
  openai: OpenAI
}

export type NodeExecutor = (
  node: PlanNode,
  context: NodeExecutionContext
) => Promise<NodeExecutorResult>
