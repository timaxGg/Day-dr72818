/* Offline-Hülle der Day-Trader-App. Kurse und Signale kommen immer frisch aus dem Netz. */
const V="dt-v7",HUELLE=["./","./index.html","./style.css","./app.js","./kern.js","./manifest.webmanifest","./icon-192.png","./icon-512.png","./apple-touch-icon.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(HUELLE)));self.skipWaiting()});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x.startsWith("dt-")&&x!==V).map(x=>caches.delete(x)))));self.clients.claim()});
self.addEventListener("fetch",e=>{const u=new URL(e.request.url);if(u.origin!==location.origin||!u.href.startsWith(self.registration.scope))return;
  e.respondWith(fetch(e.request,{cache:"no-cache"}).then(r=>{const c=r.clone();caches.open(V).then(x=>x.put(e.request,c));return r}).catch(()=>caches.match(e.request)))});
