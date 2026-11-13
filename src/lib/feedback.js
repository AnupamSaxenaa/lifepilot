/**
 * LifePilot — Feedback & Bug Report Client
 *
 * Lets users submit bug reports / feature requests / general feedback,
 * optionally with up to 3 screenshots. Follows the same offline-first
 * pattern as the rest of the app:
 *
 *   1. Screenshots upload directly to Supabase Storage (best-effort — if
 *      offline, the submission still queues, just without images).
 *   2. The feedback row itself goes through the existing syncQueue, so a
 *      submission made offline is retried automatically once back online —
 *      exactly like an offline task edit.
 *   3. A local history of the user's own submissions is cached so the
 *      Feedback screen can show "your reports" instantly, even offline.
 *
 * NEVER call supabase directly from screens for this — go through here so
 * offline handling / caching stays centralized (see AGENTS.md).
 */
import { decode } from 'base64-arraybuffer';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { Storage } from '../utils/storage';
import { supabase } from './supabase';
import { syncToSupabase } from './syncQueue';

export const FEEDBACK_CATEGORIES = ['bug', 'feature_request', 'general', 'other'];
export const FEEDBACK_SEVERITIES = ['low', 'medium', 'high', 'critical'];

const MAX_SCREENSHOTS = 3;
const MAX_SCREENSHOT_SIZE_MB = 5;
const MAX_SCREENSHOT_SIZE_BYTES = MAX_SCREENSHOT_SIZE_MB * 1024 * 1024;

// RFC4122 v4 compliant UUID generator (matches dataManager.js's generator so
// offline-created feedback rows get stable, collision-free client-side ids).
const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

/**
 * Auto-captured device/app context — helps triage without asking the user
 * anything extra. Never includes PII beyond what's already visible to the
 * app itself (no location, no contacts, etc).
 */
export const getDeviceInfo = () => {
  try {
    return {
      brand: Device.brand || undefined,
      modelName: Device.modelName || undefined,
      osName: Device.osName || Platform.OS,
      osVersion: Device.osVersion || String(Platform.Version || ''),
      isDevice: Device.isDevice ?? true,
    };
  } catch (_e) {
    return { osName: Platform.OS, osVersion: String(Platform.Version || '') };
  }
};

export const getAppVersion = () => {
  return Constants.expoConfig?.version || Constants.expoConfig?.android?.versionCode?.toString() || '1.0.0';
};

/**
 * Upload a single screenshot (local file URI) to the feedback-attachments
 * bucket, scoped to `<userId>/<random>.<ext>`. Returns the STORAGE PATH, or
 * null on failure (upload failures never block the feedback submission
 * itself — the report matters more than the picture).
 *
 * WHY A PATH AND NOT A PUBLIC URL
 *   This used to return getPublicUrl(). A bug-report screenshot is whatever the
 *   user happened to have on screen, so a permanent unauthenticated link to it
 *   is the wrong default — once that URL is seen by anyone, it works forever.
 *   The bucket is private and `feedback-notify` mints a short-lived signed URL
 *   when it posts to Discord, so triage still shows the image while the link
 *   expires on its own.
 */
const uploadScreenshot = async (userId, localUri) => {
  try {
    const mimeType = localUri.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    const ext = mimeType === 'image/png' ? 'png' : 'jpg';

    const base64 = await FileSystem.readAsStringAsync(localUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    if (!base64 || base64.length < 50) return null;

    const approxBytes = (base64.length * 3) / 4;
    if (approxBytes > MAX_SCREENSHOT_SIZE_BYTES) {
      console.warn('[Feedback] Screenshot too large, skipping upload:', approxBytes);
      return null;
    }

    const fileName = `${userId}/${generateUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from('feedback-attachments')
      .upload(fileName, decode(base64), { contentType: mimeType, upsert: false });

    if (uploadError) {
      console.warn('[Feedback] Screenshot upload failed:', uploadError.message);
      return null;
    }

    // The path, not a URL. See the note above.
    return fileName;
  } catch (e) {
    console.warn('[Feedback] Screenshot upload error:', e?.message || e);
    return null;
  }
};

/**
 * Submit a feedback/bug report.
 *
 * @param {string} userId
 * @param {object} params
 * @param {'bug'|'feature_request'|'general'|'other'} params.category
 * @param {'low'|'medium'|'high'|'critical'} [params.severity] - bug reports only
 * @param {string} params.subject
 * @param {string} params.message
 * @param {string[]} [params.screenshotUris] - local file URIs (max 3)
 * @param {string} [params.contactEmail]
 * @returns {Promise<{ success: boolean, error?: string, offline?: boolean }>}
 */
export const submitFeedback = async (userId, params) => {
  if (!userId || typeof userId !== 'string') {
    return { success: false, error: 'not_authenticated' };
  }

  const { category, severity, subject, message, screenshotUris = [], contactEmail } = params;

  if (!FEEDBACK_CATEGORIES.includes(category)) {
    return { success: false, error: 'invalid_category' };
  }
  const trimmedSubject = (subject || '').trim();
  const trimmedMessage = (message || '').trim();
  if (!trimmedSubject) return { success: false, error: 'subject_required' };
  if (!trimmedMessage) return { success: false, error: 'message_required' };
  if (trimmedSubject.length > 200) return { success: false, error: 'subject_too_long' };
  if (trimmedMessage.length > 4000) return { success: false, error: 'message_too_long' };

  // Best-effort screenshot upload — never blocks submission on failure.
  const urisToUpload = screenshotUris.slice(0, MAX_SCREENSHOTS);
  const uploadResults = await Promise.all(
    urisToUpload.map((uri) => uploadScreenshot(userId, uri))
  );
  // Storage paths, not public URLs. The column keeps its `screenshot_urls` name
  // so no migration is needed, and rows written before this change still hold
  // full URLs — feedback-notify handles both shapes.
  const screenshotUrls = uploadResults.filter(Boolean);

  const feedbackId = generateUUID();
  const payload = {
    id: feedbackId,
    user_id: userId,
    category,
    severity: category === 'bug' ? (severity || 'medium') : null,
    subject: trimmedSubject,
    message: trimmedMessage,
    screenshot_urls: screenshotUrls,
    device_info: getDeviceInfo(),
    app_version: getAppVersion(),
    contact_email: contactEmail?.trim() || null,
  };

  // Cache locally FIRST (optimistic) so "My Reports" shows it instantly even
  // if the network round-trip below is slow or the device is offline.
  const cached = (await Storage.get(`feedback_history_${userId}`)) || [];
  const optimisticRow = { ...payload, status: 'open', created_at: new Date().toISOString() };
  await Storage.set(`feedback_history_${userId}`, [optimisticRow, ...cached].slice(0, 100));

  const result = await syncToSupabase('feedback', 'insert', payload);

  if (!result) {
    // Queued for retry (offline or transient error) — not a failure from the
    // user's perspective, it WILL go through once connectivity returns.
    return { success: true, offline: true };
  }

  return { success: true, offline: false };
};

/**
 * Load the current user's feedback history (their own submissions + status),
 * cache-first then background-refreshed from Supabase.
 */
export const loadFeedbackHistory = async (userId, onFresh) => {
  if (!userId || typeof userId !== 'string') return [];

  const cached = (await Storage.get(`feedback_history_${userId}`)) || [];

  const fetchBackground = async () => {
    try {
      const { data, error } = await supabase
        .from('feedback')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (!error && data) {
        await Storage.set(`feedback_history_${userId}`, data);
        if (onFresh) onFresh(data);
      }
    } catch (e) {
      console.log('[Feedback] Background history fetch failed:', e.message);
    }
  };

  fetchBackground();
  return cached;
};
