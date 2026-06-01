# ScrobblerVari — Plan de développement

**Stack :** React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui  
**Port :** 3006 par défaut (configurable via `PORT=` dans `.env.local`) · pas de backend dédié (appels directs Last.fm API)  
**API :** Last.fm API (clé publique + secret)

---

## Phase 0 — Bootstrap du projet

### Étapes
- [x] `npm create vite@latest scrobblervari -- --template react-ts`
- [x] Installer Tailwind CSS, shadcn/ui, react-router-dom, react-query
- [x] Configurer Vite sur le port 3005 via `vite.config.ts`
- [x] Ajouter `.env.local.example` avec `VITE_LASTFM_API_KEY` et `VITE_LASTFM_SECRET`

### Critères d'acceptance
- [x] `npm run dev` démarre sur http://localhost:3005 sans erreur
- [x] Page avec header "ScrobblerVari"

---

## Phase 1 — Connexion Last.fm

### Étapes
- [x] Créer un service `lastfm.ts` qui encapsule tous les appels API
- [x] Implémenter le flux d'authentification Last.fm (Web Auth flow) :
  - Redirection vers `https://www.last.fm/api/auth/` avec `api_key`
  - Récupération du `token` en callback
  - Échange `token` → `session key` via `auth.getSession`
- [x] Stocker `session_key` + `username` dans `localStorage`
- [x] Page de connexion avec bouton "Se connecter avec Last.fm"
- [x] Afficher avatar + nom d'utilisateur une fois connecté
- [x] Bouton de déconnexion

### Critères d'acceptance
- [x] Un utilisateur peut se connecter avec son compte Last.fm réel
- [x] Le `session_key` persiste après rechargement de page
- [x] Un utilisateur non connecté est redirigé vers la page de connexion
- [x] Le nom d'utilisateur et le nombre de scrobbles sont affichés dans le header

---

## Phase 2 — Module Clean 🧹

### Objectif
Nettoyer l'historique Last.fm : supprimer des scrobbles indésirables (binaural, doublons, artistes à retirer).

### Étapes
- [ ] Appel `user.getRecentTracks` pour charger les scrobbles récents (pagination)
- [ ] Afficher la liste avec : pochette · artiste · titre · date
- [ ] Filtres :
  - Recherche texte libre (artiste, titre)
  - Filtre par artiste
  - Filtre "binaural" (mots-clés : binaural, sleep, frequencies, hz)
- [ ] Sélection multiple (checkbox par ligne + "tout sélectionner")
- [ ] Bouton "Supprimer la sélection" → appel `track.unlove` + `track.scrobble` (Last.fm n'a pas d'API delete directe — voir note)
- [ ] Confirmation avant suppression batch
- [ ] Toast de succès/échec par opération

> **Note technique Last.fm :** L'API Last.fm ne propose pas `track.delete`. La suppression passe par le site web. Le module Clean utilisera `track.unlove` pour les "loved" tracks et documentera la limitation pour la suppression réelle (qui nécessite un scraping ou une extension navigateur).

### Critères d'acceptance
- [ ] Les 200 derniers scrobbles s'affichent avec pagination
- [ ] La recherche filtre en temps réel sans nouvel appel API
- [ ] La sélection multiple fonctionne (checkbox + shift+click)
- [ ] L'action "unlove" est bien envoyée à Last.fm et confirmée visuellement
- [ ] Un message d'information explique la limitation de suppression de l'API

---

## Phase 3 — Module Écoute CD/Vinyle 💿

### Objectif
Scrobbler un album physique (CD ou vinyle) avec un timing × 1.5.

### Étapes
- [ ] Recherche d'album via `album.search` Last.fm API (nom + artiste)
- [ ] Afficher les résultats : pochette · titre · artiste · nb de pistes
- [ ] Sélectionner un album → charger les pistes via `album.getInfo`
- [ ] Afficher la liste des pistes avec durée
- [ ] Champ "Date/heure de début d'écoute" (par défaut : maintenant)
- [ ] Calculer les timestamps avec facteur × 1.5 sur les durées
- [ ] Bouton "Scrobbler cet album" → appels `track.scrobble` batch
- [ ] Résumé post-scrobble : X pistes scrobblées, timestamps affichés

### Critères d'acceptance
- [ ] La recherche d'album retourne des résultats en < 2s
- [ ] Les pistes sont listées avec leurs durées
- [ ] Les timestamps calculés respectent bien le facteur × 1.5
- [ ] Le scrobble batch réussit pour un album de 12 pistes
- [ ] Un log des scrobbles envoyés est affiché après confirmation
- [ ] Limite API Last.fm respectée (max 50 scrobbles par appel batch)

---

## Phase 4 — Module Stats 📊

### Objectif
Visualiser ses statistiques d'écoute Last.fm.

### Étapes
- [ ] Vue "Top Artistes" : `user.getTopArtists` (semaine / mois / 6 mois / an / all time)
- [ ] Vue "Top Albums" : `user.getTopAlbums`
- [ ] Vue "Top Tracks" : `user.getTopTracks`
- [ ] Graphique "Scrobbles par jour" : `user.getRecentTracks` aggrégé (7 derniers jours)
- [ ] Carte "Aujourd'hui" : scrobbles du jour en cours
- [ ] Sélecteur de période (tabs : 7j / 1m / 3m / 6m / 1an / tout)

### Critères d'acceptance
- [ ] Les top artistes/albums/tracks s'affichent avec pochette et play count
- [ ] Le graphique journalier affiche correctement 7 barres
- [ ] Le changement de période recharge les données sans bug visuel
- [ ] Les données sont mises en cache (react-query, stale 5 min) pour éviter les appels répétitifs

---

## Phase 5 — Navigation & Layout global

### Étapes
- [ ] Layout principal avec sidebar ou bottom nav (3 sections : Clean / CD-Vinyle / Stats)
- [ ] Header fixe avec : logo · username Last.fm · avatar · déconnexion
- [ ] Page 404 / fallback
- [ ] État de chargement global (skeleton / spinner)
- [ ] Gestion des erreurs API (token expiré, rate limit, réseau)

### Critères d'acceptance
- [ ] Navigation entre les 3 modules sans rechargement de page
- [ ] L'utilisateur non connecté ne peut accéder à aucun module
- [ ] Les erreurs API affichent un message lisible (pas de stack trace)
- [ ] Responsive : utilisable sur mobile (375px) et desktop (1280px)

---

## Backlog / Plus tard

- [ ] Bibliothèque CD/Vinyle locale (catalogue personnel)
- [ ] Module Radio (scraping du titre en cours diffusé)
- [ ] Export CSV de l'historique de scrobbles
- [ ] Mode sombre / clair

---

## Ordre d'implémentation recommandé

```
Phase 0 → Phase 1 → Phase 5 (layout) → Phase 3 (CD/Vinyle) → Phase 4 (Stats) → Phase 2 (Clean)
```

Le module CD/Vinyle avant Stats car il génère de la valeur immédiate (le cas d'usage principal).  
Clean en dernier car les limitations API Last.fm réduisent son impact.
