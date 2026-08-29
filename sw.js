const CACHE='calendrier-mdl-v110';
const ASSETS=['./','./index.html','./styles.css?v=110','./app.js?v=110','./config.js','./manifest.webmanifest?v=110','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS).catch(()=>{})))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  e.respondWith(fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html'))));
});


self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    clients.matchAll({type:'window',includeUncontrolled:true}).then(list => {
      for (const client of list) {
        if ('focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(target);
    })
  );
});


self.addEventListener('push',event=>{
  let data={title:'Calendrier Équipe MDL',body:'Nouveau rappel',url:'./'};
  try{if(event.data)data={...data,...event.data.json()}}catch{}
  event.waitUntil(self.registration.showNotification(data.title||'Calendrier Équipe MDL',{
    body:data.body||'Nouveau rappel',
    icon:'icons/icon-192.png',
    badge:'icons/icon-192.png',
    tag:data.event_id?`mdl-event-${data.event_id}`:'mdl-push',
    renotify:true,
    vibrate:[200,100,200],
    data:{url:data.url||'./',event_id:data.event_id||null}
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=new URL(event.notification.data?.url||'./',self.location.origin).href;
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
    for(const client of list){if('focus' in client){client.navigate(target);return client.focus()}}
    if(clients.openWindow)return clients.openWindow(target);
  }));
});
