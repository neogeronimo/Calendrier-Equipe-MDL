const CACHE='calendrier-mdl-v112';
const ASSETS=['./','./index.html','./styles.css?v=112','./app.js?v=112','./config.js','./manifest.webmanifest?v=112','./icons/icon-192.png','./icons/icon-512.png'];

self.addEventListener('install',event=>{
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS).catch(()=>{})));
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  event.respondWith(
    fetch(event.request).then(response=>{
      const copy=response.clone();
      caches.open(CACHE).then(c=>c.put(event.request,copy));
      return response;
    }).catch(()=>caches.match(event.request).then(r=>r||caches.match('./index.html')))
  );
});

self.addEventListener('push',event=>{
  let data={title:'Calendrier Équipe MDL',body:'Nouveau rappel',url:'./'};
  try{
    if(event.data){
      const raw=event.data.text();
      if(raw)data={...data,...JSON.parse(raw)};
    }
  }catch(err){
    console.error('Payload push illisible',err);
  }

  const icon=new URL('./icons/icon-192.png',self.registration.scope).href;
  const badge=new URL('./icons/icon-192.png',self.registration.scope).href;
  event.waitUntil(
    self.registration.showNotification(data.title||'Calendrier Équipe MDL',{
      body:data.body||'Nouveau rappel',
      icon,
      badge,
      tag:data.event_id?`mdl-event-${data.event_id}`:`mdl-push-${Date.now()}`,
      renotify:true,
      requireInteraction:false,
      vibrate:[250,120,250],
      data:{url:data.url||'./',event_id:data.event_id||null}
    })
  );
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=new URL(event.notification.data?.url||'./',self.registration.scope).href;
  event.waitUntil(
    clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
      for(const client of list){
        if('focus' in client){client.navigate(target);return client.focus();}
      }
      if(clients.openWindow)return clients.openWindow(target);
    })
  );
});
