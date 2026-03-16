import { inngest } from '../../utils/inngest'
import { createPendingRunForTask, sendRunStartEvent } from '../../utils/runDispatch'
import { createServiceClient } from '../../utils/supabase'

interface DueJob {
  id: string
  task_id: string
  next_run_at: string | null
  tasks?: {
    status: string
    trigger_type: string
    schedule_config: Record<string, unknown>
  } | null
}

function isJobDue(nextRunAt: string | null) {
  if (!nextRunAt) {
    return false
  }

  return new Date(nextRunAt).getTime() <= Date.now()
}

export const heartbeatCheck = inngest.createFunction(
  { id: 'heartbeat-check' },
  { cron: '*/30 * * * *' },
  async ({ step }) => {
    const dueJobs = await step.run('load-due-jobs', async () => {
      const supabase = createServiceClient()
      const { data, error } = await supabase
        .from('jobs')
        .select('id, task_id, job_type, status, next_run_at, tasks(status, trigger_type, schedule_config)')
        .in('job_type', ['scheduled', 'heartbeat'])
        .in('status', ['idle', 'scheduled', 'completed'])

      if (error) {
        throw new Error(error.message)
      }

      const jobs = (data || []) as unknown as DueJob[]

      return jobs.filter(job => job.tasks?.status === 'active' && isJobDue(job.next_run_at))
    }) as DueJob[]

    for (const job of dueJobs) {
      await step.run(`dispatch-${job.id}`, async () => {
        const supabase = createServiceClient()
        const { run, planId, taskInputArtifactIds } = await createPendingRunForTask(supabase, job.task_id, job.id)

        const updateResult = await supabase
          .from('jobs')
          .update({
            next_run_at: null,
            last_error: null
          })
          .eq('id', job.id)

        if (updateResult.error) {
          throw new Error(updateResult.error.message)
        }

        await sendRunStartEvent({
          runId: run.id,
          planId,
          taskId: job.task_id,
          jobId: job.id,
          taskInputArtifactIds
        })
      })
    }
  }
)
