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
//                       application form submissions to the staff dashboard,
//                       and lets the traffic counter write to Netlify Blobs.
//
// No password is stored anywhere — only the sha256 digest of user:pass.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const SITE_ID_FALLBACK = "70e29db6-a22c-4867-bab5-77fa668cad3d";

const DEFAULT_USER = "AngusAnderson";
const DEFAULT_PASS_HASH = "04ca8a0374f0ec45b22bafe51f9ebf26ffefb88627359125bc6579e72fe2795d";
const SESSION_DAYS = 365; // long-lived staff login; renewed on every visit, so it holds indefinitely
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
  const exp = String(Date.now() + SESSION_DAYS * 86400 * 1000);
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

// ---------- first-party traffic analytics (stored in Netlify Blobs) ----------

async function analyticsStore() {
  if (process.env.LOCAL_BLOBS_DIR) {
    const fs = await import("node:fs/promises");
    const p = await import("node:path");
    const dir = process.env.LOCAL_BLOBS_DIR;
    return {
      async get(key) {
        try { return JSON.parse(await fs.readFile(p.join(dir, key + ".json"), "utf8")); }
        catch { return null; }
      },
      async setJSON(key, val) { await fs.writeFile(p.join(dir, key + ".json"), JSON.stringify(val)); },
    };
  }
  const { getStore } = await import("@netlify/blobs");
  const opts = { name: "analytics", consistency: "strong" };
  // Explicit credentials make Blobs work on every deploy type.
  if (process.env.NETLIFY_API_TOKEN) {
    opts.siteID = process.env.SITE_ID || SITE_ID_FALLBACK;
    opts.token = process.env.NETLIFY_API_TOKEN;
  }
  const store = getStore(opts);
  return {
    async get(key) { return await store.get(key, { type: "json" }); },
    async setJSON(key, val) { await store.setJSON(key, val); },
  };
}

const dayStamp = (offset = 0) => new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);

async function recordHit(req, context) {
  const ua = req.headers.get("user-agent") || "";
  if (/bot|crawl|spider|slurp|curl|wget|python|headless|lighthouse|pingdom|monitor|preview/i.test(ua)) {
    return json({ ok: true, ignored: true });
  }
  const body = await req.json().catch(() => ({}));
  const store = await analyticsStore().catch(() => null);
  if (!store) return json({ ok: false }, 200);
  const ip = context?.ip || req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "";
  const day = dayStamp();
  const visitor = createHash("sha256").update(ip + "|" + ua + "|" + day).digest("hex").slice(0, 16);
  const page = typeof body.path === "string" && body.path ? body.path.slice(0, 200) : "/";
  let source = "(direct)";
  try {
    if (typeof body.ref === "string" && body.ref) {
      const host = new URL(body.ref).hostname;
      if (host && host !== new URL(req.url).hostname) source = host;
      else if (host) source = null; // internal navigation — not a source
    }
  } catch { /* unparseable referrer -> counts as direct */ }
  const country = context?.geo?.country?.code || "";
  const key = "day-" + day;
  const agg = (await store.get(key).catch(() => null)) ||
    { hits: 0, visitors: {}, pages: {}, sources: {}, countries: {} };
  agg.hits += 1;
  agg.visitors[visitor] = (agg.visitors[visitor] || 0) + 1;
  agg.pages[page] = (agg.pages[page] || 0) + 1;
  if (source) agg.sources[source] = (agg.sources[source] || 0) + 1;
  if (country) agg.countries[country] = (agg.countries[country] || 0) + 1;
  await store.setJSON(key, agg);
  return json({ ok: true });
}

function topEntries(counts, n) {
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([name, count]) => ({ name, count }));
}

async function trafficSummary() {
  const store = await analyticsStore().catch(() => null);
  if (!store) return null;
  let today = 0, last7 = 0, last30 = 0;
  const visitors = new Set();
  const pages = {}, sources = {}, countries = {}, daily = [];
  for (let i = 0; i < 30; i++) {
    const agg = await store.get("day-" + dayStamp(i)).catch(() => null);
    const hits = agg ? agg.hits : 0;
    daily.push({ date: dayStamp(i), hits });
    if (!agg) continue;
    last30 += hits;
    if (i === 0) today = hits;
    if (i < 7) last7 += hits;
    Object.keys(agg.visitors || {}).forEach((v) => visitors.add(dayStamp(i) + v));
    for (const [k, v] of Object.entries(agg.pages || {})) pages[k] = (pages[k] || 0) + v;
    for (const [k, v] of Object.entries(agg.sources || {})) sources[k] = (sources[k] || 0) + v;
    for (const [k, v] of Object.entries(agg.countries || {})) countries[k] = (countries[k] || 0) + v;
  }
  return {
    today, last7, last30, uniques30: visitors.size,
    pages: topEntries(pages, 10), sources: topEntries(sources, 10), countries: topEntries(countries, 10),
    daily,
  };
}

export default async (req, context) => {
  const path = new URL(req.url).pathname;

  if (path === "/api/hit" && req.method === "POST") {
    return recordHit(req, context);
  }

  if (path === "/api/login" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const user = process.env.ADMIN_USER || DEFAULT_USER;
    const wantHash = process.env.ADMIN_PASS_HASH || DEFAULT_PASS_HASH;
    const gotHash = createHash("sha256")
      .update(`${body.username || ""}:${body.password || ""}`)
      .digest("hex");
    const ok = safeEqualHex(body.username || "", user) && safeEqualHex(gotHash, wantHash);
    if (!ok) return json({ ok: false }, 401);
    return json({ ok: true }, 200, { "set-cookie": cookieAttrs(req, makeToken(), SESSION_DAYS * 86400) });
  }

  if (path === "/api/logout" && req.method === "POST") {
    return json({ ok: true }, 200, { "set-cookie": cookieAttrs(req, "gone", 0) });
  }

  if (path === "/api/session" && req.method === "GET") {
    const authed = tokenValid(readCookie(req));
    const headers = authed ? { "set-cookie": cookieAttrs(req, makeToken(), SESSION_DAYS * 86400) } : {};
    return json({ backend: true, authed }, 200, headers);
  }

  if (path === "/api/metrics" && req.method === "GET") {
    if (!tokenValid(readCookie(req))) return json({ error: "unauthorized" }, 401);
    // refresh the session on every authenticated use so it never lapses
    const refresh = { "set-cookie": cookieAttrs(req, makeToken(), SESSION_DAYS * 86400) };
    const out = { data: null, forms: null, traffic: null };
    // Try each base until one serves valid JSON — the deploy's own URL first,
    // so a hijacked/misconfigured custom domain can't break the dashboard.
    const bases = [process.env.DEPLOY_PRIME_URL, process.env.URL, new URL(req.url).origin,
      "https://darling-bunny-fd98d0.netlify.app"].filter(Boolean);
    for (const base of bases) {
      try {
        out.data = await (await fetch(`${base}/data/tough-mudder.json`)).json();
        if (out.data && Array.isArray(out.data.runners)) break;
        out.data = null;
      } catch { out.data = null; }
    }
    try {
      out.forms = await fetchForms(context?.site?.id || process.env.SITE_ID);
    } catch { /* optional */ }
    try {
      out.traffic = await trafficSummary();
    } catch { /* optional */ }
    out.diag = { formsToken: !!process.env.NETLIFY_API_TOKEN, siteId: context?.site?.id || process.env.SITE_ID || null };
    return json(out, 200, refresh);
  }

  return json({ error: "not found" }, 404);
};

export const config = { path: "/api/*" };
