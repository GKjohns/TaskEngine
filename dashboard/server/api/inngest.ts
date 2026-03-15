import { serve } from 'inngest/nuxt'
import { executeRun } from '../inngest/functions/executeRun'
import { heartbeatCheck } from '../inngest/functions/heartbeat'
import { inngest } from '../utils/inngest'

export default serve({
  client: inngest,
  functions: [
    executeRun,
    heartbeatCheck
  ]
})
