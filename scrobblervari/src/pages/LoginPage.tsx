import { getAuthUrl } from '../services/lastfm'
import { Button } from '../components/ui/button'

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="flex flex-col items-center gap-6 text-center max-w-sm px-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight">ScrobblerVari</h1>
          <p className="text-muted-foreground">Connecte-toi avec ton compte Last.fm pour continuer.</p>
        </div>
        <Button
          size="lg"
          onClick={() => { window.location.href = getAuthUrl() }}
          className="w-full"
        >
          Se connecter avec Last.fm
        </Button>
      </div>
    </div>
  )
}
