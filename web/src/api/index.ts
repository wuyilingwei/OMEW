import { mockApi } from './mock'
import { realApi } from './client'

// backend not merged yet — flip VITE_API_MOCK=false (or edit the fallback
// below) once /api/* is live. Both adapters expose the same method shape.
const USE_MOCK = import.meta.env.VITE_API_MOCK !== 'false'

export const api = USE_MOCK ? mockApi : realApi

export { ApiRequestError } from './errors'
export * from './types'
