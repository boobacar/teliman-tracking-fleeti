// Service Worker — Teliman Logistique
// Stratégie : Cache-First pour assets statiques, Network-First pour API

const CACHE_STATIC = 'teliman-static-v1'
const CACHE_API = 'teliman-api-v1'
const CACHE_IMAGES = 'teliman-images-v1'

const STATIC_EXTENSIONS = /\.(js|css|svg|png|jpg|jpeg|webp|ico|woff2?|json)$/

// ── Installation : pré-cache l'app shell ──
self.addEventListener('install', (event) => {
  console.log('[SW] Install')
  self.skipWaiting()
})

// ── Activation : nettoie les vieux caches ──
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate')
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_STATIC && k !== CACHE_API && k !== CACHE_IMAGES).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

// ── Stratégie de fetch ──
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Ne pas intercepter les requêtes non-GET
  if (request.method !== 'GET') return

  // Les API de production sont servies par un autre domaine (Tailscale Funnel).
  // Laisser le navigateur gérer directement ces requêtes afin de préserver CORS
  // et d'éviter qu'une erreur du service worker ne transforme une API disponible
  // en faux statut « Hors ligne ».
  if (url.origin !== self.location.origin) return

  // API : network-first avec cache fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request, CACHE_API))
    return
  }

  // Images et uploads : cache-first
  if (url.pathname.startsWith('/uploads/') || request.destination === 'image') {
    event.respondWith(cacheFirst(request, CACHE_IMAGES))
    return
  }

  // Assets statiques : cache-first
  if (STATIC_EXTENSIONS.test(url.pathname) || request.destination === 'style' || request.destination === 'script') {
    event.respondWith(cacheFirst(request, CACHE_STATIC))
    return
  }

  // Navigation / SPA fallback : network-first
  event.respondWith(networkFirst(request, CACHE_STATIC))
})

// ── Cache-First : sert depuis le cache, sinon réseau ──
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request)
  if (cached) return cached
  try {
    const response = await fetch(request)
    if (response.ok) {
      const clone = response.clone()
      const cache = await caches.open(cacheName)
      cache.put(request, clone)
    }
    return response
  } catch (err) {
    // Offline fallback pour les pages : renvoyer index.html
    if (request.destination === 'document' || request.mode === 'navigate') {
      const cachedIndex = await caches.match('/')
      if (cachedIndex) return cachedIndex
    }
    return new Response('Hors ligne', { status: 503, statusText: 'Service Unavailable' })
  }
}

// ── Network-First : réseau d'abord, cache en fallback ──
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request)
    if (response.ok && response.status !== 206) {
      const clone = response.clone()
      const cache = await caches.open(cacheName)
      cache.put(request, clone)
    }
    return response
  } catch (err) {
    const cached = await caches.match(request)
    if (cached) return cached
    // Pour les API, renvoyer une erreur JSON
    if (request.url.includes('/api/')) {
      return new Response(JSON.stringify({ ok: false, error: 'Hors ligne. Les données seront actualisées à la reconnexion.' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response('Hors ligne', { status: 503 })
  }
}
