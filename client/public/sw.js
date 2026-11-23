/*
 * Service worker do VÉU.
 * - Guarda a "casca" do app (HTML, JS, CSS, ícones) para abrir rápido e
 *   funcionar como aplicativo instalado (PWA / APK via PWABuilder).
 * - Estratégia "rede primeiro": sempre tenta a versão mais nova do servidor e
 *   só usa o cache quando estiver sem internet.
 * - Nunca guarda a API (/api) nem o WebSocket (/ws): o jogo é online.
 */
const CACHE = 'veu-shell-v1';
const SHELL = ['/', '/index.html', '/app.js', '/styles.css', '/manifest.webmanifest', '/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/ws') return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req.mode === 'navigate' ? '/index.html' : req, copy));
        }
        return res;
      })
      .catch(async () => (await caches.match(req.mode === 'navigate' ? '/index.html' : req)) ?? new Response('Sem conexão com o servidor do VÉU.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })),
  );
});
