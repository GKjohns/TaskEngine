import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../shared/types/database'
import type {
  ArtifactType,
  MemoryCategory,
  ReviewStatus,
  RunStatus,
  TaskStatus,
  TaskTriggerType
} from '../../shared/types/task-engine'
import type { ChatTool, ChatToolContext } from './chatToolTypes'
import { validatePlan } from './graphUtils'
import { inngest } from './inngest'
import { useOpenAI } from './openai'
import { generatePlan } from './planGenerator'
import { createPendingRunForTask, sendRunStartEvent } from './runDispatch'

type ServiceClient = SupabaseClient<Database>

type TaskRow = Database['public']['Tables']['tasks']['Row']
type RunRow = Database['public']['Tables']['runs']['Row']
type ArtifactRow = Database['public']['Tables']['artifacts']['Row']
type ReviewRow = Database['public']['Tables']['reviews']['Row']
type MemoryRow = Database['public']['Tables']['memories']['Row']
type SessionSummaryRow = Database['public']['Tables']['session_summaries']['Row']
type TaskMatchRow = Pick<TaskRow, 'id' | 'title' | 'status' | 'trigger_type'>

type TaskListRow = TaskRow & {
  current_plan: {
    id: string
    title: string
    version: number
  } | null
  runs: Array<Pick<RunRow, 'id' | 'status' | 'started_at' | 'completed_at'>>
}

type TaskDetailRow = TaskRow & {
  current_plan: {
    id: string
    title: string
    version: number
    plan_json: Database['public']['Tables']['plans']['Row']['plan_json']
  } | null
  runs: Array<Pick<RunRow, 'id' | 'status' | 'started_at' | 'completed_at'>>
  jobs: Array<Pick<Database['public']['Tables']['jobs']['Row'], 'id' | 'job_type' | 'status' | 'next_run_at' | 'last_run_at' | 'last_error'>>
}

type ArtifactListRow = ArtifactRow & {
  task_title?: string | null
}

type RunListRow = RunRow & {
  tasks: { title: string } | Array<{ title: string }> | null
  plans?: { version: number } | Array<{ version: number }> | null
}

type RunDetailRow = RunRow & {
  tasks: { title: string, prompt: string } | Array<{ title: string, prompt: string }> | null
  plans: { plan_json: Database['public']['Tables']['plans']['Row']['plan_json'], version: number } | Array<{ plan_json: Database['public']['Tables']['plans']['Row']['plan_json'], version: number }> | null
  node_runs: unknown[] | null
  reviews: unknown[] | null
}

type ReviewListRow = ReviewRow & {
  runs: {
    id: string
    task_id: string
    tasks: { title: string } | Array<{ title: string }> | null
  } | Array<{
    id: string
    task_id: string
    tasks: { title: string } | Array<{ title: string }> | null
  }> | null
  node_runs: {
    node_key: string
    node_type: string
    description: string | null
    output_refs: unknown[]
  } | Array<{
    node_key: string
    node_type: string
    description: string | null
    output_refs: unknown[]
  }> | null
}

interface DashboardTask {
  id: string
  title: string
  status: TaskStatus
  trigger_type: TaskTriggerType
}

interface DashboardRun {
  id: string
  task_id: string
  status: RunStatus
  started_at: string | null
  completed_at: string | null
  error_message: string | null
  tasks: { title: string } | Array<{ title: string }> | null
}

interface DashboardReview {
  id: string
  created_at: string
  runs: {
    tasks: { title: string } | Array<{ title: string }> | null
  } | Array<{
    tasks: { title: string } | Array<{ title: string }> | null
  }> | null
  node_runs: {
    description: string | null
  } | Array<{
    description: string | null
  }> | null
}

interface DashboardJob {
  id: string
  status: string
  next_run_at: string | null
  tasks: { title: string } | Array<{ title: string }> | null
}

const TASK_STATUSES: TaskStatus[] = ['active', 'paused', 'archived']
const TASK_TRIGGER_TYPES: TaskTriggerType[] = ['manual', 'scheduled', 'heartbeat']
const ARTIFACT_TYPES: ArtifactType[] = ['markdown', 'text', 'json', 'csv']
const RUN_STATUSES: RunStatus[] = ['pending', 'running', 'waiting_review', 'completed', 'failed', 'cancelled']
const REVIEW_STATUSES: ReviewStatus[] = ['pending', 'approved', 'rejected', 'edited']
const MEMORY_CATEGORIES: MemoryCategory[] = ['preference', 'fact', 'decision', 'workflow', 'general']

const emptyObjectSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false
} as const

function unwrapSingle<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null
  }

  return value ?? null
}

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function asOptionalString(value: unknown) {
  const parsed = asString(value)
  return parsed || null
}

function asUuidArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    : []
}

function asRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return value as Record<string, unknown>
}

function clampLimit(value: unknown, fallback = 10, max = 25) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback
  }

  return Math.max(1, Math.min(max, Math.floor(value)))
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return 'n/a'
  }

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))
}

function truncate(value: string | null | undefined, max = 180) {
  if (!value) {
    return ''
  }

  return value.length > max ? `${value.slice(0, max - 1)}...` : value
}

function escapeLike(value: string) {
  return value.replace(/[%_]/g, char => `\\${char}`)
}

async function listTaskCandidates(supabase: ServiceClient, title: string) {
  const { data, error } = await supabase
    .from('tasks')
    .select('id, title, status, trigger_type')
    .ilike('title', `%${escapeLike(title)}%`)
    .order('created_at', { ascending: false })
    .limit(5)

  if (error) {
    throw new Error(error.message)
  }

  return (data || []) as TaskMatchRow[]
}

async function resolveTaskByIdOrTitle(
  supabase: ServiceClient,
  taskId: string | null,
  title: string | null
) {
  if (taskId) {
    const { data, error } = await supabase
      .from('tasks')
      .select('id, title, status, trigger_type')
      .eq('id', taskId)
      .maybeSingle()

    if (error) {
      throw new Error(error.message)
    }

    if (!data) {
      return {
        task: null,
        message: `No task found with id ${taskId}.`
      }
    }

    return {
      task: data,
      message: null
    }
  }

  if (!title) {
    return {
      task: null,
      message: 'Provide either task_id or title.'
    }
  }

  const matches = await listTaskCandidates(supabase, title)

  if (!matches.length) {
    return {
      task: null,
      message: `No tasks matched "${title}".`
    }
  }

  if (matches.length > 1) {
    return {
      task: null,
      message: [
        `Multiple tasks matched "${title}":`,
        ...matches.map(task => `- ${task.title} (${task.id}) [${task.status}, ${task.trigger_type}]`)
      ].join('\n')
    }
  }

  return {
    task: matches[0],
    message: null
  }
}

async function assertSourceSession(ctx: ChatToolContext, sessionId: string) {
  const scopedQuery = ctx.userId
    ? ctx.supabase
        .from('chat_sessions')
        .select('id')
        .eq('id', sessionId)
        .eq('created_by', ctx.userId)
    : ctx.supabase
        .from('chat_sessions')
        .select('id')
        .eq('id', sessionId)
        .is('created_by', null)

  const { data, error } = await scopedQuery.maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  if (!data) {
    throw new Error('Source session not found.')
  }
}

const listTasksTool: ChatTool = {
  name: 'list_tasks',
  description: 'List tasks with optional filters.',
  parameters: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: TASK_STATUSES },
      trigger_type: { type: 'string', enum: TASK_TRIGGER_TYPES },
      query: { type: 'string' },
      limit: { type: 'number' }
    },
    additionalProperties: false
  },
  async execute(args, ctx) {
    const limit = clampLimit(args.limit, 10, 20)
    const queryText = asString(args.query).toLowerCase()

    let request = ctx.supabase
      .from('tasks')
      .select('*, current_plan:plans!plan_id(id, title, version), runs(id, status, started_at, completed_at)')
      .order('created_at', { ascending: false })

    const status = asOptionalString(args.status)
    const triggerType = asOptionalString(args.trigger_type)

    if (status && TASK_STATUSES.includes(status as TaskStatus)) {
      request = request.eq('status', status as TaskStatus)
    }

    if (triggerType && TASK_TRIGGER_TYPES.includes(triggerType as TaskTriggerType)) {
      request = request.eq('trigger_type', triggerType as TaskTriggerType)
    }

    const { data, error } = await request

    if (error) {
      throw new Error(error.message)
    }

    let tasks = (data || []) as TaskListRow[]

    if (queryText) {
      tasks = tasks.filter(task =>
        task.title.toLowerCase().includes(queryText)
        || task.prompt.toLowerCase().includes(queryText))
    }

    tasks = tasks.slice(0, limit)

    if (!tasks.length) {
      return 'No tasks matched the current filters.'
    }

    return [
      `Found ${tasks.length} task${tasks.length === 1 ? '' : 's'}:`,
      ...tasks.map((task) => {
        const latestRun = [...task.runs].sort((a, b) => {
          const aTime = new Date(a.completed_at || a.started_at || 0).getTime()
          const bTime = new Date(b.completed_at || b.started_at || 0).getTime()
          return bTime - aTime
        })[0]

        return [
          `- ${task.title} (${task.id})`,
          `  status: ${task.status}; trigger: ${task.trigger_type}`,
          `  current plan: ${task.current_plan ? `${task.current_plan.title} v${task.current_plan.version}` : 'none'}`,
          `  latest run: ${latestRun ? `${latestRun.status} at ${formatDate(latestRun.completed_at || latestRun.started_at)}` : 'none'}`
        ].join('\n')
      })
    ].join('\n')
  }
}

const getTaskTool: ChatTool = {
  name: 'get_task',
  description: 'Get full task detail by id or title.',
  parameters: {
    type: 'object',
    properties: {
      task_id: { type: 'string' },
      title: { type: 'string' }
    },
    additionalProperties: false
  },
  async execute(args, ctx) {
    const resolved = await resolveTaskByIdOrTitle(
      ctx.supabase,
      asOptionalString(args.task_id),
      asOptionalString(args.title)
    )

    if (!resolved.task) {
      return resolved.message || 'Task not found.'
    }

    const { data, error } = await ctx.supabase
      .from('tasks')
      .select('*, current_plan:plans!plan_id(id, title, version, plan_json), runs(id, status, started_at, completed_at), jobs(id, job_type, status, next_run_at, last_run_at, last_error)')
      .eq('id', resolved.task.id)
      .single()

    if (error || !data) {
      throw new Error(error?.message || 'Task not found.')
    }

    const task = data as TaskDetailRow
    const recentRuns = [...task.runs]
      .sort((a, b) => {
        const aTime = new Date(a.completed_at || a.started_at || 0).getTime()
        const bTime = new Date(b.completed_at || b.started_at || 0).getTime()
        return bTime - aTime
      })
      .slice(0, 5)

    return [
      `Task: ${task.title} (${task.id})`,
      `Status: ${task.status}`,
      `Trigger: ${task.trigger_type}`,
      `Prompt: ${task.prompt}`,
      `Current plan: ${task.current_plan ? `${task.current_plan.title} v${task.current_plan.version} with ${task.current_plan.plan_json.nodes.length} nodes` : 'none'}`,
      `Input artifact ids: ${task.input_artifact_ids.length ? task.input_artifact_ids.join(', ') : 'none'}`,
      task.jobs.length
        ? [
            'Jobs:',
            ...task.jobs.map(job => `- ${job.id}: ${job.job_type}, ${job.status}, next run ${formatDate(job.next_run_at)}`)
          ].join('\n')
        : 'Jobs: none',
      recentRuns.length
        ? [
            'Recent runs:',
            ...recentRuns.map(run => `- ${run.id}: ${run.status} (${formatDate(run.completed_at || run.started_at)})`)
          ].join('\n')
        : 'Recent runs: none'
    ].join('\n')
  }
}

const runTaskTool: ChatTool = {
  name: 'run_task',
  description: 'Start a run for a task.',
  parameters: {
    type: 'object',
    properties: {
      task_id: { type: 'string' },
      title: { type: 'string' },
      artifact_ids: {
        type: 'array',
        items: { type: 'string' }
      }
    },
    additionalProperties: false
  },
  async execute(args, ctx) {
    const resolved = await resolveTaskByIdOrTitle(
      ctx.supabase,
      asOptionalString(args.task_id),
      asOptionalString(args.title)
    )

    if (!resolved.task) {
      return resolved.message || 'Task not found.'
    }

    const artifactIds = asUuidArray(args.artifact_ids)
    const { run, planId, jobId, taskInputArtifactIds } = await createPendingRunForTask(
      ctx.supabase,
      resolved.task.id,
      null,
      artifactIds
    )

    await sendRunStartEvent({
      runId: run.id,
      planId,
      taskId: resolved.task.id,
      jobId,
      inputArtifactIds: run.input_artifact_ids,
      taskInputArtifactIds
    })

    return [
      `Started run ${run.id} for task "${resolved.task.title}".`,
      `Status: ${run.status}`,
      `Plan: ${planId}`,
      `Job: ${jobId || 'none'}`,
      `Run input artifacts: ${run.input_artifact_ids.length ? run.input_artifact_ids.join(', ') : 'none'}`
    ].join('\n')
  }
}

const createTaskTool: ChatTool = {
  name: 'create_task',
  description: 'Create a new task from a natural language prompt.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      prompt: { type: 'string' },
      trigger_type: { type: 'string', enum: TASK_TRIGGER_TYPES },
      schedule_config: { type: 'object', additionalProperties: true },
      input_artifact_ids: {
        type: 'array',
        items: { type: 'string' }
      }
    },
    required: ['title', 'prompt'],
    additionalProperties: false
  },
  async execute(args, ctx) {
    const title = asString(args.title)
    const prompt = asString(args.prompt)

    if (!title || !prompt) {
      throw new Error('title and prompt are required.')
    }

    const triggerType = (asOptionalString(args.trigger_type) || 'manual') as TaskTriggerType
    const scheduleConfig = asRecord(args.schedule_config)
    const inputArtifactIds = asUuidArray(args.input_artifact_ids)
    const planJson = await generatePlan(useOpenAI(), prompt, { triggerType })
    const validationErrors = validatePlan(planJson)

    const { data: planData, error: planError } = await ctx.supabase
      .from('plans')
      .insert({
        title,
        prompt,
        plan_json: planJson,
        version: 1
      })
      .select()
      .single()

    const plan = planData as Database['public']['Tables']['plans']['Row'] | null

    if (planError || !plan) {
      throw new Error(planError?.message || 'Failed to create plan.')
    }

    const { data: taskData, error: taskError } = await ctx.supabase
      .from('tasks')
      .insert({
        title,
        prompt,
        plan_id: plan.id,
        trigger_type: triggerType,
        schedule_config: scheduleConfig,
        input_artifact_ids: inputArtifactIds
      })
      .select()
      .single()

    const task = taskData as Database['public']['Tables']['tasks']['Row'] | null

    if (taskError || !task) {
      throw new Error(taskError?.message || 'Failed to create task.')
    }

    await ctx.supabase
      .from('plans')
      .update({ task_id: task.id })
      .eq('id', plan.id)

    const jobType = triggerType === 'scheduled'
      ? 'scheduled'
      : triggerType === 'heartbeat'
        ? 'heartbeat'
        : 'one_off'

    const jobStatus = triggerType === 'manual' ? 'idle' : 'scheduled'

    const { data: jobData, error: jobError } = await ctx.supabase
      .from('jobs')
      .insert({
        task_id: task.id,
        job_type: jobType,
        status: jobStatus,
        next_run_at: typeof scheduleConfig.next_run_at === 'string'
          ? scheduleConfig.next_run_at
          : null
      })
      .select()
      .single()

    const job = jobData as Database['public']['Tables']['jobs']['Row'] | null

    if (jobError || !job) {
      throw new Error(jobError?.message || 'Failed to create job.')
    }

    return [
      `Created task "${task.title}" (${task.id}).`,
      `Trigger: ${task.trigger_type}`,
      `Plan: ${plan.id} with ${plan.plan_json.nodes.length} nodes`,
      `Job: ${job.id} (${job.status})`,
      validationErrors.length
        ? `Plan validation warnings:\n${validationErrors.map(error => `- ${error}`).join('\n')}`
        : 'Plan validation: no issues'
    ].join('\n')
  }
}

const listArtifactsTool: ChatTool = {
  name: 'list_artifacts',
  description: 'Search and filter artifacts.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      task_id: { type: 'string' },
      task_title: { type: 'string' },
      run_id: { type: 'string' },
      type: { type: 'string', enum: ARTIFACT_TYPES },
      limit: { type: 'number' }
    },
    additionalProperties: false
  },
  async execute(args, ctx) {
    const limit = clampLimit(args.limit, 10, 20)
    let request = ctx.supabase
      .from('artifacts')
      .select('*')
      .order('created_at', { ascending: false })

    const queryText = asString(args.query).toLowerCase()
    const taskId = asOptionalString(args.task_id)
    const taskTitle = asOptionalString(args.task_title)
    const runId = asOptionalString(args.run_id)
    const type = asOptionalString(args.type)

    if (taskId) {
      request = request.eq('task_id', taskId)
    }

    if (runId) {
      request = request.eq('created_by_run_id', runId)
    }

    if (type && ARTIFACT_TYPES.includes(type as ArtifactType)) {
      request = request.eq('type', type as ArtifactType)
    }

    if (taskTitle && !taskId) {
      const tasks = await listTaskCandidates(ctx.supabase, taskTitle)
      const ids = tasks.map(task => task.id)

      if (!ids.length) {
        return `No tasks matched "${taskTitle}", so no artifacts were searched.`
      }

      request = request.in('task_id', ids)
    }

    const { data, error } = await request

    if (error) {
      throw new Error(error.message)
    }

    let artifacts = (data || []) as ArtifactListRow[]

    if (queryText) {
      artifacts = artifacts.filter((artifact) => {
        const haystack = [artifact.title, artifact.description, artifact.content]
          .filter((value): value is string => typeof value === 'string' && Boolean(value))
          .join('\n')
          .toLowerCase()

        return haystack.includes(queryText)
      })
    }

    artifacts = artifacts.slice(0, limit)

    if (!artifacts.length) {
      return 'No artifacts matched the current filters.'
    }

    const taskIds = [...new Set(artifacts.map(artifact => artifact.task_id).filter((value): value is string => Boolean(value)))]
    let taskById = new Map<string, string>()

    if (taskIds.length) {
      const { data: tasksData, error: tasksError } = await ctx.supabase
        .from('tasks')
        .select('id, title')
        .in('id', taskIds)

      if (tasksError) {
        throw new Error(tasksError.message)
      }

      taskById = new Map((tasksData || []).map(task => [task.id, task.title]))
    }

    return [
      `Found ${artifacts.length} artifact${artifacts.length === 1 ? '' : 's'}:`,
      ...artifacts.map(artifact => [
        `- ${artifact.title} (${artifact.id})`,
        `  type: ${artifact.type}; created: ${formatDate(artifact.created_at)}`,
        `  task: ${artifact.task_id ? taskById.get(artifact.task_id) || artifact.task_id : 'none'}`,
        `  preview: ${truncate(artifact.description || artifact.content || 'No preview available.', 160)}`
      ].join('\n'))
    ].join('\n')
  }
}

const getArtifactTool: ChatTool = {
  name: 'get_artifact',
  description: 'Read artifact content by id or title.',
  parameters: {
    type: 'object',
    properties: {
      artifact_id: { type: 'string' },
      title: { type: 'string' }
    },
    additionalProperties: false
  },
  async execute(args, ctx) {
    const artifactId = asOptionalString(args.artifact_id)
    const title = asOptionalString(args.title)

    if (!artifactId && !title) {
      throw new Error('Provide artifact_id or title.')
    }

    if (artifactId) {
      const { data, error } = await ctx.supabase
        .from('artifacts')
        .select('*')
        .eq('id', artifactId)
        .maybeSingle()

      if (error) {
        throw new Error(error.message)
      }

      const artifact = data as ArtifactRow | null

      if (!artifact) {
        return `No artifact found with id ${artifactId}.`
      }

      return [
        `Artifact: ${artifact.title} (${artifact.id})`,
        `Type: ${artifact.type}`,
        `Created: ${formatDate(artifact.created_at)}`,
        `Description: ${artifact.description || 'n/a'}`,
        artifact.content
          ? `Content:\n${artifact.content}`
          : `Content is stored externally at ${artifact.storage_path || 'an unknown path'}.`
      ].join('\n')
    }

    const { data, error } = await ctx.supabase
      .from('artifacts')
      .select('*')
      .ilike('title', `%${escapeLike(title!)}%`)
      .order('created_at', { ascending: false })
      .limit(5)

    if (error) {
      throw new Error(error.message)
    }

    const matches = (data || []) as ArtifactRow[]

    if (!matches.length) {
      return `No artifacts matched "${title}".`
    }

    if (matches.length > 1) {
      return [
        `Multiple artifacts matched "${title}":`,
        ...matches.map(artifact => `- ${artifact.title} (${artifact.id}) [${artifact.type}]`)
      ].join('\n')
    }

    const artifact = matches[0]!

    return [
      `Artifact: ${artifact.title} (${artifact.id})`,
      `Type: ${artifact.type}`,
      `Created: ${formatDate(artifact.created_at)}`,
      `Description: ${artifact.description || 'n/a'}`,
      artifact.content
        ? `Content:\n${artifact.content}`
        : `Content is stored externally at ${artifact.storage_path || 'an unknown path'}.`
    ].join('\n')
  }
}

const listRunsTool: ChatTool = {
  name: 'list_runs',
  description: 'List runs with optional task and status filters.',
  parameters: {
    type: 'object',
    properties: {
      task_id: { type: 'string' },
      task_title: { type: 'string' },
      status: { type: 'string', enum: RUN_STATUSES },
      since: { type: 'string' },
      until: { type: 'string' },
      limit: { type: 'number' }
    },
    additionalProperties: false
  },
  async execute(args, ctx) {
    const limit = clampLimit(args.limit, 10, 20)
    let request = ctx.supabase
      .from('runs')
      .select('*, tasks(title), plans(version)')
      .order('started_at', { ascending: false, nullsFirst: false })

    const taskId = asOptionalString(args.task_id)
    const taskTitle = asOptionalString(args.task_title)
    const status = asOptionalString(args.status)
    const since = asOptionalString(args.since)
    const until = asOptionalString(args.until)

    if (taskId) {
      request = request.eq('task_id', taskId)
    }

    if (status && RUN_STATUSES.includes(status as RunStatus)) {
      request = request.eq('status', status as RunStatus)
    }

    if (taskTitle && !taskId) {
      const tasks = await listTaskCandidates(ctx.supabase, taskTitle)
      const ids = tasks.map(task => task.id)

      if (!ids.length) {
        return `No tasks matched "${taskTitle}", so no runs were searched.`
      }

      request = request.in('task_id', ids)
    }

    const { data, error } = await request

    if (error) {
      throw new Error(error.message)
    }

    let runs = (data || []) as RunListRow[]

    if (since) {
      const sinceTime = new Date(since).getTime()
      runs = runs.filter(run => new Date(run.started_at || run.completed_at || 0).getTime() >= sinceTime)
    }

    if (until) {
      const untilTime = new Date(until).getTime()
      runs = runs.filter(run => new Date(run.started_at || run.completed_at || 0).getTime() <= untilTime)
    }

    runs = runs.slice(0, limit)

    if (!runs.length) {
      return 'No runs matched the current filters.'
    }

    return [
      `Found ${runs.length} run${runs.length === 1 ? '' : 's'}:`,
      ...runs.map(run => `- ${run.id}: ${unwrapSingle(run.tasks)?.title || 'Untitled task'} | ${run.status} | started ${formatDate(run.started_at)} | completed ${formatDate(run.completed_at)}`)
    ].join('\n')
  }
}

const getRunTool: ChatTool = {
  name: 'get_run',
  description: 'Get run detail by id.',
  parameters: {
    type: 'object',
    properties: {
      run_id: { type: 'string' }
    },
    required: ['run_id'],
    additionalProperties: false
  },
  async execute(args, ctx) {
    const runId = asString(args.run_id)

    if (!runId) {
      throw new Error('run_id is required.')
    }

    const { data, error } = await ctx.supabase
      .from('runs')
      .select('*, tasks(title, prompt), plans(plan_json, version), node_runs(*), reviews(*)')
      .eq('id', runId)
      .maybeSingle()

    if (error) {
      throw new Error(error.message)
    }

    const run = data as RunDetailRow | null

    if (!run) {
      return `No run found with id ${runId}.`
    }

    return [
      `Run: ${run.id}`,
      `Task: ${unwrapSingle(run.tasks)?.title || run.task_id}`,
      `Status: ${run.status}`,
      `Started: ${formatDate(run.started_at)}`,
      `Completed: ${formatDate(run.completed_at)}`,
      `Description: ${run.description || 'n/a'}`,
      `Plan version: ${unwrapSingle(run.plans)?.version || 'unknown'}`,
      `Node runs: ${Array.isArray(run.node_runs) ? run.node_runs.length : 0}`,
      `Reviews: ${Array.isArray(run.reviews) ? run.reviews.length : 0}`,
      `Input artifact ids: ${Array.isArray(run.input_artifact_ids) && run.input_artifact_ids.length ? run.input_artifact_ids.join(', ') : 'none'}`
    ].join('\n')
  }
}

const listReviewsTool: ChatTool = {
  name: 'list_reviews',
  description: 'List reviews, defaulting to pending.',
  parameters: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: REVIEW_STATUSES },
      limit: { type: 'number' }
    },
    additionalProperties: false
  },
  async execute(args, ctx) {
    const limit = clampLimit(args.limit, 10, 20)
    const status = (asOptionalString(args.status) || 'pending') as ReviewStatus

    let request = ctx.supabase
      .from('reviews')
      .select('id, run_id, node_run_id, status, comments, created_at, resolved_at, runs(id, task_id, tasks(title)), node_runs(node_key, node_type, description, output_refs)')
      .order('created_at', { ascending: false })

    if (REVIEW_STATUSES.includes(status)) {
      request = request.eq('status', status)
    }

    const { data, error } = await request.limit(limit)

    if (error) {
      throw new Error(error.message)
    }

    const reviews = (data || []) as ReviewListRow[]

    if (!reviews.length) {
      return `No ${status} reviews found.`
    }

    return [
      `Found ${reviews.length} ${status} review${reviews.length === 1 ? '' : 's'}:`,
      ...reviews.map((review) => {
        const run = unwrapSingle(review.runs)
        const nodeRun = unwrapSingle(review.node_runs)
        const task = unwrapSingle(run?.tasks)

        return [
          `- ${review.id}`,
          `  task: ${task?.title || run?.task_id || 'unknown task'}`,
          `  status: ${review.status}; created: ${formatDate(review.created_at)}`,
          `  node: ${nodeRun?.node_type || 'unknown'} (${nodeRun?.node_key || 'unknown'})`,
          `  message: ${truncate(nodeRun?.description || review.comments || 'No review message.', 160)}`
        ].join('\n')
      })
    ].join('\n')
  }
}

const resolveReviewTool: ChatTool = {
  name: 'resolve_review',
  description: 'Approve, reject, or edit a pending review.',
  parameters: {
    type: 'object',
    properties: {
      review_id: { type: 'string' },
      status: { type: 'string', enum: ['approved', 'rejected', 'edited'] },
      comments: { type: 'string' },
      artifact_id: { type: 'string' },
      artifact_content: { type: 'string' }
    },
    required: ['review_id', 'status'],
    additionalProperties: false
  },
  async execute(args, ctx) {
    const reviewId = asString(args.review_id)
    const status = asString(args.status) as ReviewStatus
    const comments = asOptionalString(args.comments)
    const artifactId = asOptionalString(args.artifact_id)

    if (!reviewId || !['approved', 'rejected', 'edited'].includes(status)) {
      throw new Error('review_id and a valid status are required.')
    }

    if (status === 'edited' && artifactId && typeof args.artifact_content === 'string') {
      const { error: artifactError } = await ctx.supabase
        .from('artifacts')
        .update({
          content: args.artifact_content,
          storage_path: null
        })
        .eq('id', artifactId)

      if (artifactError) {
        throw new Error(artifactError.message)
      }
    }

    const { data, error } = await ctx.supabase
      .from('reviews')
      .update({
        status,
        comments,
        resolved_at: new Date().toISOString()
      })
      .eq('id', reviewId)
      .select('*, node_runs(run_id)')
      .single()

    const review = data as (Database['public']['Tables']['reviews']['Row'] & {
      node_runs?: { run_id: string } | Array<{ run_id: string }> | null
    }) | null

    if (error || !review) {
      throw new Error(error?.message || 'Review not found.')
    }

    await inngest.send({
      name: 'task-engine/review.resolved',
      data: {
        reviewId: review.id,
        runId: unwrapSingle(review.node_runs)?.run_id,
        status,
        comments
      }
    })

    return [
      `Resolved review ${review.id}.`,
      `Status: ${status}`,
      `Comments: ${comments || 'none'}`,
      `Resolved at: ${formatDate(review.resolved_at)}`
    ].join('\n')
  }
}

const saveMemoryTool: ChatTool = {
  name: 'save_memory',
  description: 'Save a long-term memory.',
  parameters: {
    type: 'object',
    properties: {
      content: { type: 'string' },
      category: { type: 'string', enum: MEMORY_CATEGORIES }
    },
    required: ['content'],
    additionalProperties: false
  },
  async execute(args, ctx) {
    const content = asString(args.content)
    const category = (asOptionalString(args.category) || 'general') as MemoryCategory

    if (!content) {
      throw new Error('content is required.')
    }

    const { data, error } = await ctx.supabase
      .from('memories')
      .insert({
        content,
        category,
        source_session_id: ctx.sessionId,
        created_by: ctx.userId
      })
      .select()
      .single()

    const memory = data as MemoryRow | null

    if (error || !memory) {
      throw new Error(error?.message || 'Failed to save memory.')
    }

    return `Saved memory ${memory.id} (${memory.category}): ${memory.content}`
  }
}

const listMemoriesTool: ChatTool = {
  name: 'list_memories',
  description: 'List long-term memories for the current user.',
  parameters: emptyObjectSchema,
  async execute(_args, ctx) {
    const scopedQuery = ctx.userId
      ? ctx.supabase
          .from('memories')
          .select('*')
          .eq('created_by', ctx.userId)
          .order('updated_at', { ascending: false })
      : ctx.supabase
          .from('memories')
          .select('*')
          .is('created_by', null)
          .order('updated_at', { ascending: false })

    const { data, error } = await scopedQuery

    if (error) {
      throw new Error(error.message)
    }

    const memories = (data || []) as MemoryRow[]

    if (!memories.length) {
      return 'No saved memories.'
    }

    return [
      `Found ${memories.length} memor${memories.length === 1 ? 'y' : 'ies'}:`,
      ...memories.map(memory => `- ${memory.id} [${memory.category}] ${memory.content}`)
    ].join('\n')
  }
}

const updateMemoryTool: ChatTool = {
  name: 'update_memory',
  description: 'Update a saved memory.',
  parameters: {
    type: 'object',
    properties: {
      memory_id: { type: 'string' },
      content: { type: 'string' },
      category: { type: 'string', enum: MEMORY_CATEGORIES },
      source_session_id: { type: 'string' }
    },
    required: ['memory_id'],
    additionalProperties: false
  },
  async execute(args, ctx) {
    const memoryId = asString(args.memory_id)

    if (!memoryId) {
      throw new Error('memory_id is required.')
    }

    const update: Database['public']['Tables']['memories']['Update'] = {}
    const content = asOptionalString(args.content)
    const category = asOptionalString(args.category)
    const sourceSessionId = asOptionalString(args.source_session_id)

    if (content) {
      update.content = content
    }

    if (category && MEMORY_CATEGORIES.includes(category as MemoryCategory)) {
      update.category = category as MemoryCategory
    }

    if (sourceSessionId) {
      await assertSourceSession(ctx, sourceSessionId)
      update.source_session_id = sourceSessionId
    }

    if (!Object.keys(update).length) {
      throw new Error('Provide at least one field to update.')
    }

    const scopedQuery = ctx.userId
      ? ctx.supabase
          .from('memories')
          .update(update)
          .eq('id', memoryId)
          .eq('created_by', ctx.userId)
          .select()
          .single()
      : ctx.supabase
          .from('memories')
          .update(update)
          .eq('id', memoryId)
          .is('created_by', null)
          .select()
          .single()

    const { data, error } = await scopedQuery

    const memory = data as MemoryRow | null

    if (error || !memory) {
      throw new Error(error?.message || 'Memory not found.')
    }

    return `Updated memory ${memory.id} (${memory.category}): ${memory.content}`
  }
}

const deleteMemoryTool: ChatTool = {
  name: 'delete_memory',
  description: 'Delete a saved memory.',
  parameters: {
    type: 'object',
    properties: {
      memory_id: { type: 'string' }
    },
    required: ['memory_id'],
    additionalProperties: false
  },
  async execute(args, ctx) {
    const memoryId = asString(args.memory_id)

    if (!memoryId) {
      throw new Error('memory_id is required.')
    }

    const scopedQuery = ctx.userId
      ? ctx.supabase
          .from('memories')
          .delete()
          .eq('id', memoryId)
          .eq('created_by', ctx.userId)
          .select()
          .single()
      : ctx.supabase
          .from('memories')
          .delete()
          .eq('id', memoryId)
          .is('created_by', null)
          .select()
          .single()

    const { data, error } = await scopedQuery

    const memory = data as MemoryRow | null

    if (error || !memory) {
      throw new Error(error?.message || 'Memory not found.')
    }

    return `Deleted memory ${memory.id}.`
  }
}

const searchSessionsTool: ChatTool = {
  name: 'search_sessions',
  description: 'Search past session summaries.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      limit: { type: 'number' }
    },
    required: ['query'],
    additionalProperties: false
  },
  async execute(args, ctx) {
    const queryText = asString(args.query)
    const limit = clampLimit(args.limit, 5, 10)

    if (!queryText) {
      throw new Error('query is required.')
    }

    const scopedQuery = ctx.userId
      ? ctx.supabase
          .from('chat_sessions')
          .select('id, title')
          .eq('created_by', ctx.userId)
          .order('updated_at', { ascending: false })
          .limit(50)
      : ctx.supabase
          .from('chat_sessions')
          .select('id, title')
          .is('created_by', null)
          .order('updated_at', { ascending: false })
          .limit(50)

    const { data: sessionsData, error: sessionsError } = await scopedQuery

    if (sessionsError) {
      throw new Error(sessionsError.message)
    }

    const sessions = (sessionsData || []) as Array<Pick<Database['public']['Tables']['chat_sessions']['Row'], 'id' | 'title'>>

    if (!sessions.length) {
      return 'No chat sessions available to search.'
    }

    const sessionById = new Map(sessions.map(session => [session.id, session.title]))
    const sessionIds = sessions.map(session => session.id)
    const { data, error } = await ctx.supabase
      .from('session_summaries')
      .select('*')
      .in('session_id', sessionIds)
      .ilike('summary', `%${escapeLike(queryText)}%`)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      throw new Error(error.message)
    }

    const summaries = (data || []) as SessionSummaryRow[]

    if (!summaries.length) {
      return `No session summaries matched "${queryText}".`
    }

    return [
      `Found ${summaries.length} matching session summar${summaries.length === 1 ? 'y' : 'ies'}:`,
      ...summaries.map(summary => [
        `- ${sessionById.get(summary.session_id) || 'Untitled chat'} (${summary.session_id})`,
        `  created: ${formatDate(summary.created_at)}`,
        `  ${truncate(summary.summary, 220)}`
      ].join('\n'))
    ].join('\n')
  }
}

const getCurrentDateTool: ChatTool = {
  name: 'get_current_date',
  description: 'Get the current date and time.',
  parameters: emptyObjectSchema,
  async execute() {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'full',
      timeStyle: 'long'
    }).format(new Date())
  }
}

const getDashboardSummaryTool: ChatTool = {
  name: 'get_dashboard_summary',
  description: 'Get a summary of dashboard activity.',
  parameters: emptyObjectSchema,
  async execute(_args, ctx) {
    const [
      tasksResult,
      runsResult,
      reviewsResult,
      jobsResult,
      artifactsResult
    ] = await Promise.all([
      ctx.supabase
        .from('tasks')
        .select('id, title, status, trigger_type')
        .order('created_at', { ascending: false }),
      ctx.supabase
        .from('runs')
        .select('id, task_id, status, started_at, completed_at, error_message, tasks(title)')
        .order('started_at', { ascending: false, nullsFirst: false })
        .limit(20),
      ctx.supabase
        .from('reviews')
        .select('id, created_at, runs(tasks(title)), node_runs(description)')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(5),
      ctx.supabase
        .from('jobs')
        .select('id, status, next_run_at, tasks(title)')
        .order('next_run_at', { ascending: true, nullsFirst: false })
        .limit(5),
      ctx.supabase
        .from('artifacts')
        .select('id', { count: 'exact', head: true })
    ])

    if (tasksResult.error) throw new Error(tasksResult.error.message)
    if (runsResult.error) throw new Error(runsResult.error.message)
    if (reviewsResult.error) throw new Error(reviewsResult.error.message)
    if (jobsResult.error) throw new Error(jobsResult.error.message)
    if (artifactsResult.error) throw new Error(artifactsResult.error.message)

    const tasks = (tasksResult.data || []) as DashboardTask[]
    const runs = (runsResult.data || []) as DashboardRun[]
    const reviews = (reviewsResult.data || []) as DashboardReview[]
    const jobs = (jobsResult.data || []) as DashboardJob[]

    return [
      'Dashboard summary:',
      `- Tasks: ${tasks.length} total, ${tasks.filter(task => task.status === 'active').length} active, ${tasks.filter(task => task.status === 'paused').length} paused`,
      `- Runs: ${runs.filter(run => run.status === 'running' || run.status === 'waiting_review').length} live, ${runs.filter(run => run.status === 'failed').length} failed in the recent set`,
      `- Pending reviews: ${reviews.length}`,
      `- Artifacts: ${artifactsResult.count || 0}`,
      reviews.length
        ? [
            'Pending review highlights:',
            ...reviews.map(review => `- ${unwrapSingle(unwrapSingle(review.runs)?.tasks)?.title || 'Untitled task'}: ${truncate(unwrapSingle(review.node_runs)?.description || 'Needs review.', 120)}`)
          ].join('\n')
        : 'Pending review highlights: none',
      jobs.length
        ? [
            'Upcoming jobs:',
            ...jobs.map(job => `- ${unwrapSingle(job.tasks)?.title || 'Untitled task'}: ${job.status}, next run ${formatDate(job.next_run_at)}`)
          ].join('\n')
        : 'Upcoming jobs: none'
    ].join('\n')
  }
}

export const allChatTools: ChatTool[] = [
  listTasksTool,
  getTaskTool,
  runTaskTool,
  createTaskTool,
  listArtifactsTool,
  getArtifactTool,
  listRunsTool,
  getRunTool,
  listReviewsTool,
  resolveReviewTool,
  saveMemoryTool,
  listMemoriesTool,
  updateMemoryTool,
  deleteMemoryTool,
  searchSessionsTool,
  getCurrentDateTool,
  getDashboardSummaryTool
]

export const chatToolsByName = new Map(allChatTools.map(tool => [tool.name, tool]))
