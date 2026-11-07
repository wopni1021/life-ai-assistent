/*
 * Opens the app from the phone at once, then refreshes the saved files in the background,
 * so a published update appears on the next open. Task data is never cached here.
 */
var VERSION = 'todo-v2';
var SHELL = ['./', 'index.html', 'style.css', 'parser.js', 'todo.js', 'mock.js', 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(SHELL); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('todo-') === 0 && k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }));
  self.clients.claim();
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(function (c) {
    return c.match(e.request, { ignoreSearch: true }).then(function (hit) {
      var fresh = fetch(e.request).then(function (res) {
        if (res.ok) c.put(e.request, res.clone());
        return res;
      });
      if (hit) {
        e.waitUntil(fresh.catch(function () {}));
        return hit;
      }
      return fresh;
    });
  }));
});
