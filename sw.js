/* Offline cache for the Thousand web app */
var CACHE = 'thousand-v4';
var FILES = ['./', './index.html', './style.css', './engine.js', './app.js', './manifest.webmanifest',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
  './cards/back.jpg',
  './cards/9S.jpg', './cards/10S.jpg', './cards/JS.jpg', './cards/QS.jpg', './cards/KS.jpg', './cards/AS.jpg',
  './cards/9C.jpg', './cards/10C.jpg', './cards/JC.jpg', './cards/QC.jpg', './cards/KC.jpg', './cards/AC.jpg',
  './cards/9D.jpg', './cards/10D.jpg', './cards/JD.jpg', './cards/QD.jpg', './cards/KD.jpg', './cards/AD.jpg',
  './cards/9H.jpg', './cards/10H.jpg', './cards/JH.jpg', './cards/QH.jpg', './cards/KH.jpg', './cards/AH.jpg'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(function (r) {
      var copy = r.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      return r;
    }).catch(function () { return caches.match(e.request, { ignoreSearch: true }); })
  );
});
