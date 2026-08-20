export type RootRequirement = 'email' | 'phone' | 'code'
export type StrongholdCreationPolicy = 'open' | 'restricted' | 'application'

// server-level role (m0-protocol §7.10, migration 0008) - distinct from a
// per-stronghold StrongholdRole. 'owner' is the unique, non-transferable
// bootstrap account; 'admin' is appointed by the owner (task 035).
export type ServerRole = 'owner' | 'admin' | 'user'

// /api/instance/config (public, unauthenticated) - a deliberately thin
// projection of the server's internal config; see AdminInstanceConfig for
// the full admin-only shape (note the field is spelled differently there:
// stronghold_creation here vs. stronghold_creation_policy on admin - the
// public route renames it on the way out, creators/peers stay admin-only).
export interface InstanceConfig {
  allow_root: boolean
  root_requirements: RootRequirement[]
  stronghold_creation: StrongholdCreationPolicy
  allow_guest_browsing: boolean
}

// /api/admin/instance/config - mirrors the server's internal InstanceConfig
// row (server/src/types.ts) field-for-field; deliberately not `extends
// InstanceConfig` since the two responses don't actually share a shape.
export interface AdminInstanceConfig {
  allow_root: boolean
  root_requirements: RootRequirement[]
  trusted_identity_servers: string[]
  max_file_bytes: number
  user_storage_quota_bytes: number
  federation_peers: string[]
  stronghold_creation_policy: StrongholdCreationPolicy
  stronghold_creators: string[]
  allow_guest_browsing: boolean
}

export interface AuthUser {
  actor: string
  username: string
  is_admin: boolean
  server_role: ServerRole
  email: string | null
  email_verified: boolean
}

export interface AuthResponse {
  token: string
  user: AuthUser
}

export interface RegisterPayload {
  username: string
  password: string
  email?: string
  code?: string
  ownership_pubkey: string
  ownership_ciphertext: string
}

export interface LoginPayload {
  username: string
  password: string
}

export interface InviteCode {
  code: string
  created_by: string
  created_at: number
  used_by: string | null
  used_at: number | null
}

export type StrongholdRole = 'owner' | 'mod' | 'member'
export type StrongholdVisibility = 'public' | 'private'
export type MemberTab = 'all' | 'restricted' | 'banned'

export interface StrongholdConfig {
  id: string
  name: string
  description: string
  cover: string
  visibility: StrongholdVisibility
  allow_message_edit: boolean
  allow_message_retract: boolean
  edit_window_secs: number
}

export interface StrongholdConfigPatch {
  name?: string
  description?: string
  cover?: string
  visibility?: StrongholdVisibility
  allow_message_edit?: boolean
  allow_message_retract?: boolean
  edit_window_secs?: number
}

// task 037: a member's custom-group badge, as embedded in a member list entry
// (server's toMemberEntry) - deliberately thin, just enough to render a badge.
export interface MemberGroupRef {
  id: string
  name: string
  color: string | null
}

export interface StrongholdMember {
  actor: string
  username: string
  display_name: string
  role: StrongholdRole
  deny_discussion: boolean
  deny_idea: boolean
  deny_comment: boolean
  joined_at: string
  is_guest: boolean
  home_domain?: string
  groups: MemberGroupRef[]
}

// tri-state permission value used by custom groups: -1 deny / 0 inherit / 1 allow.
export type GroupPermValue = -1 | 0 | 1

// task 037: a stronghold-local custom group (server's GroupRow / toApiGroup).
// position is ascending synthesis order and doubles as display/sort order.
export interface Group {
  id: string
  name: string
  color: string | null
  position: number
  perm_speak: GroupPermValue
  perm_post: GroupPermValue
  perm_reply: GroupPermValue
  is_moderator: boolean
}

export interface GroupCreatePayload {
  name: string
  color?: string | null
  perm_speak?: GroupPermValue
  perm_post?: GroupPermValue
  perm_reply?: GroupPermValue
  is_moderator?: boolean
}

export interface GroupPatch {
  name?: string
  color?: string | null
  position?: number
  perm_speak?: GroupPermValue
  perm_post?: GroupPermValue
  perm_reply?: GroupPermValue
  is_moderator?: boolean
}

export interface MemberPatch {
  role?: StrongholdRole
  deny_discussion?: boolean
  deny_idea?: boolean
  deny_comment?: boolean
}

export interface MemberPage {
  members: StrongholdMember[]
  next_cursor: string | null
}

export interface BanEntry {
  actor: string
  banned_by: string
  banned_at: string
}

export interface PublicUser {
  actor: string
  username: string
  display_name: string
  is_guest: boolean
  home_domain?: string
}

// task 035, server_owner-only: GET /api/admin/users list entry.
export interface AdminUserEntry {
  localpart: string
  server_role: ServerRole
  created_at: number
}

export interface AdminUsersPage {
  users: AdminUserEntry[]
  next_cursor: string | null
}

// ---- strongholds / rooms --------------------------------------------------

export type RoomType = 'channel' | 'section'

export interface RoomSummary {
  id: string
  name: string
  type: RoomType
}

export interface StrongholdSummary {
  id: string
  name: string
  cover: string | null
  rooms: RoomSummary[]
}

// public directory entry (task 034, GET /api/directory) - unauthenticated
// discovery listing, distinct from StrongholdSummary which carries rooms and
// is only ever returned to an authenticated member.
export interface DirectoryEntry {
  id: string
  name: string
  description: string | null
  cover: string | null
  member_count: number
}

export interface CreateStrongholdPayload {
  name: string
  description?: string
  visibility?: StrongholdVisibility
}

export interface CreateRoomPayload {
  name: string
  type: RoomType
}

// ---- room items (chat messages / posts / replies) -------------------------

// image attachment as carried on an item.create WS frame's free-form body -
// server doesn't validate the shape (017/019), this is a client-side contract.
export interface MediaAttachment {
  id: string
  url: string
  mime: string
}

export interface ItemBody {
  text?: string
  title?: string
  cover?: string
  preview?: string
  media?: MediaAttachment[]
  quote?: unknown
}

export interface RoomItem {
  seq: number
  parent_seq: number | null
  root_seq: number | null
  actor: string
  kind: 'post' | 'reply'
  ts: number
  body: ItemBody
  edited_at?: number
}

export interface RoomTokenResponse {
  token: string
  room: string
  exp: number
}

export interface EditRetractResult {
  seq: number | null
  target_seq: number
}

// ---- posts (section rooms) -------------------------------------------------

export interface PostSummary {
  post_seq: number
  actor: string
  created_at: number
  title: string
  cover: string | null
  preview: string
  // optional: real listPosts/getPost responses don't project this field out
  // of the stored body yet (server-side follow-up) - present for the
  // author's own just-created post (local echo) and in mock/dev.
  media?: MediaAttachment[]
  last_reply_seq: number
  reply_count: number
  bumped_at: number
}

export interface PostPage {
  posts: PostSummary[]
  next_cursor: string | null
}

export interface PostDetail extends PostSummary {
  text: string
}

export interface PostReply {
  seq: number
  actor: string
  ts: number
  body: ItemBody
}

export interface PostThread {
  post: PostDetail
  replies: PostReply[]
  next_before: number | null
}

// ---- stronghold creation applications (application policy) ----------------

export type StrongholdApplicationState = 'pending' | 'approved' | 'rejected'

export interface StrongholdApplication {
  id: string
  actor: string
  name: string
  description: string | null
  visibility: StrongholdVisibility
  state: StrongholdApplicationState
  created_at: number
  decided_by: string | null
  decided_at: number | null
}

// ---- media / emotes / storage ----------------------------------------------

export interface MediaUploadResult {
  id: string
  url: string
  size: number
  mime: string
}

export interface StorageUsage {
  used: number
  quota: number
  max_file: number
}

export interface Emote {
  id: string
  name: string
  media_id: string
  url: string
}

export interface EmotePack {
  id: string
  name: string
  // optional human-readable label for the pack header, distinct from `name`
  // (which is the stable key embedded in :pack:name: tokens) - only the
  // built-in default pack sets this, instance packs fall back to `name`.
  display?: string
  emotes: Emote[]
}
