import { createSharedComposable } from '@vueuse/core'

const useSharedDashboard = createSharedComposable(() => {
  const router = useRouter()

  if (import.meta.client) {
    defineShortcuts({
      'g-t': () => router.push('/tasks'),
      'g-r': () => router.push('/runs'),
      'g-a': () => router.push('/artifacts'),
      'g-v': () => router.push('/reviews'),
      'g-j': () => router.push('/jobs'),
      'n': () => router.push('/tasks/new')
    })
  }

  const { data: pendingReviews, refresh: refreshPendingReviewCount } = useFetch<unknown[]>('/api/reviews', {
    key: 'pending-review-count',
    query: { status: 'pending' },
    default: () => []
  })

  const pendingReviewCount = computed(() => pendingReviews.value.length)

  return {
    pendingReviewCount,
    refreshPendingReviewCount
  }
})

export function useDashboard() {
  return useSharedDashboard()
}
