const { query } = require('./pg');

const OVERRUN_GRACE_MIN = Number(process.env.OVERRUN_GRACE_MINUTES || 15);
const COOLDOWN_MIN = Number(process.env.CHECKIN_COOLDOWN_MINUTES || 60);
const MIDDAY_FRACTION = Number(process.env.MIDDAY_CHECK_FRACTION || 0.5);
const MIDDAY_THRESHOLD = Number(process.env.MIDDAY_COMPLETION_THRESHOLD || 0.4);
const DAY_START_HOUR = Number(process.env.DAY_START_HOUR || 9);
const DAY_END_HOUR = Number(process.env.DAY_END_HOUR || 18);

function minutesSince(lastCheckinAt) {
  if (!lastCheckinAt) return Infinity;
  return (Date.now() - new Date(lastCheckinAt).getTime()) / 60000;
}

async function getAllUserIds() {
  const res = await query('SELECT id FROM users');
  return res.rows.map((r) => r.id);
}

async function todaysTasks(userId) {
  const today = new Date().toISOString().slice(0, 10);
  const res = await query(
    'SELECT * FROM tasks WHERE user_id = $1 AND task_date = $2',
    [userId, today]
  );
  return res.rows;
}

async function lastCheckinForTask(userId, taskId) {
  const res = await query(
    'SELECT * FROM checkin_log WHERE user_id = $1 AND task_id = $2 ORDER BY created_at DESC LIMIT 1',
    [userId, taskId]
  );
  return res.rows[0];
}

async function lastCheckinOfReason(userId, reason) {
  const today = new Date().toISOString().slice(0, 10);
  const res = await query(
    `SELECT * FROM checkin_log
     WHERE user_id = $1 AND reason = $2 AND created_at::date = $3
     ORDER BY created_at DESC LIMIT 1`,
    [userId, reason, today]
  );
  return res.rows[0];
}

/**
 * Scans one user's plan for today and returns trigger events that need
 * a Gemini-generated check-in right now. Pure rule logic — no AI here.
 */
async function findTriggersForUser(userId) {
  const tasks = await todaysTasks(userId);
  const now = new Date();
  const triggers = [];

  // --- Trigger 1: a task's window has closed and it's still pending ---
  for (const task of tasks) {
    if (task.status !== 'pending') continue;
    if (!task.end_at) continue;

    const end = new Date(task.end_at);
    const overrunMinutes = (now - end) / 60000;

    if (overrunMinutes >= OVERRUN_GRACE_MIN) {
      const last = await lastCheckinForTask(userId, task.id);
      if (minutesSince(last?.created_at) >= COOLDOWN_MIN) {
        triggers.push({ reason: 'task_overrun', task, allTasks: tasks });
      }
    }
  }

  // --- Trigger 2: midday drift — day is X% through, completion is low ---
  const dayStart = new Date(now);
  dayStart.setHours(DAY_START_HOUR, 0, 0, 0);
  const dayEnd = new Date(now);
  dayEnd.setHours(DAY_END_HOUR, 0, 0, 0);

  const dayElapsedFraction = (now - dayStart) / (dayEnd - dayStart);

  if (dayElapsedFraction >= MIDDAY_FRACTION && dayElapsedFraction < 1 && tasks.length > 0) {
    const done = tasks.filter((t) => t.status === 'done').length;
    const completionFraction = done / tasks.length;

    if (completionFraction < MIDDAY_THRESHOLD) {
      const last = await lastCheckinOfReason(userId, 'midday_drift');
      if (minutesSince(last?.created_at) >= COOLDOWN_MIN) {
        triggers.push({ reason: 'midday_drift', task: null, allTasks: tasks });
      }
    }
  }

  return triggers;
}

module.exports = { findTriggersForUser, getAllUserIds };
