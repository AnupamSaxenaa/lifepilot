// Public LifePilot invitation bridge. Deploy with: supabase functions deploy invite --no-verify-jwt
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const securityHeaders = (nonce: string) => ({
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store, max-age=0",
  "Pragma": "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
    "connect-src 'none'",
    "img-src 'none'",
    "font-src 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; "),
});

const page = (nonce: string) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>LifePilot invitation</title>
  <style nonce="${nonce}">
    :root { color-scheme: dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: #050505; color: #f4f4f5; padding: 24px; }
    main { width: min(100%, 440px); border: 1px solid #29292d; border-radius: 20px; background: #0d0d0f; padding: 28px; }
    .mark { width: 42px; height: 42px; display: grid; place-items: center; border: 1px solid #343438; border-radius: 12px; font-size: 20px; }
    h1 { margin: 22px 0 10px; font-size: 25px; font-weight: 450; letter-spacing: -0.02em; }
    p { margin: 0; color: #a1a1aa; font-size: 15px; font-weight: 300; line-height: 1.55; }
    a { min-height: 50px; margin-top: 24px; display: flex; align-items: center; justify-content: center; border-radius: 13px; background: #f4f4f5; color: #09090b; font-size: 15px; font-weight: 550; text-decoration: none; }
    a.disabled { pointer-events: none; background: #29292d; color: #71717a; }
    .help { margin-top: 18px; font-size: 12px; }
    #status { margin-top: 14px; color: #d4d4d8; font-size: 13px; }
  </style>
</head>
<body>
  <main>
    <div class="mark" aria-hidden="true">LP</div>
    <h1>You’re invited to LifePilot</h1>
    <p>Open LifePilot to review this shared-space invitation. Access is granted only after you sign in and accept.</p>
    <a id="open-app" class="disabled" aria-disabled="true">Open LifePilot</a>
    <p id="status" role="status">Checking invitation link…</p>
    <p class="help">If LifePilot is not installed, install it first, then open this invitation link again.</p>
  </main>
  <script nonce="${nonce}">
    (() => {
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const token = fragment.get('token') || '';
      history.replaceState(null, '', window.location.pathname);

      const button = document.getElementById('open-app');
      const status = document.getElementById('status');
      if (!/^[a-f0-9]{64}$/i.test(token)) {
        status.textContent = 'This invitation link is invalid.';
        return;
      }

      button.href = 'lifepilot://invite/' + encodeURIComponent(token);
      button.classList.remove('disabled');
      button.removeAttribute('aria-disabled');
      status.textContent = 'Invitation link ready.';
    })();
  </script>
</body>
</html>`;

serve((request: Request) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { "Allow": "GET, HEAD", "Cache-Control": "no-store" },
    });
  }

  const nonce = crypto.randomUUID().replaceAll("-", "");
  return new Response(request.method === "HEAD" ? null : page(nonce), {
    status: 200,
    headers: securityHeaders(nonce),
  });
});
