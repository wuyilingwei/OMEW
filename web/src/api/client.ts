import { ApiRequestError } from './errors'
import type {
  AdminInstanceConfig,
  AuthResponse,
  BanEntry,
  InstanceConfig,
  InviteCode,
  LoginPayload,
  MemberPage,
  MemberPatch,
  MemberTab,
  PublicUser,
  RegisterPayload,
  StrongholdConfig,
  StrongholdConfigPatch,
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

  getStrongholdConfig: (token: string, nodeId: string) =>
    request<StrongholdConfig>(`/api/stronghold/${nodeId}/config`, { headers: authHeaders(token) }),

  patchStrongholdConfig: (token: string, nodeId: string, patch: StrongholdConfigPatch) =>
    request<StrongholdConfig>(`/api/stronghold/${nodeId}/config`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify(patch),
    }),

  getStrongholdMembers: (token: string, nodeId: string, tab: MemberTab, after?: string) =>
    request<MemberPage>(
      `/api/stronghold/${nodeId}/members?tab=${tab}${after ? `&after=${encodeURIComponent(after)}` : ''}`,
      { headers: authHeaders(token) },
    ),

  patchMember: (token: string, nodeId: string, actor: string, patch: MemberPatch) =>
    request<void>(`/api/stronghold/${nodeId}/members/${encodeURIComponent(actor)}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify(patch),
    }),

  removeMember: (token: string, nodeId: string, actor: string) =>
    request<void>(`/api/stronghold/${nodeId}/members/${encodeURIComponent(actor)}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    }),

  listBans: (token: string, nodeId: string) =>
    request<BanEntry[]>(`/api/stronghold/${nodeId}/bans`, { headers: authHeaders(token) }),

  banMember: (token: string, nodeId: string, actor: string) =>
    request<void>(`/api/stronghold/${nodeId}/bans/${encodeURIComponent(actor)}`, {
      method: 'PUT',
      headers: authHeaders(token),
    }),

  unbanMember: (token: string, nodeId: string, actor: string) =>
    request<void>(`/api/stronghold/${nodeId}/bans/${encodeURIComponent(actor)}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    }),

  transferOwnership: (token: string, nodeId: string, toActor: string) =>
    request<void>(`/api/stronghold/${nodeId}/transfer`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ to: toActor }),
    }),

  getUser: (token: string, actor: string) =>
    request<PublicUser>(`/api/users/${encodeURIComponent(actor)}`, { headers: authHeaders(token) }),
}
