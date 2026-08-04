/**
 * LifePilot — Morning motivation
 * ------------------------------------------------------------------
 * Provides a daily affirmation/quote for the morning "Today's Focus" screen
 * and (later) the ring screen. Offline-first and free: it rotates through a
 * bundled, localized affirmation set deterministically by day, so the same day
 * always shows the same line and it works with zero network / zero AI credits.
 *
 * The AI engine (20/day cap) is intentionally NOT used here to keep mornings
 * instant and never spend a credit on a decorative line; richer AI-generated
 * encouragement can be layered on later behind the existing cap + fallback.
 */

// Day-of-year 0..365 (local), used as a stable rotation seed.
const dayOfYear = (d = new Date()) => {
  const start = new Date(d.getFullYear(), 0, 0);
  const diff = d - start;
  return Math.floor(diff / 86400000);
};

const greetingKey = (d = new Date()) => {
  const h = d.getHours();
  if (h < 12) return 'alarmMorning.greetingMorning';
  if (h < 18) return 'alarmMorning.greetingAfternoon';
  return 'alarmMorning.greetingEvening';
};

/**
 * Resolve today's motivation using the provided i18next `t`.
 * @returns {{ greeting: string, affirmation: string }}
 */
export const getDailyMotivation = (t) => {
  const greeting = t(greetingKey());

  let list = t('alarmMorning.affirmations', { returnObjects: true });
  if (!Array.isArray(list) || list.length === 0) {
    list = ['Make today count.'];
  }
  const affirmation = list[dayOfYear() % list.length];

  return { greeting, affirmation };
};
