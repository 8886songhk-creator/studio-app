const CACHE_NAME = 'studio-pwa-v97';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './cloud-bridge.js',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 외부 TTS 오디오 스트림 · 클라우드 서버 통신 · Range 요청은 가로채지 않고 즉시 통과
  if (
    req.method !== 'GET' ||
    req.headers.has('range') ||
    url.origin !== self.location.origin
  ) {
    return;
  }

  // 내부 파일은 항상 최신 서버본 우선(Network-First), 오프라인 시에만 캐시 사용
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req))
  );
});
