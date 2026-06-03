# ScrobblerVari — Specs techniques, UI/UX & fonctionnelles

> Webapp **Last.fm** : connexion au compte, nettoyage de l'historique, scrobble d'albums physiques (CD/Vinyle) avec timing × 1.5, et statistiques d'écoute.

**Date de rédaction :** 2026-06-03
**Statut :** En développement (Phases 0 & 1 faites ; modules Clean / CD-Vinyle / Stats en cours)
**Stack :** React 18 + TypeScript + Vite · Tailwind CSS + shadcn/ui · React Router · React Query · **pas de backend dédié** (appels directs Last.fm API)
**Port :** 3006/3007 (configurable via `PORT=` dans `.env.local`)

---

## 1. Contexte & Problème

Last.fm est excellent pour tracker ses écoutes, mais : (1) son historique se pollue (binaural, doublons, artistes parasites), (2) il ignore l'écoute **physique** (CD/Vinyle), (3) son UI de stats est limitée. **ScrobblerVari** comble ces trois manques dans une seule webapp connectée au compte Last.fm réel.

Cas d'usage signature : **scrobbler un album CD/Vinyle** avec un facteur de timing × 1.5 (étalement réaliste des timestamps).

---

## 2. Architecture

```
scrobblervari/
  src/
    services/lastfm.ts   → encapsule TOUS les appels Last.fm (auth, scrobble, stats…)
    pages/               → Clean, CD-Vinyle, Stats, Login
    components/          → layout (sidebar/bottom-nav), cartes, listes
    ...
```

- **Sans serveur** : la webapp appelle directement l'API Last.fm depuis le navigateur.
- **Auth** : Web Auth flow Last.fm (token → session key), `session_key` + `username` persistés en `localStorage`.
- **Cache** : React Query (stale 5 min) pour limiter les appels répétés.

```env
VITE_LASTFM_API_KEY=
VITE_LASTFM_SECRET=
# intégration future Ameliorator
VITE_AMELIORATOR_API_KEY=
VITE_AMELIORATOR_URL=http://localhost:3010
```

---

## 3. Specs fonctionnelles

### 3.1 Connexion Last.fm ✅
- [x] Flux d'auth Last.fm (redirection `last.fm/api/auth` → callback token → `auth.getSession`)
- [x] `session_key` + `username` persistés (survivent au reload)
- [x] Avatar + username + nombre de scrobbles dans le header
- [x] Déconnexion ; un utilisateur non connecté est redirigé vers Login

### 3.2 Module Écoute CD/Vinyle 💿 (cas d'usage principal)
- [ ] Recherche d'album (`album.search`) → pochette · titre · artiste · nb pistes
- [ ] Sélection → chargement des pistes (`album.getInfo`) avec durées
- [ ] Champ « date/heure de début d'écoute » (défaut : maintenant)
- [ ] Calcul des timestamps avec **facteur × 1.5** sur les durées
- [ ] Scrobble batch (`track.scrobble`) — **max 50 scrobbles / appel** (limite API)
- [ ] Résumé post-scrobble (X pistes, timestamps affichés)

**Critères :** recherche < 2 s · timestamps respectant × 1.5 · succès sur un album de 12 pistes · log des scrobbles envoyés.

### 3.3 Module Stats 📊
- [ ] Top Artistes / Albums / Tracks (`user.getTop*`) avec sélecteur de période (7j / 1m / 3m / 6m / 1an / all)
- [ ] Graphique « scrobbles par jour » (7 derniers jours, agrégé depuis `user.getRecentTracks`)
- [ ] Carte « Aujourd'hui »
- [ ] Données mises en cache (React Query, stale 5 min)

### 3.4 Module Clean 🧹
- [ ] Chargement des scrobbles récents (`user.getRecentTracks`, paginé)
- [ ] Filtres : recherche libre, par artiste, **filtre binaural** (mots-clés : binaural, sleep, frequencies, hz)
- [ ] Sélection multiple (checkbox + shift+click + « tout sélectionner »)
- [ ] Action de suppression batch + confirmation, toast succès/échec

> **Limitation API Last.fm :** pas de `track.delete`. Le module utilise `track.unlove` et **documente clairement** que la suppression réelle nécessite le site web / une extension navigateur (scraping). Clean est donc implémenté **en dernier** (impact réduit par l'API).

---

## 4. UI / UX

- **Layout global** : sidebar (desktop) / bottom-nav (mobile) à 3 sections — **Clean / CD-Vinyle / Stats**.
- **Header fixe** : logo · username Last.fm · avatar · déconnexion.
- **Design** : Tailwind + **shadcn/ui** ; états de chargement (skeleton/spinner), page 404/fallback.
- **Gestion d'erreurs API** : token expiré, rate limit, réseau → message lisible (jamais de stack trace).
- **Responsive** : utilisable mobile (375px) et desktop (1280px), navigation sans rechargement.

---

## 5. Ordre d'implémentation recommandé

```
Phase 0 (bootstrap) → Phase 1 (auth) → Layout global
→ CD/Vinyle (valeur immédiate) → Stats → Clean (limité par l'API)
```

---

## 6. Backlog / Hors scope

- Bibliothèque CD/Vinyle locale (catalogue personnel)
- Module **Radio** (scraping du titre en cours diffusé)
- Export CSV de l'historique
- Mode sombre / clair
- Intégration du `FeedbackWidget` **Ameliorator** (ScrobblerVari = première app branchée du portfolio)
