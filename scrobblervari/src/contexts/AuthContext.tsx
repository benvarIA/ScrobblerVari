import { createContext, useContext, useEffect, useState } from 'react'
import { getUserInfo, type LastFmUser } from '../services/lastfm'

interface AuthState {
  sessionKey: string | null
  username: string | null
  user: LastFmUser | null
}

interface AuthContextValue extends AuthState {
  login: (sessionKey: string, username: string) => void
  logout: () => void
  isLoading: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

const STORAGE_KEY = 'scrobblervari_session'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      try { return { ...JSON.parse(stored), user: null } } catch { /* ignore */ }
    }
    return { sessionKey: null, username: null, user: null }
  })
  const [isLoading, setIsLoading] = useState(!!state.username)

  useEffect(() => {
    if (!state.sessionKey || !state.username) return
    fetch('/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionKey: state.sessionKey, username: state.username }),
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!state.username) return
    setIsLoading(true)
    getUserInfo(state.username)
      .then(user => setState(s => ({ ...s, user })))
      .catch(() => { /* user info is optional */ })
      .finally(() => setIsLoading(false))
  }, [state.username])

  function login(sessionKey: string, username: string) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionKey, username }))
    setState({ sessionKey, username, user: null })
    fetch('/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionKey, username }),
    }).catch(() => {})
  }

  function logout() {
    localStorage.removeItem(STORAGE_KEY)
    setState({ sessionKey: null, username: null, user: null })
  }

  return (
    <AuthContext.Provider value={{ ...state, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
