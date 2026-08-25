'use strict';
// Minimal HTTP router. No dependencies. Urlencoded + JSON bodies,
// cookies, param routes, origin check on writes.
const http = require('http');
const { URL } = require('url');

const MAX_BODY = 25 * 1024 * 1024;

function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie;
  if (!h) return out;
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

class App {
  constructor() { this.routes = []; }
  route(method, pattern, handler) {
    const keys = [];
    const rx = new RegExp('^' + pattern.replace(/:[a-zA-Z]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
    this.routes.push({ method, pattern, rx, keys, handler });
  }
  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.rx.exec(pathname);
      if (m) {
        const params = {};
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        return { route: r, params };
      }
    }
    return null;
  }
  listen(port, makeCtx, onError) {
    const server = http.createServer(async (req, res) => {
      try {
        const u = new URL(req.url, 'http://localhost');
        const found = this.match(req.method, u.pathname);
        if (!found) { send(res, 404, 'Not found.'); return; }
        // Same-origin check on state-changing requests.
        if (req.method === 'POST') {
          const origin = req.headers.origin || req.headers.referer;
          if (origin) {
            const oh = new URL(origin).host;
            if (oh !== req.headers.host) { send(res, 403, 'Cross-origin request refused.'); return; }
          }
        }
        const body = req.method === 'POST' ? await readBody(req) : {};
        const ctx = await makeCtx(req, res, { params: found.params, query: u.searchParams, body, cookies: parseCookies(req), pathname: u.pathname });
        if (ctx === null) return; // makeCtx already responded (redirect to login etc.)
        await found.route.handler(req, res, ctx);
        if (!res.writableEnded) send(res, 500, 'Handler did not respond.');
      } catch (err) {
        if (onError) onError(err, req);
        if (!res.writableEnded) {
          if (err && err.code === 'SHREDDED') send(res, 410, 'This matter has been destroyed under its retention schedule.');
          else send(res, 500, 'Internal error.');
        }
      }
    });
    server.listen(port);
    return server;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const ct = (req.headers['content-type'] || '').split(';')[0].trim();
      try {
        if (ct === 'application/json') resolve(JSON.parse(raw.toString('utf8') || '{}'));
        else if (ct === 'application/x-www-form-urlencoded') {
          const out = {};
          for (const [k, v] of new URLSearchParams(raw.toString('utf8'))) out[k] = v;
          resolve(out);
        } else resolve({ _raw: raw });
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function send(res, status, text) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(text);
}

function html(res, body, status = 200, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
    'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; img-src 'self' data:; form-action 'self'",
    ...extraHeaders,
  });
  res.end(body);
}

function redirect(res, to, setCookie) {
  const h = { Location: to };
  if (setCookie) h['Set-Cookie'] = setCookie;
  res.writeHead(303, h);
  res.end();
}

function cookie(name, value, opts = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict`;
  if (opts.maxAge !== undefined) c += `; Max-Age=${opts.maxAge}`;
  return c;
}

module.exports = { App, send, html, redirect, cookie };
