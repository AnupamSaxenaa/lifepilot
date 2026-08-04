/**
 * LifePilot — Registered QR Codes
 * ------------------------------------------------------------------
 * Users can register one or more QR codes (e.g. placed in the kitchen,
 * bathroom, front door) that dismiss missions can require scanning. Purely
 * local/offline — QR content is just an opaque string the user scans once to
 * "register" a location, then must re-scan any of them to pass the challenge.
 */
import { Storage } from '../../../utils/storage';

const keyFor = (userId) => `alarm_qr_codes_${userId}`;

export const loadRegisteredCodes = async (userId) => {
  if (!userId) return [];
  const codes = await Storage.get(keyFor(userId));
  return Array.isArray(codes) ? codes : [];
};

/** Register a new QR code value with a friendly label (e.g. "Kitchen"). */
export const registerCode = async (userId, value, label) => {
  if (!userId || !value) return [];
  const codes = await loadRegisteredCodes(userId);
  if (codes.some((c) => c.value === value)) return codes; // already registered
  const updated = [...codes, { value, label: label || 'QR Code', addedAt: new Date().toISOString() }];
  await Storage.set(keyFor(userId), updated);
  return updated;
};

export const removeCode = async (userId, value) => {
  if (!userId) return [];
  const codes = await loadRegisteredCodes(userId);
  const updated = codes.filter((c) => c.value !== value);
  await Storage.set(keyFor(userId), updated);
  return updated;
};

export const isRegisteredCode = (codes, value) => (codes || []).some((c) => c.value === value);
