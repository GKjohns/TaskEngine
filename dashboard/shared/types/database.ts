import type {
  ArtifactType,
  JobStatus,
  JobType,
  NodeRunStatus,
  Plan,
  PlanNodeType,
  ReviewStatus,
  RunStatus,
  TaskStatus,
  TaskTriggerType
} from './task-engine'

export interface Database {
  public: {
    Tables: {
      tasks: {
        Row: {
          id: string
          title: string
          prompt: string
          trigger_type: TaskTriggerType
          schedule_config: Record<string, unknown>
          status: TaskStatus
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          title: string
          prompt: string
          trigger_type: TaskTriggerType
          schedule_config?: Record<string, unknown>
          status?: TaskStatus
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          title?: string
          prompt?: string
          trigger_type?: TaskTriggerType
          schedule_config?: Record<string, unknown>
          status?: TaskStatus
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      plans: {
        Row: {
          id: string
          task_id: string
          plan_json: Plan
          version: number
          created_at: string
        }
        Insert: {
          id?: string
          task_id: string
          plan_json: Plan
          version?: number
          created_at?: string
        }
        Update: {
          id?: string
          task_id?: string
          plan_json?: Plan
          version?: number
          created_at?: string
        }
        Relationships: []
      }
      jobs: {
        Row: {
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
        Insert: {
          id?: string
          task_id: string
          inngest_function_id?: string | null
          job_type: JobType
          status?: JobStatus
          current_run_id?: string | null
          next_run_at?: string | null
          last_run_at?: string | null
          last_error?: string | null
        }
        Update: {
          id?: string
          task_id?: string
          inngest_function_id?: string | null
          job_type?: JobType
          status?: JobStatus
          current_run_id?: string | null
          next_run_at?: string | null
          last_run_at?: string | null
          last_error?: string | null
        }
        Relationships: []
      }
      runs: {
        Row: {
          id: string
          task_id: string
          plan_id: string
          job_id: string | null
          status: RunStatus
          started_at: string | null
          completed_at: string | null
          error_message: string | null
        }
        Insert: {
          id?: string
          task_id: string
          plan_id: string
          job_id?: string | null
          status?: RunStatus
          started_at?: string | null
          completed_at?: string | null
          error_message?: string | null
        }
        Update: {
          id?: string
          task_id?: string
          plan_id?: string
          job_id?: string | null
          status?: RunStatus
          started_at?: string | null
          completed_at?: string | null
          error_message?: string | null
        }
        Relationships: []
      }
      node_runs: {
        Row: {
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
        }
        Insert: {
          id?: string
          run_id: string
          node_key: string
          node_type: PlanNodeType
          status?: NodeRunStatus
          input_refs?: unknown[]
          output_refs?: unknown[]
          logs?: Record<string, unknown>
          started_at?: string | null
          completed_at?: string | null
        }
        Update: {
          id?: string
          run_id?: string
          node_key?: string
          node_type?: PlanNodeType
          status?: NodeRunStatus
          input_refs?: unknown[]
          output_refs?: unknown[]
          logs?: Record<string, unknown>
          started_at?: string | null
          completed_at?: string | null
        }
        Relationships: []
      }
      artifacts: {
        Row: {
          id: string
          type: ArtifactType
          title: string
          content: string | null
          metadata_json: Record<string, unknown>
          storage_path: string | null
          created_by_run_id: string | null
          created_by_node_id: string | null
          task_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          type: ArtifactType
          title: string
          content?: string | null
          metadata_json?: Record<string, unknown>
          storage_path?: string | null
          created_by_run_id?: string | null
          created_by_node_id?: string | null
          task_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          type?: ArtifactType
          title?: string
          content?: string | null
          metadata_json?: Record<string, unknown>
          storage_path?: string | null
          created_by_run_id?: string | null
          created_by_node_id?: string | null
          task_id?: string | null
          created_at?: string
        }
        Relationships: []
      }
      reviews: {
        Row: {
          id: string
          run_id: string
          node_run_id: string
          status: ReviewStatus
          reviewer_id: string | null
          comments: string | null
          created_at: string
          resolved_at: string | null
        }
        Insert: {
          id?: string
          run_id: string
          node_run_id: string
          status?: ReviewStatus
          reviewer_id?: string | null
          comments?: string | null
          created_at?: string
          resolved_at?: string | null
        }
        Update: {
          id?: string
          run_id?: string
          node_run_id?: string
          status?: ReviewStatus
          reviewer_id?: string | null
          comments?: string | null
          created_at?: string
          resolved_at?: string | null
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
