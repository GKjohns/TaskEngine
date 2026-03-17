import { getRequestUserId } from '../../../utils/requestUser'
import { createServiceClient } from '../../../utils/supabase'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Memory id is required'
    })
  }

  const client = createServiceClient()
  const userId = await getRequestUserId(event)

  let deleteQuery = client
    .from('memories')
    .delete()
    .eq('id', id)
    .select()

  deleteQuery = userId
    ? deleteQuery.eq('created_by', userId)
    : deleteQuery.is('created_by', null)

  const { data, error } = await deleteQuery.single()

  if (error || !data) {
    throw createError({
      statusCode: error?.code === 'PGRST116' ? 404 : 500,
      statusMessage: error?.code === 'PGRST116' ? 'Memory not found' : error?.message || 'Memory not found'
    })
  }

  return data
})
