import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AgentTool } from '../types'

const execFileAsync = promisify(execFile)
const pythonExecutables = ['python3', 'python']

async function executeWithPython(code: string) {
  let lastError: unknown = null

  for (const executable of pythonExecutables) {
    try {
      return await execFileAsync(executable, ['-c', code], {
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          PYTHONDONTWRITEBYTECODE: '1'
        }
      })
    } catch (error) {
      lastError = error

      const codeValue = typeof error === 'object' && error && 'code' in error
        ? error.code
        : null

      if (codeValue === 'ENOENT') {
        continue
      }

      throw error
    }
  }

  throw new Error(
    lastError instanceof Error
      ? `Python runtime not available: ${lastError.message}`
      : 'Python runtime not available in this environment'
  )
}

export const runPythonTool: AgentTool = {
  name: 'run_python',
  description: 'Execute Python code and return stdout and stderr for data processing tasks. Prefer the standard library because the runtime may not include third-party packages.',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'Python code to execute.'
      }
    },
    required: ['code'],
    additionalProperties: false
  },
  run: async (input) => {
    const code = typeof input.code === 'string' ? input.code : ''

    if (!code.trim()) {
      throw new Error('Python code is required')
    }

    try {
      const { stdout, stderr } = await executeWithPython(code)

      const sections = [`stdout:\n${stdout || '[empty]'}`]

      if (stderr) {
        sections.push(`stderr:\n${stderr}`)
      }

      return sections.join('\n\n')
    } catch (error) {
      const stderr = typeof error === 'object' && error && 'stderr' in error
        ? error.stderr
        : null
      const message = error instanceof Error ? error.message : 'Unknown Python execution error'

      return `Execution error:\n${typeof stderr === 'string' && stderr ? stderr : message}`
    }
  }
}
