import { Link } from 'react-router-dom'
import { Button } from '../components/ui/button'

export default function NotFoundPage() {
  return (
    <div className="flex flex-col items-center gap-4 py-24 text-center">
      <p className="text-5xl font-bold text-muted-foreground/30">404</p>
      <p className="text-lg font-medium">Page introuvable</p>
      <Button asChild variant="outline">
        <Link to="/">Retour à l'accueil</Link>
      </Button>
    </div>
  )
}
