import { useState, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, Loader2, Disc3, X, CheckCircle2, Clock, Music, Library } from 'lucide-react'
import { Button } from '../components/ui/button'

interface BiblioTrack {
  title: string
  duration?: number
}

interface BiblioAlbum {
  id: number
  artist: string
  album: string
  image: string
  support?: string | null
  year?: number | null
  tracks: BiblioTrack[]
}

interface VinylTrack {
  title: string
  duration?: number
  status: 'pending' | 'done' | 'error'
  scrobbleAt?: number
  scrobbledAt?: number
  error?: string
}

interface VinylQueueItem {
  id: string
  artist: string
  album: string
  image: string
  tracks: VinylTrack[]
  status: 'active' | 'done' | 'cancelled'
  addedAt: string
}

const SUPPORT_LABEL: Record<string, string> = { cd: 'CD', vinyl: 'Vinyle' }

function fmtDuration(sec?: number) {
  if (!sec) return ''
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

function fmtTime(unixSec?: number) {
  if (!unixSec) return ''
  return new Date(unixSec * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export default function VinylPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [collection, setCollection] = useState<BiblioAlbum[]>([])
  const [collLoading, setCollLoading] = useState(true)
  const [collError, setCollError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<BiblioAlbum | null>(null)
  const [queueItems, setQueueItems] = useState<VinylQueueItem[]>([])
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const autoQueued = useRef(false)

  // Charge la collection musicale Biblianalo (une fois)
  useEffect(() => {
    fetch('/api/biblianalo/albums')
      .then(async r => {
        const d = await r.json()
        if (!r.ok) throw new Error(d.error ?? 'Erreur')
        return d
      })
      .then((d: BiblioAlbum[]) => setCollection(Array.isArray(d) ? d : []))
      .catch(e => setCollError(e.message))
      .finally(() => setCollLoading(false))
  }, [])

  // Polling de la file
  useEffect(() => {
    const poll = () =>
      fetch('/api/vinyl/queue')
        .then(r => r.json())
        .then(d => setQueueItems(Array.isArray(d) ? d : []))
        .catch(() => {})
    poll()
    const id = setInterval(poll, 3000)
    return () => clearInterval(id)
  }, [])

  // Auto-enqueue depuis BibliAnalogique (?add=<id>)
  useEffect(() => {
    if (autoQueued.current) return
    const addId = searchParams.get('add')
    if (!addId || collLoading || collection.length === 0) return
    autoQueued.current = true
    setSearchParams({}, { replace: true })
    const album = collection.find(a => String(a.id) === addId)
    if (album) handleAddToQueue(album)
  }, [searchParams, setSearchParams, collection, collLoading])

  // Suggestions filtrées parmi les disques de la collection
  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return collection
    return collection.filter(a =>
      a.album.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q)
    )
  }, [query, collection])

  async function handleAddToQueue(album: BiblioAlbum) {
    setAdding(true)
    setError(null)
    try {
      const res = await fetch('/api/vinyl/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artist: album.artist,
          album: album.album,
          image: album.image,
          tracks: album.tracks.length ? album.tracks : undefined,
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Erreur')
      if (d.duplicate) {
        setError('Cet album est déjà dans la file.')
      } else {
        setQueueItems(prev => [...prev, d])
      }
      setSelected(null)
      setQuery('')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setAdding(false)
    }
  }

  async function handleCancel(id: string) {
    await fetch(`/api/vinyl/queue/${id}`, { method: 'DELETE' })
    setQueueItems(prev => prev.map(i => i.id === id ? { ...i, status: 'cancelled' as const } : i))
  }

  const activeItems = queueItems.filter(i => i.status === 'active')
  const doneItems = queueItems.filter(i => i.status === 'done')

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-2xl font-semibold">CD / Vinyle</h2>
        {!collLoading && !collError && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Library className="h-3.5 w-3.5" />{collection.length} disques
          </span>
        )}
      </div>

      {/* Recherche dans la collection */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setSelected(null) }}
          placeholder="Cherche un disque de ta collection…"
          className="w-full bg-background border border-border rounded-md pl-9 pr-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      {collLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />Chargement de ta collection…
        </div>
      )}

      {collError && (
        <div className="border border-destructive/40 bg-destructive/5 rounded-lg p-3 text-sm text-destructive">
          {collError}
        </div>
      )}

      {/* Album sélectionné → confirmation avec tracklist */}
      {selected && (
        <div className="border border-border rounded-lg p-4 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex gap-3 items-start min-w-0">
              {selected.image
                ? <img src={selected.image} alt={selected.album} className="w-14 h-14 rounded object-cover shrink-0" />
                : <div className="w-14 h-14 bg-muted rounded flex items-center justify-center shrink-0"><Disc3 className="h-6 w-6 text-muted-foreground" /></div>
              }
              <div className="min-w-0">
                <p className="font-semibold truncate">{selected.album}</p>
                <p className="text-sm text-muted-foreground truncate">{selected.artist}</p>
                {selected.support && <span className="text-[11px] text-muted-foreground">{SUPPORT_LABEL[selected.support] ?? selected.support}</span>}
              </div>
            </div>
            <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground shrink-0">
              <X className="h-4 w-4" />
            </button>
          </div>

          {selected.tracks.length > 0 ? (
            <ol className="text-sm flex flex-col divide-y divide-border/40">
              {selected.tracks.map((t, i) => (
                <li key={i} className="flex items-center justify-between py-1.5">
                  <span className="flex gap-2 min-w-0">
                    <span className="text-muted-foreground w-5 text-right shrink-0">{i + 1}.</span>
                    <span className="truncate">{t.title}</span>
                  </span>
                  {t.duration && <span className="text-muted-foreground shrink-0 pl-2">{fmtDuration(t.duration)}</span>}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">Pas de tracklist dans ta fiche — ScrobblerVari récupérera les pistes sur Last.fm.</p>
          )}

          <Button onClick={() => handleAddToQueue(selected)} disabled={adding} className="self-start">
            {adding ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Disc3 className="h-4 w-4 mr-2" />}
            Scrobbler cet album
          </Button>
        </div>
      )}

      {/* Suggestions = disques de la collection */}
      {!selected && !collLoading && !collError && (
        suggestions.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {suggestions.map(a => (
              <button
                key={a.id}
                onClick={() => setSelected(a)}
                className="flex flex-col gap-1.5 rounded-lg border border-border p-2 text-left hover:bg-accent transition-colors"
              >
                {a.image
                  ? <img src={a.image} alt={a.album} className="w-full aspect-square object-cover rounded" />
                  : <div className="w-full aspect-square bg-muted rounded flex items-center justify-center"><Music className="h-8 w-8 text-muted-foreground" /></div>
                }
                <span className="text-sm font-medium leading-tight line-clamp-2">{a.album}</span>
                <span className="text-xs text-muted-foreground truncate">{a.artist}</span>
                <span className="text-[11px] text-muted-foreground">
                  {a.support ? SUPPORT_LABEL[a.support] ?? a.support : ''}
                  {a.tracks.length ? ` · ${a.tracks.length} pistes` : ''}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {collection.length === 0 ? 'Aucun disque dans ta collection Biblianalo.' : 'Aucun disque ne correspond.'}
          </p>
        )
      )}

      {/* File d'attente */}
      {activeItems.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">File d'attente</h3>
          {activeItems.map(item => {
            const done = item.tracks.filter(t => t.status === 'done').length
            const total = item.tracks.length
            const next = item.tracks.find(t => t.status === 'pending')
            const finishAt = item.tracks[item.tracks.length - 1]?.scrobbleAt
            return (
              <div key={item.id} className="border border-border rounded-lg p-3 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {item.image
                      ? <img src={item.image} alt={item.album} className="w-10 h-10 rounded shrink-0 object-cover" />
                      : <div className="w-10 h-10 bg-muted rounded shrink-0 flex items-center justify-center"><Music className="h-4 w-4 text-muted-foreground" /></div>
                    }
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{item.album}</p>
                      <p className="text-xs text-muted-foreground truncate">{item.artist}</p>
                    </div>
                  </div>
                  <button onClick={() => handleCancel(item.id)} title="Annuler" className="text-muted-foreground hover:text-destructive shrink-0">
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{done}/{total} scrobblés</span>
                    {next
                      ? <span className="flex items-center gap-1 text-primary"><Clock className="h-3 w-3" />prochaine à {fmtTime(next.scrobbleAt)}</span>
                      : <span className="flex items-center gap-1 text-green-500"><CheckCircle2 className="h-3 w-3" />terminé</span>
                    }
                  </div>
                  <div className="h-1 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
                  </div>
                  {finishAt && next && (
                    <span className="text-[11px] text-muted-foreground">Fin estimée vers {fmtTime(finishAt)}</span>
                  )}
                </div>

                <ol className="text-sm flex flex-col divide-y divide-border/40">
                  {item.tracks.map((t, i) => (
                    <li key={i} className="flex items-center gap-2 py-1.5">
                      <span className="shrink-0 w-4 flex justify-center">
                        {t.status === 'done' && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
                        {t.status === 'error' && <X className="h-3.5 w-3.5 text-destructive" />}
                        {t.status === 'pending' && <span className="text-xs text-muted-foreground">{i + 1}</span>}
                      </span>
                      <span className={`truncate flex-1 ${t.status === 'done' ? 'text-muted-foreground line-through' : ''}`}>{t.title}</span>
                      <span className="shrink-0 text-xs tabular-nums">
                        {t.status === 'done'
                          ? <span className="text-green-500/70">{fmtTime(t.scrobbledAt)}</span>
                          : t.status === 'error'
                            ? <span className="text-destructive" title={t.error}>échec</span>
                            : <span className="text-muted-foreground">{fmtTime(t.scrobbleAt)}</span>
                        }
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )
          })}
        </div>
      )}

      {doneItems.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Terminés</h3>
          {[...doneItems].reverse().slice(0, 5).map(item => (
            <div key={item.id} className="flex items-center gap-2 text-sm py-1 text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
              <span className="font-medium text-foreground">{item.artist}</span>
              <span>—</span>
              <span>{item.album}</span>
              <span className="ml-auto shrink-0">({item.tracks.length} pistes)</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
