import { execFileSync } from 'node:child_process'
import killPort from 'kill-port'

const ports = [3000, 8288, 8289, 50052, 50053]

function getListeningPids(port) {
  try {
    const stdout = execFileSync(
      'lsof',
      ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }
    )

    return stdout
      .split('\n')
      .map(value => value.trim())
      .filter(Boolean)
  } catch (error) {
    if (error.status === 1) {
      return []
    }

    throw error
  }
}

async function killPortsWithFallback() {
  await Promise.all(
    ports.map(async (port) => {
      try {
        await killPort(port)
        console.log(`[predev] Killed process on port ${port}`)
      } catch {
        // Ignore ports that are already free.
      }
    })
  )
}

async function main() {
  if (process.platform === 'win32') {
    await killPortsWithFallback()
    return
  }

  const pidToPorts = new Map()

  for (const port of ports) {
    for (const pid of getListeningPids(port)) {
      const matchedPorts = pidToPorts.get(pid) ?? []
      matchedPorts.push(port)
      pidToPorts.set(pid, matchedPorts)
    }
  }

  if (pidToPorts.size === 0) {
    console.log('[predev] No existing dev processes found.')
    return
  }

  for (const [pid, matchedPorts] of pidToPorts) {
    process.kill(Number(pid), 'SIGKILL')
    console.log(
      `[predev] Killed PID ${pid} on port${matchedPorts.length > 1 ? 's' : ''} ${matchedPorts.join(', ')}`
    )
  }
}

main().catch((error) => {
  console.error('[predev] Failed to clear dev ports.')
  console.error(error)
  process.exitCode = 1
})
