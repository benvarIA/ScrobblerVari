import { Component, type ReactNode } from 'react'
import { Button } from './ui/button'

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const isApiError = error.message.startsWith('Last.fm')
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="text-lg font-medium">
          {isApiError ? 'Erreur Last.fm' : 'Une erreur est survenue'}
        </p>
        <p className="text-sm text-muted-foreground max-w-sm">{error.message}</p>
        <Button variant="outline" onClick={() => this.setState({ error: null })}>
          Réessayer
        </Button>
      </div>
    )
  }
}
