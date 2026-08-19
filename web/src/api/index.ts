import { mockApi } from './mock'
import { realApi } from './client'

// production builds always use the real backend; mock is a dev-only opt-in
// via VITE_API_MOCK=true (e.g. running the UI without `wrangler dev` up).
export const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_API_MOCK === 'true'

export const api = USE_MOCK ? mockApi : realApi

export { ApiRequestError } from './errors'
export * from './types'
