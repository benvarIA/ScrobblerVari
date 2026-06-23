import fs from 'node:fs'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import crypto from 'node:crypto'
import type { Plugin, Connect } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'

const DATA_DIR = path.resolve(process.cwd(), 'data')
const BLACKLIST_FILE = path.join(DATA_DIR, 'blacklist.json')
const LOG_FILE = path.join(DATA_DIR, 'clean-log.json')
const SPOTIFY_TOKEN_FILE = path.join(DATA_DIR, 'spotify-token.json')
const VINYL_QUEUE_FILE = path.join(DATA_DIR, 'vinyl-queue.json')
const COVERS_CACHE_FILE = path.join(DATA_DIR, 'covers-cache.json')

interface VinylTrack {
  title: string
  duration?: number
  status: 'pending' | 'done' | 'error'
  scrobbleAt?: number   // unix seconds — heure planifiée du scrobble
  scrobbledAt?: number  // unix seconds — heure réelle du scrobble
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

// Intervalle aléatoire entre deux pistes (secondes)
function gap() { return 20 + Math.floor(Math.random() * 21) }

// Planifie les pistes en attente d'un album à partir de `startAt` (unix s).
// Renvoie l'horaire de la dernière piste planifiée (= queue de file).
function scheduleTracks(tracks: VinylTrack[], startAt: number): number {
  let cursor = startAt
  let first = true
  for (const track of tracks) {
    if (track.status === 'done') continue
    if (!first) cursor += gap()
    track.scrobbleAt = cursor
    first = false
  }
  return cursor
}

function readJSON<T>(file: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')) as T } catch { return fallback }
}

function writeJSON(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise(resolve => {
    let body = ''
    req.on('data', (c: Buffer) => { body += c })
    req.on('end', () => resolve(body))
  })
}

function json(res: ServerResponse, data: unknown, status = 200) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(data))
}

interface SpotifyTokenStore {
  access_token: string
  refresh_token: string
  expiry: number
}

export function apiPlugin(env: Record<string, string> = {}): Plugin {
  return {
    name: 'scrobblervari-api',
    configureServer(server) {
      fs.mkdirSync(DATA_DIR, { recursive: true })
      if (!fs.existsSync(BLACKLIST_FILE)) writeJSON(BLACKLIST_FILE, [])
      if (!fs.existsSync(LOG_FILE)) writeJSON(LOG_FILE, [])

      const clientId = env.VITE_SPOTIFY_CLIENT_ID
      const clientSecret = env.VITE_SPOTIFY_CLIENT_SECRET
      const port = env.PORT ?? '3008'
      const SPOTIFY_CALLBACK = env.SPOTIFY_CALLBACK_URL ?? `https://localhost:${port}/api/spotify/callback`

      // ── Vinyl Queue ──────────────────────────────────────────────────────────
      const lfmApiKey = env.VITE_LASTFM_API_KEY ?? ''
      const lfmSecret = env.VITE_LASTFM_SECRET ?? ''
      let vinylItems = readJSON<VinylQueueItem[]>(VINYL_QUEUE_FILE, [])

      // Couvertures d'albums (cache Last.fm) : "artist|||album" → URL image
      let coversCache: Record<string, string> = readJSON(COVERS_CACHE_FILE, {})
      function saveCoversCache() { writeJSON(COVERS_CACHE_FILE, coversCache) }
      function coverKey(artist: string, album: string) { return `${artist.toLowerCase()}|||${album.toLowerCase()}` }

      function saveVinylItems() { writeJSON(VINYL_QUEUE_FILE, vinylItems) }

      // Horaire de départ pour un nouvel album = après la dernière piste déjà planifiée
      function nextStart(): number {
        let tail = Math.floor(Date.now() / 1000) + 5
        for (const item of vinylItems) {
          if (item.status !== 'active') continue
          for (const t of item.tracks) {
            if (t.status === 'pending' && t.scrobbleAt) tail = Math.max(tail, t.scrobbleAt + gap())
          }
        }
        return tail
      }

      function lfmSig(params: Record<string, string>): string {
        const str = Object.keys(params).sort().map(k => k + params[k]).join('') + lfmSecret
        return crypto.createHash('md5').update(str).digest('hex')
      }

      async function scrobbleOne(artist: string, track: string, album: string, timestamp: number, sk: string) {
        const p: Record<string, string> = {
          api_key: lfmApiKey, artist, track, album,
          timestamp: String(timestamp), method: 'track.scrobble', sk,
        }
        const body = new URLSearchParams({ ...p, api_sig: lfmSig(p), format: 'json' })
        const r = await fetch('https://ws.audioscrobbler.com/2.0/', { method: 'POST', body })
        const d = await r.json() as any
        if (d.error) throw new Error(`Last.fm ${d.error}: ${d.message}`)
      }

      async function fetchAlbumTracksFromLfm(album: string, artist: string): Promise<{ title: string; duration?: number }[]> {
        const url = new URL('https://ws.audioscrobbler.com/2.0/')
        url.searchParams.set('method', 'album.getInfo')
        url.searchParams.set('album', album)
        url.searchParams.set('artist', artist)
        url.searchParams.set('api_key', lfmApiKey)
        url.searchParams.set('format', 'json')
        const r = await fetch(url.toString())
        const d = await r.json() as any
        if (d.error) return []
        const raw = d.album?.tracks?.track
        const arr = Array.isArray(raw) ? raw : raw ? [raw] : []
        return arr.map((t: any) => ({ title: t.name, duration: t.duration ? Number(t.duration) : undefined }))
      }

      async function fetchAlbumCover(album: string, artist: string): Promise<string> {
        try {
          const url = new URL('https://ws.audioscrobbler.com/2.0/')
          url.searchParams.set('method', 'album.getInfo')
          url.searchParams.set('album', album)
          url.searchParams.set('artist', artist)
          url.searchParams.set('api_key', lfmApiKey)
          url.searchParams.set('format', 'json')
          const r = await fetch(url.toString())
          const d = await r.json() as any
          if (d.error) return ''
          const imgs: Array<{ size: string; '#text': string }> = d.album?.image ?? []
          for (const size of ['extralarge', 'mega', 'large', 'medium']) {
            const hit = imgs.find(i => i.size === size)
            if (hit?.['#text']) return hit['#text']
          }
        } catch {}
        return ''
      }

      // Planificateur : à chaque tick, scrobble les pistes dont l'heure est arrivée
      let ticking = false
      async function tick() {
        if (ticking) return
        ticking = true
        try {
          const now = Math.floor(Date.now() / 1000)
          let changed = false
          for (const item of vinylItems) {
            if (item.status !== 'active') continue
            const session = readJSON<{ sessionKey?: string }>(path.join(DATA_DIR, 'lastfm-session.json'), {})
            for (const track of item.tracks) {
              if (track.status !== 'pending' || !track.scrobbleAt || track.scrobbleAt > now) continue
              if (!session.sessionKey) break // pas connecté : on réessaiera au prochain tick
              try {
                await scrobbleOne(item.artist, track.title, item.album, track.scrobbleAt, session.sessionKey)
                track.status = 'done'
                track.scrobbledAt = Math.floor(Date.now() / 1000)
              } catch (e: any) {
                track.status = 'error'
                track.error = e.message
              }
              changed = true
            }
            if (item.tracks.every(t => t.status === 'done' || t.status === 'error')) {
              item.status = 'done'
              changed = true
            }
          }
          if (changed) saveVinylItems()
        } finally {
          ticking = false
        }
      }
      // ─────────────────────────────────────────────────────────────────────────

      // Load persisted token from disk on startup
      let tokenStore = readJSON<SpotifyTokenStore | null>(SPOTIFY_TOKEN_FILE, null)

      function saveToken(access_token: string, refresh_token: string, expires_in: number) {
        tokenStore = { access_token, refresh_token, expiry: Date.now() + (expires_in - 60) * 1000 }
        writeJSON(SPOTIFY_TOKEN_FILE, tokenStore)
      }

      async function refreshAccessToken(): Promise<string> {
        if (!tokenStore?.refresh_token) throw new Error('not_connected')
        const r = await fetch('https://accounts.spotify.com/api/token', {
          method: 'POST',
          headers: {
            Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokenStore.refresh_token }),
        })
        const data = await r.json() as any
        if (data.error) throw new Error('not_connected')
        saveToken(data.access_token, data.refresh_token ?? tokenStore.refresh_token, data.expires_in)
        return data.access_token
      }

      async function getSpotifyToken(): Promise<string> {
        if (!tokenStore) throw new Error('not_connected')
        if (Date.now() < tokenStore.expiry) return tokenStore.access_token
        return refreshAccessToken()
      }

      const handler: Connect.NextHandleFunction = async (req, res, next) => {
        const url = req.url ?? ''
        const method = req.method ?? 'GET'

        if (!url.startsWith('/api/')) return next()

        if (url === '/api/blacklist' && method === 'GET') {
          return json(res, readJSON(BLACKLIST_FILE, []))
        }

        if (url === '/api/blacklist' && method === 'POST') {
          const body = JSON.parse(await readBody(req))
          const entries = readJSON<object[]>(BLACKLIST_FILE, [])
          const entry = { ...body, id: crypto.randomUUID(), addedAt: new Date().toISOString() }
          entries.push(entry)
          writeJSON(BLACKLIST_FILE, entries)
          return json(res, entry, 201)
        }

        if (url.startsWith('/api/blacklist/') && method === 'DELETE') {
          const id = url.replace('/api/blacklist/', '')
          const entries = readJSON<{ id: string }[]>(BLACKLIST_FILE, []).filter(e => e.id !== id)
          writeJSON(BLACKLIST_FILE, entries)
          return json(res, { ok: true })
        }

        if (url.startsWith('/api/blacklist/') && method === 'PATCH') {
          const id = url.replace('/api/blacklist/', '')
          const patch = JSON.parse(await readBody(req))
          const entries = readJSON<{ id: string }[]>(BLACKLIST_FILE, []).map(e =>
            e.id === id ? { ...e, ...patch } : e
          )
          writeJSON(BLACKLIST_FILE, entries)
          const updated = entries.find(e => e.id === id)
          return json(res, updated ?? { ok: true })
        }

        // Persist Last.fm session key to disk for use by scripts
        if (url === '/api/auth/session' && method === 'POST') {
          const { sessionKey, username } = JSON.parse(await readBody(req))
          if (!sessionKey) return json(res, { error: 'sessionKey manquant' }, 400)
          writeJSON(path.join(DATA_DIR, 'lastfm-session.json'), { sessionKey, username, savedAt: new Date().toISOString() })
          return json(res, { ok: true })
        }

        if (url === '/api/clean-log' && method === 'GET') {
          return json(res, readJSON(LOG_FILE, []))
        }

        if (url === '/api/clean/run' && method === 'POST') {
          const scriptPath = path.resolve(process.cwd(), 'scripts/clean.mjs')
          return execFile('node', ['--env-file=.env.local', scriptPath], (err, stdout, stderr) => {
            if (err) return json(res, { error: stderr || err.message }, 500)
            json(res, { ok: true, output: stdout })
          })
        }

        if (url === '/api/delete-scrobbles' && method === 'POST') {
          const jobFile = path.join(DATA_DIR, 'delete-job.json')
          const existing = readJSON<{ status: string }>(jobFile, { status: 'idle' })
          const activeStatuses = ['starting', 'scanning', 'authenticating', 'waiting_login', 'deleting']
          if (activeStatuses.includes(existing.status)) {
            return json(res, { error: 'Job déjà en cours' }, 409)
          }
          let body: any = {}
          try { body = JSON.parse(await readBody(req)) } catch {}
          const selectedArtists: string[] | undefined = body?.artists
          const scriptPath = path.resolve(process.cwd(), 'scripts/delete-scrobbles.mjs')
          const env = { ...process.env, ...(selectedArtists?.length ? { ARTISTS: JSON.stringify(selectedArtists) } : {}) }
          const child = spawn('node', ['--env-file=.env.local', scriptPath], {
            detached: true,
            stdio: 'ignore',
            cwd: process.cwd(),
            env,
          })
          child.unref()
          return json(res, { ok: true })
        }

        if (url === '/api/delete-scrobbles' && method === 'DELETE') {
          const jobFile = path.join(DATA_DIR, 'delete-job.json')
          const job = readJSON<{ status: string; pid?: number }>(jobFile, { status: 'idle' })
          if (!job.pid) return json(res, { error: 'Aucun job actif' }, 409)
          try {
            process.kill(job.pid, 'SIGTERM')
          } catch {
            // process already gone — write cancelled anyway
            writeJSON(jobFile, { ...job, status: 'cancelled', updatedAt: new Date().toISOString() })
          }
          return json(res, { ok: true })
        }

        if (url === '/api/delete-scrobbles/status' && method === 'GET') {
          return json(res, readJSON(path.join(DATA_DIR, 'delete-job.json'), { status: 'idle' }))
        }

        // Spotify OAuth — step 1: get auth URL
        if (url === '/api/spotify/auth' && method === 'GET') {
          if (!clientId) return json(res, { error: 'VITE_SPOTIFY_CLIENT_ID manquant' }, 400)
          const state = crypto.randomBytes(8).toString('hex')
          const scope = 'user-read-private playlist-read-private playlist-read-collaborative'
          const authUrl = `https://accounts.spotify.com/authorize?` +
            `client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(SPOTIFY_CALLBACK)}&scope=${encodeURIComponent(scope)}&state=${state}`
          return json(res, { url: authUrl })
        }

        // Spotify OAuth — step 2: callback with code
        if (url.startsWith('/api/spotify/callback') && method === 'GET') {
          const params = new URL(url, 'http://localhost').searchParams
          const code = params.get('code')
          if (!code) {
            res.statusCode = 302
            res.setHeader('Location', '/?spotify_error=1')
            return res.end()
          }
          try {
            const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
              method: 'POST',
              headers: {
                Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: SPOTIFY_CALLBACK }),
            })
            const data = await tokenRes.json() as any
            if (data.error) throw new Error(data.error_description ?? data.error)
            saveToken(data.access_token, data.refresh_token, data.expires_in)
            res.statusCode = 302
            res.setHeader('Location', '/clean?spotify_connected=1')
            return res.end()
          } catch (e: any) {
            res.statusCode = 302
            res.setHeader('Location', `/clean?spotify_error=${encodeURIComponent(e.message)}`)
            return res.end()
          }
        }

        // Spotify status
        if (url === '/api/spotify/status' && method === 'GET') {
          return json(res, { connected: !!tokenStore })
        }

        // Spotify — list user playlists
        if (url === '/api/spotify/playlists' && method === 'GET') {
          let token: string
          try { token = await getSpotifyToken() } catch { return json(res, { error: 'not_connected' }, 401) }
          try {
            const playlists: { id: string; name: string; tracks: number | null; image: string | null }[] = []
            let next: string | null = 'https://api.spotify.com/v1/me/playlists?limit=50'
            while (next) {
              const r = await fetch(next, { headers: { Authorization: `Bearer ${token}` } })
              const data = await r.json() as any
              if (data.error) {
                if (data.error.status === 401) {
                  try { token = await refreshAccessToken() } catch { return json(res, { error: 'not_connected' }, 401) }
                  continue
                }
                return json(res, { error: `Spotify ${data.error.status}: ${data.error.message}` }, 400)
              }
              for (const p of data.items ?? []) {
                if (!p) continue
                // Spotify API no longer returns tracks.total in simplified playlist objects
                const trackCount = p.tracks?.total ?? p.items?.total ?? null
                playlists.push({ id: p.id, name: p.name, tracks: trackCount, image: p.images?.[0]?.url ?? null })
              }
              next = data.next ?? null
            }
            return json(res, { playlists })
          } catch (e: any) {
            return json(res, { error: e.message }, 500)
          }
        }

        // Spotify import
        if (url === '/api/spotify/import' && method === 'POST') {
          if (!clientId || !clientSecret) {
            return json(res, { error: 'VITE_SPOTIFY_CLIENT_ID et VITE_SPOTIFY_CLIENT_SECRET requis dans .env.local' }, 400)
          }
          let token: string
          try { token = await getSpotifyToken() } catch { return json(res, { error: 'not_connected' }, 401) }
          const { playlistId } = JSON.parse(await readBody(req))
          try {
            const tracks: { artist: string; title: string }[] = []

            function extractTracks(items: any[]) {
              for (const item of items) {
                // Spotify API v2 uses 'item', older format used 'track'
                const t = item?.item ?? item?.track
                if (t?.type === 'track' && t.name && t.artists?.length) {
                  tracks.push({ artist: t.artists[0].name, title: t.name })
                }
              }
            }

            // Spotify API v2: GET /playlists/{id} returns items at root, paginated via /playlists/{id}/items
            const r0 = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, { headers: { Authorization: `Bearer ${token}` } })
            const d0 = await r0.json() as any
            if (d0.error) {
              if (d0.error.status === 401) return json(res, { error: 'not_connected' }, 401)
              return json(res, { error: `Spotify ${d0.error.status}: ${d0.error.message}` }, 400)
            }
            const firstPage = d0.items ?? d0.tracks
            extractTracks(firstPage?.items ?? [])
            let next: string | null = firstPage?.next ?? null

            while (next) {
              const r = await fetch(next, { headers: { Authorization: `Bearer ${token}` } })
              const data = await r.json() as any
              if (data.error) {
                if (data.error.status === 401) return json(res, { error: 'not_connected' }, 401)
                return json(res, { error: `Spotify ${data.error.status}: ${data.error.message}` }, 400)
              }
              extractTracks(data.items ?? [])
              next = data.next ?? null
            }

            return json(res, { tracks })
          } catch (e: any) {
            return json(res, { error: e.message }, 500)
          }
        }

        // ── Vinyl Queue ──────────────────────────────────────────────────────────
        if (url.startsWith('/api/vinyl/') && method === 'OPTIONS') {
          res.setHeader('Access-Control-Allow-Origin', '*')
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
          res.statusCode = 204
          return res.end()
        }

        if (url === '/api/vinyl/queue' && method === 'GET') {
          res.setHeader('Access-Control-Allow-Origin', '*')
          return json(res, vinylItems)
        }

        if (url === '/api/vinyl/queue' && method === 'POST') {
          res.setHeader('Access-Control-Allow-Origin', '*')
          let body: any = {}
          try { body = JSON.parse(await readBody(req)) } catch {}
          const { artist, album, image, tracks: inputTracks } = body
          if (!artist || !album) return json(res, { error: 'artist et album requis' }, 400)

          // Anti-doublon : même album déjà en cours dans la file → on renvoie l'existant
          const dup = vinylItems.find(i =>
            i.status === 'active' &&
            i.artist.toLowerCase() === String(artist).toLowerCase() &&
            i.album.toLowerCase() === String(album).toLowerCase()
          )
          if (dup) {
            res.setHeader('Access-Control-Allow-Origin', '*')
            const finishAt = dup.tracks[dup.tracks.length - 1]?.scrobbleAt
            return json(res, { ...dup, finishAt, duplicate: true }, 200)
          }

          let tracks: VinylTrack[]
          if (Array.isArray(inputTracks) && inputTracks.length) {
            tracks = inputTracks.map((t: any) => ({
              title: String(t.title ?? ''),
              duration: t.duration ? Number(t.duration) : undefined,
              status: 'pending' as const,
            }))
          } else {
            const fetched = await fetchAlbumTracksFromLfm(album, artist)
            if (!fetched.length) return json(res, { error: 'Aucune piste trouvée pour cet album' }, 404)
            tracks = fetched.map(t => ({ title: t.title, duration: t.duration, status: 'pending' as const }))
          }

          scheduleTracks(tracks, nextStart())
          const item: VinylQueueItem = {
            id: crypto.randomUUID(),
            artist,
            album,
            image: image ?? '',
            tracks,
            status: 'active',
            addedAt: new Date().toISOString(),
          }
          vinylItems.push(item)
          saveVinylItems()
          tick()
          const finishAt = tracks[tracks.length - 1]?.scrobbleAt
          return json(res, { ...item, finishAt }, 201)
        }

        if (url.startsWith('/api/vinyl/queue/') && method === 'DELETE') {
          res.setHeader('Access-Control-Allow-Origin', '*')
          const id = url.replace('/api/vinyl/queue/', '')
          const item = vinylItems.find(i => i.id === id)
          if (!item) return json(res, { error: 'Not found' }, 404)
          item.status = 'cancelled'
          saveVinylItems()
          return json(res, { ok: true })
        }

        // Proxy collection musicale Biblianalo (contourne le blocage mixed-content https→http)
        if (url === '/api/biblianalo/albums' && method === 'GET') {
          const base = env.BIBLIANALO_API_URL ?? 'http://localhost:8002/api'
          try {
            const r = await fetch(`${base}/items?type=music`)
            if (!r.ok) return json(res, { error: `Biblianalo a répondu ${r.status}` }, 502)
            const items = await r.json() as any[]
            const albums = items.map(it => {
              const artist = it.artist_or_director ?? ''
              const album = it.title ?? ''
              return {
                id: it.id,
                artist,
                album,
                image: it.cover_url || coversCache[coverKey(artist, album)] || '',
                support: it.support ?? null,
                year: it.year ?? null,
                tracks: (Array.isArray(it.tracklist) ? it.tracklist : [])
                  .filter((t: any) => t?.title)
                  .map((t: any) => ({ title: t.title, duration: t.length_sec ?? undefined })),
              }
            })
            // Fetch and cache any missing covers in the background
            const toFetch = albums.filter(a => !a.image && coversCache[coverKey(a.artist, a.album)] === undefined)
            if (toFetch.length) {
              ;(async () => {
                for (const a of toFetch) {
                  coversCache[coverKey(a.artist, a.album)] = await fetchAlbumCover(a.album, a.artist)
                  await new Promise(r => setTimeout(r, 250))
                }
                saveCoversCache()
              })().catch(() => {})
            }
            return json(res, albums)
          } catch {
            return json(res, { error: 'Biblianalo injoignable (le serveur tourne-t-il sur :8002 ?)' }, 502)
          }
        }
        // ─────────────────────────────────────────────────────────────────────────

        next()
      }

      server.middlewares.use(handler)

      // Reprise après redémarrage : replanifie séquentiellement toute la file active
      // depuis maintenant (évite tout envoi groupé des pistes en retard).
      {
        let cursor = Math.floor(Date.now() / 1000) + 5
        let resumeChanged = false
        for (const item of vinylItems) {
          if (item.status !== 'active') continue
          if (item.tracks.some(t => t.status === 'pending')) {
            cursor = scheduleTracks(item.tracks, cursor) + gap()
            resumeChanged = true
          }
        }
        if (resumeChanged) saveVinylItems()
      }

      // Planificateur global : un tick toutes les 5s
      setInterval(tick, 5000)
      tick()

      // Pré-charge les couvertures d'albums Biblianalo depuis Last.fm au démarrage
      ;(async () => {
        try {
          const base = env.BIBLIANALO_API_URL ?? 'http://localhost:8002/api'
          const r = await fetch(`${base}/items?type=music`)
          if (!r.ok) return
          const items = await r.json() as any[]
          let saved = false
          for (const it of items) {
            const artist = String(it.artist_or_director ?? '')
            const album = String(it.title ?? '')
            if (!artist || !album) continue
            const key = coverKey(artist, album)
            if (coversCache[key] !== undefined) continue
            coversCache[key] = await fetchAlbumCover(album, artist)
            saved = true
            await new Promise(r => setTimeout(r, 250))
          }
          if (saved) saveCoversCache()
        } catch {}
      })()
    },
  }
}
