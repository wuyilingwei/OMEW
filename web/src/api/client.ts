import { ApiRequestError } from './errors'
import type {
  AdminInstanceConfig,
  AuthResponse,
  InstanceConfig,
  InviteCode,
  LoginPayload,
  RegisterPayload,
} from './types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body?.error) {
    throw new ApiRequestError(body?.error ?? 'UNKNOWN_ERROR', res.status)
  }
  return body as T
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` }
}

export const realApi = {
  getInstanceConfig: () => request<InstanceConfig>('/api/instance/config'),

  register: (payload: RegisterPayload) =>
    request<AuthResponse>('/api/register', { method: 'POST', body: JSON.stringify(payload) }),

  login: (payload: LoginPayload) =>
    request<AuthResponse>('/api/login', { method: 'POST', body: JSON.stringify(payload) }),

  getAdminConfig: (token: string) =>
    request<AdminInstanceConfig>('/api/admin/instance/config', { headers: authHeaders(token) }),

  patchAdminConfig: (token: string, patch: Partial<AdminInstanceConfig>) =>
    request<AdminInstanceConfig>('/api/admin/instance/config', {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify(patch),
    }),

  listInviteCodes: (token: string) =>
    request<InviteCode[]>('/api/admin/invite-codes', { headers: authHeaders(token) }),

  createInviteCodes: (token: string, count?: number) =>
    request<InviteCode[]>('/api/admin/invite-codes', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ count }),
    }),
}
