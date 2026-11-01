// Service Worker for PDFForge LibreOffice WASM offline caching
// CAUTION: Cache ONLY engine + font assets. NEVER cache user files.

const CACHE_NAME = 'pdfforge-libreoffice-wasm-v1';

const ENGINE_ASSETS = [
  '/wasm/soffice.js',
  '/wasm/soffice.wasm',
  '/wasm/soffice.data',
  '/wasm/soffice.worker.js',
  '/dist/browser.worker.js',
  '/dist/browser.worker.global.js',
  '/assets/fonts-core.zip',
  '/assets/fonts-cjk-min.zip',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Strictly only intercept known engine and font assets
  const isEngineAsset = ENGINE_ASSETS.some((asset) => url.pathname.endsWith(asset));

  if (!isEngineAsset) {
    // Standard bypass for all other requests (especially user files / API)
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cachedResponse = await cache.match(event.request);
      if (cachedResponse) {
        return cachedResponse;
      }
      const networkResponse = await fetch(event.request);
      if (networkResponse && networkResponse.status === 200) {
        cache.put(event.request, networkResponse.clone());
      }
      return networkResponse;
    })
  );
});
