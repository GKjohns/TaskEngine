export function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return 'Not yet'
  }

  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))
}

export function formatRelativeCount(value: number, singular: string, plural = `${singular}s`) {
  if (value === 1) {
    return `1 ${singular}`
  }

  return `${value} ${plural}`
}
