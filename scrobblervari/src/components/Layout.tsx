import { Outlet, Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Button } from './ui/button'
import { Sidebar, BottomNav } from './Nav'
import { ErrorBoundary } from './ErrorBoundary'

function getAvatar(user: ReturnType<typeof useAuth>['user']): string | null {
  if (!user) return null
  const large = user.image.find(i => i.size === 'large')
  return large?.['#text'] || user.image[0]?.['#text'] || null
}

export default function Layout() {
  const { sessionKey, username, user, logout, isLoading } = useAuth()

  if (!sessionKey) return <Navigate to="/login" replace />

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur-sm px-4 py-3 flex items-center justify-between">
        <span className="text-lg font-semibold tracking-tight">ScrobblerVari</span>

        <div className="flex items-center gap-3">
          {isLoading ? (
            <div className="h-8 w-32 rounded bg-muted animate-pulse" />
          ) : (
            <>
              {getAvatar(user) && (
                <img
                  src={getAvatar(user)!}
                  alt={username ?? ''}
                  className="h-8 w-8 rounded-full object-cover"
                />
              )}
              <div className="flex flex-col leading-tight text-right">
                <span className="text-sm font-medium">{user?.name ?? username}</span>
                {user?.playcount && (
                  <span className="text-xs text-muted-foreground">
                    {Number(user.playcount).toLocaleString()} scrobbles
                  </span>
                )}
              </div>
              <Button variant="ghost" size="sm" onClick={logout}>
                Déconnexion
              </Button>
            </>
          )}
        </div>
      </header>

      <div className="flex flex-1">
        <Sidebar />
        <main className="flex-1 p-6 pb-20 sm:pb-6 min-w-0">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      <BottomNav />
    </div>
  )
}
