// ============================================================================
// LifePilot — Public legal pages (Supabase Edge Function)
// ----------------------------------------------------------------------------
// Serves the privacy policy and the account-deletion request page at stable
// public HTTPS URLs. Google Play requires both, and a dead or wrong-content link
// is grounds for removal.
//
// WHY NOT GITHUB PAGES
//   This account's user site (anupamsaxenaa.github.io) has a custom domain,
//   classiqdtc.me, which answers every path with an unrelated app. Project pages
//   for the lifepilot repo therefore could not be served reliably from there —
//   requests returned HTTP 200 with the wrong page, which is worse than a 404
//   for review purposes. An edge function involves no DNS and no redirects.
//
// ROUTES
//   /functions/v1/legal            → landing page
//   /functions/v1/legal/privacy    → privacy policy
//   /functions/v1/legal/delete     → account deletion request
//
// The HTML is generated from web/*.html by scripts/build-legal-pages.js, so
// there is a single source of truth; `npm run check` fails if it drifts.
//
// Deploy (must be public — reviewers and users have no Supabase token):
//   supabase functions deploy legal --no-verify-jwt
// ============================================================================

import { DELETE_HTML, INDEX_HTML, PRIVACY_HTML } from "./pages.ts";

const html = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Short cache: these are legal documents that occasionally change, and a
      // stale privacy policy is a compliance problem rather than a cosmetic one.
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      // Static documents with no scripts, forms or third-party resources.
      "Content-Security-Policy": [
        "default-src 'none'",
        "style-src 'unsafe-inline'",
        "img-src 'none'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ].join("; "),
    },
  });

Deno.serve((req: Request) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("method not allowed", { status: 405 });
  }

  const { pathname } = new URL(req.url);
  // Normalise: strip the function prefix and any trailing slash so /legal,
  // /legal/, and /functions/v1/legal all resolve the same way.
  const route = pathname
    .replace(/^\/functions\/v1/, "")
    .replace(/^\/legal/, "")
    .replace(/\/+$/, "")
    .toLowerCase();

  switch (route) {
    case "":
      return html(INDEX_HTML);
    case "/privacy":
    case "/privacy-policy":
      return html(PRIVACY_HTML);
    case "/delete":
    case "/delete-account":
      return html(DELETE_HTML);
    default:
      // Serve the landing page rather than a bare 404, so a mistyped or
      // truncated link still reaches something useful and legally relevant.
      return html(INDEX_HTML, 404);
  }
});
