require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const { query, initSchema } = require('./lib/pg');
const {
  hashPassword,
  verifyPassword,
  issueToken,
  setSessionCookie,
  clearSessionCookie,
  requireAuth
} = require('./lib/auth');
const { startScheduler, runScan } = require('./lib/scheduler');

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

// ===================== AUTH =====================

app.post('/api/auth/signup', async (req, res) => {
  const { email, password, timezone } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const existing = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const passwordHash = await hashPassword(password);
    const result = await query(
      'INSERT INTO users (email, password_hash, timezone) VALUES ($1, $2, $3) RETURNING id, email, timezone',
      [email.toLowerCase(), passwordHash, timezone || 'UTC']
    );

    const user = result.rows[0];
    const token = issueToken(user.id);
    setSessionCookie(res, token);
    res.status(201).json({ id: user.id, email: user.email, timezone: user.timezone });
  } catch (err) {
    console.error('Signup failed:', err.message);
    res.status(500).json({ error: 'Could not create account' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  try {
    const result = await query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    const user = result.rows[0];

    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = issueToken(user.id);
    setSessionCookie(res, token);
    res.json({ id: user.id, email: user.email, timezone: user.timezone });
  } catch (err) {
    console.error('Login failed:', err.message);
    res.status(500).json({ error: 'Could not sign in' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  const result = await query('SELECT id, email, timezone FROM users WHERE id = $1', [req.userId]);
  const user = result.rows[0];
  if (!user) return res.status(401).json({ error: 'User not found' });
  res.json(user);
});

// ===================== PUSH SUBSCRIPTION =====================

app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

app.post('/api/subscribe', requireAuth, async (req, res) => {
  const subscription = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Invalid subscription object' });
  }

  await query(
    `INSERT INTO push_subscriptions (user_id, subscription, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (user_id) DO UPDATE SET subscription = $2, updated_at = now()`,
    [req.userId, JSON.stringify(subscription)]
  );

  res.status(201).json({ ok: true });
});

// ===================== TASKS =====================

app.get('/api/tasks', requireAuth, async (req, res) => {
  const result = await query(
    'SELECT * FROM tasks WHERE user_id = $1 AND task_date = $2 ORDER BY start_at',
    [req.userId, todayKey()]
  );
  res.json(result.rows);
});

app.post('/api/tasks', requireAuth, async (req, res) => {
  const { title, description, obstacle, start, end } = req.body;
  if (!title || !start || !end) {
    return res.status(400).json({ error: 'title, start, and end are required' });
  }

  const result = await query(
    `INSERT INTO tasks (user_id, title, description, obstacle, start_at, end_at, task_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [req.userId, title, description || '', obstacle || '', start, end, new Date(start).toISOString().slice(0, 10)]
  );

  res.status(201).json(result.rows[0]);
});

app.delete('/api/tasks/:id', requireAuth, async (req, res) => {
  await query('DELETE FROM tasks WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
  res.status(204).end();
});

// Called when the user taps a notification action, or updates status
// from inside the app itself.
app.post('/api/tasks/:id/action', requireAuth, async (req, res) => {
  const { action } = req.body; // 'skip' | 'shrink' | 'reschedule' | 'done'
  const statusMap = { skip: 'skipped', shrink: 'shrunk', reschedule: 'rescheduled', done: 'done' };
  const status = statusMap[action];
  if (!status) return res.status(400).json({ error: 'Unknown action' });

  const result = await query(
    'UPDATE tasks SET status = $1 WHERE id = $2 AND user_id = $3 RETURNING id',
    [status, req.params.id, req.userId]
  );

  if (result.rows.length === 0) return res.status(404).json({ error: 'Task not found' });
  res.json({ ok: true, status });
});

// ===================== CHECK-IN LOG =====================

app.get('/api/checkins', requireAuth, async (req, res) => {
  const result = await query(
    'SELECT * FROM checkin_log WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100',
    [req.userId]
  );
  res.json(result.rows);
});

app.post('/api/scan-now', requireAuth, async (req, res) => {
  try {
    const count = await runScan(req.userId);
    res.json({ ok: true, triggeredCount: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== DAILY NOTES =====================

app.get('/api/notes/:date', requireAuth, async (req, res) => {
  const result = await query(
    'SELECT * FROM daily_notes WHERE user_id = $1 AND note_date = $2',
    [req.userId, req.params.date]
  );
  res.json(result.rows[0] || null);
});

app.post('/api/notes', requireAuth, async (req, res) => {
  const { note } = req.body;
  const date = req.body.date || todayKey();
  if (typeof note !== 'string') {
    return res.status(400).json({ error: 'note must be a string' });
  }

  await query(
    `INSERT INTO daily_notes (user_id, note_date, note, created_at, updated_at)
     VALUES ($1, $2, $3, now(), now())
     ON CONFLICT (user_id, note_date) DO UPDATE SET note = $3, updated_at = now()`,
    [req.userId, date, note]
  );

  res.status(200).json({ ok: true, date, note });
});

app.get('/api/notes', requireAuth, async (req, res) => {
  const notesResult = await query(
    'SELECT * FROM daily_notes WHERE user_id = $1 ORDER BY note_date DESC',
    [req.userId]
  );

  const enriched = await Promise.all(
    notesResult.rows.map(async (n) => {
      const dateStr = n.note_date.toISOString ? n.note_date.toISOString().slice(0, 10) : n.note_date;
      const tasksResult = await query(
        'SELECT status FROM tasks WHERE user_id = $1 AND task_date = $2',
        [req.userId, dateStr]
      );
      const done = tasksResult.rows.filter((t) => t.status === 'done').length;
      return { ...n, date: dateStr, taskStats: { total: tasksResult.rows.length, done } };
    })
  );

  res.json(enriched);
});

app.get('/favicon.ico', (req, res) => res.status(204).end());

const PORT = process.env.PORT || 3000;

initSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Check-in system running at http://localhost:${PORT}`);
      startScheduler();
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database schema:', err.message);
    process.exit(1);
  });
