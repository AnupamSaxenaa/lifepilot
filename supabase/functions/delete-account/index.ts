// ============================================================================
// LifePilot — Account deletion (Supabase Edge Function)
// ----------------------------------------------------------------------------
// Permanently deletes the CALLER's account. Required by Google Play's User Data
// policy for any app that lets users create an account.
//
// THE SECURITY PROPERTY THAT MATTERS
//   The user id is taken from the caller's VERIFIED JWT and never from the
//   request body. If it came from the body, any authenticated user could delete
//   anybody else's account by passing a different id. There is deliberately no
//   parameter for choosing whose account to delete.
//
// ORDER OF OPERATIONS
//   1. Verify the JWT and resolve the caller's id.
//   2. Delete storage objects (avatar/<uid>/, feedback-attachments/<uid>/).
//      Storage is unreachable from SQL, and it must happen BEFORE the database
//      rows go, because once the account is gone we lose the ability to
//      enumerate what belonged to it.
//   3. Call public.delete_account(uid), which resolves Space ownership, clears
//      non-cascading tables and finally deletes the auth.users row.
//
// Storage failures are reported but do NOT abort the database deletion. A user
// asking to be deleted must not be left with a live account because one orphan
// image could not be removed; leftover blobs are logged for cleanup instead.
//
// Deploy:
//   supabase functions deploy delete-account
//   (JWT verification ON — this must only ever run for a signed-in caller.)
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

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

/** Remove every object under `<uid>/` in a bucket. Returns how many were deleted. */
async function purgeUserFolder(
  admin: ReturnType<typeof createClient>,
  bucket: string,
  userId: string,
): Promise<{ removed: number; error?: string }> {
  try {
    const { data: files, error: listErr } = await admin.storage.from(bucket).list(userId);
    if (listErr) return { removed: 0, error: listErr.message };
    if (!files || files.length === 0) return { removed: 0 };

    // Filenames are user-supplied, so never assume a fixed set — enumerate.
    const paths = files.map((f: { name: string }) => `${userId}/${f.name}`);
    const { error: rmErr } = await admin.storage.from(bucket).remove(paths);
    if (rmErr) return { removed: 0, error: rmErr.message };
    return { removed: paths.length };
  } catch (e) {
    return { removed: 0, error: (e as Error).message };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_ROLE = Deno.env.get("SERVICE_ROLE_KEY")
    ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (!SERVICE_ROLE) {
    console.error("[delete-account] service role key missing");
    return json(500, { error: "misconfigured" });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json(401, { error: "unauthorized" });
  }

  // Resolve the caller against their own token. This is the ONLY source of the
  // id we delete.
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await caller.auth.getUser();
  const userId = userData?.user?.id;
  if (userErr || !userId) {
    return json(401, { error: "unauthorized" });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── Storage first, while we can still enumerate the user's folders ───────
  const storageWarnings: string[] = [];
  for (const bucket of ["avatar", "feedback-attachments"]) {
    const result = await purgeUserFolder(admin, bucket, userId);
    if (result.error) {
      // Logged, not fatal — see the header note on why deletion still proceeds.
      console.warn(`[delete-account] ${bucket} purge issue:`, result.error);
      storageWarnings.push(`${bucket}: ${result.error}`);
    }
  }

  // ── Database, including the auth account ────────────────────────────────
  const { data: report, error: rpcErr } = await admin.rpc("delete_account", {
    p_user: userId,
  });

  if (rpcErr) {
    console.error("[delete-account] delete_account failed:", rpcErr.message);
    return json(500, { error: "deletion_failed", detail: rpcErr.message });
  }

  if (!report?.ok) {
    // The RPC ran but did not remove an auth row — treat as failure so the app
    // never tells the user their account is gone when it is not.
    console.error("[delete-account] deletion incomplete:", JSON.stringify(report));
    return json(500, { error: "deletion_incomplete", report });
  }

  console.log("[delete-account] completed for", userId, JSON.stringify(report));
  return json(200, {
    ok: true,
    report,
    ...(storageWarnings.length > 0 ? { storageWarnings } : {}),
  });
});
