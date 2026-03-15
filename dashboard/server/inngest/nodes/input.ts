import type { RuntimeInputArtifact } from './types'

export function renderArtifactInput(artifact: RuntimeInputArtifact) {
  const content = artifact.content?.trim() || ''

  if (!content && artifact.storage_path) {
    return `# ${artifact.title}\nType: ${artifact.type}\nStored in Supabase Storage at ${artifact.storage_path}.`
  }

  return `# ${artifact.title}\nType: ${artifact.type}\n\n${content}`
}

export function joinArtifactInputs(inputArtifacts: RuntimeInputArtifact[]) {
  return inputArtifacts.map(renderArtifactInput).join('\n\n---\n\n')
}
