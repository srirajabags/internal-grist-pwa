// Push handling, loaded into the Workbox service worker with importScripts
// (vite.config.js). Kept as a plain script beside the generated worker, so the
// caching and auto-update behaviour stays exactly what vite-plugin-pwa builds.
//
// A message is JSON: { title, body, url, tag }. `tag` makes a newer message
// replace an older one with the same tag instead of stacking up.

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Sri Raja Bags';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      tag: data.tag || undefined,
      renotify: !!data.tag,
      data: { url: data.url || '/' },
    })
  );
});

// Tapping a notification brings the app forward on the page it points at,
// reusing an open window rather than starting a second copy of the app.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Only ever a path inside this app.
  const target = new URL(event.notification.data?.url || '/', self.location.origin);
  if (target.origin !== self.location.origin) target.href = self.location.origin + '/';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.focus();
        if (client.url !== target.href && 'navigate' in client) await client.navigate(target.href);
        return;
      }
    }
    await self.clients.openWindow(target.href);
  })());
});
