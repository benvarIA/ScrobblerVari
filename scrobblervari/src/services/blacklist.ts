export interface BlacklistEntry {
  id: string
  type: 'artist' | 'track'
  artist: string
  title?: string
  addedAt: string
  source?: 'manual' | 'spotify'
  bypass?: boolean
  lastScannedAt?: string
}

export async function fetchBlacklist(): Promise<BlacklistEntry[]> {
  const res = await fetch('/api/blacklist')
  return res.json()
}

export async function addBlacklistEntry(
  entry: Omit<BlacklistEntry, 'id' | 'addedAt'>,
): Promise<BlacklistEntry> {
  const res = await fetch('/api/blacklist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  })
  return res.json()
}

export async function removeBlacklistEntry(id: string): Promise<void> {
  await fetch(`/api/blacklist/${id}`, { method: 'DELETE' })
}

export function isBlacklisted(artist: string, title: string, list: BlacklistEntry[]): boolean {
  const a = artist.toLowerCase()
  const t = title.toLowerCase()
  return list.some(e =>
    e.type === 'artist'
      ? e.artist.toLowerCase() === a
      : e.artist.toLowerCase() === a && (e.title ?? '').toLowerCase() === t,
  )
}

export function extractSpotifyId(url: string): string | null {
  const m = url.match(/playlist\/([a-zA-Z0-9]+)/)
  return m ? m[1] : null
}

export async function importSpotifyPlaylist(
  playlistId: string,
): Promise<{ artist: string; title: string }[]> {
  const res = await fetch('/api/spotify/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playlistId }),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return data.tracks
}

export async function runClean(): Promise<{ ok: boolean; output?: string; error?: string }> {
  const res = await fetch('/api/clean/run', { method: 'POST' })
  return res.json()
}

export async function fetchCleanLog(): Promise<
  { date: string; total: number; ok: number; results: any[] }[]
> {
  const res = await fetch('/api/clean-log')
  return res.json()
}

export const BINAURAL_KEYWORDS = [
  'binaural', 'sleep', 'frequencies', 'hz', '432', '528', 'solfeggio',
  'meditation', 'healing', 'delta waves', 'theta waves', 'alpha waves',
  'isochronic', 'relaxing music', 'white noise',
]

export function isBinaural(artist: string, title: string): boolean {
  const text = `${artist} ${title}`.toLowerCase()
  return BINAURAL_KEYWORDS.some(kw => text.includes(kw))
}
