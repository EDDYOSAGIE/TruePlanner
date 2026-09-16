

const cron = require('node-cron');
const { query } = require('./pg');
const { findTriggersForUser, getAllUserIds } = require('./triggers');
const { generateCheckin } = require('./gemini');
const { sendCheckinPush } = require('./push');

async function processTriggerForUser(userId, trigger) {
  try {
    const snapshot = {
      reason: trigger.reason,
      currentTime: new Date().toISOString(),
      task: trigger.task
        ? {
            title: trigger.task.title,
            description: trigger.task.description || '',
            obstacle: trigger.task.obstacle || '',
            start: trigger.task.start_at,
            end: trigger.task.end_at
          }
        : null,
      allTasks: trigger.allTasks.map((t) => ({
        title: t.title,
        description: t.description || '',
        obstacle: t.obstacle || '',
        status: t.status,
        end: t.end_at
      }))
    };

    const checkin = await generateCheckin(snapshot);

    await query(
      `INSERT INTO checkin_log (user_id, task_id, reason, headline, options)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, trigger.task ? trigger.task.id : null, trigger.reason, checkin.headline, JSON.stringify(checkin.options)]
    );

    await sendCheckinPush(userId, checkin, trigger.task);
  } catch (err) {
    console.error(`Check-in pipeline failed for user ${userId}, trigger "${trigger.reason}":`, err.message);
  }
}

async function runScan(targetUserId) {
  const userIds = targetUserId ? [targetUserId] : await getAllUserIds();
  let totalTriggers = 0;

  for (const userId of userIds) {
    const triggers = await findTriggersForUser(userId);
    totalTriggers += triggers.length;
    for (const trigger of triggers) {
      await processTriggerForUser(userId, trigger);
    }
  }

  return totalTriggers;
}

function startScheduler() {
  const interval = Number(process.env.SCAN_INTERVAL_MINUTES || 10);
  const cronExpr = `*/${interval} * * * *`;

  console.log(`Scheduler running every ${interval} minute(s), across all users.`);

  cron.schedule(cronExpr, () => {
    runScan().then((count) => {
      if (count > 0) console.log(`Scan complete — ${count} check-in(s) processed.`);
    });
  });
}

module.exports = { startScheduler, runScan };
