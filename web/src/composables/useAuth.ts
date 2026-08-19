import { computed, ref } from 'vue'
import { api } from '../api'
import { setUnauthorizedHandler } from '../api/client'
import type { AuthResponse, AuthUser, LoginPayload, RegisterPayload } from '../api/types'

const TOKEN_KEY = 'openmew-token'
const USER_KEY = 'openmew-user'

function readStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as AuthUser
  } catch {
    return null
  }
}

const token = ref<string | null>(localStorage.getItem(TOKEN_KEY))
const user = ref<AuthUser | null>(readStoredUser())
// set when a 401 kicks an existing session out, so the auth gate keeps the
// login tab for returning users instead of the fresh-visitor register default
const sessionExpired = ref(false)

function persist() {
  if (token.value && user.value) {
    localStorage.setItem(TOKEN_KEY, token.value)
    localStorage.setItem(USER_KEY, JSON.stringify(user.value))
  } else {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
  }
}

function setSession(session: AuthResponse) {
  token.value = session.token
  user.value = session.user
  sessionExpired.value = false
  persist()
}

async function login(payload: LoginPayload) {
  const session = await api.login(payload)
  setSession(session)
}

// register() intentionally does NOT commit the session by itself — the
// caller (registration form) shows the ownership-key backup step first and
// commits explicitly via setSession() once the user has seen it.
async function register(payload: RegisterPayload): Promise<AuthResponse> {
  return api.register(payload)
}

function logout() {
  token.value = null
  user.value = null
  persist()
}

setUnauthorizedHandler(() => {
  sessionExpired.value = true
  logout()
})

export function useAuth() {
  return {
    token,
    user,
    isAuthenticated: computed(() => !!token.value),
    sessionExpired,
    isAdmin: computed(() => !!user.value?.is_admin),
    login,
    register,
    setSession,
    logout,
  }
}
