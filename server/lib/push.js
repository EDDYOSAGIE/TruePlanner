const webpush = require('web-push');
const { query } = require('./pg');

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:you@example.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

/**
 * @param {string} userId
 * @param {{headline: string, options: {label:string, action:string}[]}} checkin
 * @param {{id: string|null, title: string}|null} task
 */
async function sendCheckinPush(userId, checkin, task) {
  const res = await query('SELECT subscription FROM push_subscriptions WHERE user_id = $1', [userId]);
  const subscription = res.rows[0]?.subscription;

  if (!subscription) {
    console.warn(`No push subscription on file for user ${userId} — cannot send check-in.`);
    return { sent: false, reason: 'no_subscription' };
  }

  const payload = JSON.stringify({
    title: task ? `Check-in: ${task.title}` : 'A quiet check-in',
    body: checkin.headline,
    taskId: task ? task.id : null,
    options: checkin.options
  });

  try {
    await webpush.sendNotification(subscription, payload);
    return { sent: true };
  } catch (err) {
    // 410/404 means the subscription is stale — clear it so we don't
    // keep failing silently against a dead endpoint.
    if (err.statusCode === 410 || err.statusCode === 404) {
      await query('DELETE FROM push_subscriptions WHERE user_id = $1', [userId]);
    }
    console.error(`Push send failed for user ${userId}:`, err.message);
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendCheckinPush };
