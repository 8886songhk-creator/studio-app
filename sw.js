const CACHE_NAME = 'magyo-studio-cloud-shell-v1';
const SHELL_ASSETS = ['./', './index.html', './cloud-bridge.js', './manifest.json'];
const DB_NAME = 'magyo_cloud_boot_db';
const STORE_NAME = 'kv';

function readFromIDB(key) {
return new Promise((resolve) => {
try {
const req = indexedDB.open(DB_NAME, 1);
req.onupgradeneeded = (e) => {
const db = e.target.result;
if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
};
req.onsuccess = (e) => {
try {
const db = e.target.result;
const tx = db.transaction(STORE_NAME, 'readonly');
const g = tx.objectStore(STORE_NAME).get(key);
g.onsuccess = () => { const v = g.result || null; db.close(); resolve(v); };
g.onerror = () => { db.close(); resolve(null); };
} catch (err) { resolve(null); }
};
req.onerror = () => resolve(null);
} catch (err) { resolve(null); }
});
}

function injectBridgeIntoStudioHtml(rawHtml) {
let html = String(rawHtml || '');
if (!html.includes('manifest.json')) {
const pwaTags = '\n<link rel="manifest" href="./manifest.json">\n<meta name="theme-color" content="#0b1120">\n';
const headIdx = html.toLowerCase().indexOf('</head>');
html = headIdx !== -1 ? html.slice(0, headIdx) + pwaTags + html.slice(headIdx) : pwaTags + html;
}
if (!html.includes('cloud-bridge.js')) {
const bridgeTag = '\n<script src="./cloud-bridge.js"></script>\n';
const lastBodyIdx = html.toLowerCase().lastIndexOf('</body>');
html = lastBodyIdx !== -1 ? html.slice(0, lastBodyIdx) + bridgeTag + html.slice(lastBodyIdx) : html + bridgeTag;
}
return html;
}

self.addEventListener('install', (event) => {
event.waitUntil(
caches.open(CACHE_NAME).then((c) => c.addAll(SHELL_ASSETS)).catch(() => {}).then(() => self.skipWaiting())
);
});

self.addEventListener('activate', (event) => {
event.waitUntil(
caches.keys().then((keys) => Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : Promise.resolve()))))
.then(() => self.clients.claim())
);
});

async function networkFirstWithCache(request) {
const cache = await caches.open(CACHE_NAME);
try {
const ctrl = new AbortController();
const timer = setTimeout(() => ctrl.abort(), 3500);
const fresh = await fetch(request, { signal: ctrl.signal, cache: 'no-store' });
clearTimeout(timer);
if (fresh && fresh.ok) {
cache.put(request, fresh.clone()).catch(() => {});
return fresh;
}
} catch (err) {}
const cached = await cache.match(request, { ignoreSearch: true });
return cached || fetch(request);
}

self.addEventListener('fetch', (event) => {
const req = event.request;
if (req.method !== 'GET') return;
const url = new URL(req.url);
if (url.origin !== self.location.origin) return;

if (req.mode === 'navigate') {
event.respondWith((async () => {
if (!url.searchParams.has('launcher') && !url.searchParams.has('reset')) {
const storedHtml = await readFromIDB('active_studio_html');
if (storedHtml && typeof storedHtml === 'string' && storedHtml.length > 500) {
return new Response(injectBridgeIntoStudioHtml(storedHtml), {
status: 200,
headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
});
}
}
return networkFirstWithCache(new Request('./index.html'));
})());
return;
}
event.respondWith(networkFirstWithCache(req));
});