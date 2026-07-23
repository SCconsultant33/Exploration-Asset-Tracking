const JSON_PATH = "data/assets.json";
const API_VERSION = "2022-11-28";
const REVIEW_STATUSES = new Set(["pending", "not_approved", "approved"]);

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (error) {
      console.error(error);
      return json({ error: "The request could not be completed." }, 500, request, env);
    }
  }
};

async function route(request, env) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");

  if (request.method === "OPTIONS") {
    if (!isAllowedOrigin(origin, env)) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (url.pathname === "/health") {
    return json({ ok: true, service: "exploration-asset-tracking-api" }, 200, request, env);
  }

  if (url.pathname === "/auth/login" && request.method === "GET") {
    assertConfigured(env, ["GITHUB_CLIENT_ID", "SESSION_SECRET", "DASHBOARD_URL"]);
    const returnTo = url.searchParams.get("return_to") || env.DASHBOARD_URL;
    if (!isAllowedReturnUrl(returnTo, env)) return text("Invalid return URL.", 400);
    const state = await signToken({
      kind: "oauth-state",
      returnTo,
      exp: Date.now() + 10 * 60 * 1000
    }, env.SESSION_SECRET);
    const authorize = new URL("https://github.com/login/oauth/authorize");
    authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
    authorize.searchParams.set("redirect_uri", url.origin + "/auth/callback");
    authorize.searchParams.set("scope", "read:user");
    authorize.searchParams.set("state", state);
    return Response.redirect(authorize.toString(), 302);
  }

  if (url.pathname === "/auth/callback" && request.method === "GET") {
    assertConfigured(env, ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "SESSION_SECRET", "DASHBOARD_URL", "ALLOWED_GITHUB_LOGIN"]);
    const code = url.searchParams.get("code");
    const state = await verifyToken(url.searchParams.get("state"), env.SESSION_SECRET, "oauth-state");
    if (!code || !state || !isAllowedReturnUrl(state.returnTo, env)) return text("The GitHub sign-in request is invalid or expired.", 400);

    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Accept": "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: url.origin + "/auth/callback"
      })
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) return text("GitHub sign-in could not be completed.", 401);

    const userResponse = await fetch("https://api.github.com/user", {
      headers: githubHeaders(tokenData.access_token)
    });
    const user = await userResponse.json();
    if (!userResponse.ok || String(user.login).toLowerCase() !== String(env.ALLOWED_GITHUB_LOGIN).toLowerCase()) {
      await revokeOAuthToken(env, tokenData.access_token);
      return text("This GitHub account is not allowed to edit the dashboard.", 403);
    }

    const session = await signToken({
      kind: "session",
      login: user.login,
      exp: Date.now() + 8 * 60 * 60 * 1000
    }, env.SESSION_SECRET);
    await revokeOAuthToken(env, tokenData.access_token);

    const destination = new URL(state.returnTo);
    destination.hash = "session=" + encodeURIComponent(session);
    return Response.redirect(destination.toString(), 302);
  }

  if (url.pathname === "/api/session" && request.method === "GET") {
    const session = await requireSession(request, env);
    return json({ authenticated: true, login: session.login }, 200, request, env);
  }

  if (url.pathname.startsWith("/api/assets/") && request.method === "PATCH") {
    const session = await requireSession(request, env);
    if (!isAllowedOrigin(origin, env)) return json({ error: "Origin is not allowed." }, 403, request, env);

    const assetId = decodeURIComponent(url.pathname.slice("/api/assets/".length));
    if (!assetId || assetId.length > 160) return json({ error: "Invalid asset ID." }, 400, request, env);

    let input;
    try { input = await request.json(); }
    catch (error) { return json({ error: "A JSON request body is required." }, 400, request, env); }

    const changes = validateChanges(input);
    if (changes.error) return json({ error: changes.error }, 400, request, env);

    const result = await updateAsset(assetId, changes.value, session.login, env);
    return json(result, 200, request, env);
  }

  return json({ error: "Not found." }, 404, request, env);
}

function validateChanges(input) {
  if (!input || typeof input !== "object") return { error: "Invalid update." };
  if (!REVIEW_STATUSES.has(input.review_status)) return { error: "Invalid review status." };
  if (typeof input.used_for_exploration !== "boolean") return { error: "Invalid usage value." };

  let usedDate = null;
  if (input.used_for_exploration) {
    if (typeof input.used_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.used_date)) {
      return { error: "A valid date used is required." };
    }
    const parsed = new Date(input.used_date + "T00:00:00Z");
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== input.used_date) {
      return { error: "The date used is not valid." };
    }
    usedDate = input.used_date;
  }

  return {
    value: {
      review_status: input.review_status,
      used_for_exploration: input.used_for_exploration,
      used_date: usedDate
    }
  };
}

async function updateAsset(assetId, changes, login, env) {
  assertConfigured(env, ["GITHUB_CONTENT_TOKEN", "GITHUB_OWNER", "GITHUB_REPO"]);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = await readRegistry(env);
    const index = current.registry.assets.findIndex((asset) => asset.id === assetId);
    if (index < 0) throw httpError(404, "Asset not found.");

    const updatedAt = new Date().toISOString();
    current.registry.assets[index] = {
      ...current.registry.assets[index],
      ...changes,
      last_updated_at: updatedAt,
      last_updated_by: login
    };
    current.registry.updated_at = updatedAt.slice(0, 10);

    const response = await fetch(githubContentsUrl(env), {
      method: "PUT",
      headers: githubHeaders(env.GITHUB_CONTENT_TOKEN),
      body: JSON.stringify({
        message: "Update tracking for " + current.registry.assets[index].title,
        content: encodeBase64(JSON.stringify(current.registry, null, 2) + "\n"),
        sha: current.sha
      })
    });

    if (response.ok) {
      const commit = await response.json();
      return {
        asset: current.registry.assets[index],
        commit_sha: commit.commit && commit.commit.sha,
        saved_at: updatedAt
      };
    }

    if ((response.status === 409 || response.status === 422) && attempt === 0) continue;
    const detail = await safeJson(response);
    throw httpError(response.status, detail.message || "GitHub rejected the update.");
  }

  throw httpError(409, "The registry changed during the save. Please try again.");
}

async function readRegistry(env) {
  const response = await fetch(githubContentsUrl(env), {
    headers: githubHeaders(env.GITHUB_CONTENT_TOKEN)
  });
  const data = await safeJson(response);
  if (!response.ok) throw httpError(response.status, data.message || "Could not read the asset registry.");
  return {
    sha: data.sha,
    registry: JSON.parse(decodeBase64(String(data.content || "").replace(/\s/g, "")))
  };
}

function githubContentsUrl(env) {
  return "https://api.github.com/repos/" + encodeURIComponent(env.GITHUB_OWNER) + "/" +
    encodeURIComponent(env.GITHUB_REPO) + "/contents/" + JSON_PATH;
}

function githubHeaders(token) {
  return {
    "Accept": "application/vnd.github+json",
    "Authorization": "Bearer " + token,
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": "exploration-asset-tracking"
  };
}

async function requireSession(request, env) {
  assertConfigured(env, ["SESSION_SECRET", "ALLOWED_GITHUB_LOGIN"]);
  const authorization = request.headers.get("Authorization") || "";
  const session = await verifyToken(authorization.replace(/^Bearer\s+/i, ""), env.SESSION_SECRET, "session");
  if (!session || String(session.login).toLowerCase() !== String(env.ALLOWED_GITHUB_LOGIN).toLowerCase()) {
    throw httpError(401, "Sign in with GitHub to save changes.");
  }
  return session;
}

async function signToken(payload, secret) {
  const encoded = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmac(encoded, secret);
  return encoded + "." + signature;
}

async function verifyToken(token, secret, kind) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const expected = await hmac(parts[0], secret);
  if (!constantTimeEqual(parts[1], expected)) return null;
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0]))); }
  catch (error) { return null; }
  if (payload.kind !== kind || typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
  return payload;
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return base64UrlEncode(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))));
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function encodeBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value) {
  const binary = atob(value);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

function isAllowedReturnUrl(value, env) {
  try {
    const candidate = new URL(value);
    const allowed = new URL(env.DASHBOARD_URL);
    return candidate.origin === allowed.origin && candidate.pathname === allowed.pathname;
  } catch (error) {
    return false;
  }
}

function isAllowedOrigin(origin, env) {
  if (!origin || !env.ALLOWED_ORIGIN) return false;
  return origin === env.ALLOWED_ORIGIN;
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, PATCH, OPTIONS",
    "Vary": "Origin"
  };
}

function json(body, status, request, env) {
  const origin = request && request.headers.get("Origin");
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  if (isAllowedOrigin(origin, env)) Object.assign(headers, corsHeaders(origin));
  return new Response(JSON.stringify(body), { status, headers });
}

function text(body, status) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

function assertConfigured(env, names) {
  const missing = names.filter((name) => !env[name]);
  if (missing.length) throw httpError(503, "Service configuration is incomplete.");
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function safeJson(response) {
  try { return await response.json(); }
  catch (error) { return {}; }
}

async function revokeOAuthToken(env, token) {
  try {
    const credentials = btoa(env.GITHUB_CLIENT_ID + ":" + env.GITHUB_CLIENT_SECRET);
    await fetch("https://api.github.com/applications/" + encodeURIComponent(env.GITHUB_CLIENT_ID) + "/token", {
      method: "DELETE",
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": "Basic " + credentials,
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": "exploration-asset-tracking"
      },
      body: JSON.stringify({ access_token: token })
    });
  } catch (error) {
    console.error("OAuth token cleanup failed.");
  }
}
