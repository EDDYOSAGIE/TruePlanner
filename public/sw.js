self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    // DevTools' manual "Push" test button (and any malformed payload)
    // sends plain text, not JSON — fall back instead of dying silently.
    const raw = event.data ? event.data.text() : '';
    data = { title: 'Check-in', body: raw || 'A check-in arrived, but could not be read.' };
  }

  const options = data.options || [];

  const notificationOptions = {
    body: data.body || '',
    icon: '/icon.png',
    badge: '/icon.png',
    tag: data.taskId ? `checkin-${data.taskId}` : 'checkin-general',
    data: { taskId: data.taskId, options },
    // Most browsers cap visible actions at 2; the third option (if any)
    // is still available inside the app when the notification body is tapped.
    actions: options.slice(0, 2).map((o) => ({ action: o.action, title: o.label }))
  };

  event.waitUntil(self.registration.showNotification(data.title || 'Check-in', notificationOptions));
});

self.addEventListener('notificationclick', (event) => {
  const { taskId } = event.notification.data || {};
  const action = event.action; // '' if the body itself was clicked

  event.notification.close();

  if (!taskId) {
    event.waitUntil(clients.openWindow('/'));
    return;
  }

  if (action === 'skip' || action === 'shrink' || action === 'reschedule') {
    event.waitUntil(
      fetch(`/api/tasks/${taskId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      })
    );
  } else {
    // Body click with no specific action — open the app so the user
    // can pick from all three options, including "move it" with a time.
    event.waitUntil(clients.openWindow('/'));
  }
});
