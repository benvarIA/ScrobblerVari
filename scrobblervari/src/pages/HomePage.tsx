import { useAuth } from '../contexts/AuthContext'

export default function HomePage() {
  const { user, username } = useAuth()

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-2xl font-semibold">
        Bonjour, {user?.realname || username} 👋
      </h2>
      <p className="text-muted-foreground">
        Les modules arrivent — CD/Vinyle, Stats, Clean.
      </p>
    </div>
  )
}
