// ============================================================================
// LifePilot — Secure AI Proxy (Supabase Edge Function)
// ----------------------------------------------------------------------------
// Responsibilities:
//   • Authenticate the caller via their Supabase JWT (never trust the client).
//   • Enforce AI credits / Pro entitlement SERVER-SIDE (cost is decided here,
//     not sent by the client — prevents cost tampering).
//   • Hold all provider API keys as Supabase secrets (never in the app bundle).
//   • Cascade across providers (Groq → Gemini → Mistral → Cohere) for uptime.
//   • Refund the credit if every provider fails.
//
// Deploy:
//   supabase functions deploy ai-proxy
//   supabase secrets set GROQ_API_KEY=... GEMINI_API_KEY=... \
//       MISTRAL_API_KEY=... COHERE_API_KEY=...
// ============================================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// Server-decided cost per operation. Clients send a `mode`, NOT a cost.
//
// Only operations the user DELIBERATELY starts are billable. Everything else is
// something the app decides to do on its own — the Dashboard fires `nudge` on
// launch, for instance — and charging for those made credits drain with no
// visible cause. A cost of 0 means the credit bucket is never touched.
//
// Free modes are still authenticated, rate-limited and payload-capped below, so
// they cannot be used to hammer the shared provider keys.
const MODE_COST: Record<string, number> = {
  // Billable: the user asked for these.
  aura_chat: 1, // chatting with Aura
  plan: 3,      // "Build schedule"

  // Free: background / system-initiated assistance.
  coach: 0,        // coach advice
  nudge: 0,        // inactivity nudge, fired automatically on launch
  block: 0,        // app-blocker message
  intervention: 0, // mindful intervention
  chat: 0,         // coach chat + default when a client sends no mode
};

// ── Abuse guardrails ─────────────────────────────────────────────────────────
// Hardcoded server-side caps — never trust anything the client sends for
// these. Protects the shared provider keys from being hammered by a single
// account (rate limit) and from oversized prompts inflating real provider
// cost while only spending 1 token (payload cap).
const MAX_MESSAGES = 40;             // conversation length cap
const MAX_MESSAGE_CHARS = 6000;      // per-message content cap
const MAX_TOTAL_CHARS = 24000;       // whole-payload cap

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Latency control ─────────────────────────────────────────────────────────
// WHY THIS EXISTS
//
// The cascade below is sequential, and with every key set it is up to ELEVEN
// HTTP requests: groq, cerebras, gemini (3 models), openrouter (4 models),
// mistral, cohere. Deno's `fetch` has NO default timeout, so a single slow or
// hanging provider blocked everything behind it — which on free tiers (queued
// or rate-limited requests that stall rather than 429 promptly) is routine.
// That is why Aura felt slow: not the model, the waiting.
//
// Two bounds fix it:
//   PROVIDER_TIMEOUT_MS — abandon one attempt quickly and move to the next
//   TOTAL_DEADLINE_MS   — cap the whole cascade so the user always gets an
//                         answer or an honest failure in bounded time
//
// The signal genuinely ABORTS the request rather than just racing a timer, so a
// slow provider stops consuming the isolate instead of dangling until the
// platform's wall-clock limit.
const PROVIDER_TIMEOUT_MS = 8_000;
const TOTAL_DEADLINE_MS = 25_000;
// Below this there is no point starting another attempt.
const MIN_ATTEMPT_MS = 1_500;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Milliseconds left before the cascade must give up. */
const msLeft = (deadline: number) => deadline - Date.now();

/** Budget for a single attempt: the per-provider cap, clipped to the deadline. */
const attemptBudget = (deadline: number) =>
  Math.min(PROVIDER_TIMEOUT_MS, Math.max(0, msLeft(deadline)));

// ── Provider calls ──────────────────────────────────────────────────────────
type Msg = { role: string; content: string };

async function callGroq(messages: Msg[], jsonMode: boolean, deadline: number): Promise<string> {
  const key = Deno.env.get("GROQ_API_KEY");
  if (!key) throw new Error("no groq key");
  const res = await fetchWithTimeout("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages,
      temperature: 0.7,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  }, attemptBudget(deadline));
  if (!res.ok) throw new Error(`groq ${res.status}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("groq empty");
  return text;
}

async function callGemini(messages: Msg[], deadline: number): Promise<string> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("no gemini key");
  const prompt = messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");
  const models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-flash-latest"];
  let lastErr: Error | null = null;
  for (const model of models) {
    // This inner loop is 3 more sequential requests. Respect the shared deadline
    // so Gemini alone cannot consume the whole budget and starve the providers
    // queued behind it.
    if (msLeft(deadline) < MIN_ATTEMPT_MS) break;
    try {
      const res = await fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        },
        attemptBudget(deadline),
      );
      if (!res.ok) { lastErr = new Error(`gemini ${model} ${res.status}`); continue; }
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) { lastErr = new Error(`gemini ${model} empty`); continue; }
      return text;
    } catch (e) {
      lastErr = e as Error;
    }
  }
  throw lastErr ?? new Error("gemini failed");
}

async function callMistral(messages: Msg[], jsonMode: boolean, deadline: number): Promise<string> {
  const key = Deno.env.get("MISTRAL_API_KEY");
  if (!key) throw new Error("no mistral key");
  const res = await fetchWithTimeout("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "mistral-small-latest",
      messages,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  }, attemptBudget(deadline));
  if (!res.ok) throw new Error(`mistral ${res.status}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("mistral empty");
  return text;
}

async function callCohere(messages: Msg[], deadline: number): Promise<string> {
  const key = Deno.env.get("COHERE_API_KEY");
  if (!key) throw new Error("no cohere key");
  const prompt = messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");
  const res = await fetchWithTimeout("https://api.cohere.com/v2/chat", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "command-r", messages: [{ role: "user", content: prompt }] }),
  }, attemptBudget(deadline));
  if (!res.ok) throw new Error(`cohere ${res.status}`);
  const data = await res.json();
  const text = data?.message?.content?.[0]?.text;
  if (!text) throw new Error("cohere empty");
  return text;
}

// ── OpenRouter (OpenAI-compatible) ──
// A single free key unlocks MANY free models — the strongest single backup.
// We try a few free models in order so one being rate-limited doesn't sink us.
async function callOpenRouter(messages: Msg[], jsonMode: boolean, deadline: number): Promise<string> {
  const key = Deno.env.get("OPENROUTER_API_KEY");
  if (!key) throw new Error("no openrouter key");
  const models = [
    "meta-llama/llama-3.3-70b-instruct:free",
    "google/gemini-2.0-flash-exp:free",
    "mistralai/mistral-small-3.1-24b-instruct:free",
    "qwen/qwen-2.5-72b-instruct:free",
  ];
  let lastErr: Error | null = null;
  for (const model of models) {
    // Four sequential model attempts — same deadline guard as Gemini above.
    if (msLeft(deadline) < MIN_ATTEMPT_MS) break;
    try {
      const res = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages,
          ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        }),
      }, attemptBudget(deadline));
      if (!res.ok) { lastErr = new Error(`openrouter ${model} ${res.status}`); continue; }
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      if (!text) { lastErr = new Error(`openrouter ${model} empty`); continue; }
      return text;
    } catch (e) {
      lastErr = e as Error;
    }
  }
  throw lastErr ?? new Error("openrouter failed");
}

// ── Cerebras (OpenAI-compatible, free tier, very fast) ──
async function callCerebras(messages: Msg[], jsonMode: boolean, deadline: number): Promise<string> {
  const key = Deno.env.get("CEREBRAS_API_KEY");
  if (!key) throw new Error("no cerebras key");
  const res = await fetchWithTimeout("https://api.cerebras.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama-3.3-70b",
      messages,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  }, attemptBudget(deadline));
  if (!res.ok) throw new Error(`cerebras ${res.status}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("cerebras empty");
  return text;
}

async function runCascade(messages: Msg[], jsonMode: boolean): Promise<string> {
  // Order = fastest/most-generous first, then broad backups. Each provider
  // throws "no key" and is skipped cleanly if its secret isn't set, so you can
  // add keys incrementally without touching code.
  const deadline = Date.now() + TOTAL_DEADLINE_MS;
  const providers = [
    () => callGroq(messages, jsonMode, deadline),
    () => callCerebras(messages, jsonMode, deadline),
    () => callGemini(messages, deadline),
    () => callOpenRouter(messages, jsonMode, deadline),
    () => callMistral(messages, jsonMode, deadline),
    () => callCohere(messages, deadline),
  ];
  let lastErr: Error | null = null;
  for (const p of providers) {
    // Stop rather than start an attempt that cannot finish. Without this the
    // cascade would keep trying providers long after the caller gave up.
    if (msLeft(deadline) < MIN_ATTEMPT_MS) {
      lastErr = lastErr ?? new Error("cascade deadline exceeded");
      break;
    }
    try {
      return await p();
    } catch (e) {
      lastErr = e as Error;
    }
  }
  throw lastErr ?? new Error("all providers failed");
}

// ── Handler ──────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json(401, { error: "missing bearer token" });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  // Caller-bound client: auth.uid() resolves to the signed-in user for all
  // balance, rate-limit, and consumption RPCs.
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return json(401, { error: "invalid session" });
  }
  const userId = userData.user.id;

  let payload: { mode?: string; messages?: Msg[]; json?: boolean };
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: "invalid json body" });
  }

  const mode = payload.mode ?? "chat";
  if (!Object.prototype.hasOwnProperty.call(MODE_COST, mode)) {
    return json(400, { error: "unknown_mode", reason: "unknown_mode" });
  }

  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const jsonMode = !!payload.json;
  const cost = MODE_COST[mode];

  if (messages.length === 0) return json(400, { error: "no messages" });

  const { data: aiEnabled, error: enabledErr } = await supabase.rpc("is_ai_enabled");
  if (enabledErr) {
    return json(500, { error: "config_check_failed" });
  }
  if (aiEnabled === false) {
    return json(503, { error: "ai_disabled", reason: "AI is temporarily unavailable. Please try again later." });
  }

  if (messages.length > MAX_MESSAGES) {
    return json(400, { error: "payload_too_large", reason: "too_many_messages" });
  }
  let totalChars = 0;
  for (const m of messages) {
    const len = typeof m?.content === "string" ? m.content.length : 0;
    if (len > MAX_MESSAGE_CHARS) {
      return json(400, { error: "payload_too_large", reason: "message_too_long" });
    }
    totalChars += len;
  }
  if (totalChars > MAX_TOTAL_CHARS) {
    return json(400, { error: "payload_too_large", reason: "conversation_too_long" });
  }

  const { data: rateLimit, error: rlErr } = await supabase.rpc("check_ai_rate_limit");
  if (rlErr) {
    return json(500, { error: "rate_limit_check_failed" });
  }
  if (!rateLimit?.allowed) {
    return json(429, {
      error: "rate_limited",
      reason: rateLimit?.reason ?? "rate_limited",
    });
  }

  // Free modes skip the credit bucket entirely. This has to be a skip rather
  // than `p_cost: 0` — `consume_ai_tokens` treats anything below 1 as
  // `invalid_cost` and refuses, which would break every free feature.
  let remaining: number | null = null;
  // Which buckets the spend actually came from, so a refund restores exactly
  // those. Refunding a mixed spend entirely into the paid bucket would convert
  // perishable free credits into permanent ones on every provider failure.
  let spentFromBonus = 0;
  let spentFromFree = 0;
  let spentFromPaid = 0;
  if (cost > 0) {
    const { data: consume, error: consumeErr } = await supabase.rpc("consume_ai_tokens", {
      p_cost: cost,
    });
    if (consumeErr) {
      return json(500, { error: "token check failed" });
    }
    if (!consume?.allowed) {
      return json(402, {
        error: "insufficient_tokens",
        reason: consume?.reason ?? "insufficient_tokens",
        remaining: consume?.remaining ?? 0,
      });
    }
    remaining = consume?.remaining ?? 0;
    // Pre-0026 databases don't return the split. Falling back to "all free"
    // matches the old refund behaviour rather than inventing paid credits.
    spentFromBonus = consume?.from_bonus ?? 0;
    spentFromFree = consume?.from_free ?? cost;
    spentFromPaid = consume?.from_paid ?? 0;
  }

  try {
    const text = await runCascade(messages, jsonMode);
    return json(200, { text, remaining });
  } catch (_e) {
    // Clients cannot execute refunds. The service-role client restores only
    // this user's failed server-approved cost, back into today's capped bucket.
    // Nothing was charged for a free mode, so refunding one would mint credits.
    const serviceRoleKey = cost > 0 ? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") : null;
    if (serviceRoleKey) {
      const admin = createClient(SUPABASE_URL, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      // Bucket-accurate refund. Try newest signature first and degrade, so this
      // function is safe to deploy before (or after) 0027 and 0026 are applied.
      //   4-arg (0027): bonus + free + paid
      //   3-arg (0026): free + paid
      //   2-arg (pre):  flat amount into the free bucket
      const { error: refund4Err } = await admin.rpc("refund_ai_tokens", {
        p_user: userId,
        p_from_bonus: spentFromBonus,
        p_from_free: spentFromFree,
        p_from_paid: spentFromPaid,
      });
      if (refund4Err) {
        const { error: refund3Err } = await admin.rpc("refund_ai_tokens", {
          p_user: userId,
          // Without a bonus bucket, bonus-funded spend is closest to free.
          p_from_free: spentFromFree + spentFromBonus,
          p_from_paid: spentFromPaid,
        });
        if (refund3Err) {
          await admin.rpc("refund_ai_tokens", {
            p_user: userId,
            p_amount: cost,
          }).catch(() => {});
        }
      }
    }
    return json(502, { error: "ai_unavailable" });
  }
});
