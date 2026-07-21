const CACHE_NAME = 'maximus-licitacoes-shell-v11';
const MODEL_CACHE_PREFIX = 'maximus-licitacoes-gemma3-uint8-9909734-cache';
const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './app-config.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(key =>
          key.startsWith('maximus-licitacoes-shell-') &&
          key !== CACHE_NAME &&
          !key.startsWith(MODEL_CACHE_PREFIX)
        )
        .map(key => caches.delete(key)),
    );
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  try {
    const response = await fetch(request, {cache: 'no-store'});
    if (response.ok) {
      const copy = response.clone();
      await caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') return caches.match('./index.html');
    throw error;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const copy = response.clone();
    await caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
  }
  return response;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.headers.has('range')) return;

  // O catálogo grande não é duplicado no cache do shell. Ele só é carregado
  // quando o manifesto publicado indica uma nova versão.
  if (url.pathname.endsWith('/data/licitacoes.zip')) return;

  if (
    request.mode === 'navigate' ||
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'worker' ||
    url.pathname.includes('/assets/') ||
    url.pathname.endsWith('/app-config.json') ||
    url.pathname.endsWith('/data/licitacoes-source.json') ||
    url.pathname.endsWith('/manifest.webmanifest') ||
    url.pathname.endsWith('/sw.js')
  ) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});
