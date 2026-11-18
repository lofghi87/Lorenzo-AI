const CACHE_NAME = 'vault-shell-v1';
const APP_SHELL = ['/', '/vault-logo.svg', '/favicon.svg', '/vault-app-icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('vault-shell-') && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(response => {
        if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put('/', response.clone()));
        return response;
      }).catch(() => caches.match('/'))
    );
    return;
  }

  const isStaticAsset = url.pathname.startsWith('/assets/') ||
    ['/vault-logo.svg', '/favicon.svg', '/vault-app-icon.svg', '/manifest.webmanifest'].includes(url.pathname);
  if (!isStaticAsset) return;

  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request).then(response => {
        if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
        return response;
      });
      return cached || network;
    })
  );
});