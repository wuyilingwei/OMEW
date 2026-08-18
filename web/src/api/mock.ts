// in-memory stand-in for /api/* — resets on page reload, no persistence.
// remove once the real backend is merged; see index.ts for the switch.
import { mockNodes } from '../data/mock'
import { ApiRequestError } from './errors'
import type {
  AdminInstanceConfig,
  AuthResponse,
  AuthUser,
  BanEntry,
  InviteCode,
  LoginPayload,
  MemberPage,
  MemberPatch,
  MemberTab,
  PublicUser,
  RegisterPayload,
  StrongholdConfig,
  StrongholdConfigPatch,
  StrongholdMember,
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

function requireUser(token: string): MockUser {
  const uid = sessions.get(token)
  const user = users.find((candidate) => candidate.id === uid)
  if (!user) throw new ApiRequestError('AUTH_FAILED', 401)
  return user
}

// stronghold config/members/bans — seeded lazily per node id so every mock
// stronghold (mockNodes) is manageable without a separate bootstrap step.
const strongholdConfigs = new Map<string, StrongholdConfig>()
const strongholdMembers = new Map<string, StrongholdMember[]>()
const strongholdBans = new Map<string, BanEntry[]>()

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

function seedStronghold(nodeId: string) {
  if (strongholdConfigs.has(nodeId)) return
  const node = mockNodes.find((candidate) => candidate.id === nodeId)
  strongholdConfigs.set(nodeId, {
    id: nodeId,
    name: node?.name ?? nodeId,
    description: node?.description ?? '',
    cover: node?.cover ?? '',
    visibility: 'public',
    allow_message_edit: true,
    allow_message_retract: true,
    edit_window_secs: 300,
  })
  strongholdMembers.set(nodeId, [
    {
      actor: 'admin@local',
      username: 'admin',
      display_name: 'admin',
      role: 'owner',
      deny_discussion: false,
      deny_idea: false,
      deny_comment: false,
      joined_at: daysAgo(30),
      is_guest: false,
    },
    {
      actor: 'rin@local',
      username: 'Rin',
      display_name: 'Rin',
      role: 'mod',
      deny_discussion: false,
      deny_idea: false,
      deny_comment: false,
      joined_at: daysAgo(20),
      is_guest: false,
    },
    {
      actor: 'aki@local',
      username: 'Aki',
      display_name: 'Aki',
      role: 'member',
      deny_discussion: false,
      deny_idea: false,
      deny_comment: false,
      joined_at: daysAgo(10),
      is_guest: false,
    },
    {
      actor: 'mika@remote.example',
      username: 'Mika',
      display_name: 'Mika',
      role: 'member',
      deny_discussion: false,
      deny_idea: true,
      deny_comment: false,
      joined_at: daysAgo(5),
      is_guest: true,
      home_domain: 'remote.example',
    },
  ])
  strongholdBans.set(nodeId, [])
}

function findMember(nodeId: string, actor: string): StrongholdMember | undefined {
  return strongholdMembers.get(nodeId)?.find((member) => member.actor === actor)
}

function requireManager(token: string, nodeId: string): { user: MockUser; member: StrongholdMember } {
  seedStronghold(nodeId)
  const user = requireUser(token)
  const member = strongholdMembers.get(nodeId)?.find((candidate) => candidate.username === user.username)
  if (!member || (member.role !== 'owner' && member.role !== 'mod')) throw new ApiRequestError('FORBIDDEN', 403)
  return { user, member }
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

  async getStrongholdConfig(token: string, nodeId: string): Promise<StrongholdConfig> {
    requireUser(token)
    seedStronghold(nodeId)
    return delay({ ...strongholdConfigs.get(nodeId)! })
  },

  async patchStrongholdConfig(token: string, nodeId: string, patch: StrongholdConfigPatch): Promise<StrongholdConfig> {
    const { member } = requireManager(token, nodeId)
    if (patch.visibility !== undefined && member.role !== 'owner') throw new ApiRequestError('FORBIDDEN', 403)
    const next = { ...strongholdConfigs.get(nodeId)!, ...patch }
    strongholdConfigs.set(nodeId, next)
    return delay({ ...next })
  },

  async getStrongholdMembers(token: string, nodeId: string, tab: MemberTab): Promise<MemberPage> {
    requireUser(token)
    seedStronghold(nodeId)
    if (tab === 'banned') {
      const banned = strongholdBans.get(nodeId) ?? []
      return delay({
        members: banned.map((ban) => ({
          actor: ban.actor,
          username: ban.username,
          display_name: ban.display_name,
          role: 'member' as const,
          deny_discussion: true,
          deny_idea: true,
          deny_comment: true,
          joined_at: ban.banned_at,
          is_guest: false,
        })),
        next_cursor: null,
      })
    }
    const all = strongholdMembers.get(nodeId) ?? []
    const filtered =
      tab === 'restricted'
        ? all.filter((member) => member.deny_discussion || member.deny_idea || member.deny_comment)
        : all
    return delay({ members: [...filtered], next_cursor: null })
  },

  async patchMember(token: string, nodeId: string, actor: string, patch: MemberPatch): Promise<StrongholdMember> {
    const { member: manager } = requireManager(token, nodeId)
    const target = findMember(nodeId, actor)
    if (!target) throw new ApiRequestError('NOT_FOUND', 404)
    if (target.role === 'owner') throw new ApiRequestError('FORBIDDEN', 403)
    if (patch.role !== undefined) {
      if (manager.role !== 'owner') throw new ApiRequestError('FORBIDDEN', 403)
      if (patch.deny_discussion || patch.deny_idea || patch.deny_comment) {
        throw new ApiRequestError('DENY_ON_MOD', 400)
      }
      target.role = patch.role
    }
    const hasDenyPatch = patch.deny_discussion !== undefined || patch.deny_idea !== undefined || patch.deny_comment !== undefined
    if (hasDenyPatch) {
      if (target.role === 'mod') throw new ApiRequestError('DENY_ON_MOD', 400)
      if (patch.deny_discussion !== undefined) target.deny_discussion = patch.deny_discussion
      if (patch.deny_idea !== undefined) target.deny_idea = patch.deny_idea
      if (patch.deny_comment !== undefined) target.deny_comment = patch.deny_comment
    }
    return delay({ ...target })
  },

  async removeMember(token: string, nodeId: string, actor: string): Promise<void> {
    const { member: manager } = requireManager(token, nodeId)
    const target = findMember(nodeId, actor)
    if (!target) throw new ApiRequestError('NOT_FOUND', 404)
    if (target.role === 'owner') throw new ApiRequestError('FORBIDDEN', 403)
    if (target.role === 'mod' && manager.role !== 'owner') throw new ApiRequestError('FORBIDDEN', 403)
    strongholdMembers.set(nodeId, (strongholdMembers.get(nodeId) ?? []).filter((m) => m.actor !== actor))
    return delay(undefined)
  },

  async listBans(token: string, nodeId: string): Promise<BanEntry[]> {
    requireManager(token, nodeId)
    return delay([...(strongholdBans.get(nodeId) ?? [])])
  },

  async banMember(token: string, nodeId: string, actor: string): Promise<void> {
    const { user, member: manager } = requireManager(token, nodeId)
    const target = findMember(nodeId, actor)
    if (!target) throw new ApiRequestError('NOT_FOUND', 404)
    if (target.role === 'owner') throw new ApiRequestError('FORBIDDEN', 403)
    if (target.role === 'mod' && manager.role !== 'owner') throw new ApiRequestError('FORBIDDEN', 403)
    strongholdMembers.set(nodeId, (strongholdMembers.get(nodeId) ?? []).filter((m) => m.actor !== actor))
    const bans = strongholdBans.get(nodeId) ?? []
    bans.push({
      actor: target.actor,
      username: target.username,
      display_name: target.display_name,
      banned_by: user.username,
      banned_at: new Date().toISOString(),
    })
    strongholdBans.set(nodeId, bans)
    return delay(undefined)
  },

  async unbanMember(token: string, nodeId: string, actor: string): Promise<void> {
    requireManager(token, nodeId)
    strongholdBans.set(nodeId, (strongholdBans.get(nodeId) ?? []).filter((ban) => ban.actor !== actor))
    return delay(undefined)
  },

  async transferOwnership(token: string, nodeId: string, toActor: string): Promise<void> {
    const { user } = requireManager(token, nodeId)
    const members = strongholdMembers.get(nodeId) ?? []
    const currentOwner = members.find((m) => m.username === user.username && m.role === 'owner')
    if (!currentOwner) throw new ApiRequestError('FORBIDDEN', 403)
    const target = members.find((m) => m.actor === toActor)
    if (!target) throw new ApiRequestError('NOT_FOUND', 404)
    currentOwner.role = 'member'
    currentOwner.deny_discussion = false
    currentOwner.deny_idea = false
    currentOwner.deny_comment = false
    target.role = 'owner'
    target.deny_discussion = false
    target.deny_idea = false
    target.deny_comment = false
    return delay(undefined)
  },

  async getUser(token: string, actor: string): Promise<PublicUser> {
    requireUser(token)
    for (const nodeId of strongholdMembers.keys()) {
      const member = findMember(nodeId, actor)
      if (member) {
        return delay({
          actor: member.actor,
          username: member.username,
          display_name: member.display_name,
          is_guest: member.is_guest,
          home_domain: member.home_domain,
        })
      }
    }
    throw new ApiRequestError('NOT_FOUND', 404)
  },
}
