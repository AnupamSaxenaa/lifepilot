// ─── AI Fallback Content Library ──────────────────────────────
// Hardcoded, hand-written variety pools used whenever the AI proxy/providers
// are unavailable (network down, all providers failed, rate-limited without
// a clearer message, etc). The goal: the user should never see a broken/blank
// AI response — they should see something that still feels intentional and
// in-voice, just not personalized.
//
// Every pool has multiple entries so repeated failures don't show the exact
// same line twice in a row (see pickVariant below).
// ─────────────────────────────────────────────────────────────

// Simple seeded-ish rotation: avoids the same line repeating back-to-back
// within a session by remembering the last index used per pool.
const lastIndexByPool = {};

export const pickVariant = (poolKey, pool) => {
  if (!Array.isArray(pool) || pool.length === 0) return '';
  if (pool.length === 1) return pool[0];
  let idx = Math.floor(Math.random() * pool.length);
  if (idx === lastIndexByPool[poolKey]) {
    idx = (idx + 1) % pool.length;
  }
  lastIndexByPool[poolKey] = idx;
  return pool[idx];
};

// ── Aura chat (general assistant conversation) ──
export const AURA_CHAT_FALLBACKS = [
  "I'm having trouble thinking clearly right now, but I'm still here. Want to just tell me what's on your plate today?",
  "My connection's a little foggy at the moment. Let's keep it simple — what's the one thing you most need to get done today?",
  "I can't fully process that right now, but let's not lose momentum. Add your top task and I'll catch up with you shortly.",
  "Having a slow moment on my end. In the meantime, take a look at your task list — what feels most urgent?",
  "I'm a bit offline in the brain department right now. Your tasks are still right here though — want to tackle one?",
];

// ── Coach advice (focus session start) ──
export const COACH_ADVICE_FALLBACKS = [
  { minutes: 25, advice: "Zero distractions. Let's go.", tough_love: "Quitting is for the weak. Get back to work." },
  { minutes: 25, advice: "One task, full focus, no phone.", tough_love: "You don't get results by stopping early." },
  { minutes: 20, advice: "Start small, build the streak.", tough_love: "Discomfort now beats regret later." },
  { minutes: 30, advice: "Deep work needs a closed door, not willpower.", tough_love: "Nobody remembers who gave up at minute ten." },
  { minutes: 25, advice: "Momentum beats motivation. Just start.", tough_love: "Future you is watching. Don't embarrass them." },
];

// ── Inactivity nudge notifications ──
export const INACTIVITY_NUDGE_FALLBACKS = (count) => [
  `📋 You have ${count} task${count === 1 ? '' : 's'} waiting. Time to get things done!`,
  `⏰ ${count} task${count === 1 ? '' : 's'} still open. A few minutes now saves a rush later.`,
  `🔥 Don't let ${count} task${count === 1 ? '' : 's'} pile up. Pick one and knock it out.`,
  `👋 Still ${count} thing${count === 1 ? '' : 's'} on your list. Let's chip away at it.`,
];

// ── Aggressive block message (strict mode) ──
export const AGGRESSIVE_BLOCK_FALLBACKS = (appName) => [
  `WTF are you doing opening ${appName}? You've hit your limit. Close it right now and get back to work.`,
  `Seriously? ${appName}? Not right now. You know what you're supposed to be doing.`,
  `${appName} again? Your limit's up. Put the phone down and get back to your tasks.`,
  `Nope. Not ${appName}, not now. You already used your time — go finish something real.`,
  `This is exactly the moment you lose the day. Close ${appName} and go do the thing you're avoiding.`,
];

// ── Mindful intervention (gentle/coach mode) ──
export const MINDFUL_INTERVENTION_FALLBACKS = (appName) => [
  { message: `Take a deep breath. Do you really need to use ${appName} right now?`, replacement: 'Stretch for 60 seconds and check your task list.' },
  { message: `Quick check-in: is opening ${appName} moving you toward your goal today, or away from it?`, replacement: 'Drink a glass of water and glance at your top task.' },
  { message: `You paused before opening ${appName} — that's already a win. What do you actually need right now?`, replacement: 'Take 5 slow breaths, then decide.' },
  { message: `${appName} will still be there in 20 minutes. Your focus window might not be.`, replacement: 'Do one small task first, then reassess.' },
];

// ── Mindful coach chat (conversational, during temptation) ──
export const COACH_CHAT_FALLBACKS = [
  'I am having trouble connecting right now, but please take a deep breath and reconsider your choice.',
  "My connection's a bit spotty at the moment — but you don't need me to tell you what the right move is here.",
  "I'm here for you even if I'm a little slow to respond. Take a breath, and think about what you'd tell a friend in this moment.",
  "Can't fully process that right now, but I'm still rooting for you. What's one small step you could take instead?",
];

// ── Fallback fixed schedule item (used inside AIEngine.buildFallbackSchedule
// as the title when there are no tasks to schedule) ──
export const NO_TASKS_PLAN_FALLBACKS = [
  'Plan and prioritize today',
  'Review your goals for today',
  'Pick your top 3 tasks for today',
];
