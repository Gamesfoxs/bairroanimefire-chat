const CACHE = 'baf-chat-v7-20261114v6';
const ASSETS = ['/', '/index.html', '/css/style.css?v=20261114v6',
  '/js/app.js?v=20261114v6', '/manifest.json',
  '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))
  ).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin ||
      url.pathname.startsWith('/api') || url.pathname.startsWith('/auth') ||
      url.pathname.startsWith('/socket.io')) return;
  // Prefer the network to avoid stale login pages and frontends after release.
  event.respondWith(fetch(request).then(response => {
    if (response.ok && response.type === 'basic') {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy)));
    }
    return response;
  }).catch(async () => (await caches.match(request)) || (await caches.match('/'))));
});
