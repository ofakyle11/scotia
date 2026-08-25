'use strict';
// US courts connector — RECAP/CourtListener official API (Free Law Project)
// plus PACER deep links. RECAP-first: what the archive already holds is free;
// PACER itself is credentialed and fee-based ($0.10/page) with no free API —
// we link into it, never scrape it.
const BASE = 'https://www.courtlistener.com';

async function clGet(path, token) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const headers = { accept: 'application/json', 'user-agent': 'Chambers-platform' };
    if (token) headers.authorization = 'Token ' + token;
    const r = await fetch(BASE + path, { signal: ctl.signal, headers });
    const body = await r.json().catch(() => null);
    if (!r.ok) {
      const msg = r.status === 429 ? 'CourtListener rate limit — add an API token or slow down.'
        : r.status === 401 || r.status === 403 ? 'CourtListener refused the token.'
        : `CourtListener error ${r.status}.`;
      return { ok: false, status: r.status, message: (body && body.detail) || msg };
    }
    return { ok: true, data: body };
  } catch (e) {
    return { ok: false, status: 0, message: e.name === 'AbortError' ? 'CourtListener timed out.' : 'Network error: ' + e.message };
  } finally { clearTimeout(timer); }
}

// type: 'o' opinions · 'r' RECAP dockets/filings
async function search(q, type, token) {
  const out = await clGet(`/api/rest/v4/search/?q=${encodeURIComponent(q)}&type=${type === 'r' ? 'r' : 'o'}&order_by=score%20desc`, token);
  if (!out.ok) return out;
  const results = (out.data.results || []).slice(0, 20).map((r) => ({
    caseName: r.caseName || r.caseNameFull || '', court: r.court || r.court_citation_string || r.court_id || '',
    dateFiled: r.dateFiled || '', docketNumber: r.docketNumber || '',
    citation: Array.isArray(r.citation) ? r.citation.filter(Boolean) : (r.citation ? [r.citation] : []),
    citeCount: r.citeCount ?? null, status: r.status || '',
    url: r.absolute_url ? BASE + r.absolute_url : '',
  }));
  return { ok: true, count: out.data.count, results };
}

const links = {
  pacerLocator: 'https://pcl.uscourts.gov/pcl/index.jsf',
  pacer: 'https://pacer.uscourts.gov',
  recapSearch: (q) => `${BASE}/?q=${encodeURIComponent(q)}&type=r`,
};

module.exports = { search, links, BASE };
