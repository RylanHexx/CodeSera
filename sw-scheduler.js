/* ═══════════════════════════════════════════════════════════
   CodeSera — sw-scheduler.js
   Service Worker for background scheduler notifications.
   Works even when the LearnForge tab is closed.
═══════════════════════════════════════════════════════════ */

const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
let _schedule  = null;
let _checkTimer = null;

self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Receive schedule from app
self.addEventListener('message', e => {
  if (e.data?.type === 'SET_SCHEDULE') {
    _schedule = e.data.schedule;
    startChecking();
  }
});

function startChecking() {
  if (_checkTimer) clearInterval(_checkTimer);
  _checkTimer = setInterval(checkTime, 60000);
  checkTime(); // check immediately
}

function checkTime() {
  if (!_schedule?.time || !_schedule?.days?.length) return;
  const now  = new Date();
  const day  = DAYS[now.getDay()];
  const [h, m] = _schedule.time.split(':').map(Number);

  if (now.getHours() === h && now.getMinutes() === m && _schedule.days.includes(day)) {
    self.registration.showNotification('CodeSera — Time to learn! 📘', {
      body:  'Your scheduled learning session is ready. Tap to open CodeSera.',
      icon:  '/favicon.ico',
      badge: '/favicon.ico',
      tag:   'learnforge-schedule', // prevents duplicate notifications
      renotify: false,
      data:  { url: '/' },
    });
  }
}

// Open app when notification is clicked
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      // Focus existing tab if open
      for (const client of clients) {
        if (client.url.includes(self.registration.scope) && 'focus' in client) {
          return client.focus();
        }
      }
      // Open new tab
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});
