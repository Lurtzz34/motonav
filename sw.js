// MotoNav service worker — bump VERSION on every release so phones pick up the update.
const VERSION = '1.5.2';
const SHELL_CACHE = 'motonav-shell-' + VERSION;
const TILE_CACHE = 'motonav-tiles';
const TILE_LIMIT = 3000;
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './icon-180.png', './icon-192.png', './icon-512.png',
  'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js',
  'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c =>
    Promise.all(SHELL.map(u => c.add(u).catch(() => null)))));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('motonav-shell-') && k !== SHELL_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => { if(e.data === 'skipWaiting') self.skipWaiting(); });

let puts = 0;
async function trimTiles(){
  const c = await caches.open(TILE_CACHE);
  const keys = await c.keys();
  if(keys.length > TILE_LIMIT) await Promise.all(keys.slice(0, keys.length - TILE_LIMIT).map(k => c.delete(k)));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);

  // App page: network first so updates arrive immediately, cache as offline fallback
  // App page: network first so updates arrive immediately; after 4 s on a weak signal use the saved copy
  if(req.mode === 'navigate'){
    e.respondWith((async () => {
      const cached = (await caches.match('./index.html')) || (await caches.match('./'));
      const net = fetch(req).then(async res => {
        if(res.ok){ const c = await caches.open(SHELL_CACHE); await c.put('./index.html', res.clone()); }
        return res;
      });
      if(!cached) return net.catch(() => Response.error());
      const timeout = new Promise(r => setTimeout(() => r(null), 4000));
      try{ return (await Promise.race([net, timeout])) || cached; }
      catch(err){ return cached; }
    })());
    return;
  }

  // Map tiles, style, fonts: show cached instantly, refresh in background
  if(url.hostname === 'tiles.openfreemap.org'){
    e.respondWith((async () => {
      const c = await caches.open(TILE_CACHE);
      const hit = await c.match(req);
      const net = fetch(req).then(res => {
        if(res.ok){ c.put(req, res.clone()); if(++puts % 100 === 0) trimTiles(); }
        return res;
      }).catch(() => hit);
      return hit || net;
    })());
    return;
  }

  // App shell & map library: cache first
  if((url.origin === self.location.origin && !url.pathname.endsWith('sw.js')) || url.hostname === 'unpkg.com' || url.hostname.endsWith('gstatic.com') || url.hostname === 'fonts.googleapis.com'){
    e.respondWith((async () => {
      const hit = await caches.match(req);
      if(hit) return hit;
      const res = await fetch(req);
      if(res.ok || res.type === 'opaque'){ const c = await caches.open(SHELL_CACHE); c.put(req, res.clone()); }
      return res;
    })());
  }
  // Everything else (search, routing) goes straight to the network.
});
