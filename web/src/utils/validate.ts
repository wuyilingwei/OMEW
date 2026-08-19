// Centralized client-side form validation. Regexes mirror server/src/users.ts's
// authoritative rules so a submission only reaches the network once it can
// plausibly succeed - the server independently re-validates everything here,
// this layer only exists to give inline feedback before a round trip.

export const USERNAME_RE = /^[a-z0-9_-]{2,32}$/
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// trusted_identity_servers: domain or "*" wildcard (server's DOMAIN_OR_WILDCARD_RE)
const DOMAIN_OR_WILDCARD_RE = /^(\*|[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+)$/
// federation_peers: real domains only, no wildcard (server's DOMAIN_RE)
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/
// stronghold_creators: actor strings "@name:domain" (server's ACTOR_RE)
const ACTOR_RE = /^@[^\s:]{1,64}:[^\s:]{1,255}$/

export const MIN_PASSWORD_LENGTH = 10

export function usernameError(value: string): string {
  if (!value) return '用户名不能为空'
  if (!USERNAME_RE.test(value)) return '用户名需为 2-32 位小写字母、数字、下划线或短横线'
  return ''
}

export function passwordError(value: string): string {
  if (!value) return '密码不能为空'
  if (value.length < MIN_PASSWORD_LENGTH) return `密码至少需要 ${MIN_PASSWORD_LENGTH} 位`
  return ''
}

export function ownershipPassphraseError(value: string, loginPassword: string): string {
  if (!value) return '所有权口令不能为空'
  if (value.length < MIN_PASSWORD_LENGTH) return `所有权口令至少需要 ${MIN_PASSWORD_LENGTH} 位`
  if (loginPassword && value === loginPassword) return '所有权口令不能与登录密码相同'
  return ''
}

export function emailError(value: string): string {
  if (!value) return '邮箱不能为空'
  if (!EMAIL_RE.test(value)) return '邮箱格式不正确'
  return ''
}

export function requiredError(value: string, label: string): string {
  return value.trim() ? '' : `${label}不能为空`
}

export function maxLengthError(value: string, max: number, label: string): string {
  return value.length > max ? `${label}不能超过 ${max} 字` : ''
}

// combines required + max-length, the common case for name/title fields
export function requiredMaxLengthError(value: string, max: number, label: string): string {
  return requiredError(value, label) || maxLengthError(value, max, label)
}

export function nonNegativeIntError(value: number, label: string): string {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) return `${label}需为非负整数`
  return ''
}

function lineListError(text: string, re: RegExp, label: string): string {
  const bad = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !re.test(line))
  return bad.length ? `${label}格式有误：${bad.join('、')}` : ''
}

// each line either a bare domain or "*"
export function trustedServersError(text: string): string {
  return lineListError(text, DOMAIN_OR_WILDCARD_RE, '信任身份服务器')
}

// each line a bare domain, no wildcard
export function domainListError(text: string): string {
  return lineListError(text, DOMAIN_RE, '域名列表')
}

// each line an actor "@name:domain"
export function actorListError(text: string): string {
  return lineListError(text, ACTOR_RE, 'actor 列表')
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`
}

// pre-flight check against GET /api/me/storage's {used, quota, max_file} - lets
// the UI reject an oversized/over-quota file before spending a request on it.
// Returns '' (no local check possible yet) when storage info hasn't loaded -
// the upload still goes through and the server enforces the real limits.
export function fileUploadError(file: File, storage: { used: number; quota: number; max_file: number } | null): string {
  if (!storage) return ''
  if (file.size > storage.max_file) return `文件超过实例大小限制（${formatBytes(storage.max_file)}）`
  if (storage.used + file.size > storage.quota) return `存储配额不足（已用 ${formatBytes(storage.used)} / ${formatBytes(storage.quota)}）`
  return ''
}
