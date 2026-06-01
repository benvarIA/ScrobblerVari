import { cn } from '../lib/utils'

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />
}

export function CardSkeleton() {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-border">
      <Skeleton className="h-12 w-12 shrink-0" />
      <div className="flex flex-col gap-2 flex-1">
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  )
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }).map((_, i) => <CardSkeleton key={i} />)}
    </div>
  )
}
