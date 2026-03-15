import type { PlanNode, RunStatus } from '../../../shared/types/task-engine'
import { useOpenAI } from '../../utils/openai'
import { createServiceClient } from '../../utils/supabase'
import { inngest } from '../../utils/inngest'
import { topoSort } from '../../utils/graphUtils'
import { ensureNodeExecutorsRegistered } from '../nodes/register'
import { getNodeExecutor } from '../nodes/registry'
import { parseDurationToMs } from '../nodes/infrastructure'
import { persistExecutionArtifacts } from '../nodes/persistArtifacts'
import type { NodeExecutionContext } from '../nodes/types'

interface NodeState {
  nodeRunId: string
  status: string
  outputRefs: string[]
  logs: Record<string, unknown>
}

function toSleepDuration(waitMs: number) {
  return `${Math.max(1, Math.ceil(waitMs / 1000))}s`
}

function getLogNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

async function markRunAndJobStatus(input: {
  runId: string
  jobId: string | null
  runStatus: RunStatus
  jobStatus?: 'running' | 'waiting_review' | 'completed' | 'failed'
  errorMessage?: string | null
  lastError?: string | null
  completed?: boolean
}) {
  const supabase = createServiceClient()
  const now = new Date().toISOString()

  await supabase
    .from('runs')
    .update({
      status: input.runStatus,
      error_message: input.errorMessage ?? null,
      started_at: input.runStatus === 'running' ? now : undefined,
      completed_at: input.completed ? now : undefined
    })
    .eq('id', input.runId)

  if (input.jobId && input.jobStatus) {
    await supabase
      .from('jobs')
      .update({
        status: input.jobStatus,
        current_run_id: input.jobStatus === 'running' ? input.runId : null,
        last_run_at: input.jobStatus === 'completed' ? now : undefined,
        last_error: input.lastError ?? null
      })
      .eq('id', input.jobId)
  }
}

ensureNodeExecutorsRegistered()

export const executeRun = inngest.createFunction(
  { id: 'execute-run', retries: 0 },
  { event: 'task-engine/run.start' },
  async ({ event, step }) => {
    const { runId, planId, taskId, jobId } = event.data as {
      runId: string
      planId: string
      taskId: string
      jobId: string | null
    }

    try {
      const plan = await step.run('load-plan', async () => {
        const supabase = createServiceClient()
        const { data, error } = await supabase
          .from('plans')
          .select('plan_json')
          .eq('id', planId)
          .single()

        if (error || !data) {
          throw new Error(error?.message || 'Plan not found')
        }

        return data.plan_json
      })

      await step.run('mark-running', async () => {
        await markRunAndJobStatus({
          runId,
          jobId,
          runStatus: 'running',
          jobStatus: 'running'
        })
      })

      const sortedNodes = topoSort(plan.nodes as PlanNode[])
      const nodeStates: Record<string, NodeState> = {}
      const explicitlySkippedNodes = new Set<string>()

      for (const node of sortedNodes) {
        const dependencyWasSkipped = node.depends_on.some(depId => nodeStates[depId]?.status === 'skipped')

        if (explicitlySkippedNodes.has(node.id) || dependencyWasSkipped) {
          const skippedResult = await step.run(`node-${node.id}-skipped`, async (): Promise<NodeState> => {
            const supabase = createServiceClient()
            const now = new Date().toISOString()
            const { data, error } = await supabase
              .from('node_runs')
              .insert({
                run_id: runId,
                node_key: node.id,
                node_type: node.type,
                status: 'skipped',
                logs: {
                  reason: explicitlySkippedNodes.has(node.id) ? 'branch_not_selected' : 'dependency_skipped'
                },
                started_at: now,
                completed_at: now
              })
              .select('id')
              .single()

            if (error || !data) {
              throw new Error(error?.message || `Failed to record skipped node ${node.id}`)
            }

            return {
              nodeRunId: data.id,
              status: 'skipped',
              outputRefs: [] as string[],
              logs: {
                reason: explicitlySkippedNodes.has(node.id) ? 'branch_not_selected' : 'dependency_skipped'
              }
            }
          }) as NodeState

          nodeStates[node.id] = skippedResult
          continue
        }

        const result = await step.run(`node-${node.id}`, async (): Promise<NodeState> => {
          const supabase = createServiceClient()
          const openai = useOpenAI()
          const now = new Date().toISOString()
          const { data: nodeRun, error: nodeRunError } = await supabase
            .from('node_runs')
            .insert({
              run_id: runId,
              node_key: node.id,
              node_type: node.type,
              status: 'running',
              started_at: now
            })
            .select('id')
            .single()

          if (nodeRunError || !nodeRun) {
            throw new Error(nodeRunError?.message || `Failed to create node run for ${node.id}`)
          }

          try {
            const depNodeRunIds = node.depends_on
              .map(depId => nodeStates[depId]?.nodeRunId)
              .filter((value): value is string => Boolean(value))

            let inputArtifactIds: string[] = []
            let inputArtifacts: NodeExecutionContext['inputArtifacts'] = []

            if (depNodeRunIds.length > 0) {
              const { data: dependencyRuns, error: dependencyError } = await supabase
                .from('node_runs')
                .select('output_refs')
                .in('id', depNodeRunIds)

              if (dependencyError) {
                throw new Error(dependencyError.message)
              }

              inputArtifactIds = (dependencyRuns || [])
                .flatMap(run => Array.isArray(run.output_refs) ? run.output_refs : [])
                .filter((value): value is string => typeof value === 'string')

              if (inputArtifactIds.length > 0) {
                const { data: artifacts, error: artifactError } = await supabase
                  .from('artifacts')
                  .select('id, title, content, type, metadata_json, storage_path')
                  .in('id', inputArtifactIds)

                if (artifactError) {
                  throw new Error(artifactError.message)
                }

                inputArtifacts = artifacts || []
              }
            }

            const inputUpdate = await supabase
              .from('node_runs')
              .update({ input_refs: inputArtifactIds })
              .eq('id', nodeRun.id)

            if (inputUpdate.error) {
              throw new Error(inputUpdate.error.message)
            }

            const context: NodeExecutionContext = {
              runId,
              nodeRunId: nodeRun.id,
              taskId,
              inputArtifacts,
              supabase,
              openai
            }

            const executor = getNodeExecutor(node.type)
            const execution = await executor(node, context)
            const outputRefs = await persistExecutionArtifacts(execution.artifacts, context)
            const status = node.type === 'review' ? 'waiting_review' : node.type === 'wait' ? 'running' : 'completed'

            const updateResult = await supabase
              .from('node_runs')
              .update({
                status,
                output_refs: outputRefs,
                logs: execution.logs,
                completed_at: status === 'completed' ? new Date().toISOString() : null
              })
              .eq('id', nodeRun.id)

            if (updateResult.error) {
              throw new Error(updateResult.error.message)
            }

            return {
              nodeRunId: nodeRun.id,
              status,
              outputRefs,
              logs: execution.logs
            }
          } catch (error) {
            await supabase
              .from('node_runs')
              .update({
                status: 'failed',
                logs: {
                  error: error instanceof Error ? error.message : 'Unknown node execution error'
                },
                completed_at: new Date().toISOString()
              })
              .eq('id', nodeRun.id)

            throw error
          }
        }) as NodeState

        nodeStates[node.id] = result

        if (node.type === 'branch') {
          const skippedNode = typeof result.logs.skipped_node === 'string' ? result.logs.skipped_node : null

          if (skippedNode) {
            explicitlySkippedNodes.add(skippedNode)
          }
        }

        if (node.type === 'wait') {
          const waitMs = getLogNumber(result.logs.wait_ms)
          const normalizedWaitMs = waitMs || parseDurationToMs(node.duration)

          if (normalizedWaitMs > 0) {
            await step.sleep(`wait-${node.id}`, toSleepDuration(normalizedWaitMs))
          }

          await step.run(`wait-complete-${node.id}`, async () => {
            const supabase = createServiceClient()
            const completedAt = new Date().toISOString()

            await supabase
              .from('node_runs')
              .update({
                status: 'completed',
                completed_at: completedAt,
                logs: {
                  ...result.logs,
                  waited_until: completedAt
                }
              })
              .eq('id', result.nodeRunId)
          })

          nodeStates[node.id] = {
            ...result,
            status: 'completed',
            logs: {
              ...result.logs,
              waited_for_ms: normalizedWaitMs
            }
          }
        }

        if (node.type === 'review') {
          await step.run(`review-wait-start-${node.id}`, async () => {
            await markRunAndJobStatus({
              runId,
              jobId,
              runStatus: 'waiting_review',
              jobStatus: 'waiting_review'
            })
          })

          const reviewEvent = await step.waitForEvent(`review-${node.id}`, {
            event: 'task-engine/review.resolved',
            match: 'data.runId',
            timeout: '7d'
          })

          if (!reviewEvent) {
            await step.run(`review-timeout-${node.id}`, async () => {
              const supabase = createServiceClient()
              const failedAt = new Date().toISOString()

              await markRunAndJobStatus({
                runId,
                jobId,
                runStatus: 'failed',
                jobStatus: 'failed',
                errorMessage: 'Review timed out after 7 days',
                lastError: 'Review timed out',
                completed: true
              })

              await supabase
                .from('node_runs')
                .update({
                  status: 'failed',
                  completed_at: failedAt,
                  logs: {
                    ...result.logs,
                    review_resolution: 'timed_out'
                  }
                })
                .eq('id', result.nodeRunId)
            })

            return
          }

          const reviewStatus = reviewEvent.data.status as string

          if (reviewStatus === 'rejected') {
            await step.run(`review-rejected-${node.id}`, async () => {
              const supabase = createServiceClient()
              const completedAt = new Date().toISOString()

              await markRunAndJobStatus({
                runId,
                jobId,
                runStatus: 'cancelled',
                jobStatus: 'failed',
                errorMessage: 'Review rejected',
                lastError: 'Review rejected',
                completed: true
              })

              await supabase
                .from('node_runs')
                .update({
                  status: 'failed',
                  completed_at: completedAt,
                  logs: {
                    ...result.logs,
                    review_resolution: reviewStatus,
                    review_comments: reviewEvent.data.comments || null
                  }
                })
                .eq('id', result.nodeRunId)
            })

            return
          }

          await step.run(`review-resume-${node.id}`, async () => {
            const supabase = createServiceClient()
            const completedAt = new Date().toISOString()

            await markRunAndJobStatus({
              runId,
              jobId,
              runStatus: 'running',
              jobStatus: 'running'
            })

            await supabase
              .from('node_runs')
              .update({
                status: 'completed',
                completed_at: completedAt,
                logs: {
                  ...result.logs,
                  review_resolution: reviewStatus,
                  review_comments: reviewEvent.data.comments || null
                }
              })
              .eq('id', result.nodeRunId)
          })

          nodeStates[node.id] = {
            ...result,
            status: 'completed',
            logs: {
              ...result.logs,
              review_resolution: reviewStatus
            }
          }
        }
      }

      await step.run('mark-completed', async () => {
        await markRunAndJobStatus({
          runId,
          jobId,
          runStatus: 'completed',
          jobStatus: 'completed',
          completed: true
        })
      })
    } catch (error) {
      await step.run('mark-failed', async () => {
        await markRunAndJobStatus({
          runId,
          jobId,
          runStatus: 'failed',
          jobStatus: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Run execution failed',
          lastError: error instanceof Error ? error.message : 'Run execution failed',
          completed: true
        })
      })

      throw error
    }
  }
)
