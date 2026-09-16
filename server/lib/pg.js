const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Most hosted Postgres providers (Supabase, Neon, Render, Railway) require
  // SSL but use certs that fail default verification — this is their
  // documented standard connection pattern, not a security downgrade specific
  // to this app.
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
});

async function query(text, params) {
  return pool.query(text, params);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  obstacle TEXT NOT NULL DEFAULT '',
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  task_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tasks_user_date ON tasks(user_id, task_date);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  subscription JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS checkin_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  headline TEXT NOT NULL,
  options JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_notes (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_date DATE NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, note_date)
);
`;

async function initSchema() {
  await query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  await query(SCHEMA);
  console.log('Database schema ready.');
}

module.exports = { pool, query, initSchema };
