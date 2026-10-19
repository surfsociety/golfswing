// Offline-Cache: App-Dateien und Pose-Modell werden beim ersten Besuch gespeichert.
const CACHE = 'golf-swing-v2';
const ASSETS = [
  './', './index.html', './styles.css', './app.js', './analysis.js', './patterns.js', './storage.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  './vendor/mediapipe/vision_bundle.mjs',
  './vendor/mediapipe/wasm/vision_wasm_internal.js', './vendor/mediapipe/wasm/vision_wasm_internal.wasm',
  './models/pose_landmarker_full.task',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    })),
  );
});
