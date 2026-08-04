/** Keep the ring compact while guaranteeing the configured default is offered. */
export const deriveVisibleSnoozePresets = (snoozeConfig = {}, limit = 3) => {
  const maxOptions = Math.max(1, Math.floor(Number(limit) || 3));
  const normalizeMinute = (value) => {
    const minute = Math.floor(Number(value));
    return Number.isFinite(minute) && minute >= 1 && minute <= 120 ? minute : null;
  };
  const defaultMinute = normalizeMinute(snoozeConfig.defaultMin) || 5;
  const candidates = Array.from(new Set([
    ...(Array.isArray(snoozeConfig.presets) ? snoozeConfig.presets : []),
    5,
    10,
    15,
  ].map(normalizeMinute).filter(Boolean))).sort((a, b) => a - b);
  const visible = candidates.slice(0, maxOptions);

  if (!visible.includes(defaultMinute)) {
    visible[Math.min(visible.length, maxOptions) - 1] = defaultMinute;
  }
  return Array.from(new Set(visible)).sort((a, b) => a - b);
};