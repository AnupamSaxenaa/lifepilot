/**
 * LifePilot — Pro plan limits (pure functions)
 * ---------------------------------------------------------------------------
 * Every free-vs-Pro threshold in one place, as pure arithmetic with no imports,
 * so it is unit-testable and there is exactly one definition of "at the limit".
 * Same rationale as `creditRules.js`: nothing here reads state, calls a server,
 * or grants anything.
 *
 * Entitlement itself is SERVER-AUTHORITATIVE — `get_pro_status()` (migration
 * 0030), surfaced via `usePro()`. These helpers only answer "given isPro, what is
 * allowed". They are a product limit on local productivity features, not a
 * security boundary: a determined user editing their own device could exceed
 * them, which is an acceptable trade for not round-tripping the server on every
 * render. Anything that costs real money or compute is enforced server-side
 * instead (see `consume_ai_tokens`).
 *
 * EVERY limit here must correspond to a benefit listed on the paywall, and every
 * paywall benefit must correspond to a limit here. Advertising a Pro feature with
 * no gate behind it is a Play policy problem, not just a UX one.
 */

const toCount = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
};

// ─── Mindful Lock ──────────────────────────────────────────────────────────
// Tuned so the free tier is genuinely useful (most people have 2-3 problem apps)
// while a serious user hits the wall and has a reason to upgrade. Too tight and
// the app feels crippled; too loose and nobody converts.
export const FREE_LOCKED_APP_LIMIT = 3;

/**
 * How many apps this user may lock, and how much of that is used.
 * `limit` is null for Pro, meaning unlimited.
 */
export const lockedAppQuota = ({ isPro = false, currentCount = 0 } = {}) => {
  const used = toCount(currentCount);
  if (isPro) {
    return { limit: null, used, remaining: Infinity, atLimit: false, unlimited: true };
  }
  const remaining = Math.max(0, FREE_LOCKED_APP_LIMIT - used);
  return {
    limit: FREE_LOCKED_APP_LIMIT,
    used,
    remaining,
    atLimit: remaining === 0,
    unlimited: false,
  };
};

/**
 * Can `adding` more apps fit within the quota?
 * Takes a batch count because the setup flow adds several at once — checking one
 * at a time would let a free user with 2 apps select 3 more.
 */
export const canLockMoreApps = ({ isPro = false, currentCount = 0, adding = 1 } = {}) => {
  const { unlimited, remaining } = lockedAppQuota({ isPro, currentCount });
  return unlimited || toCount(adding) <= remaining;
};

/**
 * Schedules (auto-switching strict mode by time of day) are Pro.
 * Fails CLOSED on an unknown entitlement — `usePro()` reports free until the
 * server answers, and briefly hiding a Pro feature is far better than briefly
 * handing it out.
 */
export const canUseSchedules = (isPro) => isPro === true;
