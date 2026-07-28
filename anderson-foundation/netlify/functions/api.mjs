// Staff backend: server-side login, signed HttpOnly session cookies, and
// authenticated metrics. Runs as a Netlify Function — this code executes on
// the server, never in the visitor's browser.
//
// Environment variables (Site configuration -> Environment variables):
//   SESSION_SECRET      recommended — random hex used to sign session cookies.
//                       Without it a derived fallback key is used.
//   ADMIN_USER          optional — overrides the default staff username.
//   ADMIN_PASS_HASH     optional — sha256 hex of "username:password"; lets you
//                       rotate the password without a redeploy.
//   NETLIFY_API_TOKEN   optional — personal access token; adds pledge/
//                       application form submissions to the staff dashboard.
//   GOATCOUNTER_TOKEN   optional — GoatCounter API token; adds traffic totals.
//   GOATCOUNTER_CODE    optional — GoatCounter site code (default angusanderson).
//
// No password is stored anywhere — only the sha256 digest of user:pass.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_USER = "AngusAnderson";
const DEFAULT_PASS_HASH = "04ca8a0374f0ec45b22bafe51f9ebf26ffefb88627359125bc6579e72fe2795d";
const SESSION_HOURS = 12;
const COOKIE = "aaf_session";

function sessionKey() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  // Fallback: derived key so the site works before any env vars are set.
  // Setting SESSION_SECRET in Netlify upgrades this to a true server secret.
  return createHash("sha256")
    .update("aaf-derived:" + (process.env.ADMIN_PASS_HASH || DEFAULT_PASS_HASH) + ":" + (process.env.URL || ""))
    .digest("hex");
}

function safeEqualHex(a, b) {
  const ba = Buffer.from(String(a), "utf8");
  const bb = Buffer.from(String(b), "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function makeToken() {
  const exp = String(Date.now() + SESSION_HOURS * 3600 * 1000);
  const mac = createHmac("sha256", sessionKey()).update(exp).digest("hex");
  return exp + "." + mac;
}

function tokenValid(token) {
  if (typeof token !== "string") return false;
  const dot = token.indexOf(".");
  if (dot < 1) return false;
  const exp = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const want = createHmac("sha256", sessionKey()).update(exp).digest("hex");
  if (!safeEqualHex(mac, want)) return false;
  return Number(exp) > Date.now();
}

function readCookie(req) {
  const header = req.headers.get("cookie") || "";
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq) === COOKIE) return part.slice(eq + 1);
  }
  return null;
}

function cookieAttrs(req, value, maxAge) {
  const secure = new URL(req.url).protocol === "https:" ? " Secure;" : "";
  return `${COOKIE}=${value}; Path=/; HttpOnly;${secure} SameSite=Strict; Max-Age=${maxAge}`;
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

async function fetchForms(siteId) {
  const token = process.env.NETLIFY_API_TOKEN;
  if (!token || !siteId) return null;
  const auth = { headers: { authorization: `Bearer ${token}` } };
  const forms = await (await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/forms`, auth)).json();
  const out = [];
  for (const f of Array.isArray(forms) ? forms : []) {
    const entry = { name: f.name, count: f.submission_count || 0, latest: [] };
    try {
      const subs = await (await fetch(`https://api.netlify.com/api/v1/forms/${f.id}/submissions?per_page=5`, auth)).json();
      entry.latest = (Array.isArray(subs) ? subs : []).map((s) => ({
        at: s.created_at,
        summary: s.summary || s.name || "",
        fields: s.human_fields || {},
      }));
    } catch { /* keep counts even if submissions fail */ }
    out.push(entry);
  }
  return out;
}

async function fetchTraffic() {
  const token = process.env.GOATCOUNTER_TOKEN;
  const code = process.env.GOATCOUNTER_CODE || "angusanderson";
  if (!token) return null;
  const since = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);
  const r = await fetch(`https://${code}.goatcounter.com/api/v0/stats/total?start=${since}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const t = await r.json();
  return { total30d: t.total, totalUnique30d: t.total_utc ?? t.total_unique ?? null };
}

export default async (req, context) => {
  const path = new URL(req.url).pathname;

  if (path === "/api/login" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const user = process.env.ADMIN_USER || DEFAULT_USER;
    const wantHash = process.env.ADMIN_PASS_HASH || DEFAULT_PASS_HASH;
    const gotHash = createHash("sha256")
      .update(`${body.username || ""}:${body.password || ""}`)
      .digest("hex");
    const ok = safeEqualHex(body.username || "", user) && safeEqualHex(gotHash, wantHash);
    if (!ok) return json({ ok: false }, 401);
    return json({ ok: true }, 200, { "set-cookie": cookieAttrs(req, makeToken(), SESSION_HOURS * 3600) });
  }

  if (path === "/api/logout" && req.method === "POST") {
    return json({ ok: true }, 200, { "set-cookie": cookieAttrs(req, "gone", 0) });
  }

  if (path === "/api/session" && req.method === "GET") {
    return json({ backend: true, authed: tokenValid(readCookie(req)) });
  }

  if (path === "/api/metrics" && req.method === "GET") {
    if (!tokenValid(readCookie(req))) return json({ error: "unauthorized" }, 401);
    const base = process.env.URL || new URL(req.url).origin;
    const out = { data: null, forms: null, traffic: null };
    try {
      out.data = await (await fetch(`${base}/data/tough-mudder.json`)).json();
    } catch { /* dashboard shows data-unavailable tile */ }
    try {
      out.forms = await fetchForms(context?.site?.id || process.env.SITE_ID);
    } catch { /* optional */ }
    try {
      out.traffic = await fetchTraffic();
    } catch { /* optional */ }
    return json(out);
  }

  return json({ error: "not found" }, 404);
};

export const config = { path: "/api/*" };
