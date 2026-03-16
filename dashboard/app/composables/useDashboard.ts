import { createSharedComposable } from '@vueuse/core'

const useSharedDashboard = createSharedComposable(() => {
  const router = useRouter()
  const route = useRoute()

  if (import.meta.client) {
    defineShortcuts({
      'g-h': () => router.push('/'),
      'g-t': () => router.push('/tasks'),
      'g-w': () => router.push('/plans'),
      'g-s': () => router.push('/jobs'),
      'g-d': () => router.push('/artifacts'),
      'g-a': () => router.push('/runs'),
      'g-v': () => router.push('/reviews'),
      'g-p': () => router.push('/plans'),
      'g-r': () => router.push('/runs'),
      'n': () => router.push('/tasks/new'),
      'r': () => {
        if (route.path !== '/') {
          return
        }

        window.requestAnimationFrame(() => {
          document.querySelector<HTMLElement>('[data-review-shortcut-target="true"]')?.focus()
        })
      }
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
