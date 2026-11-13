/**
 * LifePilot — AI credit rules (pure functions)
 * ---------------------------------------------------------------------------
 * The SERVER is authoritative for every credit decision. These helpers exist so
 * the UI can EXPLAIN the rules without guessing at them, and so the arithmetic
 * has unit tests. Nothing here grants, spends, or persists anything.
 *
 * The rules mirror these migrations:
 *   0026_unified_ai_credits.sql   → free floor + persistent paid bucket
 *   0027_ad_reward_credits.sql    → same-day bonus bucket from rewarded ads
 *
 *   bonus → profiles.bonus_tokens       same-day only, expires at date roll
 *   free  → profiles.daily_free_tokens  replenishing, capped at floor
 *   paid  → profiles.ai_tokens          purchased, never auto-reset
 *   floor → coalesce(daily_token_allowance, app_config.free_daily_tokens)
 *
 *   0032_daily_floor_is_additive.sql → the floor is additive
 *
 *   Once per calendar day: if free < floor, raise `free` to floor. Purchased and
 *   bonus credits are EXCLUDED from that comparison, so neither buying credits
 *   nor watching ads can reduce the next day's free grant. Before 0032 the
 *   comparison was (free + paid) < floor, which meant a Pro user holding an
 *   allotment got no daily grant at all — making Pro worth less than free.
 *
 *   Spend order: bonus → free → paid (most perishable first). This is what keeps
 *   a paying user's purchased balance intact while the daily grant is spent.
 *
 *   0031_credit_debt_and_clawback.sql → refund clawback
 *   debt  → profiles.credit_debt      NOT spendable, always >= 0
 *
 *   A refund claws back what was granted. Anything already spent becomes `debt`.
 *   Debt is then settled by EVERY inbound grant — the daily floor top-up, a
 *   purchase, or an ad reward — before any of it becomes spendable. So the
 *   buy → spend → refund → repeat loop earns nothing.
 *
 *   Debt is a SEPARATE non-negative column rather than a negative `paid`, because
 *   the top-up rule reads `free := floor - paid`; a negative `paid` would MINT
 *   free credits equal to the debt.
 *
 * If you change the SQL, change this file and its tests in the same commit.
 */

export const DEFAULT_CREDIT_FLOOR = 20;

const toCount = (value, fallback = 0) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
};

const toFloor = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_CREDIT_FLOOR;
  return Math.floor(n);
};

/**
 * Normalise whatever `get_ai_balance()` returned into a predictable shape.
 * Tolerates missing keys so an older backend can't crash the UI — a pre-0027
 * server simply reports no bonus.
 */
export const normalizeBalance = (raw) => {
  const floor = toFloor(raw?.floor);
  const free = toCount(raw?.daily_free);
  const paid = toCount(raw?.purchased);
  const bonus = toCount(raw?.bonus);
  // Outstanding refund clawback. A pre-0031 server simply reports none.
  const debt = toCount(raw?.debt);
  const parts = bonus + free + paid;
  // Trust an explicit `total` when present — it is what the server will spend
  // from — but never let it disagree with the parts by going negative.
  const total = raw?.total === undefined || raw?.total === null
    ? parts
    : toCount(raw.total, parts);
  return { bonus, free, paid, debt, total, floor };
};

/**
 * The transition the next call of a new day applies: the bonus bucket expires,
 * then the free bucket is topped up to the floor if needed.
 */
export const applyDailyTopUp = ({ bonus = 0, free, paid, floor, debt = 0 }) => {
  const f = toCount(free);
  const p = toCount(paid);
  const cap = toFloor(floor);
  let d = toCount(debt);
  // Bonus credits are same-day only; a new day always clears them. `bonus` is
  // accepted and ignored so callers can pass a whole balance object.
  void toCount(bonus);

  // What the top-up would add before debt takes its cut. Compares the FREE
  // bucket only (0032) — a purchased balance must not suppress the daily grant.
  let topUp = Math.max(0, cap - f);
  if (topUp > 0 && d > 0) {
    // Mirrors consume_ai_tokens: the grant is earned, then immediately consumed
    // by any outstanding clawback. A refunder gets no free credits until square.
    const applied = Math.min(d, topUp);
    d -= applied;
    topUp -= applied;
  }
  const nextFree = f + topUp;
  return { bonus: 0, free: nextFree, paid: p, debt: d, total: nextFree + p };
};

/**
 * What the balance becomes tomorrow if nothing else is spent, bought or earned.
 * Used by the credit store to show an honest "tops up to N tomorrow" line.
 */
export const projectNextDayTotal = (balance) => {
  const { bonus, free, paid, floor, debt } = normalizeBalance(balance);
  return applyDailyTopUp({ bonus, free, paid, floor, debt }).total;
};

/**
 * Can this balance cover a call costing `cost`?
 *
 * Debt is NOT subtracted here: it is not a hold on the current balance, it is a
 * lien on future grants. Credits already sitting in the buckets stay spendable —
 * the server's `consume_ai_tokens` behaves the same way, so the two agree.
 */
export const canAfford = (balance, cost) => {
  const { total } = normalizeBalance(balance);
  const price = toCount(cost);
  if (price < 1) return true; // free modes never touch the bucket
  return total >= price;
};

/**
 * Split a spend across buckets, most perishable first.
 * Returns null when the balance cannot cover the cost.
 */
export const splitSpend = ({ bonus = 0, free, paid }, cost) => {
  const b = toCount(bonus);
  const f = toCount(free);
  const p = toCount(paid);
  const price = toCount(cost);

  if (price < 1) {
    return { fromBonus: 0, fromFree: 0, fromPaid: 0, bonus: b, free: f, paid: p };
  }
  if (b + f + p < price) return null;

  const fromBonus = Math.min(b, price);
  const afterBonus = price - fromBonus;
  const fromFree = Math.min(f, afterBonus);
  const fromPaid = afterBonus - fromFree;

  return {
    fromBonus,
    fromFree,
    fromPaid,
    bonus: b - fromBonus,
    free: f - fromFree,
    paid: p - fromPaid,
  };
};

/**
 * Human-readable breakdown for the store screen.
 * `paid` is described as never expiring and `bonus` as today-only, because that
 * is the actual server behaviour.
 */
export const describeBalance = (balance) => {
  const { bonus, free, paid, debt, total, floor } = normalizeBalance(balance);
  return {
    total,
    bonus,
    free,
    paid,
    debt,
    floor,
    hasPaid: paid > 0,
    hasBonus: bonus > 0,
    hasDebt: debt > 0,
    // What the user is really worth right now. Goes NEGATIVE while a clawback is
    // outstanding, which is the honest thing to show: "you owe 20" reads far
    // better than a silent 0 that swallows every credit they earn.
    effective: total - debt,
    // True when the floor top-up would do nothing tomorrow (free already at/above
    // it). Purchased credits no longer suppress the grant, so they don't count.
    aboveFloor: free >= floor,
    nextDayTotal: applyDailyTopUp({ bonus, free, paid, floor, debt }).total,
  };
};

// ─── Rewarded ads ──────────────────────────────────────────────────────────
// Mirrors `get_ad_reward_status()`. The server enforces the cap; this only
// shapes the response so the store can render it without inventing numbers.

export const DEFAULT_AD_CREDITS = 3;
export const DEFAULT_AD_DAILY_MAX = 6;

export const normalizeAdStatus = (raw) => {
  const creditsPerAd = Math.max(1, toCount(raw?.credits_per_ad, DEFAULT_AD_CREDITS)
    || DEFAULT_AD_CREDITS);
  const dailyMax = toCount(raw?.daily_max, DEFAULT_AD_DAILY_MAX);
  const earnedToday = Math.min(dailyMax, toCount(raw?.earned_today));
  const remainingToday = raw?.remaining_today === undefined || raw?.remaining_today === null
    ? Math.max(0, dailyMax - earnedToday)
    : Math.min(toCount(raw.remaining_today), Math.max(0, dailyMax - earnedToday));
  // A partial final reward still costs a full ad view.
  const adsLeft = raw?.ads_left === undefined || raw?.ads_left === null
    ? Math.ceil(remainingToday / creditsPerAd)
    : toCount(raw.ads_left);

  return {
    creditsPerAd,
    dailyMax,
    earnedToday,
    remainingToday,
    adsLeft,
    // The next reward is clamped to whatever is left under the cap.
    nextReward: Math.min(creditsPerAd, remainingToday),
    exhausted: remainingToday <= 0,
  };
};
