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

        next()
      }

      server.middlewares.use(handler)
    },
  }
}
