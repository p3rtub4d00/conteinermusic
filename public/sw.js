const CACHE_NAME = 'admin-conteiner-v1';
const urlsToCache = [
  '/admin.html',
  '/css/admin.css',
  '/js/admin.js',
  '/images/icone.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});
