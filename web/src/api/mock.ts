// in-memory stand-in for /api/* — resets on page reload, no persistence.
// remove once the real backend is merged; see index.ts for the switch.
import { ApiRequestError } from './errors'
import type {
  AdminInstanceConfig,
  AuthResponse,
  AuthUser,
  InviteCode,
  LoginPayload,
  RegisterPayload,
} from './types'

interface MockUser extends AuthUser {
  password: string
}

let config: AdminInstanceConfig = {
  allow_root: true,
  root_requirements: ['email'],
  trusted_identity_servers: ['*'],
}

// seeded so the admin view has something to log into during dev/visual checks
const users: MockUser[] = [
  { id: 'u-admin', username: 'admin', password: 'admin123', is_admin: true, email: 'admin@example.com' },
]

const inviteCodes: InviteCode[] = []
const sessions = new Map<string, string>() // token -> user id

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/
const CODE_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'

function delay<T>(value: T, ms = 220): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

function makeToken(): string {
  return `mock-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

function stripPassword(user: MockUser): AuthUser {
  const { password: _password, ...rest } = user
  return rest
}

function randomCode(): string {
  return Array.from({ length: 10 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('')
}

function requireAdmin(token: string): MockUser {
  const uid = sessions.get(token)
  const user = users.find((candidate) => candidate.id === uid)
  if (!user?.is_admin) throw new ApiRequestError('AUTH_FAILED', 403)
  return user
}

export const mockApi = {
  async getInstanceConfig() {
    return delay({ allow_root: config.allow_root, root_requirements: config.root_requirements })
  },

  async register(payload: RegisterPayload): Promise<AuthResponse> {
    if (!config.allow_root) throw new ApiRequestError('REGISTRATION_DISABLED', 403)
    if (config.root_requirements.includes('phone')) throw new ApiRequestError('PHONE_UNSUPPORTED', 400)
    if (!USERNAME_RE.test(payload.username) || users.some((u) => u.username === payload.username)) {
      throw new ApiRequestError('USERNAME_INVALID', 400)
    }
    if (config.root_requirements.includes('code')) {
      const invite = inviteCodes.find((c) => c.code === payload.code && !c.used)
      if (!invite) throw new ApiRequestError('INVITE_INVALID', 400)
      invite.used = true
    }
    const user: MockUser = {
      id: `u-${Date.now().toString(36)}`,
      username: payload.username,
      password: payload.password,
      is_admin: false,
      email: payload.email,
    }
    users.push(user)
    const token = makeToken()
    sessions.set(token, user.id)
    return delay({ token, user: stripPassword(user) })
  },

  async login(payload: LoginPayload): Promise<AuthResponse> {
    const user = users.find((u) => u.username === payload.username && u.password === payload.password)
    if (!user) throw new ApiRequestError('AUTH_FAILED', 401)
    const token = makeToken()
    sessions.set(token, user.id)
    return delay({ token, user: stripPassword(user) })
  },

  async getAdminConfig(token: string) {
    requireAdmin(token)
    return delay({ ...config })
  },

  async patchAdminConfig(token: string, patch: Partial<AdminInstanceConfig>) {
    requireAdmin(token)
    config = { ...config, ...patch }
    return delay({ ...config })
  },

  async listInviteCodes(token: string) {
    requireAdmin(token)
    return delay([...inviteCodes])
  },

  async createInviteCodes(token: string, count = 1) {
    requireAdmin(token)
    const created: InviteCode[] = Array.from({ length: Math.max(1, count) }, () => ({
      code: randomCode(),
      used: false,
      created_at: new Date().toISOString(),
    }))
    inviteCodes.push(...created)
    return delay([...inviteCodes])
  },
}
