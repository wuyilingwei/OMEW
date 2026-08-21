// in-memory stand-in for /api/* — resets on page reload, no persistence.
// dev-only opt-in (see index.ts); production builds never import this module's
// data path in practice since USE_MOCK is false by default.
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/browser'
import { STAMP_EMOTES } from '../assets/mew'
import { isReservedUsername } from '../utils/reservedUsernames'
import { ApiRequestError } from './errors'
import type { RoomSocketHandlers, RoomTransport } from './roomSocket'
import type {
  AdminInstanceConfig,
  AdminUsersPage,
  AuthResponse,
  AuthUser,
  BanEntry,
  CreateRoomPayload,
  CreateStrongholdPayload,
  DirectoryEntry,
  EditRetractResult,
  Emote,
  EmotePack,
  InviteCode,
  ItemBody,
  LoginPayload,
  MediaUploadResult,
  MemberGroupRef,
  MemberPage,
  MemberPatch,
  MemberTab,
  OwnershipResponse,
  Passkey,
  PasskeyAuthOptions,
  PasskeyRegistrationOptions,
  PostPage,
  PostThread,
  PublicUser,
  RegisterPayload,
  RoomItem,
  RoomPatch,
  RoomSummary,
  RoomTokenResponse,
  RoomType,
  ServerGroup,
  ServerGroupCreatePayload,
  ServerGroupPatch,
  ServerRole,
  StorageUsage,
  StrongholdApplication,
  StrongholdApplicationState,
  StrongholdConfig,
  StrongholdConfigPatch,
  StrongholdMember,
  StrongholdSummary,
  Topic,
  TopicPayload,
  TotpLoginResult,
  TotpSetupResponse,
} from './types'

const TOPIC_LIMIT = 32
const POST_TOPIC_LIMIT = 5

interface MockUser extends AuthUser {
  password: string
  ownership_pubkey: string
  ownership_ciphertext: string
  created_at: number
  totp_secret: string | null
  totp_enabled: boolean
}

// task 035: real instance policy is env-config, read-only through the API -
// this fixed object stands in for that env snapshot. stronghold_creation_policy
// is seeded 'application' (not 'open') specifically so the read-only admin
// panel's pending-applications section has something to show during a mock
// visual check.
const config: AdminInstanceConfig = {
  allow_root: true,
  root_requirements: ['email'],
  trusted_identity_servers: ['*'],
  federation_peers: [],
  max_file_bytes: 8 * 1024 * 1024,
  user_storage_quota_bytes: 100 * 1024 * 1024,
  stronghold_creation_policy: 'application',
  stronghold_creators: [],
  allow_guest_browsing: true,
}

// demo emote pack seeded from the same bundled mascot images the seed
// script installs against a real instance - lets the picker/renderer be
// visually checked without a backend.
const emotePacks: EmotePack[] = [
  {
    id: 'mock-pack-mew',
    name: 'Mew',
    emotes: Object.entries(STAMP_EMOTES).map(([name, url]): Emote => ({ id: `mock-emote-${name}`, name, media_id: `mock-media-${name}`, url })),
  },
]

const mediaStore = new Map<string, MediaUploadResult>()
const storageUsage = { used: 0 }
// seeded pending entry so the admin panel's applications review section
// (still a live data operation under the read-only policy, task 039) has
// something to approve/reject during a mock visual check.
const strongholdApplications: StrongholdApplication[] = [
  {
    id: 'app-seed-1',
    actor: actorFor('newcomer'),
    name: '同好会驿站',
    description: '面向同好交流的小型据点，日常闲聊为主。',
    visibility: 'public',
    state: 'pending',
    created_at: Date.now() - 3600_000,
    decided_by: null,
    decided_at: null,
  },
]

function actorFor(username: string): string {
  return `@${username}:local`
}

function localpartOf(actor: string): string {
  return actor.replace(/^@/, '').split(':')[0] ?? actor
}

// seeded so the admin view has something to log into during dev/visual checks
// - 'admin' is the server_owner (bootstrap account, m0-protocol §7.10), 'mod2'
// is a plain server_admin so the owner-only appointment UI (task 039) has a
// second row to demote during a visual check.
const users: MockUser[] = [
  {
    actor: actorFor('admin'),
    username: 'admin',
    password: 'admin123',
    is_admin: true,
    server_role: 'owner',
    email: 'admin@example.com',
    email_verified: true,
    ownership_pubkey: 'mock-seed-pubkey',
    ownership_ciphertext: 'mock-seed-ciphertext',
    created_at: Date.now() - 30 * 86_400_000,
    totp_secret: null,
    totp_enabled: false,
  },
  {
    actor: actorFor('mod2'),
    username: 'mod2',
    password: 'mod2pass1',
    is_admin: true,
    server_role: 'admin',
    email: null,
    email_verified: false,
    ownership_pubkey: 'mock-seed-pubkey',
    ownership_ciphertext: 'mock-seed-ciphertext',
    created_at: Date.now() - 12 * 86_400_000,
    totp_secret: null,
    totp_enabled: false,
  },
]

const inviteCodes: InviteCode[] = []
const sessions = new Map<string, string>() // token -> actor

// ---- TOTP / passkey mock state ---------------------------------------------
// The mock never implements real RFC 6238 arithmetic or WebAuthn signature
// verification (no backend to check against) - it only needs to satisfy the
// contract shape for a dev/visual check. TOTP codes are accepted as valid as
// long as they're 6 digits; passkey registration/login still drives the
// browser's real navigator.credentials ceremony (ids/challenges below are
// well-formed base64url), just without cryptographic verification server-side.
const totpPending = new Map<string, { actor: string; exp: number }>() // pending token -> claims
interface MockPasskey extends Passkey {
  actor: string
}
const passkeys: MockPasskey[] = []

function randomBase64Url(bytes = 32): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes))
  let bin = ''
  for (const b of arr) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomBase32Secret(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  return Array.from({ length: 32 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
}

function makeChallengeToken(payload: Record<string, unknown>): string {
  return btoa(JSON.stringify(payload))
}

function readChallengeToken(token: string): Record<string, unknown> | null {
  try {
    return JSON.parse(atob(token))
  } catch {
    return null
  }
}

function totpCodeError(code: string): boolean {
  return !/^\d{6}$/.test(code)
}

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/
const CODE_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const PREVIEW_LEN = 80

function delay<T>(value: T, ms = 220): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

function makeToken(): string {
  return `mock-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

function stripPassword(user: MockUser): AuthUser {
  const {
    password: _password,
    ownership_pubkey: _pubkey,
    ownership_ciphertext: _ciphertext,
    totp_secret: _totpSecret,
    totp_enabled: _totpEnabled,
    ...rest
  } = user
  return rest
}

function randomCode(): string {
  return Array.from({ length: 10 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('')
}

function requireAdmin(token: string): MockUser {
  const actor = sessions.get(token)
  const user = users.find((candidate) => candidate.actor === actor)
  if (!user?.is_admin) throw new ApiRequestError('AUTH_FAILED', 403)
  return user
}

// server_owner-only gate (task 035/039), mirrors server's requireServerRole(min="owner").
function requireOwner(token: string): MockUser {
  const actor = sessions.get(token)
  if (!actor) throw new ApiRequestError('AUTH_REQUIRED', 401)
  const user = users.find((candidate) => candidate.actor === actor)
  if (!user || user.server_role !== 'owner') throw new ApiRequestError('ADMIN_REQUIRED', 403)
  return user
}

function requireUser(token: string): MockUser {
  const actor = sessions.get(token)
  const user = users.find((candidate) => candidate.actor === actor)
  if (!user) throw new ApiRequestError('AUTH_FAILED', 401)
  return user
}

// task 034 guest read gate, mirrors server's resolveGuestOrMember: a token
// still requires a valid session, but no token at all falls through to a
// guest read as long as the instance allows it and the stronghold is public.
function requireUserOrGuest(token: string | null, nodeId: string): MockUser | null {
  if (token) return requireUser(token)
  const state = strongholds.get(nodeId)
  if (!state || !(config.allow_guest_browsing && state.visibility === 'public')) {
    throw new ApiRequestError('AUTH_REQUIRED', 401)
  }
  return null
}

// ---- strongholds / rooms / room items --------------------------------------

interface MockRoomState {
  res_id: string
  type: RoomType
  name: string
  position: number
  restricted: boolean
  items: RoomItem[] // seq ascending
  tombstoned: Set<number>
  postIndex: Map<number, { last_reply_seq: number; reply_count: number; bumped_at: number }>
  nextSeq: number
}

interface MockStrongholdState {
  id: string
  name: string
  description: string
  cover: string
  visibility: StrongholdConfig['visibility']
  allow_message_edit: boolean
  allow_message_retract: boolean
  edit_window_secs: number
  owner_actor: string
  rooms: Map<string, MockRoomState>
  topics: Topic[]
}

const strongholds = new Map<string, MockStrongholdState>()
const strongholdMembers = new Map<string, StrongholdMember[]>()
const strongholdBans = new Map<string, BanEntry[]>()

// task 048: server-level user groups, and each local user's group membership
// as a set of group ids - mirrors the server's `server_groups` /
// `user_server_groups` D1 tables closely enough for a dev/visual check.
// Keyed by bare localpart (design point 1: only local users are assignable).
const serverGroups: ServerGroup[] = []
const userGroupIds = new Map<string, Set<string>>() // localpart -> group ids

function memberGroupsFor(localpart: string): MemberGroupRef[] {
  const ids = userGroupIds.get(localpart)
  if (!ids || ids.size === 0) return []
  return serverGroups
    .filter((g) => ids.has(g.id))
    .sort((a, b) => a.position - b.position)
    .map((g) => ({ id: g.id, name: g.name, color: g.color }))
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

function minutesAgo(mins: number): number {
  return Date.now() - mins * 60_000
}

function makeRoom(resId: string, type: RoomType, name: string, position = 0): MockRoomState {
  return {
    res_id: resId,
    type,
    name,
    position,
    restricted: false,
    items: [],
    tombstoned: new Set(),
    postIndex: new Map(),
    nextSeq: 1,
  }
}

function appendItem(
  room: MockRoomState,
  actor: string,
  kind: 'post' | 'reply',
  body: ItemBody,
  parentSeq: number | null,
  ts: number,
): RoomItem {
  const seq = room.nextSeq++
  const rootSeq = parentSeq ?? seq
  const topics = body.topics?.length ? [...new Set(body.topics)].slice(0, POST_TOPIC_LIMIT) : undefined
  const finalBody: ItemBody =
    room.type === 'section' && parentSeq == null
      ? { ...body, preview: (body.text ?? '').slice(0, PREVIEW_LEN), topics }
      : { ...body, topics }
  const item: RoomItem = { seq, parent_seq: parentSeq, root_seq: rootSeq, actor, kind, ts, body: finalBody }
  room.items.push(item)
  if (room.type === 'section' && parentSeq == null) {
    room.postIndex.set(seq, { last_reply_seq: seq, reply_count: 0, bumped_at: ts })
  } else if (room.type === 'section' && parentSeq != null) {
    const idx = room.postIndex.get(rootSeq)
    if (idx) {
      idx.last_reply_seq = seq
      idx.reply_count += 1
      idx.bumped_at = ts
    }
  }
  return item
}

function seedDemoStronghold(): void {
  const id = 'demo-stronghold'
  if (strongholds.has(id)) return
  const lobby = makeRoom('lobby', 'channel', '大厅', 0)
  const posts = makeRoom('posts', 'section', '帖子', 0)

  const chatSeed: [string, string, number][] = [
    ['rin', '早上好，今天的同步会议改到下午三点', 60],
    ['admin', '收到，我把文档链接放这里', 58],
    ['rin', '看到了，辛苦', 57],
    ['aki', '频道下拉切换起来顺手多了', 40],
    ['admin', '对，之前那条横向标签栏确实别扭', 38],
    ['rin', '进度已经同步到看板了', 20],
    ['admin', '看到了，稍后过一遍', 12],
  ]
  for (const [username, text, minsAgo] of chatSeed) {
    appendItem(lobby, actorFor(username), 'post', { text }, null, minutesAgo(minsAgo))
  }

  const postSeed: [string, string, string, number][] = [
    ['admin', '本周维护窗口已更新', '本次维护将在周四凌晨两点开始，预计持续一小时，期间聊天记录仍可正常读取，但发送新消息会暂时不可用。', 300],
    ['rin', '新据点主题壁纸放出', '这次的主题延续了上个季度的配色，加入了更多据点相关的细节，欢迎大家来挑喜欢的一张。', 180],
    ['aki', '周末创作征集', '主题是「据点日常」，形式不限，文字、绘画、摄影都可以，周日晚上十点截止投稿。', 90],
  ]
  for (const [username, title, text, minsAgo] of postSeed) {
    appendItem(posts, actorFor(username), 'post', { title, text }, null, minutesAgo(minsAgo))
  }

  strongholds.set(id, {
    id,
    name: '主据点',
    description: '综合讨论与公告的默认据点，日常消息大多汇聚在这里。',
    cover: '',
    visibility: 'public',
    allow_message_edit: true,
    allow_message_retract: true,
    edit_window_secs: 300,
    owner_actor: actorFor('admin'),
    rooms: new Map([
      [lobby.res_id, lobby],
      [posts.res_id, posts],
    ]),
    topics: [
      { id: 'topic-announce', name: '公告', color: '#4b9dd7', position: 0 },
      { id: 'topic-chat', name: '闲聊', color: '#af5d3e', position: 1 },
    ],
  })

  // task 048: two demo server groups + one assignment, so the server admin
  // panel's groups tab and a member badge both have something to show
  // during a mock visual check.
  if (!serverGroups.length) {
    serverGroups.push(
      { id: 'grp-tester', name: '内测成员', color: '#4b9dd7', position: 0, allow_speak: 0, allow_post: 1, allow_reply: 0, is_moderator: false },
      { id: 'grp-quieted', name: '禁言观察', color: '#af5d3e', position: 1, allow_speak: -1, allow_post: -1, allow_reply: -1, is_moderator: false },
    )
    userGroupIds.set('Aki', new Set(['grp-tester']))
  }

  strongholdMembers.set(id, [
    {
      actor: actorFor('admin'),
      username: 'admin',
      display_name: 'admin',
      role: 'owner',
      deny_discussion: false,
      deny_idea: false,
      deny_comment: false,
      joined_at: daysAgo(30),
      is_guest: false,
      groups: [],
    },
    {
      actor: actorFor('rin'),
      username: 'Rin',
      display_name: 'Rin',
      role: 'mod',
      deny_discussion: false,
      deny_idea: false,
      deny_comment: false,
      joined_at: daysAgo(20),
      is_guest: false,
      groups: [],
    },
    {
      actor: actorFor('aki'),
      username: 'Aki',
      display_name: 'Aki',
      role: 'member',
      deny_discussion: false,
      deny_idea: false,
      deny_comment: false,
      joined_at: daysAgo(10),
      is_guest: false,
      groups: memberGroupsFor('Aki'),
    },
  ])
  strongholdBans.set(id, [])
}
seedDemoStronghold()

function toStrongholdConfig(state: MockStrongholdState): StrongholdConfig {
  return {
    id: state.id,
    name: state.name,
    description: state.description,
    cover: state.cover,
    visibility: state.visibility,
    allow_message_edit: state.allow_message_edit,
    allow_message_retract: state.allow_message_retract,
    edit_window_secs: state.edit_window_secs,
  }
}

function toStrongholdSummary(state: MockStrongholdState): StrongholdSummary {
  const rooms: RoomSummary[] = [...state.rooms.values()]
    .sort((a, b) => a.position - b.position)
    .map((r) => ({ id: r.res_id, name: r.name, type: r.type }))
  return { id: state.id, name: state.name, cover: state.cover || null, rooms }
}

function requireTopic(state: MockStrongholdState, topicId: string): Topic {
  const topic = state.topics.find((t) => t.id === topicId)
  if (!topic) throw new ApiRequestError('NOT_FOUND', 404)
  return topic
}

function validateTopicName(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length < 1 || trimmed.length > 16) throw new ApiRequestError('MALFORMED', 400)
  return trimmed
}

function requireRoom(nodeId: string, resId: string): MockRoomState {
  const state = strongholds.get(nodeId)
  const room = state?.rooms.get(resId)
  if (!room) throw new ApiRequestError('NOT_FOUND', 404)
  return room
}

function findMember(nodeId: string, actor: string): StrongholdMember | undefined {
  return strongholdMembers.get(nodeId)?.find((member) => member.actor === actor)
}

function requireManager(token: string, nodeId: string): { user: MockUser; member: StrongholdMember } {
  const user = requireUser(token)
  const member = strongholdMembers.get(nodeId)?.find((candidate) => candidate.actor === user.actor)
  if (!member || (member.role !== 'owner' && member.role !== 'mod')) throw new ApiRequestError('FORBIDDEN', 403)
  return { user, member }
}

function toPost(room: MockRoomState, item: RoomItem) {
  const idx = room.postIndex.get(item.seq)
  return {
    post_seq: item.seq,
    actor: item.actor,
    created_at: item.ts,
    title: item.body.title ?? '',
    cover: item.body.cover ?? null,
    preview: item.body.preview ?? '',
    media: item.body.media,
    topics: item.body.topics,
    last_reply_seq: idx?.last_reply_seq ?? item.seq,
    reply_count: idx?.reply_count ?? 0,
    bumped_at: idx?.bumped_at ?? item.ts,
  }
}

// ---- mock room WS transport --------------------------------------------------
// no real network hop; item.create resolves synchronously against the same
// in-memory room store the REST-shaped methods below read from.

export class MockRoomTransport implements RoomTransport {
  constructor(
    private readonly nodeId: string,
    private readonly resId: string,
    private readonly actor: string,
    private readonly handlers: RoomSocketHandlers,
  ) {}

  connect(): void {
    queueMicrotask(() => this.handlers.onOpen?.())
  }

  close(): void {
    this.handlers.onClose?.()
  }

  createItem(clientId: string, kind: 'post' | 'reply', body: Record<string, unknown>, parentSeq?: number | null): boolean {
    const room = strongholds.get(this.nodeId)?.rooms.get(this.resId)
    if (!room) return false
    const item = appendItem(room, this.actor, kind, body as ItemBody, parentSeq ?? null, Date.now())
    queueMicrotask(() => {
      this.handlers.onAck?.({ status: 'ok', client_id: clientId, seq: item.seq })
      if (item.parent_seq != null) {
        const idx = room.postIndex.get(item.root_seq!)
        if (idx) {
          this.handlers.onBump?.({
            post_seq: item.root_seq!,
            last_reply_seq: idx.last_reply_seq,
            reply_count: idx.reply_count,
            preview: item.body.text?.slice(0, PREVIEW_LEN) ?? '',
            ts: idx.bumped_at,
          })
        }
      }
    })
    return true
  }

  editItem(targetSeq: number, body: Record<string, unknown>): boolean {
    const room = strongholds.get(this.nodeId)?.rooms.get(this.resId)
    const item = room?.items.find((i) => i.seq === targetSeq)
    if (!room || !item) return false
    item.body = body as ItemBody
    item.edited_at = Date.now()
    queueMicrotask(() => this.handlers.onUpdate?.({ seq: targetSeq, target_seq: targetSeq, body: item.body, edited_at: item.edited_at! }))
    return true
  }

  deleteItem(targetSeq: number, reason?: string): boolean {
    const room = strongholds.get(this.nodeId)?.rooms.get(this.resId)
    if (!room) return false
    room.tombstoned.add(targetSeq)
    queueMicrotask(() => this.handlers.onDelete?.({ seq: targetSeq, target_seq: targetSeq, reason, by_role: 'author' }))
    return true
  }
}

export const mockApi = {
  async getInstanceConfig() {
    return delay({
      allow_root: config.allow_root,
      root_requirements: config.root_requirements,
      stronghold_creation: config.stronghold_creation_policy,
      allow_guest_browsing: config.allow_guest_browsing,
    })
  },

  async getDirectory(): Promise<DirectoryEntry[]> {
    if (!config.allow_guest_browsing) throw new ApiRequestError('NOT_FOUND', 404)
    const entries = [...strongholds.values()]
      .filter((s) => s.visibility === 'public')
      .map(
        (s): DirectoryEntry => ({
          id: s.id,
          name: s.name,
          description: s.description || null,
          cover: s.cover || null,
          member_count: strongholdMembers.get(s.id)?.length ?? 0,
        }),
      )
    return delay(entries)
  },

  async changePassword(
    token: string,
    payload: { old_password: string; new_password: string; new_ownership_ciphertext?: string },
  ): Promise<void> {
    const user = requireUser(token)
    if (payload.old_password !== user.password) throw new ApiRequestError('AUTH_FAILED', 401)
    if (payload.new_password.length < 8) throw new ApiRequestError('PASSWORD_INVALID', 400)
    user.password = payload.new_password
    if (payload.new_ownership_ciphertext) user.ownership_ciphertext = payload.new_ownership_ciphertext
    return delay(undefined, 150)
  },

  async getOwnership(token: string): Promise<OwnershipResponse> {
    const user = requireUser(token)
    return delay({ ownership_pubkey: user.ownership_pubkey, ownership_ciphertext: user.ownership_ciphertext })
  },

  async register(payload: RegisterPayload): Promise<AuthResponse> {
    if (!config.allow_root) throw new ApiRequestError('REGISTRATION_DISABLED', 403)
    if (config.root_requirements.includes('phone')) throw new ApiRequestError('PHONE_UNSUPPORTED', 400)
    if (!USERNAME_RE.test(payload.username) || users.some((u) => u.username === payload.username)) {
      throw new ApiRequestError('USERNAME_INVALID', 400)
    }
    if (isReservedUsername(payload.username.toLowerCase())) {
      throw new ApiRequestError('USERNAME_RESERVED', 400)
    }
    if (config.root_requirements.includes('code')) {
      const invite = inviteCodes.find((c) => c.code === payload.code && c.used_by == null)
      if (!invite) throw new ApiRequestError('INVITE_INVALID', 400)
      invite.used_by = payload.username
      invite.used_at = Date.now()
    }
    const user: MockUser = {
      actor: actorFor(payload.username),
      username: payload.username,
      password: payload.password,
      is_admin: false,
      server_role: 'user',
      email: payload.email ?? null,
      email_verified: false,
      ownership_pubkey: payload.ownership_pubkey,
      ownership_ciphertext: payload.ownership_ciphertext,
      created_at: Date.now(),
      totp_secret: null,
      totp_enabled: false,
    }
    users.push(user)
    const token = makeToken()
    sessions.set(token, user.actor)
    return delay({ token, user: stripPassword(user) })
  },

  async login(payload: LoginPayload): Promise<TotpLoginResult> {
    const user = users.find((u) => u.username === payload.username && u.password === payload.password)
    if (!user) throw new ApiRequestError('AUTH_FAILED', 401)
    if (user.totp_enabled) {
      const pending = makeToken()
      totpPending.set(pending, { actor: user.actor, exp: Date.now() + 300_000 })
      return delay({ totp_required: true as const, pending })
    }
    const token = makeToken()
    sessions.set(token, user.actor)
    return delay({ token, user: stripPassword(user) })
  },

  // ---- TOTP second factor (spec §7.2a) -----------------------------------

  async totpSetup(token: string): Promise<TotpSetupResponse> {
    const user = requireUser(token)
    if (user.totp_enabled) throw new ApiRequestError('TOTP_ALREADY_ENABLED', 409)
    const secret = randomBase32Secret()
    user.totp_secret = secret
    return delay({
      secret,
      otpauth_url: `otpauth://totp/OMEW:${user.username}?secret=${secret}&issuer=OMEW&algorithm=SHA1&digits=6&period=30`,
    })
  },

  async totpActivate(token: string, code: string): Promise<{ ok: true }> {
    const user = requireUser(token)
    if (!user.totp_secret) throw new ApiRequestError('TOTP_NOT_PENDING', 409)
    if (totpCodeError(code)) throw new ApiRequestError('TOTP_INVALID', 401)
    user.totp_enabled = true
    return delay({ ok: true as const })
  },

  async totpDisable(token: string, password: string, code: string): Promise<{ ok: true }> {
    const user = requireUser(token)
    if (password !== user.password) throw new ApiRequestError('AUTH_FAILED', 401)
    if (totpCodeError(code)) throw new ApiRequestError('TOTP_INVALID', 401)
    user.totp_secret = null
    user.totp_enabled = false
    return delay({ ok: true as const })
  },

  async loginTotp(pending: string, code: string): Promise<AuthResponse> {
    const claims = totpPending.get(pending)
    if (!claims || claims.exp < Date.now()) throw new ApiRequestError('AUTH_FAILED', 401)
    const user = users.find((u) => u.actor === claims.actor)
    if (!user) throw new ApiRequestError('AUTH_FAILED', 401)
    if (totpCodeError(code)) throw new ApiRequestError('TOTP_INVALID', 401)
    const token = makeToken()
    sessions.set(token, user.actor)
    return delay({ token, user: stripPassword(user) })
  },

  // ---- passkeys (WebAuthn, spec §7.2a) -----------------------------------

  async listPasskeys(token: string): Promise<Passkey[]> {
    const user = requireUser(token)
    return delay(passkeys.filter((p) => p.actor === user.actor).map(({ id, name, created_at }) => ({ id, name, created_at })))
  },

  async passkeyRegOptions(token: string): Promise<PasskeyRegistrationOptions> {
    const user = requireUser(token)
    const challenge = randomBase64Url()
    const challenge_token = makeChallengeToken({ actor: user.actor, challenge, exp: Date.now() + 300_000 })
    return delay({
      options: {
        rp: { name: 'OpenMew', id: location.hostname },
        user: { id: randomBase64Url(16), name: user.username, displayName: user.username },
        challenge,
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },
          { alg: -257, type: 'public-key' },
        ],
        timeout: 60_000,
        attestation: 'none',
        excludeCredentials: passkeys
          .filter((p) => p.actor === user.actor)
          .map((p) => ({ id: p.id, type: 'public-key' as const })),
      } as PasskeyRegistrationOptions['options'],
      challenge_token,
    })
  },

  async registerPasskey(
    token: string,
    response: RegistrationResponseJSON,
    challengeToken: string,
    name: string,
  ): Promise<Passkey> {
    const user = requireUser(token)
    const claims = readChallengeToken(challengeToken)
    if (!claims || claims.actor !== user.actor || (claims.exp as number) < Date.now()) {
      throw new ApiRequestError('AUTH_REQUIRED', 401)
    }
    if (!name) throw new ApiRequestError('PAYLOAD_INVALID', 400)
    if (passkeys.some((p) => p.id === response.id)) throw new ApiRequestError('PASSKEY_ALREADY_REGISTERED', 409)
    const passkey: MockPasskey = { id: response.id, name, created_at: Date.now(), actor: user.actor }
    passkeys.push(passkey)
    return delay({ id: passkey.id, name: passkey.name, created_at: passkey.created_at })
  },

  async renamePasskey(token: string, id: string, name: string): Promise<Passkey> {
    const user = requireUser(token)
    const passkey = passkeys.find((p) => p.id === id && p.actor === user.actor)
    if (!passkey) throw new ApiRequestError('NOT_FOUND', 404)
    if (!name) throw new ApiRequestError('PAYLOAD_INVALID', 400)
    passkey.name = name
    return delay({ id: passkey.id, name: passkey.name, created_at: passkey.created_at })
  },

  async deletePasskey(token: string, id: string): Promise<void> {
    const user = requireUser(token)
    const idx = passkeys.findIndex((p) => p.id === id && p.actor === user.actor)
    if (idx < 0) throw new ApiRequestError('NOT_FOUND', 404)
    passkeys.splice(idx, 1)
    return delay(undefined)
  },

  async passkeyLoginOptions(): Promise<PasskeyAuthOptions> {
    const challenge = randomBase64Url()
    const challenge_token = makeChallengeToken({ challenge, exp: Date.now() + 300_000 })
    return delay({
      options: {
        rpId: location.hostname,
        challenge,
        timeout: 60_000,
        userVerification: 'preferred',
        allowCredentials: [],
      } as PasskeyAuthOptions['options'],
      challenge_token,
    })
  },

  async loginPasskey(response: AuthenticationResponseJSON, challengeToken: string): Promise<AuthResponse> {
    const claims = readChallengeToken(challengeToken)
    if (!claims || (claims.exp as number) < Date.now()) throw new ApiRequestError('AUTH_FAILED', 401)
    const passkey = passkeys.find((p) => p.id === response.id)
    if (!passkey) throw new ApiRequestError('AUTH_FAILED', 401)
    const user = users.find((u) => u.actor === passkey.actor)
    if (!user) throw new ApiRequestError('AUTH_FAILED', 401)
    const token = makeToken()
    sessions.set(token, user.actor)
    return delay({ token, user: stripPassword(user) })
  },

  async getAdminConfig(token: string) {
    requireAdmin(token)
    return delay({ ...config })
  },

  // task 035: policy is env-config now - PATCH always 409s, same as the real
  // server (nothing in the UI calls this anymore; kept for contract fidelity).
  async patchAdminConfig(token: string, _patch: Partial<AdminInstanceConfig>) {
    requireAdmin(token)
    throw new ApiRequestError('POLICY_IS_ENV', 409)
  },

  async listInviteCodes(token: string) {
    requireAdmin(token)
    return delay([...inviteCodes])
  },

  async createInviteCodes(token: string, count = 1) {
    const admin = requireAdmin(token)
    const created: InviteCode[] = Array.from({ length: Math.max(1, count) }, () => ({
      code: randomCode(),
      created_by: admin.actor,
      created_at: Date.now(),
      used_by: null,
      used_at: null,
    }))
    inviteCodes.push(...created)
    return delay([...inviteCodes])
  },

  // ---- strongholds ----------------------------------------------------------

  async listMyStrongholds(token: string): Promise<StrongholdSummary[]> {
    const user = requireUser(token)
    const mine = [...strongholds.values()].filter((s) => strongholdMembers.get(s.id)?.some((m) => m.actor === user.actor))
    return delay(mine.map(toStrongholdSummary))
  },

  async createStronghold(
    token: string,
    payload: CreateStrongholdPayload,
  ): Promise<StrongholdConfig | { application_id: string; state: 'pending' }> {
    const user = requireUser(token)
    if (!user.is_admin && config.stronghold_creation_policy === 'restricted' && !config.stronghold_creators.includes(user.actor)) {
      throw new ApiRequestError('CREATION_RESTRICTED', 403)
    }
    if (!user.is_admin && config.stronghold_creation_policy === 'application') {
      const application: StrongholdApplication = {
        id: `app-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        actor: user.actor,
        name: payload.name,
        description: payload.description ?? null,
        visibility: payload.visibility ?? 'public',
        state: 'pending',
        created_at: Date.now(),
        decided_by: null,
        decided_at: null,
      }
      strongholdApplications.push(application)
      return delay({ application_id: application.id, state: 'pending' as const })
    }
    const id = `sh-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const lobby = makeRoom('lobby', 'channel', '大厅', 0)
    const posts = makeRoom('posts', 'section', '帖子', 0)
    const state: MockStrongholdState = {
      id,
      name: payload.name,
      description: payload.description ?? '',
      cover: '',
      visibility: payload.visibility ?? 'public',
      allow_message_edit: true,
      allow_message_retract: true,
      edit_window_secs: 300,
      owner_actor: user.actor,
      rooms: new Map([
        [lobby.res_id, lobby],
        [posts.res_id, posts],
      ]),
      topics: [],
    }
    strongholds.set(id, state)
    strongholdMembers.set(id, [
      {
        actor: user.actor,
        username: user.username,
        display_name: user.username,
        role: 'owner',
        deny_discussion: false,
        deny_idea: false,
        deny_comment: false,
        joined_at: new Date().toISOString(),
        is_guest: false,
        groups: [],
      },
    ])
    strongholdBans.set(id, [])
    return delay(toStrongholdConfig(state))
  },

  async joinStronghold(token: string, nodeId: string): Promise<StrongholdMember> {
    const user = requireUser(token)
    const state = strongholds.get(nodeId)
    if (!state) throw new ApiRequestError('NOT_FOUND', 404)
    const existing = findMember(nodeId, user.actor)
    if (existing) return delay(existing)
    const member: StrongholdMember = {
      actor: user.actor,
      username: user.username,
      display_name: user.username,
      role: 'member',
      deny_discussion: false,
      deny_idea: false,
      deny_comment: false,
      joined_at: new Date().toISOString(),
      is_guest: false,
      groups: [],
    }
    strongholdMembers.get(nodeId)?.push(member)
    return delay(member)
  },

  async createRoom(token: string, nodeId: string, payload: CreateRoomPayload): Promise<RoomSummary> {
    const { member } = requireManager(token, nodeId)
    if (member.role !== 'owner' && member.role !== 'mod') throw new ApiRequestError('FORBIDDEN', 403)
    const state = strongholds.get(nodeId)
    if (!state) throw new ApiRequestError('NOT_FOUND', 404)
    const resId = `room-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const room = makeRoom(resId, payload.type, payload.name)
    state.rooms.set(resId, room)
    return delay({ id: room.res_id, name: room.name, type: room.type })
  },

  async getStrongholdRooms(token: string | null, nodeId: string): Promise<RoomSummary[]> {
    const state = strongholds.get(nodeId)
    if (!state) throw new ApiRequestError('NOT_FOUND', 404)
    requireUserOrGuest(token, nodeId)
    return delay(
      [...state.rooms.values()]
        .sort((a, b) => a.position - b.position)
        .map((r) => ({ id: r.res_id, name: r.name, type: r.type })),
    )
  },

  async patchRoom(token: string, nodeId: string, resId: string, patch: RoomPatch): Promise<RoomSummary> {
    requireManager(token, nodeId)
    const room = requireRoom(nodeId, resId)
    if (patch.name !== undefined) room.name = patch.name
    if (patch.position !== undefined) room.position = patch.position
    if (patch.restricted !== undefined) room.restricted = patch.restricted
    return delay({ id: room.res_id, name: room.name, type: room.type })
  },

  async deleteRoom(token: string, nodeId: string, resId: string): Promise<void> {
    requireManager(token, nodeId)
    const state = strongholds.get(nodeId)
    const room = requireRoom(nodeId, resId)
    const sameType = [...(state?.rooms.values() ?? [])].filter((r) => r.type === room.type)
    if (sameType.length <= 1) throw new ApiRequestError('LAST_ROOM_OF_TYPE', 409)
    state?.rooms.delete(resId)
    return delay(undefined)
  },

  // ---- topics (据点共用话题池) --------------------------------------------

  async listTopics(token: string | null, nodeId: string): Promise<Topic[]> {
    const state = strongholds.get(nodeId)
    if (!state) throw new ApiRequestError('NOT_FOUND', 404)
    requireUserOrGuest(token, nodeId)
    return delay(
      [...state.topics].sort((a, b) => a.position - b.position),
    )
  },

  async createTopic(token: string, nodeId: string, payload: TopicPayload): Promise<Topic> {
    requireManager(token, nodeId)
    const state = strongholds.get(nodeId)
    if (!state) throw new ApiRequestError('NOT_FOUND', 404)
    const name = validateTopicName(payload.name)
    if (state.topics.some((t) => t.name === name)) throw new ApiRequestError('ALREADY_EXISTS', 409)
    if (state.topics.length >= TOPIC_LIMIT) throw new ApiRequestError('TOPIC_LIMIT', 409)
    const topic: Topic = {
      id: `topic-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name,
      color: payload.color ?? null,
      position: state.topics.length ? Math.max(...state.topics.map((t) => t.position)) + 1 : 0,
    }
    state.topics.push(topic)
    return delay(topic, 120)
  },

  async patchTopic(
    token: string,
    nodeId: string,
    topicId: string,
    patch: Partial<TopicPayload> & { position?: number },
  ): Promise<Topic> {
    requireManager(token, nodeId)
    const state = strongholds.get(nodeId)
    if (!state) throw new ApiRequestError('NOT_FOUND', 404)
    const topic = requireTopic(state, topicId)
    if (patch.name !== undefined) {
      const name = validateTopicName(patch.name)
      if (state.topics.some((t) => t.id !== topicId && t.name === name)) throw new ApiRequestError('ALREADY_EXISTS', 409)
      topic.name = name
    }
    if (patch.color !== undefined) topic.color = patch.color
    if (patch.position !== undefined) topic.position = patch.position
    return delay({ ...topic }, 120)
  },

  async deleteTopic(token: string, nodeId: string, topicId: string): Promise<void> {
    requireManager(token, nodeId)
    const state = strongholds.get(nodeId)
    if (!state) throw new ApiRequestError('NOT_FOUND', 404)
    requireTopic(state, topicId)
    state.topics = state.topics.filter((t) => t.id !== topicId)
    return delay(undefined, 120)
  },

  async getStrongholdConfig(token: string | null, nodeId: string): Promise<StrongholdConfig> {
    const state = strongholds.get(nodeId)
    if (!state) throw new ApiRequestError('NOT_FOUND', 404)
    requireUserOrGuest(token, nodeId)
    return delay(toStrongholdConfig(state))
  },

  async patchStrongholdConfig(token: string, nodeId: string, patch: StrongholdConfigPatch): Promise<StrongholdConfig> {
    const { member } = requireManager(token, nodeId)
    if (patch.visibility !== undefined && member.role !== 'owner') throw new ApiRequestError('FORBIDDEN', 403)
    const state = strongholds.get(nodeId)
    if (!state) throw new ApiRequestError('NOT_FOUND', 404)
    Object.assign(state, patch)
    return delay(toStrongholdConfig(state))
  },

  // ---- room WS token / history ------------------------------------------------

  async mintRoomToken(token: string, nodeId: string, resId: string): Promise<RoomTokenResponse> {
    requireUser(token)
    requireRoom(nodeId, resId)
    return delay({ token: `mock-room-token-${resId}`, room: `${nodeId}/mock/${resId}`, exp: Math.floor(Date.now() / 1000) + 300 })
  },

  async getRoomHistory(token: string | null, nodeId: string, resId: string, before?: number | null, limit = 50): Promise<RoomItem[]> {
    requireUserOrGuest(token, nodeId)
    const room = requireRoom(nodeId, resId)
    const visible = room.items.filter((i) => !room.tombstoned.has(i.seq))
    const filtered = before == null ? visible : visible.filter((i) => i.seq < before)
    return delay(filtered.slice(-limit).reverse())
  },

  async editItem(token: string, nodeId: string, resId: string, seq: number, content: unknown): Promise<EditRetractResult> {
    const user = requireUser(token)
    const room = requireRoom(nodeId, resId)
    const item = room.items.find((i) => i.seq === seq)
    if (!item) throw new ApiRequestError('OMEW_TARGET_NOT_FOUND', 404)
    if (item.actor !== user.actor) throw new ApiRequestError('OMEW_FORBIDDEN', 403)
    item.body = content as ItemBody
    item.edited_at = Date.now()
    return delay({ seq: item.seq, target_seq: seq })
  },

  async retractItem(token: string, nodeId: string, resId: string, seq: number): Promise<EditRetractResult> {
    const user = requireUser(token)
    const room = requireRoom(nodeId, resId)
    const item = room.items.find((i) => i.seq === seq)
    if (!item) throw new ApiRequestError('OMEW_TARGET_NOT_FOUND', 404)
    const manager = findMember(nodeId, user.actor)
    const isModerator = manager?.role === 'owner' || manager?.role === 'mod'
    if (item.actor !== user.actor && !isModerator) throw new ApiRequestError('OMEW_FORBIDDEN', 403)
    room.tombstoned.add(seq)
    return delay({ seq, target_seq: seq })
  },

  // ---- posts ------------------------------------------------------------------

  async listPosts(
    token: string | null,
    nodeId: string,
    resId: string,
    after?: string | null,
    limit = 20,
    topic?: string | null,
  ): Promise<PostPage> {
    requireUserOrGuest(token, nodeId)
    const room = requireRoom(nodeId, resId)
    const posts = room.items
      .filter((i) => i.parent_seq == null && !room.tombstoned.has(i.seq))
      .map((i) => toPost(room, i))
      .filter((p) => !topic || p.topics?.includes(topic))
      .sort((a, b) => b.bumped_at - a.bumped_at || b.post_seq - a.post_seq)
    let startIndex = 0
    if (after) {
      const [atPart, seqPart] = after.split(':')
      const at = Number(atPart)
      const seq = Number(seqPart)
      startIndex = posts.findIndex((p) => p.bumped_at < at || (p.bumped_at === at && p.post_seq < seq))
      if (startIndex < 0) startIndex = posts.length
    }
    const page = posts.slice(startIndex, startIndex + limit)
    const hasMore = startIndex + limit < posts.length
    const last = page[page.length - 1]
    return delay({ posts: page, next_cursor: hasMore && last ? `${last.bumped_at}:${last.post_seq}` : null })
  },

  async getPost(token: string | null, nodeId: string, resId: string, seq: number, before?: number | null, limit = 50): Promise<PostThread> {
    requireUserOrGuest(token, nodeId)
    const room = requireRoom(nodeId, resId)
    const postItem = room.items.find((i) => i.seq === seq && i.parent_seq == null)
    if (!postItem || room.tombstoned.has(seq)) throw new ApiRequestError('NOT_FOUND', 404)
    const summary = toPost(room, postItem)
    const allReplies = room.items
      .filter((i) => i.root_seq === seq && i.parent_seq != null && !room.tombstoned.has(i.seq))
      .sort((a, b) => b.seq - a.seq)
    const filtered = before == null ? allReplies : allReplies.filter((r) => r.seq < before)
    const page = filtered.slice(0, limit)
    return delay({
      post: { ...summary, text: postItem.body.text ?? '' },
      replies: page.map((r) => ({ seq: r.seq, actor: r.actor, ts: r.ts, body: r.body })),
      next_before: page.length === limit ? page[page.length - 1]!.seq : null,
    })
  },

  async getStrongholdMembers(token: string, nodeId: string, tab: MemberTab): Promise<MemberPage> {
    requireUser(token)
    if (tab === 'banned') {
      const banned = strongholdBans.get(nodeId) ?? []
      return delay({
        members: banned.map((ban) => ({
          actor: ban.actor,
          username: ban.actor,
          display_name: ban.actor,
          role: 'member' as const,
          deny_discussion: true,
          deny_idea: true,
          deny_comment: true,
          joined_at: ban.banned_at,
          is_guest: false,
          groups: memberGroupsFor(localpartOf(ban.actor)),
        })),
        next_cursor: null,
      })
    }
    const all = strongholdMembers.get(nodeId) ?? []
    const filtered =
      tab === 'restricted'
        ? all.filter((member) => member.deny_discussion || member.deny_idea || member.deny_comment)
        : all
    // groups are server-level (task 048) - recomputed at read time rather
    // than mutated in place, since assignment now happens through a
    // separate D1-backed surface with no per-stronghold storage.
    return delay({
      members: filtered.map((member) => ({ ...member, groups: member.is_guest ? [] : memberGroupsFor(member.username) })),
      next_cursor: null,
    })
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
    bans.push({ actor: target.actor, banned_by: user.username, banned_at: new Date().toISOString() })
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
    const currentOwner = members.find((m) => m.actor === user.actor && m.role === 'owner')
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

  // ---- emotes / media / storage ------------------------------------------------

  async getEmotes(token: string): Promise<EmotePack[]> {
    requireUser(token)
    return delay(emotePacks.map((pack) => ({ ...pack, emotes: [...pack.emotes] })))
  },

  // ---- instance emote pack administration (018 admin endpoints, task 039 UI) ---

  async createEmotePack(token: string, name: string): Promise<EmotePack> {
    requireAdmin(token)
    if (!name || name.length > 32 || name.includes(':')) throw new ApiRequestError('PACK_NAME_INVALID', 400)
    if (emotePacks.some((p) => p.name === name)) throw new ApiRequestError('PACK_NAME_TAKEN', 409)
    const pack: EmotePack = { id: `mock-pack-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, emotes: [] }
    emotePacks.push(pack)
    return delay(pack, 120)
  },

  async deleteEmotePack(token: string, packId: string): Promise<void> {
    requireAdmin(token)
    const idx = emotePacks.findIndex((p) => p.id === packId)
    if (idx < 0) throw new ApiRequestError('NOT_FOUND', 404)
    emotePacks.splice(idx, 1)
    return delay(undefined, 120)
  },

  async createEmote(token: string, packId: string, name: string, mediaId: string): Promise<Emote> {
    requireAdmin(token)
    const pack = emotePacks.find((p) => p.id === packId)
    if (!pack) throw new ApiRequestError('NOT_FOUND', 404)
    if (!name || name.length > 32 || name.includes(':')) throw new ApiRequestError('EMOTE_NAME_INVALID', 400)
    if (pack.emotes.some((e) => e.name === name)) throw new ApiRequestError('EMOTE_NAME_TAKEN', 409)
    const media = mediaStore.get(mediaId)
    if (!media) throw new ApiRequestError('MEDIA_NOT_FOUND', 400)
    const emote: Emote = { id: `mock-emote-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, media_id: mediaId, url: media.url }
    pack.emotes.push(emote)
    return delay(emote, 120)
  },

  async deleteEmote(token: string, emoteId: string): Promise<void> {
    requireAdmin(token)
    for (const pack of emotePacks) {
      const idx = pack.emotes.findIndex((e) => e.id === emoteId)
      if (idx >= 0) {
        pack.emotes.splice(idx, 1)
        return delay(undefined, 120)
      }
    }
    throw new ApiRequestError('NOT_FOUND', 404)
  },

  async uploadMedia(token: string, file: File | Blob, onProgress?: (percent: number) => void): Promise<MediaUploadResult> {
    requireUser(token)
    const maxFile = config.max_file_bytes
    if (file.size > maxFile) throw new ApiRequestError('FILE_TOO_LARGE', 413)
    if (!file.type.startsWith('image/')) throw new ApiRequestError('MIME_REJECTED', 415)
    if (storageUsage.used + file.size > config.user_storage_quota_bytes) throw new ApiRequestError('QUOTA_EXCEEDED', 413)
    onProgress?.(100)
    const id = `mock-upload-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const result: MediaUploadResult = { id, url: URL.createObjectURL(file), size: file.size, mime: file.type }
    mediaStore.set(id, result)
    storageUsage.used += file.size
    return delay(result, 60)
  },

  async getStorageUsage(token: string): Promise<StorageUsage> {
    requireUser(token)
    return delay({ used: storageUsage.used, quota: config.user_storage_quota_bytes, max_file: config.max_file_bytes })
  },

  // ---- stronghold creation applications -----------------------------------------

  async getMyStrongholdApplications(token: string): Promise<StrongholdApplication[]> {
    const user = requireUser(token)
    return delay(strongholdApplications.filter((app) => app.actor === user.actor))
  },

  async getAdminStrongholdApplications(token: string, state?: StrongholdApplicationState): Promise<StrongholdApplication[]> {
    requireAdmin(token)
    return delay(state ? strongholdApplications.filter((app) => app.state === state) : [...strongholdApplications])
  },

  async decideStrongholdApplication(
    token: string,
    id: string,
    state: 'approved' | 'rejected',
  ): Promise<{ id: string; state: string }> {
    const admin = requireAdmin(token)
    const application = strongholdApplications.find((app) => app.id === id)
    if (!application) throw new ApiRequestError('NOT_FOUND', 404)
    if (application.state !== 'pending') throw new ApiRequestError('ALREADY_DECIDED', 409)
    application.state = state
    application.decided_by = admin.actor
    application.decided_at = Date.now()
    if (state === 'approved') {
      const nodeId = `sh-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
      const lobby = makeRoom('lobby', 'channel', '大厅', 0)
      const posts = makeRoom('posts', 'section', '帖子', 0)
      strongholds.set(nodeId, {
        id: nodeId,
        name: application.name,
        description: application.description ?? '',
        cover: '',
        visibility: application.visibility,
        allow_message_edit: true,
        allow_message_retract: true,
        edit_window_secs: 300,
        owner_actor: application.actor,
        rooms: new Map([
          [lobby.res_id, lobby],
          [posts.res_id, posts],
        ]),
        topics: [],
      })
      strongholdMembers.set(nodeId, [
        {
          actor: application.actor,
          username: application.actor,
          display_name: application.actor,
          role: 'owner',
          deny_discussion: false,
          deny_idea: false,
          deny_comment: false,
          joined_at: new Date().toISOString(),
          is_guest: false,
          groups: [],
        },
      ])
      strongholdBans.set(nodeId, [])
    }
    return delay({ id: application.id, state: application.state })
  },

  // ---- server-level user groups (task 048, server_role admin/owner gate) ------

  async getServerGroups(token: string): Promise<ServerGroup[]> {
    requireAdmin(token)
    return delay([...serverGroups].sort((a, b) => a.position - b.position))
  },

  async createServerGroup(token: string, payload: ServerGroupCreatePayload): Promise<ServerGroup> {
    requireAdmin(token)
    if (!payload.name || payload.name.length > 32) throw new ApiRequestError('GROUP_NAME_INVALID', 400)
    if (payload.color != null && !/^#[0-9a-fA-F]{6}$/.test(payload.color)) throw new ApiRequestError('GROUP_COLOR_INVALID', 400)
    const position = payload.position ?? (serverGroups.length ? Math.max(...serverGroups.map((g) => g.position)) + 1 : 0)
    const group: ServerGroup = {
      id: `grp-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: payload.name,
      color: payload.color ?? null,
      position,
      allow_speak: payload.allow_speak ?? 0,
      allow_post: payload.allow_post ?? 0,
      allow_reply: payload.allow_reply ?? 0,
      is_moderator: payload.is_moderator ?? false,
    }
    serverGroups.push(group)
    return delay(group, 120)
  },

  async updateServerGroup(token: string, groupId: string, patch: ServerGroupPatch): Promise<ServerGroup> {
    requireAdmin(token)
    if (patch.name !== undefined && (!patch.name || patch.name.length > 32)) throw new ApiRequestError('GROUP_NAME_INVALID', 400)
    if (patch.color !== undefined && patch.color != null && !/^#[0-9a-fA-F]{6}$/.test(patch.color)) {
      throw new ApiRequestError('GROUP_COLOR_INVALID', 400)
    }
    const idx = serverGroups.findIndex((g) => g.id === groupId)
    if (idx < 0) throw new ApiRequestError('NOT_FOUND', 404)
    const updated = { ...serverGroups[idx]!, ...patch }
    serverGroups[idx] = updated
    return delay(updated, 120)
  },

  async deleteServerGroup(token: string, groupId: string): Promise<void> {
    requireAdmin(token)
    const idx = serverGroups.findIndex((g) => g.id === groupId)
    if (idx < 0) throw new ApiRequestError('NOT_FOUND', 404)
    serverGroups.splice(idx, 1)
    for (const assigned of userGroupIds.values()) assigned.delete(groupId)
    return delay(undefined, 120)
  },

  async reorderServerGroups(token: string, positions: { id: string; position: number }[]): Promise<ServerGroup[]> {
    requireAdmin(token)
    const byId = new Map(positions.map((p) => [p.id, p.position]))
    for (let i = 0; i < serverGroups.length; i++) {
      const g = serverGroups[i]!
      if (byId.has(g.id)) serverGroups[i] = { ...g, position: byId.get(g.id)! }
    }
    serverGroups.sort((a, b) => a.position - b.position)
    return delay([...serverGroups])
  },

  async assignServerGroupMember(token: string, groupId: string, localpart: string): Promise<void> {
    requireAdmin(token)
    if (!serverGroups.some((g) => g.id === groupId)) throw new ApiRequestError('NOT_FOUND', 404)
    if (!users.some((u) => u.username === localpart)) throw new ApiRequestError('NOT_FOUND', 404)
    let ids = userGroupIds.get(localpart)
    if (!ids) {
      ids = new Set()
      userGroupIds.set(localpart, ids)
    }
    ids.add(groupId)
    return delay(undefined, 80)
  },

  async unassignServerGroupMember(token: string, groupId: string, localpart: string): Promise<void> {
    requireAdmin(token)
    userGroupIds.get(localpart)?.delete(groupId)
    return delay(undefined, 80)
  },

  // guest-readable per instance policy (task 048 batch display endpoint) -
  // keyed by localpart, every requested entry present even if empty.
  async getGroupsForMembers(token: string | null, localparts: string[]): Promise<Record<string, MemberGroupRef[]>> {
    if (!config.allow_guest_browsing) requireUser(token ?? '')
    if (!localparts.length || localparts.length > 100) throw new ApiRequestError('PAYLOAD_INVALID', 400)
    const result: Record<string, MemberGroupRef[]> = {}
    for (const localpart of new Set(localparts)) result[localpart] = memberGroupsFor(localpart)
    return delay(result, 60)
  },

  // ---- server-level role appointment (task 035/039, server_owner only) --------

  async getAdminUsers(token: string, after?: string): Promise<AdminUsersPage> {
    requireOwner(token)
    const sorted = [...users].sort((a, b) => a.username.localeCompare(b.username))
    const startIndex = after ? sorted.findIndex((u) => u.username === after) + 1 : 0
    const page = sorted.slice(startIndex, startIndex + 50)
    return delay({
      users: page.map((u) => ({ localpart: u.username, server_role: u.server_role, created_at: u.created_at })),
      next_cursor: sorted.length > startIndex + 50 ? page[page.length - 1]!.username : null,
    })
  },

  async patchAdminUserRole(
    token: string,
    localpart: string,
    serverRole: Extract<ServerRole, 'admin' | 'user'>,
  ): Promise<{ localpart: string; server_role: ServerRole }> {
    const owner = requireOwner(token)
    if (localpart === owner.username) throw new ApiRequestError('ROLE_INVALID', 400)
    const target = users.find((u) => u.username === localpart)
    if (!target || target.server_role === 'owner') throw new ApiRequestError('NOT_FOUND', 404)
    target.server_role = serverRole
    target.is_admin = serverRole === 'admin'
    return delay({ localpart, server_role: serverRole }, 120)
  },
}
