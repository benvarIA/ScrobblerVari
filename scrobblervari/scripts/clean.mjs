#!/usr/bin/env node
// Usage : node --env-file=.env.local scripts/clean.mjs
// Cron  : */6 * * * * cd /chemin/vers/scrobblervari && node --env-file=.env.local scripts/clean.mjs >> /tmp/scrobblervari-clean.log 2>&1

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const API_KEY = process.env.VITE_LASTFM_API_KEY
const SECRET = process.env.VITE_LASTFM_SECRET
const USERNAME = process.env.LASTFM_USERNAME
const PASSWORD = process.env.LASTFM_PASSWORD

const BLACKLIST_FILE = path.join(ROOT, 'data/blacklist.json')
const LOG_FILE = path.join(ROOT, 'data/clean-log.json')
const SESSION_FILE = path.join(ROOT, 'data/lastfm-session.json')
const BASE_URL = 'https://ws.audioscrobbler.com/2.0/'

const md5 = (str) => crypto.createHash('md5').update(str, 'utf-8').digest('hex')

function apiSig(params) {
  return md5(Object.keys(params).sort().map(k => k + params[k]).join('') + SECRET)
}

async function apiPost(params) {
  const body = new URLSearchParams({ ...params, api_key: API_KEY, format: 'json' })
  const res = await fetch(BASE_URL, { method: 'POST', body })
  const data = await res.json()
  if (data.error) throw new Error(`Last.fm ${data.error}: ${data.message}`)
  return data
}

async function apiGet(params) {
  const url = new URL(BASE_URL)
  Object.entries({ ...params, api_key: API_KEY, format: 'json' }).forEach(([k, v]) => url.searchParams.set(k, v))
  const res = await fetch(url.toString())
  const data = await res.json()
  if (data.error) throw new Error(`Last.fm ${data.error}: ${data.message}`)
  return data
}

function getSession() {
  try {
    const stored = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'))
    if (stored?.sessionKey) return stored.sessionKey
  } catch {}
  throw new Error(`Session key introuvable. Connecte-toi sur l'app web (https://localhost:3008) pour la générer.`)
}

async function getRecentTracks(username, maxPages = 3) {
  const all = []
  for (let page = 1; page <= maxPages; page++) {
    const data = await apiGet({ method: 'user.getRecentTracks', user: username, page: String(page), limit: '200' })
    const raw = data.recenttracks.track
    const arr = Array.isArray(raw) ? raw : (raw ? [raw] : [])
    all.push(...arr.filter(t => !t['@attr']?.nowplaying))
    if (page >= Number(data.recenttracks['@attr'].totalPages)) break
  }
  return all
}

async function unloveTrack(sessionKey, artist, track) {
  const params = { api_key: API_KEY, artist, method: 'track.unlove', sk: sessionKey, track }
  const sig = apiSig(params)
  await apiPost({ method: 'track.unlove', artist, track, sk: sessionKey, api_sig: sig })
}

function isMatch(track, blacklist) {
  const artist = track.artist['#text'].toLowerCase()
  const title = track.name.toLowerCase()
  return blacklist.some(entry => {
    if (entry.type === 'artist') return artist === entry.artist.toLowerCase()
    if (entry.type === 'track') return artist === entry.artist.toLowerCase() && title === (entry.title ?? '').toLowerCase()
    return false
  })
}

async function main() {
  const stamp = new Date().toISOString()
  console.log(`[clean] ${stamp} — démarrage`)

  if (!API_KEY || !SECRET) { console.error('[clean] VITE_LASTFM_API_KEY/SECRET manquant'); process.exit(1) }

  let blacklist = []
  try { blacklist = JSON.parse(fs.readFileSync(BLACKLIST_FILE, 'utf-8')) } catch { /* pas de fichier */ }

  if (!blacklist.length) { console.log('[clean] Blacklist vide, rien à faire'); return }

  const sessionKey = getSession()
  console.log(`[clean] Authentifié comme ${USERNAME}`)

  const tracks = await getRecentTracks(USERNAME)
  console.log(`[clean] ${tracks.length} scrobbles chargés`)

  const matched = tracks.filter(t => isMatch(t, blacklist))
  console.log(`[clean] ${matched.length} correspondances blacklist`)

  const results = []
  for (const track of matched) {
    const artist = track.artist['#text']
    const title = track.name
    try {
      await unloveTrack(sessionKey, artist, title)
      console.log(`[clean] ✓ Unlove — ${artist} · ${title}`)
      results.push({ artist, title, action: 'unloved', ts: Date.now(), ok: true })
    } catch (e) {
      console.error(`[clean] ✗ Erreur — ${artist} · ${title}: ${e.message}`)
      results.push({ artist, title, action: 'unloved', ts: Date.now(), ok: false, error: e.message })
    }
  }

  let log = []
  try { log = JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8')) } catch {}
  log.unshift({ date: stamp, total: matched.length, ok: results.filter(r => r.ok).length, results })
  log.splice(100)
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2))

  console.log(`[clean] Terminé — ${results.filter(r => r.ok).length}/${matched.length} succès`)
}

main().catch(e => { console.error('[clean] Erreur fatale:', e.message); process.exit(1) })
