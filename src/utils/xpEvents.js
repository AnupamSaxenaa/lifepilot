/**
 * LifePilot — XP event bus
 * ---------------------------------------------------------------------------
 * A tiny in-memory pub/sub so a single global <XpToast/> (mounted once in
 * App.js) can show a small "+X XP" / "-X XP" popup whenever XP changes,
 * without every screen needing to wire up its own toast.
 *
 * Emit from the ONE place all task/step completions funnel through
 * (Gamification.addXP), so every screen gets the popup for free.
 */
let listeners = [];

export const XpEvents = {
  subscribe(fn) {
    listeners.push(fn);
    return () => { listeners = listeners.filter((l) => l !== fn); };
  },
  emit(amount) {
    if (!amount) return; // no toast for a 0 delta
    listeners.forEach((l) => { try { l(amount); } catch (_e) {} });
  },
};
