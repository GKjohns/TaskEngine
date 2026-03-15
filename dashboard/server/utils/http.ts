import type { ZodType } from 'zod'
import { ZodError } from 'zod'

export async function readValidatedBody<T>(
  event: Parameters<typeof readBody>[0],
  schema: ZodType<T>
): Promise<T> {
  try {
    return schema.parse(await readBody(event))
  } catch (error) {
    if (error instanceof ZodError) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid request body',
        data: error.flatten(),
        message: JSON.stringify(error.issues, null, 2)
      })
    }

    throw error
  }
}
