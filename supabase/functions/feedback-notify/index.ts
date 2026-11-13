// ============================================================================
// LifePilot — Feedback Notification (Supabase Edge Function)
// ----------------------------------------------------------------------------
// Fires whenever a new row is inserted into `public.feedback`, and posts a
// formatted message to a Discord channel via webhook so you find out about
// bug reports / feature requests instantly instead of having to poll the
// Supabase dashboard.
//
// This is wired up as a DATABASE WEBHOOK (not called directly by the app),
// which is important: the client can insert a feedback row, but only the
// Supabase database itself triggers this function — so there's no way for a
// malicious client to fake a notification or spam your Discord webhook
// directly.
//
// One-time setup:
//   1. Deploy this function:
//        supabase functions deploy feedback-notify --no-verify-jwt
//   2. Create a Discord webhook (Discord: Server Settings → Integrations →
//      Webhooks → New Webhook) and copy its URL.
//   3. Set secrets:
//        supabase secrets set DISCORD_FEEDBACK_WEBHOOK_URL=<discord webhook url> \
//            FEEDBACK_NOTIFY_SECRET=<any random long string>
//   4. In the Supabase Dashboard → Database → Webhooks → Create a new webhook:
//        - Table: feedback
//        - Events: Insert
//        - Type: HTTP Request
//        - URL: https://<project-ref>.functions.supabase.co/feedback-notify
//        - HTTP Headers: Authorization: Bearer <same FEEDBACK_NOTIFY_SECRET>
//
// If DISCORD_FEEDBACK_WEBHOOK_URL isn't set, this function still returns 200
// (no-op) so it never blocks the insert or causes Supabase to retry forever.
// ============================================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const CATEGORY_EMOJI: Record<string, string> = {
  bug: "🐞",
  feature_request: "💡",
  general: "💬",
  other: "📎",
};

const SEVERITY_EMOJI: Record<string, string> = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "🟢",
};

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  // Verify the shared secret so only our own Database Webhook can trigger this.
  const expected = Deno.env.get("FEEDBACK_NOTIFY_SECRET");
  const auth = req.headers.get("Authorization") ?? "";
  if (expected && auth !== `Bearer ${expected}`) {
    return new Response("unauthorized", { status: 401 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  // Supabase Database Webhook payload shape: { type, table, record, ... }
  const row = payload?.record ?? payload;
  if (!row) return new Response("ok", { status: 200 });

  /**
   * Signed URL for one private screenshot, or null if it cannot be produced.
   *
   * Never throws: a missing key or a storage hiccup must not stop the Discord
   * notification, because the report itself matters far more than its picture.
   * Accepts SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY — the same naming trap
   * that once made the revenuecat webhook silently fail.
   */
  async function signScreenshot(path: string): Promise<string | null> {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SERVICE_ROLE_KEY")
      ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return null;

    try {
      const res = await fetch(
        `${url}/storage/v1/object/sign/feedback-attachments/${path}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            apikey: key,
            "Content-Type": "application/json",
          },
          // 7 days: long enough to triage a report at leisure, short enough that
          // a link pasted somewhere it should not be stops working.
          body: JSON.stringify({ expiresIn: 60 * 60 * 24 * 7 }),
        },
      );
      if (!res.ok) {
        console.error("[feedback-notify] sign failed:", res.status);
        return null;
      }
      const data = await res.json();
      const signed = data?.signedURL ?? data?.signedUrl;
      if (!signed) return null;
      return signed.startsWith("http")
        ? signed
        : `${url}/storage/v1${signed.startsWith("/") ? "" : "/"}${signed}`;
    } catch (e) {
      console.error("[feedback-notify] sign error:", (e as Error).message);
      return null;
    }
  }

  const webhookUrl = Deno.env.get("DISCORD_FEEDBACK_WEBHOOK_URL");
  if (!webhookUrl) {
    // Not configured yet — don't fail the webhook, just no-op.
    return new Response("ok (no webhook configured)", { status: 200 });
  }

  const categoryLabel = String(row.category ?? "other").replace("_", " ");
  const emoji = CATEGORY_EMOJI[row.category] ?? "📩";
  const severityTag = row.severity ? ` ${SEVERITY_EMOJI[row.severity] ?? ""} ${row.severity}` : "";

  const device = row.device_info ?? {};
  const deviceLine = [device.brand, device.modelName, device.osName, device.osVersion]
    .filter(Boolean)
    .join(" · ");

  // ── Screenshot links ──────────────────────────────────────────────────────
  // `screenshot_urls` now holds STORAGE PATHS ("<uid>/<uuid>.jpg") rather than
  // public URLs, because the feedback-attachments bucket is private: a public
  // URL for a bug-report screenshot works forever for anyone who ever sees it,
  // and people screenshot whatever they happen to be doing.
  //
  // Discord fetches embed images anonymously, so it cannot use a private object
  // directly. We mint a short-lived signed URL here with the service role. The
  // link dies on its own, which is the whole point.
  //
  // Rows written before this change stored full "https://..." URLs. Those are
  // passed through untouched so old feedback still renders.
  const screenshotRefs: string[] = Array.isArray(row.screenshot_urls) ? row.screenshot_urls : [];
  const screenshots: string[] = [];

  for (const ref of screenshotRefs.slice(0, 1)) {
    const value = String(ref ?? "");
    if (!value) continue;

    if (value.startsWith("http://") || value.startsWith("https://")) {
      screenshots.push(value); // legacy public URL
      continue;
    }

    const signed = await signScreenshot(value);
    if (signed) screenshots.push(signed);
  }

  const embed = {
    title: `${emoji} New ${categoryLabel}${severityTag}`,
    description: (row.message ?? "").slice(0, 1800),
    color: row.category === "bug" ? 0xef4444 : row.category === "feature_request" ? 0x3b82f6 : 0x6366f1,
    fields: [
      { name: "Subject", value: String(row.subject ?? "—").slice(0, 256) },
      ...(row.app_version ? [{ name: "App Version", value: String(row.app_version), inline: true }] : []),
      ...(deviceLine ? [{ name: "Device", value: deviceLine, inline: true }] : []),
      ...(row.contact_email ? [{ name: "Contact", value: String(row.contact_email), inline: true }] : []),
      { name: "User ID", value: String(row.user_id ?? "—"), inline: true },
      { name: "Feedback ID", value: String(row.id ?? "—"), inline: true },
    ],
    image: screenshots[0] ? { url: screenshots[0] } : undefined,
    timestamp: row.created_at ?? new Date().toISOString(),
  };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    });
    if (!res.ok) {
      console.error("[feedback-notify] Discord post failed:", res.status, await res.text());
    }
  } catch (e) {
    console.error("[feedback-notify] Discord post error:", (e as Error).message);
  }

  // Always 200 — a Discord hiccup should never cause Supabase to retry this
  // webhook repeatedly against a row that already exists.
  return new Response("ok", { status: 200 });
});
