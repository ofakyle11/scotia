'use strict';
// CanLII connector — official REST API + deep links only. No scraping, no
// bulk download: CanLII's Terms of Use prohibit both, and the API docs
// (github.com/canlii/API_documentation) define everything used here.
// Live mode needs an API key (requested from CanLII via their feedback
// form; commercial use is a conversation with CanLII — Build Sheet Gap 4).
const BASE = 'https://api.canlii.org/v1';

// Neutral-citation court code -> CanLII databaseId (differs where noted).
const DB_MAP = {
  scc: 'csc-scc', csc: 'csc-scc', caf: 'fca', cf: 'fc', cci: 'tcc',
};
const NEUTRAL_RX = /\b((?:19|20)\d{2})\s+(SCC|CSC|FCA|CAF|FC|CF|TCC|CCI|ONCA|ONSC|ONSCDC|ONCJ|BCCA|BCSC|BCPC|ABCA|ABQB|ABKB|ABPC|ABCJ|SKCA|SKQB|SKKB|SKPC|MBCA|MBQB|MBKB|MBPC|NSCA|NSSC|NSPC|NBCA|NBQB|NBKB|NBPC|PECA|PESC|NLCA|NLSC|NLPC|YKCA|YKSC|NWTCA|NWTSC|NUCA|NUCJ|QCCA|QCCS|QCCQ|QCTDP)\s+(\d{1,5})\b/g;
const CANLII_RX = /\b((?:19|20)\d{2})\s+CanLII\s+(\d{1,6})\s*\(\s*([A-Z]{2,4}(?:\s+[A-Z]{2,4})?)\s*\)/g;
const SCR_RX = /\[((?:19|20)\d{2})\]\s+(\d+)\s+S\.?C\.?R\.?\s+(\d+)/g;

function parseCitations(text) {
  const found = new Map();
  let m;
  NEUTRAL_RX.lastIndex = 0;
  while ((m = NEUTRAL_RX.exec(text))) {
    const [raw, year, code, num] = m;
    const lc = code.toLowerCase();
    found.set(raw, {
      cite: `${year} ${code} ${num}`, kind: 'neutral',
      ids: { databaseId: DB_MAP[lc] || lc, caseId: `${year}${lc}${num}` },
    });
  }
  CANLII_RX.lastIndex = 0;
  while ((m = CANLII_RX.exec(text))) {
    const [raw, year, num, court] = m;
    const lc = court.replace(/\s+/g, '').toLowerCase();
    found.set(raw, {
      cite: `${year} CanLII ${num} (${court})`, kind: 'canlii',
      ids: { databaseId: DB_MAP[lc] || lc, caseId: `${year}canlii${num}` },
    });
  }
  SCR_RX.lastIndex = 0;
  while ((m = SCR_RX.exec(text))) {
    const [raw, year, vol, page] = m;
    found.set(raw, { cite: `[${year}] ${vol} SCR ${page}`, kind: 'scr', ids: null });
  }
  return [...found.values()];
}

// Linking to canlii.org is permitted and encouraged; this is the no-key mode.
const searchUrl = (cite) => 'https://www.canlii.org/en/search/?text=' + encodeURIComponent(cite);

async function apiGet(path, key) {
  if (!key) return { ok: false, status: 0, message: 'No API key configured — link-out mode.' };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(key)}`;
    const r = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
    const body = await r.json().catch(() => null);
    if (!r.ok) {
      const msg = r.status === 401 || r.status === 403 ? 'CanLII refused the API key.'
        : r.status === 404 ? 'Not found on CanLII (id derivation may not match this cite).'
        : r.status === 429 ? 'CanLII rate limit reached — slow down.'
        : `CanLII API error ${r.status}.`;
      return { ok: false, status: r.status, message: (body && body.message) || msg };
    }
    return { ok: true, data: body };
  } catch (e) {
    return { ok: false, status: 0, message: e.name === 'AbortError' ? 'CanLII API timed out.' : 'Network error reaching CanLII: ' + e.message };
  } finally { clearTimeout(timer); }
}

const fetchDatabases = (key) => apiGet('/caseBrowse/en/', key);
const fetchCase = (ids, key) => apiGet(`/caseBrowse/en/${ids.databaseId}/${ids.caseId}/`, key);
const fetchCitator = (ids, type, key) => apiGet(`/caseCitator/en/${ids.databaseId}/${ids.caseId}/${type}`, key); // citedCases | citingCases | citedLegislations

module.exports = { parseCitations, searchUrl, fetchDatabases, fetchCase, fetchCitator, DB_MAP };
