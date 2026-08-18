export type RootRequirement = 'email' | 'phone' | 'code'

export interface InstanceConfig {
  allow_root: boolean
  root_requirements: RootRequirement[]
}

export interface AdminInstanceConfig extends InstanceConfig {
  trusted_identity_servers: string[]
}

export interface AuthUser {
  id: string
  username: string
  is_admin: boolean
  email?: string
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
  used: boolean
  created_at?: string
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
  username: string
  display_name: string
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
