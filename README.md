<<<<<<< HEAD
# Check-in System

A plan-tracking app that sends calm, structured web-push check-ins at critical
points in the day — when a task's window closes unmet, or when the day is
half over and little is done. Built for the "after" moment, not the "before":
it doesn't help you plan, it helps you recover when the plan breaks.

## How it works

1. You log today's tasks with start/end times in the web UI.
2. A scheduler scans every N minutes (rule-based, no AI) for two conditions:
   - a task's end time has passed and it's still marked pending ("overrun")
   - the day is more than halfway through and completion is still low ("drift")
3. When a trigger fires, the snapshot of your day is sent to Gemini, which
   returns one calm, non-judgmental headline and three fixed options:
   **cut it / shrink it / move it**.
4. That gets pushed to your device as a native browser notification, with
   action buttons wired straight to updating the task — no need to open the app.

The AI never decides *when* to interrupt you — that's deterministic code.
It only decides *what to say* once a real trigger has already fired. Keep
it that way if you extend this; it's what keeps the system predictable.

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

1. **GEMINI_API_KEY** — get one at https://aistudio.google.com/apikey
2. **VAPID keys** — generate with:
   ```bash
   npm run generate-vapid
   ```
   Paste the public/private key pair into `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`.
3. Everything else in `.env.example` has a sane default — adjust the timing
   knobs (`OVERRUN_GRACE_MINUTES`, `MIDDAY_CHECK_FRACTION`, etc.) to taste.

Run it locally:

```bash
npm start
```

Open `http://localhost:3000`, click **Enable check-ins**, grant the browser
permission, and add a task with an end time a minute or two in the future
to test the pipeline quickly. Use the **Scan for check-ins now** button on
the page instead of waiting for the cron interval.

## Deploying it for real

This needs a server that stays running (for the cron scan and to hold your
push subscription) — not a serverless function that spins down. Good fits:

- **Render** (free tier works for a single-user MVP) — set the same env vars
  in the dashboard, build command `npm install`, start command `npm start`.
- **Railway** or **Fly.io** — same idea, slightly different dashboards.
- A small always-on VPS if you want full control.

Once deployed, the browser needs HTTPS to register a service worker and
subscribe to push (this is a browser requirement, not something in this
code) — all three platforms above give you HTTPS by default.

## Data model (single-user MVP)

Everything lives in `server/data.json` via lowdb — no external database
needed to start. `tasks` holds today's plan, `subscription` holds the one
push subscription, `checkinLog` holds every generated check-in for history.

To support multiple people, the natural next step is adding a `userId` to
each task and subscription, and passing it through the API routes — the
trigger and Gemini logic don't need to change.

## Project layout

```
server/
  index.js         Express app + all API routes
  lib/
    db.js          lowdb JSON storage
    triggers.js     rule-based logic deciding WHEN to check in
    gemini.js        Gemini call + system prompt deciding WHAT to say
    push.js          sends the web push notification
    scheduler.js      cron job wiring triggers → gemini → push together
public/
  index.html        plan entry UI + check-in history
  app.js            push subscription + task CRUD
  sw.js             service worker handling push + notification taps
```

## Tuning the tone

The system prompt lives in `server/lib/gemini.js` as `SYSTEM_PROMPT`. It's
deliberately strict about tone (calm, factual, no guilt, no cheerleading,
under 40 words). If you want to experiment, that's the one string to edit —
the JSON schema around it enforces the headline + three-option structure
regardless of tone changes.


