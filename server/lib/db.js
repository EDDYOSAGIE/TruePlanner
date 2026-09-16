const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');

const adapter = new FileSync(path.join(__dirname, '..', 'data.json'));
const db = low(adapter);

// Single-user MVP. Swap `tasks`/`subscription` for per-user collections
// keyed by a user id once you need more than one person using this.
db.defaults({
  tasks: [],
  subscription: null,
  checkinLog: [], // { id, taskId, reason, headline, options, createdAt }
  dailyNotes: [] // { date, note, createdAt, updatedAt }
}).write();

module.exports = db;
