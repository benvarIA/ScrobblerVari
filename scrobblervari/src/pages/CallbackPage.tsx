import { useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { getSession } from '../services/lastfm'
import { useAuth } from '../contexts/AuthContext'

export default function CallbackPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { login } = useAuth()
  const called = useRef(false)

  useEffect(() => {
    if (called.current) return
    called.current = true

    const token = params.get('token')
    if (!token) { navigate('/login'); return }

    getSession(token)
      .then(session => {
        login(session.key, session.name)
        navigate('/')
      })
      .catch(() => navigate('/login'))
  }, [])

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <p className="text-muted-foreground">Connexion en cours…</p>
    </div>
  )
}
