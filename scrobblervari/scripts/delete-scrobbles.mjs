#!/usr/bin/env node
/**
 * delete-scrobbles.mjs
 * Suppression des artistes blacklistés via "Delete artist from library" de Last.fm.
 * Un seul POST par artiste — pas de scan de l'historique.
 * Progress → data/delete-job.json
 * Cookies Last.fm → data/lastfm-cookies.json
 */

import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '../data')
const BLACKLIST_FILE = path.join(DATA_DIR, 'blacklist.json')
const JOB_FILE = path.join(DATA_DIR, 'delete-job.json')
const COOKIES_FILE = path.join(DATA_DIR, 'lastfm-cookies.json')

const USERNAME = process.env.LASTFM_USERNAME
if (!USERNAME) {
  console.error('Missing env: LASTFM_USERNAME')
  process.exit(1)
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let _startedAt = new Date().toISOString()

function writeJob(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(JOB_FILE, JSON.stringify({ ...data, startedAt: _startedAt, updatedAt: new Date().toISOString() }, null, 2))
}

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')) } catch { return fallback }
}

function encodeArtist(name) {
  return encodeURIComponent(name).replace(/%20/g, '+')
}

function extractCsrf(html) {
  const m = html.match(/name="csrfmiddlewaretoken"\s+value="([^"]+)"/)
  return m ? m[1] : null
}

async function deleteArtist(context, artistName) {
  const encoded = encodeArtist(artistName)
  const baseUrl = `https://www.last.fm/user/${USERNAME}/library/music/${encoded}/+delete`
  const modalUrl = `${baseUrl}?is_modal=1`

  const modalResp = await context.request.get(modalUrl, {
    headers: {
      Referer: `https://www.last.fm/user/${USERNAME}/library/music/${encoded}`,
      Accept: 'text/html',
    },
  })
  const modalHtml = await modalResp.text()

  if (modalHtml.includes('action="/login"') || modalHtml.includes('/login?next=')) {
    throw new Error('session_expired')
  }

  let token = extractCsrf(modalHtml)
  if (!token) {
    const cookies = await context.cookies('https://www.last.fm')
    token = cookies.find(c => c.name === 'csrftoken')?.value
  }
  if (!token) throw new Error('csrf_not_found')

  const resp = await context.request.post(modalUrl, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': modalUrl,
      'X-CSRFToken': token,
      'X-Requested-With': 'XMLHttpRequest',
    },
    form: { csrfmiddlewaretoken: token, confirm: 'on' },
  })

  return resp.status()
}

async function reauth() {
  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] })
  const context = await browser.newContext({ viewport: null })
  const page = await context.newPage()
  await page.goto('https://www.last.fm/login', { waitUntil: 'domcontentloaded' })
  await page.waitForURL(u => !u.toString().includes('/login'), { timeout: 300_000 })
  await page.goto(`https://www.last.fm/user/${USERNAME}/library`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  const cookies = await context.cookies('https://www.last.fm')
  fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2))
  return { browser, context }
}

async function runDeletions(context, artists, browserRef = null) {
  let deleted = 0, errors = 0
  let currentContext = context
  let currentBrowser = browserRef
  writeJob({ status: 'deleting', total: artists.length, deleted, errors })

  for (const artistName of artists) {
    try {
      const status = await deleteArtist(currentContext, artistName)
      status >= 200 && status < 400 ? deleted++ : errors++
      console.log(`  ${status < 400 ? '✓' : '✗'} ${artistName} (HTTP ${status})`)
    } catch (e) {
      if (e.message === 'session_expired') {
        writeJob({ status: 'waiting_login', total: artists.length, deleted, errors })
        console.log('Session expirée — ouverture du navigateur pour re-connexion…')
        if (currentBrowser) await currentBrowser.close().catch(() => {})
        const { browser: nb, context: nc } = await reauth()
        currentBrowser = nb
        currentContext = nc
        // retry this artist
        try {
          const status = await deleteArtist(currentContext, artistName)
          status >= 200 && status < 400 ? deleted++ : errors++
          console.log(`  ${status < 400 ? '✓' : '✗'} ${artistName} (HTTP ${status}) [retry]`)
        } catch (e2) {
          errors++
          console.warn(`  ✗ ${artistName}: ${e2.message} [retry failed]`)
        }
        writeJob({ status: 'deleting', total: artists.length, deleted, errors })
        await sleep(800)
        continue
      }
      errors++
      console.warn(`  ✗ ${artistName}: ${e.message}`)
    }
    writeJob({ status: 'deleting', total: artists.length, deleted, errors })
    await sleep(800)
  }

  if (currentBrowser) await currentBrowser.close().catch(() => {})
  writeJob({ status: 'done', total: artists.length, deleted, errors, finishedAt: new Date().toISOString() })
  console.log(`Done: ${deleted}/${artists.length} deleted, ${errors} errors`)
}

async function main() {
  _startedAt = new Date().toISOString()
  writeJob({ status: 'starting' })

  const blacklist = readJSON(BLACKLIST_FILE, [])
  const artistEntries = blacklist.filter(e => e.type === 'artist')
  const allArtists = artistEntries.map(e => e.artist)

  // If a selection was passed by the UI, only process those
  const artistsOverride = process.env.ARTISTS ? JSON.parse(process.env.ARTISTS) : null
  const artists = artistsOverride ? allArtists.filter(a => artistsOverride.includes(a)) : allArtists

  if (!artists.length) {
    writeJob({ status: 'done', deleted: 0, errors: 0, total: 0 })
    return
  }

  const savedCookies = readJSON(COOKIES_FILE, null)
  const hasValidCookies = !!(savedCookies?.length)

  writeJob({ status: hasValidCookies ? 'authenticating' : 'waiting_login', total: artists.length, deleted: 0, errors: 0 })

  const browser = await chromium.launch({ headless: hasValidCookies, args: hasValidCookies ? [] : ['--start-maximized'] })
  const context = await browser.newContext({ viewport: null })
  if (hasValidCookies) await context.addCookies(savedCookies)

  const page = await context.newPage()
  await page.goto(`https://www.last.fm/user/${USERNAME}/library`, { waitUntil: 'domcontentloaded' }).catch(() => {})

  let cookies = await context.cookies('https://www.last.fm')
  const isLoggedIn = cookies.some(c => c.name === 'sessionid')

  if (!isLoggedIn) {
    writeJob({ status: 'waiting_login', total: artists.length, deleted: 0, errors: 0 })

    if (hasValidCookies) {
      await browser.close()
      const vb = await chromium.launch({ headless: false, args: ['--start-maximized'] })
      const vc = await vb.newContext({ viewport: null })
      const vp = await vc.newPage()
      await vp.goto('https://www.last.fm/login', { waitUntil: 'domcontentloaded' })
      await vp.waitForURL(u => !u.toString().includes('/login'), { timeout: 300_000 })
      await vp.goto(`https://www.last.fm/user/${USERNAME}/library`, { waitUntil: 'domcontentloaded' }).catch(() => {})
      fs.writeFileSync(COOKIES_FILE, JSON.stringify(await vc.cookies('https://www.last.fm'), null, 2))
      await runDeletions(vc, artists, vb)
      return
    } else {
      await page.goto('https://www.last.fm/login', { waitUntil: 'domcontentloaded' })
      await page.waitForURL(u => !u.toString().includes('/login'), { timeout: 300_000 })
      await page.goto(`https://www.last.fm/user/${USERNAME}/library`, { waitUntil: 'domcontentloaded' }).catch(() => {})
      cookies = await context.cookies('https://www.last.fm')
      fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2))
    }
  } else if (!hasValidCookies) {
    fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2))
  }

  await runDeletions(context, artists, browser)
}

main().catch(e => {
  console.error(e)
  writeJob({ status: 'error', message: e.message })
  process.exit(1)
})
