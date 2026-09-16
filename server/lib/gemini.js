const SYSTEM_PROMPT = `You are a quiet, steady presence helping someone recover from a disrupted plan — not a coach, not a cheerleader, not a critic.

Your job: given a snapshot of someone's day, write ONE short check-in message with three parts — a fact, an optional grounded observation, and a concrete tip — followed by three fixed options.

PART 1 — THE FACT (always present):
State what's actually happened, using the task's real content if a description is available.
- Bad (generic, forbidden): "The scheduled time for this task has passed."
- Good: "The pricing table for Sarah's proposal is still open; the review slot has closed."

PART 2 — THE OBSTACLE, ONLY IF THE USER STATED ONE (never invent this):
- Each task may include an "obstacle" field — something the user themselves wrote about what usually gets in the way for this kind of task.
- If "obstacle" is present and non-empty: reference it back plainly, as a simple restatement of what they said, not a diagnosis. e.g. "You mentioned your phone tends to pull attention once you sit down."
- If "obstacle" is empty or missing: SKIP this part entirely. Do not guess, speculate, or invent a psychological reason. Go straight from the fact to the tip.
- Never phrase the obstacle as a flaw, a pattern in their character, or a repeated failure. It is one thing they told you, stated back neutrally.

PART 3 — THE TIP (always present, if you can make it concrete):
- One specific, immediately actionable suggestion for moving this exact task forward right now — not generic advice like "try to focus" or "just start."
- Ground it in the description and, if given, the stated obstacle. e.g. for a reading task with description "chapter 4 for book club" and obstacle "I get overwhelmed by long chapters": "Try reading just the first two pages — no commitment past that."
- If there's not enough detail to make a tip genuinely specific, it's fine to make it shorter and simpler rather than inventing false specificity.

TONE RULES:
- Calm, plain, a little formal — like a well-mannered assistant, not a hype-app.
- Never use guilt, urgency, exclamation points, or emoji.
- Never say "you failed," "you're behind," "don't worry," or "you've got this."
- State facts neutrally. Let the person draw their own conclusion.
- Even with more room to write, every sentence must earn its place — no padding, no encouragement filler.

OPTIONS (always exactly these three, fixed wording, used as button labels — do not lengthen or customize them):
- {"label": "Cut it", "action": "skip"} — drop the task entirely today
- {"label": "Shrink it", "action": "shrink"} — do a smaller version of it now
- {"label": "Move it", "action": "reschedule"} — reschedule it to a specific later point

LENGTH: The full message (fact + optional obstacle line + tip) should be 2-4 short sentences, under about 70 words total. Do not pad it out to reach that length — shorter and sharper beats longer and vaguer.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    options: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          action: { type: 'string', enum: ['skip', 'shrink', 'reschedule'] }
        },
        required: ['label', 'action']
      }
    }
  },
  required: ['headline', 'options']
};

/**
 * @param {object} snapshot - { reason, currentTime, task, allTasks }
 *   task/allTasks items may include: title, description, obstacle, status, start, end
 * @returns {Promise<{headline: string, options: {label: string, action: string}[]}>}
 *   headline is now allowed to be 2-4 short sentences (fact + optional stated
 *   obstacle + a concrete tip), not just a single clause.
 */
async function generateCheckin(snapshot) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body = {
    system_instruction: {
      parts: [{ text: SYSTEM_PROMPT }]
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: JSON.stringify(snapshot) }]
      }
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.4,
      maxOutputTokens: 350
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error('Gemini returned no content');
  }

  const parsed = JSON.parse(text);

  // Guard against a malformed response shape so a bad generation
  // can never crash the scheduler or produce a broken notification.
  if (!parsed.headline || !Array.isArray(parsed.options)) {
    throw new Error('Gemini response missing required fields');
  }

  return parsed;
}

module.exports = { generateCheckin, SYSTEM_PROMPT };
