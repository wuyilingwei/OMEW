export type RootRequirement = 'email' | 'phone' | 'code'

export interface InstanceConfig {
  allow_root: boolean
  root_requirements: RootRequirement[]
}

export interface AdminInstanceConfig extends InstanceConfig {
  trusted_identity_servers: string[]
}

export interface AuthUser {
  actor: string
  username: string
  is_admin: boolean
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

export interface ItemBody {
  text?: string
  title?: string
  cover?: string
  preview?: string
  media?: unknown
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
