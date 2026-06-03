
/**
 * FeedbackWidget — composant PORTABLE à embarquer dans une app cliente.
 * Autonome : aucun style externe requis (styles inline + <style> injecté).
 * Fonctionne en Next.js comme en Vite/CRA (React + fetch uniquement).
 *
 * Usage :
 *   <FeedbackWidget apiKey={import.meta.env.VITE_AMELIORATOR_API_KEY}
 *                   amelioratorUrl={import.meta.env.VITE_AMELIORATOR_URL} />
 *
 * Comportement :
 *  - Au montage, interroge {amelioratorUrl}/api/widget-config (cache 5 min).
 *  - Ne s'affiche QUE si enabled === true (kill-switch distant, fail-closed).
 *  - Envoie la page courante automatiquement.
 */

import { useEffect, useMemo, useState } from 'react'

type Props = {
  apiKey?: string
  amelioratorUrl?: string
  /** Position du bouton flottant. */
  position?: 'bottom-right' | 'bottom-left'
}

type Config = { enabled: boolean; types: string[]; appName: string; accent: string }

const TYPE_META: Record<string, { label: string; emoji: string; hint: string }> = {
  bug:          { label: 'Bug',          emoji: '🐛', hint: 'Quelque chose ne marche pas' },
  amelioration: { label: 'Amélioration', emoji: '✨', hint: 'Une idée, une suggestion' },
  contenu:      { label: 'Contenu',      emoji: '📄', hint: 'Une info incorrecte' },
  autre:        { label: 'Autre',        emoji: '💬', hint: 'Autre retour' },
}

const CACHE_KEY = 'amlr_widget_cfg'
const CACHE_TTL = 5 * 60 * 1000 // 5 min

/** Lit la config en cache (sessionStorage) si encore fraîche. Null si absente/expirée/SSR. */
function readCachedConfig(apiKey?: string): Config | null {
  if (!apiKey || typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(`${CACHE_KEY}:${apiKey.slice(0, 8)}`)
    if (!raw) return null
    const { at, data } = JSON.parse(raw)
    return Date.now() - at < CACHE_TTL ? (data as Config) : null
  } catch { return null }
}

export function FeedbackWidget({ apiKey, amelioratorUrl = 'http://localhost:3010', position = 'bottom-right' }: Props) {
  const [cfg, setCfg] = useState<Config | null>(() => readCachedConfig(apiKey))
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<string>('bug')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Récupère la config réseau (cache court via sessionStorage, seedé en état initial).
  useEffect(() => {
    if (!apiKey) return
    if (readCachedConfig(apiKey)) return // cache frais → déjà chargé en état initial
    let cancelled = false
    const cacheId = `${CACHE_KEY}:${apiKey.slice(0, 8)}`

    fetch(`${amelioratorUrl}/api/widget-config`, { headers: { 'X-Api-Key': apiKey } })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: Config) => {
        if (cancelled) return
        setCfg(data)
        try { sessionStorage.setItem(cacheId, JSON.stringify({ at: Date.now(), data })) } catch { /* ignore */ }
      })
      .catch(() => { if (!cancelled) setCfg({ enabled: false, types: [], appName: '', accent: '#f4bf4f' }) }) // fail-closed
    return () => { cancelled = true }
  }, [apiKey, amelioratorUrl])

  const accent = cfg?.accent || '#f4bf4f'
  const types = useMemo(
    () => (cfg?.types != null ? cfg.types : ['bug', 'amelioration', 'contenu', 'autre']),
    [cfg],
  )

  async function submit() {
    if (!apiKey) return
    if (!message.trim()) { setError('Décris ton retour en quelques mots.'); return }
    setSending(true); setError(null)
    try {
      const res = await fetch(`${amelioratorUrl}/api/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
        body: JSON.stringify({
          type, message: message.trim(),
          page: typeof window !== 'undefined' ? window.location.href : undefined,
          contexte: typeof window !== 'undefined'
            ? { path: window.location.pathname, ua: navigator.userAgent, viewport: `${window.innerWidth}x${window.innerHeight}` }
            : undefined,
        }),
      })
      if (!res.ok) throw new Error()
      setDone(true); setMessage('')
      setTimeout(() => { setOpen(false); setTimeout(() => setDone(false), 300) }, 1600)
    } catch {
      setError('Envoi impossible, réessaie.')
    } finally { setSending(false) }
  }

  // Kill-switch distant : ne rien rendre si désactivé / pas encore chargé
  if (!cfg || !cfg.enabled) return null

  const side = position === 'bottom-left' ? { left: 20 } : { right: 20 }

  return (
    <>
      <style>{WIDGET_CSS}</style>

      {/* Bouton flottant */}
      {!open && (
        <button
          className="amlr-fab"
          style={{ ...side, ['--amlr-accent' as string]: accent }}
          onClick={() => setOpen(true)}
          aria-label="Donner un retour"
        >
          <span className="amlr-fab-ico">💬</span>
          <span className="amlr-fab-label">Un retour&nbsp;?</span>
        </button>
      )}

      {/* Panneau */}
      {open && (
        <div className="amlr-panel" style={{ ...side, ['--amlr-accent' as string]: accent }} role="dialog" aria-label="Feedback">
          <div className="amlr-head">
            <div className="amlr-head-t">
              <span className="amlr-dot" />
              <span>{done ? 'Merci !' : 'Un retour ?'}</span>
            </div>
            <button className="amlr-x" onClick={() => setOpen(false)} aria-label="Fermer">✕</button>
          </div>

          {done ? (
            <div className="amlr-done">
              <div className="amlr-check">✓</div>
              <p>Merci pour ton retour&nbsp;!</p>
              <span>Bien reçu par {cfg.appName || 'l’équipe'}.</span>
            </div>
          ) : (
            <div className="amlr-body">
              {types.length > 0 && (
                <div className="amlr-types">
                  {types.map((tk) => {
                    const m = TYPE_META[tk] ?? { label: tk, emoji: '•', hint: '' }
                    const active = type === tk
                    return (
                      <button
                        key={tk}
                        className={`amlr-type${active ? ' amlr-type-on' : ''}`}
                        onClick={() => setType(tk)}
                        title={m.hint}
                      >
                        <span className="amlr-type-e">{m.emoji}</span>
                        <span>{m.label}</span>
                      </button>
                    )
                  })}
                </div>
              )}

              <textarea
                className="amlr-ta"
                value={message}
                onChange={(e) => { setMessage(e.target.value); if (error) setError(null) }}
                placeholder={TYPE_META[type]?.hint || 'Ton message…'}
                rows={4}
                autoFocus
              />

              {error && <div className="amlr-err">{error}</div>}

              <div className="amlr-foot">
                <span className="amlr-page">{typeof window !== 'undefined' ? window.location.pathname : ''}</span>
                <button className="amlr-send" disabled={sending} onClick={submit}>
                  {sending ? 'Envoi…' : 'Envoyer'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}

const WIDGET_CSS = `
.amlr-fab, .amlr-panel, .amlr-fab * , .amlr-panel * { box-sizing: border-box; }
.amlr-fab {
  position: fixed; bottom: 20px; z-index: 2147483000;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 10px 14px; border-radius: 999px; cursor: pointer;
  font: 500 13px/1 ui-sans-serif, system-ui, sans-serif; color: #e8eef6;
  background: rgba(14,19,28,0.82); backdrop-filter: blur(10px);
  border: 1px solid rgba(255,255,255,0.12);
  box-shadow: 0 6px 22px -8px rgba(0,0,0,0.7);
  transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease;
}
.amlr-fab:hover {
  transform: translateY(-2px);
  border-color: var(--amlr-accent);
  box-shadow: 0 10px 28px -10px rgba(0,0,0,0.75), 0 0 16px -4px var(--amlr-accent);
}
.amlr-fab-ico { font-size: 15px; }
.amlr-fab-label { white-space: nowrap; }

.amlr-panel {
  position: fixed; bottom: 20px; z-index: 2147483000;
  width: min(340px, calc(100vw - 32px));
  background: rgba(12,17,25,0.94); backdrop-filter: blur(16px);
  border: 1px solid rgba(255,255,255,0.1);
  border-top: 2px solid var(--amlr-accent);
  border-radius: 14px; overflow: hidden;
  box-shadow: 0 24px 60px -24px rgba(0,0,0,0.85);
  font-family: ui-sans-serif, system-ui, sans-serif; color: #e8eef6;
  animation: amlr-in .22s cubic-bezier(.2,.7,.2,1);
}
@keyframes amlr-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
.amlr-head { display: flex; align-items: center; justify-content: space-between; padding: 13px 14px; border-bottom: 1px solid rgba(255,255,255,0.07); }
.amlr-head-t { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 14px; }
.amlr-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--amlr-accent); box-shadow: 0 0 8px var(--amlr-accent); }
.amlr-x { background: none; border: none; color: #7d8590; cursor: pointer; font-size: 14px; padding: 2px 4px; }
.amlr-x:hover { color: #e8eef6; }
.amlr-body { padding: 14px; }
.amlr-types { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-bottom: 11px; }
.amlr-type {
  display: flex; align-items: center; gap: 7px; padding: 9px 10px; cursor: pointer;
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.09);
  border-radius: 9px; color: #c4cad4; font-size: 12.5px; transition: all .14s ease;
}
.amlr-type:hover { border-color: rgba(255,255,255,0.2); color: #e8eef6; }
.amlr-type-on { border-color: var(--amlr-accent); color: #fff; background: color-mix(in srgb, var(--amlr-accent) 14%, transparent); }
.amlr-type-e { font-size: 14px; }
.amlr-ta {
  width: 100%; resize: vertical; min-height: 78px; padding: 10px;
  background: rgba(0,0,0,0.32); border: 1px solid rgba(255,255,255,0.1); border-radius: 9px;
  color: #e8eef6; font: 400 13px/1.5 ui-sans-serif, system-ui, sans-serif; outline: none;
}
.amlr-ta:focus { border-color: var(--amlr-accent); }
.amlr-ta::placeholder { color: #5f7186; }
.amlr-err { color: #ff8b84; font-size: 12px; margin-top: 8px; }
.amlr-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 11px; }
.amlr-page { font: 400 10.5px/1 ui-monospace, monospace; color: #5f7186; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 150px; }
.amlr-send {
  padding: 9px 16px; border-radius: 8px; cursor: pointer; border: none;
  background: var(--amlr-accent); color: #10130a; font-weight: 600; font-size: 13px;
  transition: filter .15s ease;
}
.amlr-send:hover { filter: brightness(1.08); }
.amlr-send:disabled { opacity: 0.6; cursor: default; }
.amlr-done { padding: 26px 18px; text-align: center; }
.amlr-check {
  width: 44px; height: 44px; margin: 0 auto 12px; border-radius: 50%;
  display: grid; place-items: center; font-size: 22px; color: #10130a;
  background: var(--amlr-accent); box-shadow: 0 0 22px -4px var(--amlr-accent);
  animation: amlr-pop .3s cubic-bezier(.2,.9,.3,1.3);
}
@keyframes amlr-pop { from { transform: scale(0.5); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.amlr-done p { margin: 0 0 4px; font-weight: 600; font-size: 14px; }
.amlr-done span { font-size: 12px; color: #7d8590; }
`
