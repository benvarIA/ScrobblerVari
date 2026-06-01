import { useState, useEffect, useCallback, useRef } from 'react'
import { Trash2, Plus, RefreshCw, X, Music } from 'lucide-react'
import { Button } from '../components/ui/button'
import {
  fetchBlacklist, addBlacklistEntry, removeBlacklistEntry,
  importSpotifyPlaylist, type BlacklistEntry,
} from '../services/blacklist'
import { searchArtists, type ArtistSuggestion } from '../services/lastfm'

interface DeleteJob {
  status: 'idle' | 'starting' | 'authenticating' | 'waiting_login' | 'deleting' | 'done' | 'error'
  total?: number
  deleted?: number
  errors?: number
  message?: string
  finishedAt?: string
}

function useToast() {
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const show = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }, [])
  return { toast, show }
}

function DeleteStatus({ job }: { job: DeleteJob }) {
  if (job.status === 'idle') return null

  const pct = job.status === 'deleting' && job.total
    ? Math.round(((job.deleted ?? 0) / job.total) * 100)
    : null

  return (
    <div className="flex flex-col gap-1.5 text-xs mt-1">
      {job.status === 'starting' && <span className="text-muted-foreground">Démarrage…</span>}
      {job.status === 'authenticating' && <span className="text-muted-foreground">Connexion Last.fm…</span>}
      {job.status === 'waiting_login' && (
        <span className="text-amber-600 dark:text-amber-400">
          Un navigateur s'est ouvert — connecte-toi à Last.fm pour continuer
        </span>
      )}
      {job.status === 'deleting' && (
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground">
            Suppression… {job.deleted}/{job.total}
            {job.errors ? ` — ${job.errors} erreurs` : ''}
          </span>
          {pct !== null && (
            <div className="h-1.5 rounded-full bg-muted overflow-hidden w-full">
              <div
                className="h-full bg-foreground rounded-full transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
        </div>
      )}
      {job.status === 'done' && (
        <span className="text-green-600 dark:text-green-400">
          ✓ Terminé — {job.deleted} supprimé(s){job.errors ? `, ${job.errors} erreurs` : ''}
        </span>
      )}
      {job.status === 'error' && (
        <span className="text-destructive">Erreur : {job.message}</span>
      )}
    </div>
  )
}

function ArtistAutocomplete({ value, onChange, onEnter, className }: {
  value: string
  onChange: (v: string) => void
  onEnter: () => void
  className: string
}) {
  const [suggestions, setSuggestions] = useState<ArtistSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (value.trim().length < 2) { setSuggestions([]); setOpen(false); return }
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await searchArtists(value)
        setSuggestions(results)
        setOpen(results.length > 0)
        setActiveIdx(-1)
      } catch {}
    }, 300)
    return () => clearTimeout(debounceRef.current)
  }, [value])

  const select = (name: string) => { onChange(name); setSuggestions([]); setOpen(false) }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, suggestions.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') {
      if (activeIdx >= 0 && suggestions[activeIdx]) select(suggestions[activeIdx].name)
      else { setOpen(false); onEnter() }
    }
    else if (e.key === 'Escape') { setOpen(false); setSuggestions([]) }
  }

  return (
    <div className="relative flex-1 min-w-0">
      <input
        className={className}
        placeholder="Nom de l'artiste…"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
      />
      {open && (
        <ul className="absolute z-50 w-full mt-1 rounded-md border border-border bg-popover shadow-md overflow-hidden">
          {suggestions.map((s, i) => (
            <li
              key={s.name}
              className={`px-3 py-2 text-sm cursor-pointer flex justify-between items-center gap-2 ${i === activeIdx ? 'bg-accent' : 'hover:bg-accent/60'}`}
              onMouseDown={() => select(s.name)}
            >
              <span className="truncate">{s.name}</span>
              {s.listeners > 0 && (
                <span className="text-xs text-muted-foreground shrink-0">
                  {s.listeners.toLocaleString('fr-FR')} auditeurs
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function CleanPage() {
  const { toast, show } = useToast()

  const [blacklist, setBlacklist] = useState<BlacklistEntry[]>([])
  const [newArtist, setNewArtist] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [isImporting, setIsImporting] = useState(false)
  const [spotifyConnected, setSpotifyConnected] = useState(false)
  const [spotifyPlaylists, setSpotifyPlaylists] = useState<{ id: string; name: string; tracks: number | null; image: string | null }[]>([])
  const [isLoadingPlaylists, setIsLoadingPlaylists] = useState(false)
  const [deleteJob, setDeleteJob] = useState<DeleteJob>({ status: 'idle' })

  const artists = blacklist.filter(e => e.type === 'artist')
  const isDeleteActive = !['idle', 'done', 'error'].includes(deleteJob.status)
  const allSelected = artists.length > 0 && selected.size === artists.length
  const someSelected = selected.size > 0 && !allSelected

  const loadSpotifyPlaylists = useCallback(async () => {
    setIsLoadingPlaylists(true)
    try {
      const res = await fetch('/api/spotify/playlists')
      const data = await res.json()
      if (data.error === 'not_connected') { setSpotifyConnected(false); return }
      if (data.error) { show(data.error, false); return }
      setSpotifyPlaylists(data.playlists)
    } catch (e: any) {
      show(e.message, false)
    } finally {
      setIsLoadingPlaylists(false)
    }
  }, [show])

  useEffect(() => {
    fetchBlacklist().then(setBlacklist).catch(() => show('Erreur chargement blacklist', false))
    fetch('/api/spotify/status').then(r => r.json()).then(d => setSpotifyConnected(d.connected)).catch(() => {})
    const params = new URLSearchParams(window.location.search)
    if (params.get('spotify_connected')) {
      setSpotifyConnected(true)
      show('Spotify connecté')
      window.history.replaceState({}, '', '/clean')
      loadSpotifyPlaylists()
    }
    if (params.get('spotify_error')) {
      show(`Erreur Spotify : ${params.get('spotify_error')}`, false)
      window.history.replaceState({}, '', '/clean')
    }
  }, [])

  useEffect(() => {
    const poll = () =>
      fetch('/api/delete-scrobbles/status')
        .then(r => r.json())
        .then(setDeleteJob)
        .catch(() => {})
    poll()
    const interval = setInterval(poll, 2500)
    return () => clearInterval(interval)
  }, [])

  const toggleAll = () => {
    if (allSelected || someSelected) setSelected(new Set())
    else setSelected(new Set(artists.map(a => a.id)))
  }

  const toggleOne = (id: string) => {
    setSelected(s => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleDelete = async () => {
    if (selected.size === 0) return
    const selectedArtists = artists.filter(a => selected.has(a.id)).map(a => a.artist)
    try {
      const res = await fetch('/api/delete-scrobbles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artists: selectedArtists }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setDeleteJob({ status: 'starting' })
    } catch (e: any) {
      show(e.message, false)
    }
  }

  const addArtist = async () => {
    if (!newArtist.trim()) return
    const entry = await addBlacklistEntry({ type: 'artist', artist: newArtist.trim(), source: 'manual' })
    setBlacklist(b => [...b, entry])
    setNewArtist('')
    show(`Artiste ajouté : ${entry.artist}`)
  }

  const removeEntry = async (id: string) => {
    await removeBlacklistEntry(id)
    setBlacklist(b => b.filter(e => e.id !== id))
    setSelected(s => { const n = new Set(s); n.delete(id); return n })
  }

  const handleSpotifyConnect = async () => {
    const res = await fetch('/api/spotify/auth')
    const { url, error } = await res.json()
    if (error) { show(error, false); return }
    window.location.href = url
  }

  // Import unique artists from playlist tracks
  const handleSpotifyImport = async (playlistId: string) => {
    setIsImporting(true)
    try {
      const tracks = await importSpotifyPlaylist(playlistId)
      const uniqueArtists = [...new Set(tracks.map(t => t.artist))]
      const existingNames = new Set(artists.map(a => a.artist.toLowerCase()))
      let added = 0
      for (const name of uniqueArtists) {
        if (existingNames.has(name.toLowerCase())) continue
        const entry = await addBlacklistEntry({ type: 'artist', artist: name, source: 'spotify' })
        setBlacklist(b => [...b, entry])
        added++
      }
      show(added > 0 ? `${added} artiste(s) ajouté(s)` : 'Tous les artistes sont déjà dans la liste')
    } catch (e: any) {
      if (e.message === 'not_connected') { setSpotifyConnected(false); show('Session Spotify expirée, reconnecte-toi', false) }
      else show(e.message, false)
    } finally {
      setIsImporting(false)
    }
  }

  const inputCls = 'flex-1 min-w-0 rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground'

  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      {toast && (
        <div className={`fixed bottom-20 sm:bottom-6 right-4 z-50 px-4 py-2.5 rounded-lg text-sm shadow-lg text-white transition-all ${toast.ok ? 'bg-green-600' : 'bg-destructive'}`}>
          {toast.msg}
        </div>
      )}

      {/* Add artist */}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Ajouter un artiste</p>
        <div className="flex gap-2">
          <ArtistAutocomplete
            value={newArtist}
            onChange={setNewArtist}
            onEnter={addArtist}
            className={inputCls}
          />
          <Button size="sm" onClick={addArtist} disabled={!newArtist.trim()}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Spotify import */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Importer depuis Spotify</p>
          {spotifyConnected
            ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-green-600 font-medium">● Connecté</span>
                <Button size="sm" variant="outline" onClick={loadSpotifyPlaylists} disabled={isLoadingPlaylists}>
                  {isLoadingPlaylists ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : 'Mes playlists'}
                </Button>
              </div>
            )
            : <Button size="sm" variant="outline" onClick={handleSpotifyConnect}>Connecter Spotify</Button>
          }
        </div>
        {spotifyPlaylists.length > 0 && (
          <div className="flex flex-col gap-1 max-h-56 overflow-y-auto rounded-lg border border-border">
            {spotifyPlaylists.map(pl => (
              <div key={pl.id} className="flex items-center gap-3 px-3 py-2 hover:bg-accent/50 transition-colors">
                {pl.image
                  ? <img src={pl.image} alt="" className="h-8 w-8 rounded shrink-0 object-cover" />
                  : <div className="h-8 w-8 rounded bg-muted shrink-0 flex items-center justify-center"><Music className="h-3.5 w-3.5 text-muted-foreground" /></div>
                }
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{pl.name}</p>
                  <p className="text-xs text-muted-foreground">{pl.tracks != null ? `${pl.tracks} pistes` : '—'}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => handleSpotifyImport(pl.id)} disabled={isImporting}>
                  {isImporting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : 'Importer'}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Artists list */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={allSelected}
              ref={el => { if (el) el.indeterminate = someSelected }}
              onChange={toggleAll}
              disabled={artists.length === 0}
              className="h-4 w-4 accent-foreground"
            />
            <span className="text-sm font-medium">
              {artists.length === 0
                ? 'Aucun artiste'
                : `${artists.length} artiste${artists.length > 1 ? 's' : ''}${selected.size > 0 ? ` — ${selected.size} sélectionné${selected.size > 1 ? 's' : ''}` : ''}`
              }
            </span>
          </label>
          <Button
            size="sm"
            onClick={handleDelete}
            disabled={isDeleteActive || selected.size === 0}
          >
            {isDeleteActive
              ? <RefreshCw className="h-4 w-4 animate-spin mr-2" />
              : <Trash2 className="h-4 w-4 mr-2" />
            }
            {isDeleteActive ? 'En cours…' : 'Supprimer de Last.fm'}
          </Button>
        </div>

        {artists.length > 0 ? (
          <div className="flex flex-col gap-1">
            {artists.map(a => (
              <div key={a.id} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border">
                <input
                  type="checkbox"
                  checked={selected.has(a.id)}
                  onChange={() => toggleOne(a.id)}
                  className="h-4 w-4 accent-foreground shrink-0"
                />
                <span className="flex-1 text-sm truncate">{a.artist}</span>
                {a.source === 'spotify' && <span className="text-xs text-muted-foreground shrink-0">Spotify</span>}
                <button
                  onClick={() => removeEntry(a.id)}
                  className="shrink-0 p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-6">
            Ajoute des artistes ci-dessus pour les supprimer de ton historique Last.fm.
          </p>
        )}

        <DeleteStatus job={deleteJob} />
      </div>
    </div>
  )
}
