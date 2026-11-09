var V = 'tradein-v1';
var SHELL = ['./', 'index.html', 'config.js', 'parse.js', 'manifest.webmanifest', 'vendor/pdf.min.js', 'vendor/pdf.worker.min.js', 'icon-192.png'];
self.addEventListener('install', function (e) { e.waitUntil(caches.open(V).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); })); });
self.addEventListener('activate', function (e) { e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== V; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); })); });
self.addEventListener('fetch', function (e) {
  var u = new URL(e.request.url);
  if (u.origin !== location.origin) return;           // Drive 請求不經過快取
  e.respondWith(fetch(e.request).then(function (r) {  // 先連網，離線時用快取
    var c = r.clone(); caches.open(V).then(function (ch) { ch.put(e.request, c); }); return r;
  }).catch(function () { return caches.match(e.request); }));
});
