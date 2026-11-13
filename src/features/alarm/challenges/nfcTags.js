/**
 * LifePilot — Registered NFC Tags
 * ------------------------------------------------------------------
 * Mirrors qrCodes.js: users register one or more NFC tag IDs that dismiss
 * missions can require tapping. Fully local/offline.
 */
import { Storage } from '../../../utils/storage';

const keyFor = (userId) => `alarm_nfc_tags_${userId}`;

export const loadRegisteredTags = async (userId) => {
  if (!userId) return [];
  const tags = await Storage.get(keyFor(userId));
  return Array.isArray(tags) ? tags : [];
};

export const registerTag = async (userId, tagId, label) => {
  if (!userId || !tagId) return [];
  const tags = await loadRegisteredTags(userId);
  if (tags.some((t) => t.id === tagId)) return tags;
  const updated = [...tags, { id: tagId, label: label || 'NFC Tag', addedAt: new Date().toISOString() }];
  await Storage.set(keyFor(userId), updated);
  return updated;
};

export const removeTag = async (userId, tagId) => {
  if (!userId) return [];
  const tags = await loadRegisteredTags(userId);
  const updated = tags.filter((t) => t.id !== tagId);
  await Storage.set(keyFor(userId), updated);
  return updated;
};

export const isRegisteredTag = (tags, tagId) => (tags || []).some((t) => t.id === tagId);
