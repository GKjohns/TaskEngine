export const PLAN_NODE_TYPES = [
  'agent_transform',
  'agent_code',
  'llm_classify',
  'llm_extract',
  'llm_summarize',
  'llm_transform',
  'retrieve',
  'http_fetch',
  'branch',
  'wait',
  'review',
  'emit',
  'notify'
] as const

export type PlanNodeType = (typeof PLAN_NODE_TYPES)[number]

export type TaskTriggerType = 'manual' | 'scheduled' | 'heartbeat'
export type TaskStatus = 'active' | 'paused' | 'archived'
export type JobType = 'one_off' | 'scheduled' | 'heartbeat'
export type JobStatus = 'idle' | 'scheduled' | 'running' | 'waiting_review' | 'paused' | 'completed' | 'failed'
export type RunStatus = 'pending' | 'running' | 'waiting_review' | 'completed' | 'failed' | 'cancelled'
export type NodeRunStatus = 'pending' | 'running' | 'waiting_review' | 'completed' | 'failed' | 'skipped'
export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'edited'
export type ArtifactType = 'markdown' | 'text' | 'json' | 'csv'
export type RetrieveTimeWindow = '24h' | '7d' | '30d' | 'since_last_run'
export type RetrieveSort = 'newest' | 'oldest'
export type HttpFetchMethod = 'GET' | 'POST'
export type HttpFetchResponseType = 'json' | 'text' | 'html_to_text' | 'csv'

export interface RetrieveConfig {
  match: string | null
  task_id: string | null
  time_window: RetrieveTimeWindow | null
  content_search: string | null
  types: ArtifactType[] | null
  limit: number
  sort: RetrieveSort
}

export interface PlanNode {
  id: string
  type: PlanNodeType
  description: string
  per_artifact: boolean
  depends_on: string[]
  prompt: string | null
  labels: string[] | null
  max_length: number | null
  source: string | null
  filter: string | null
  retrieve_config: RetrieveConfig | null
  url: string | null
  method: HttpFetchMethod | null
  headers: Record<string, string> | null
  body: string | null
  response_type: HttpFetchResponseType | null
  artifact_title: string | null
  condition: string | null
  if_true_node: string | null
  if_false_node: string | null
  duration: string | null
  message: string | null
  title: string | null
  format: ArtifactType | null
  level: 'info' | 'warning' | 'error' | null
}

export interface Plan {
  nodes: PlanNode[]
}

export interface TaskRecord {
  id: string
  title: string
  prompt: string
  plan_id: string | null
  trigger_type: TaskTriggerType
  schedule_config: Record<string, unknown>
  status: TaskStatus
  input_artifact_ids: string[]
  last_completed_run_at: string | null
  created_at: string
  updated_at?: string
}

export interface PlanRecord {
  id: string
  title: string
  description: string | null
  prompt: string | null
  task_id: string | null
  plan_json: Plan
  version: number
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface JobRecord {
  id: string
  task_id: string
  inngest_function_id: string | null
  job_type: JobType
  status: JobStatus
  current_run_id: string | null
  next_run_at: string | null
  last_run_at: string | null
  last_error: string | null
}

export interface RunRecord {
  id: string
  task_id: string
  plan_id: string
  job_id: string | null
  status: RunStatus
  started_at: string | null
  completed_at: string | null
  error_message: string | null
  description: string | null
}

export interface NodeRunRecord {
  id: string
  run_id: string
  node_key: string
  node_type: PlanNodeType
  status: NodeRunStatus
  input_refs: unknown[]
  output_refs: unknown[]
  logs: Record<string, unknown>
  started_at: string | null
  completed_at: string | null
  description: string | null
}

export interface ArtifactRecord {
  id: string
  type: ArtifactType
  title: string
  content: string | null
  metadata_json: Record<string, unknown>
  storage_path: string | null
  task_id: string | null
  created_by_run_id: string | null
  created_by_node_id: string | null
  created_at: string
  download_url?: string
  description: string | null
}

export interface ReviewRecord {
  id: string
  run_id: string
  node_run_id: string
  status: ReviewStatus
  reviewer_id: string | null
  comments: string | null
  created_at: string
  resolved_at: string | null
}
