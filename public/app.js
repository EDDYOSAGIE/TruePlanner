function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function initPush() {
  const statusEl = document.getElementById('push-status');

  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    statusEl.textContent = 'Push notifications are not supported in this browser.';
    return;
  }

  const reg = await navigator.serviceWorker.register('/sw.js');
  const existing = await reg.pushManager.getSubscription();

  if (existing) {
    // Re-sync with the server even if the browser already has a
    // subscription — the server's copy may have been reset (a fresh
    // data.json, a redeploy, etc.) independently of the browser.
    await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
      body: JSON.stringify(existing)
    });
    statusEl.textContent = 'Check-ins are enabled.';
    return;
  }

  document.getElementById('enable-push').style.display = 'inline-block';
  document.getElementById('enable-push').addEventListener('click', async () => {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      statusEl.textContent = 'Notifications were not granted.';
      return;
    }

    const { publicKey } = await fetch('/api/vapid-public-key', { credentials: 'include' }).then((r) => r.json());
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });

    await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
      body: JSON.stringify(subscription)
    });

    statusEl.textContent = 'Check-ins are enabled.';
    document.getElementById('enable-push').style.display = 'none';
  });
}

function taskRow(task) {
  const row = document.createElement('div');
  row.className = `task-row status-${task.status}`;

  const time = document.createElement('span');
  time.className = 'task-time';
  const start = new Date(task.start);
  const end = new Date(task.end);
  time.textContent = `${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}–${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

  const title = document.createElement('span');
  title.className = 'task-title';
  title.textContent = task.title;
  if (task.description) title.title = task.description;

  const status = document.createElement('span');
  status.className = 'task-status';
  status.textContent = task.status;

  const doneBtn = document.createElement('button');
  doneBtn.textContent = 'Mark done';
  doneBtn.className = 'task-action';
  doneBtn.addEventListener('click', () => updateTask(task.id, 'done'));

  row.append(time, title, status, doneBtn);
  return row;
}

async function updateTask(id, action) {
  await fetch(`/api/tasks/${id}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ action })
  });
  loadTasks();
}

async function loadTasks() {
  const tasks = await fetch('/api/tasks', { credentials: 'include' }).then((r) => r.json());
  const list = document.getElementById('task-list');
  list.innerHTML = '';
  tasks
    .sort((a, b) => new Date(a.start) - new Date(b.start))
    .forEach((t) => list.appendChild(taskRow(t)));
}

async function loadCheckins() {
  const checkins = await fetch('/api/checkins', { credentials: 'include' }).then((r) => r.json());
  const list = document.getElementById('checkin-list');
  list.innerHTML = '';

  if (checkins.length === 0) {
    list.innerHTML = '<p class="empty">No check-ins yet.</p>';
    return;
  }

  checkins.forEach((c) => {
    const item = document.createElement('div');
    item.className = 'checkin-item';
    const time = new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    item.innerHTML = `<span class="checkin-time">${time}</span><span class="checkin-headline">${c.headline}</span>`;
    list.appendChild(item);
  });
}

function displayTodayDate() {
  const el = document.getElementById('today-date');
  const now = new Date();
  el.textContent = now.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

// Tasks are already scoped to "today" server-side, but if this tab stays
// open past midnight, the page itself doesn't know the day changed until
// something tells it to. Check periodically and reload when the date
// rolls over, so the plan resets clean for the new day automatically.
let currentDateKey = new Date().toISOString().slice(0, 10);
function watchForDayChange() {
  const nowKey = new Date().toISOString().slice(0, 10);
  if (nowKey !== currentDateKey) {
    currentDateKey = nowKey;
    window.location.reload();
  }
}

function todayAt(timeStr) {
  // timeStr is "HH:MM" from <input type="time">. Combine with today's
  // date to make a full ISO datetime the server can compare against now().
  const today = new Date().toISOString().slice(0, 10);
  return new Date(`${today}T${timeStr}:00`).toISOString();
}

document.getElementById('task-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('title').value.trim();
  const description = document.getElementById('description').value.trim();
  const obstacle = document.getElementById('obstacle').value.trim();
  const startRaw = document.getElementById('start').value;
  const endRaw = document.getElementById('end').value;

  if (!title || !startRaw || !endRaw) return;

  await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ title, description, obstacle, start: todayAt(startRaw), end: todayAt(endRaw) })
  });

  e.target.reset();
  loadTasks();
});

document.getElementById('scan-now').addEventListener('click', async () => {
  const btn = document.getElementById('scan-now');
  btn.disabled = true;
  btn.textContent = 'Scanning…';
  await fetch('/api/scan-now', { method: 'POST', credentials: 'include' });
  btn.disabled = false;
  btn.textContent = 'Scan for check-ins now';
  loadTasks();
  loadCheckins();
});

// --- Tab switching ---

function setupTabs() {
  const buttons = document.querySelectorAll('.tab-btn');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      const view = btn.dataset.view;
      document.getElementById('view-today').classList.toggle('hidden', view !== 'today');
      document.getElementById('view-past').classList.toggle('hidden', view !== 'past');

      if (view === 'past') loadPastDays();
    });
  });
}

// --- End-of-day note ---

function todayDateKey() {
  return new Date().toISOString().slice(0, 10);
}

async function loadTodayNote() {
  try {
    const note = await fetch(`/api/notes/${todayDateKey()}`, { credentials: 'include' }).then((r) => r.json());
    if (note && note.note) {
      document.getElementById('note-text').value = note.note;
    }
  } catch (err) {
    console.error('Could not load today\'s note:', err);
  }
}

document.getElementById('note-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const noteText = document.getElementById('note-text').value;
  const statusEl = document.getElementById('note-status');
  const saveBtn = document.getElementById('note-save');

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  try {
    await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
      body: JSON.stringify({ date: todayDateKey(), note: noteText })
    });
    statusEl.textContent = 'Saved.';
    setTimeout(() => { statusEl.textContent = ''; }, 3000);
  } catch (err) {
    statusEl.textContent = 'Could not save — try again.';
    console.error(err);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save note';
  }
});

// --- Past days ---

async function loadPastDays() {
  const list = document.getElementById('past-days-list');
  list.innerHTML = '<p class="empty">Loading…</p>';

  try {
    const days = await fetch('/api/notes', { credentials: 'include' }).then((r) => r.json());

    if (days.length === 0) {
      list.innerHTML = '<p class="empty">No days recorded yet — save a note from the Today tab to start building this up.</p>';
      return;
    }

    list.innerHTML = '';
    days.forEach((day) => {
      const el = document.createElement('div');
      el.className = 'past-day';

      const isToday = day.date === todayDateKey();
      const label = isToday
        ? 'Today'
        : new Date(`${day.date}T00:00:00Z`).toLocaleDateString(undefined, {
            weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
          });

      const stats = day.taskStats
        ? `${day.taskStats.done}/${day.taskStats.total} tasks done`
        : '';

      el.innerHTML = `
        <div class="past-day-header">
          <span class="past-day-date">${label}</span>
          <span class="past-day-stats">${stats}</span>
        </div>
        <div class="past-day-note ${day.note ? '' : 'empty'}">${day.note || 'No note written for this day.'}</div>
      `;
      list.appendChild(el);
    });
  } catch (err) {
    list.innerHTML = '<p class="empty">Could not load past days.</p>';
    console.error(err);
  }
}

async function checkAuth() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    if (!res.ok) {
      window.location.href = '/';
      return false;
    }
    return true;
  } catch (err) {
    window.location.href = '/';
    return false;
  }
}

document.getElementById('logout-btn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  window.location.href = '/';
});

async function initApp() {
  const authed = await checkAuth();
  if (!authed) return; // checkAuth already redirected

  initPush();
  displayTodayDate();
  loadTasks();
  loadCheckins();
  loadTodayNote();
  setupTabs();
  setInterval(loadCheckins, 30000);
  setInterval(loadTasks, 30000);
  setInterval(watchForDayChange, 60000);
}

initApp();
