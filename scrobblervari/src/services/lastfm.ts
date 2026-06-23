import { md5 } from '../lib/md5'

const API_KEY = import.meta.env.VITE_LASTFM_API_KEY as string
const SECRET = import.meta.env.VITE_LASTFM_SECRET as string
const BASE_URL = 'https://ws.audioscrobbler.com/2.0/'
const AUTH_URL = 'https://www.last.fm/api/auth/'

export interface LastFmUser {
  name: string
  realname: string
  image: { '#text': string; size: string }[]
  playcount: string
  url: string
}

export interface LastFmSession {
  key: string
  name: string
}

export interface RecentTrack {
  key: string
  artist: string
  title: string
  album: string
  image: string
  date: number | null
  url: string
}

function apiSig(params: Record<string, string>): string {
  const sorted = Object.keys(params).sort().map(k => k + params[k]).join('')
  return md5(sorted + SECRET)
}

async function apiFetch<T>(params: Record<string, string>): Promise<T> {
  const url = new URL(BASE_URL)
  Object.entries({ ...params, api_key: API_KEY, format: 'json' }).forEach(([k, v]) =>
    url.searchParams.set(k, v)
  )
  const res = await fetch(url.toString())
  const data = await res.json()
  if (data.error) throw new Error(`Last.fm ${data.error}: ${data.message}`)
  return data as T
}

async function apiPost<T>(params: Record<string, string>): Promise<T> {
  const body = new URLSearchParams({ ...params, api_key: API_KEY, format: 'json' })
  const res = await fetch(BASE_URL, { method: 'POST', body })
  const data = await res.json()
  if (data.error) throw new Error(`Last.fm ${data.error}: ${data.message}`)
  return data as T
}

export function getAuthUrl(): string {
  const cb = encodeURIComponent(`${window.location.origin}/callback`)
  return `${AUTH_URL}?api_key=${API_KEY}&cb=${cb}`
}

export async function getSession(token: string): Promise<LastFmSession> {
  const params = { api_key: API_KEY, method: 'auth.getSession', token }
  const sig = apiSig(params)
  const data = await apiFetch<{ session: LastFmSession }>({
    method: 'auth.getSession',
    token,
    api_sig: sig,
  })
  return data.session
}

export async function getUserInfo(username: string): Promise<LastFmUser> {
  const data = await apiFetch<{ user: LastFmUser }>({
    method: 'user.getInfo',
    user: username,
  })
  return data.user
}

export async function getRecentTracks(
  username: string,
  page = 1,
  limit = 200,
): Promise<{ tracks: RecentTrack[]; total: number; totalPages: number }> {
  const data = await apiFetch<any>({
    method: 'user.getRecentTracks',
    user: username,
    page: String(page),
    limit: String(limit),
  })
  const raw: any[] = Array.isArray(data.recenttracks.track)
    ? data.recenttracks.track
    : data.recenttracks.track ? [data.recenttracks.track] : []

  const tracks: RecentTrack[] = raw
    .filter(t => !t['@attr']?.nowplaying)
    .map(t => {
      const date = t.date ? Number(t.date.uts) : null
      return {
        key: `${t.artist['#text']}::${t.name}::${date ?? 'np'}`,
        artist: t.artist['#text'],
        title: t.name,
        album: t.album['#text'],
        image: t.image?.find((i: any) => i.size === 'medium')?.['#text'] ?? '',
        date,
        url: t.url,
      }
    })

  return {
    tracks,
    total: Number(data.recenttracks['@attr'].total),
    totalPages: Number(data.recenttracks['@attr'].totalPages),
  }
}

export interface ArtistSuggestion {
  name: string
  listeners: number
}

export async function searchArtists(query: string, limit = 6): Promise<ArtistSuggestion[]> {
  if (!query.trim()) return []
  const data = await apiFetch<any>({ method: 'artist.search', artist: query, limit: String(limit) })
  const matches = data.results?.artistmatches?.artist
  if (!matches) return []
  const arr = Array.isArray(matches) ? matches : [matches]
  return arr.map((a: any) => ({ name: a.name, listeners: Number(a.listeners) || 0 }))
}

export interface AlbumSearchResult {
  name: string
  artist: string
  image: string
}

export interface AlbumTrack {
  title: string
  duration?: number
  position: number
}

export async function searchAlbums(query: string, limit = 8): Promise<AlbumSearchResult[]> {
  if (!query.trim()) return []
  const data = await apiFetch<any>({ method: 'album.search', album: query, limit: String(limit) })
  const matches = data.results?.albummatches?.album
  if (!matches) return []
  const arr = Array.isArray(matches) ? matches : [matches]
  return arr
    .filter((a: any) => a.name && a.artist && a.artist !== '(null)')
    .map((a: any) => ({
      name: a.name,
      artist: a.artist,
      image: a.image?.find((i: any) => i.size === 'large')?.['#text'] ?? '',
    }))
}

export async function getAlbumInfo(album: string, artist: string): Promise<{ tracks: AlbumTrack[]; image: string }> {
  const data = await apiFetch<any>({ method: 'album.getInfo', album, artist })
  const rawTracks = data.album?.tracks?.track
  const arr = Array.isArray(rawTracks) ? rawTracks : rawTracks ? [rawTracks] : []
  return {
    image: data.album?.image?.find((i: any) => i.size === 'large')?.['#text'] ?? '',
    tracks: arr.map((t: any, idx: number) => ({
      title: t.name,
      duration: t.duration ? Number(t.duration) : undefined,
      position: Number(t['@attr']?.rank ?? idx + 1),
    })),
  }
}

export async function unloveTrack(
  artist: string,
  track: string,
  sessionKey: string,
): Promise<void> {
  const params = { api_key: API_KEY, artist, method: 'track.unlove', sk: sessionKey, track }
  const sig = apiSig(params)
  await apiPost<unknown>({ method: 'track.unlove', artist, track, sk: sessionKey, api_sig: sig })
}
