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
