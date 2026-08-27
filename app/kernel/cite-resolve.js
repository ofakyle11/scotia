'use strict';
// Citation resolution — a thin, honest kernel helper (no room, no UI).
// Given one citation string it detects the jurisdiction and drives the
// existing connectors: Canadian cites through the CanLII API (room 29's
// connector — parseCitations + fetchCase), US reporter cites through
// CourtListener/RECAP (room 30's connector — uscourts.search). It never
// scrapes, never fabricates a case, and never throws: a missing key,
// unconfigured endpoint, or no match all come back as resolved:false with
// a plain-language note and a real link-out URL where one exists.
const canlii = require('./canlii.js');
const uscourts = require('./uscourts.js');

// US reporter citations: "<vol> <reporter> <page>". The reporter token list is
// what distinguishes a real cite from three arbitrary numbers. No /g flag —
// .test() stays stateless. Canadian forms are matched first (below), so this
// only ever sees non-Canadian strings.
const US_CITE_RX = /\b\d{1,4}\s+(?:U\.?\s?S\.?|S\.?\s?Ct\.?|L\.?\s?Ed\.?(?:\s?2d)?|F\.?(?:\s?(?:2d|3d|4th|Supp\.?(?:\s?[23]d)?|App'?x\.?|R\.?D\.?))?|A\.?(?:\s?[23]d)?|P\.?(?:\s?[23]d)?|N\.?E\.?(?:\s?[23]d)?|N\.?W\.?(?:\s?[23]d)?|S\.?E\.?(?:\s?[23]d)?|S\.?W\.?(?:\s?[23]d)?|So\.?(?:\s?[23]d)?|Cal\.?\s?Rptr\.?(?:\s?[23]d)?|N\.?Y\.?S\.?(?:\s?[23]d)?)\s+\d{1,5}\b/;

const result = (resolved, source, title, url, note) => ({
  resolved: !!resolved, source: source || null, title: title || '', url: url || '', note: note || '',
});
const safe = (fn, dflt) => { try { return fn(); } catch (e) { return dflt; } };

// Pure, offline classifier. Returns { jurisdiction: 'CA'|'US'|null, raw, ca }.
// Canadian recognition reuses the connector's parser; US is the reporter regex.
function detect(cite) {
  const raw = String(cite == null ? '' : cite).trim();
  if (!raw) return { jurisdiction: null, raw, ca: [] };
  const ca = safe(() => canlii.parseCitations(raw), []) || [];
  if (ca.length) return { jurisdiction: 'CA', raw, ca };
  if (US_CITE_RX.test(raw)) return { jurisdiction: 'US', raw, ca: [] };
  return { jurisdiction: null, raw, ca: [] };
}

async function resolve(kernel, cite) {
  const raw = String(cite == null ? '' : cite).trim();
  if (!raw) return result(false, null, '', '', 'Empty citation — nothing to resolve.');
  if (!kernel) return result(false, null, '', '', 'No kernel provided — cannot resolve.');

  // --- Canadian: parse deterministically, then resolve via the official API ---
  const caCites = safe(() => (kernel.canlii && kernel.canlii.parseCitations(raw)) || [], []) || [];
  if (caCites.length) {
    const withIds = caCites.find((c) => c && c.ids);
    const any = withIds || caCites[0];
    const searchUrl = safe(() => kernel.canlii.searchUrl(any.cite), '') || '';
    if (!withIds) {
      // e.g. an SCR reporter cite — no deterministic CanLII id, link-out only.
      return result(false, 'canlii', '', searchUrl,
        `Recognized Canadian citation "${any.cite}" (${any.kind}) — no deterministic CanLII id, link-out only. Open on CanLII to confirm.`);
    }
    const key = safe(() => kernel.canlii.apiKey(), null);
    if (!key) {
      return result(false, 'canlii', '', searchUrl,
        `Recognized "${withIds.cite}" but no CanLII API key configured — link-out mode. An admin can add a key at /r/canlii for live resolution.`);
    }
    const out = await Promise.resolve(safe(() => kernel.canlii.fetchCase(withIds.ids, key),
      { ok: false, message: 'connector unavailable' })).catch((e) => ({ ok: false, message: (e && e.message) || 'error' }));
    if (!out || !out.ok) {
      return result(false, 'canlii-api', '', searchUrl, 'CanLII: ' + ((out && out.message) || 'no match') + '.');
    }
    // A 200 is not a resolution. kernel/canlii.js apiGet() returns
    // {ok:true, data:null} when a 200 body fails to parse, and an empty payload
    // used to arrive here as resolved:true with the CITATION STRING echoed back
    // as the case title — so room 08 flashed "Connector matched 2011 ONCA 9999"
    // and rendered "connector found a match" directly above the checkbox
    // "Resolves to a real case — looked up, not assumed". That is machine
    // corroboration for a case that does not exist: precisely the hallucinated-
    // citation failure this gate exists to stop. A resolution now requires a
    // real title from the payload, and the query is never its own answer.
    const d = out.data || {};
    const title = typeof d.title === 'string' ? d.title.trim() : '';
    if (!title) {
      return result(false, 'canlii-api', '', d.url || searchUrl,
        'CanLII answered but returned no case record for this citation — unresolved. Confirm by hand before relying on it.');
    }
    return result(true, 'canlii-api', title, d.url || searchUrl,
      `Resolved via CanLII API: ${title}${d.citation ? ', ' + d.citation : ''}.`);
  }

  // --- US: reporter cite -> CourtListener/RECAP opinion search (token optional) ---
  if (US_CITE_RX.test(raw)) {
    const recapUrl = safe(() => kernel.uscourts.links.recapSearch(raw), '') || '';
    if (!kernel.uscourts || typeof kernel.uscourts.search !== 'function') {
      return result(false, 'courtlistener', '', recapUrl, 'US connector unavailable — link out to RECAP by hand.');
    }
    const token = safe(() => kernel.uscourts.token(), null);
    const out = await Promise.resolve(safe(() => kernel.uscourts.search(raw, 'o', token),
      { ok: false, message: 'connector unavailable' })).catch((e) => ({ ok: false, message: (e && e.message) || 'error' }));
    if (!out || !out.ok) {
      return result(false, 'courtlistener', '', recapUrl, 'CourtListener: ' + ((out && out.message) || 'no match') + '.');
    }
    const hit = (out.results || [])[0];
    if (!hit) {
      return result(false, 'courtlistener', '', recapUrl,
        `No CourtListener match for "${raw}" — search the RECAP archive or PACER by hand.`);
    }
    const firstCite = Array.isArray(hit.citation) && hit.citation[0] ? hit.citation[0] : '';
    // Same rule as the CanLII branch: a hit carrying no case name is not a
    // resolution, and the citation the user typed is never echoed back as if it
    // were the connector's answer.
    const caseName = typeof hit.caseName === 'string' ? hit.caseName.trim() : '';
    if (!caseName) {
      return result(false, 'courtlistener', '', hit.url || recapUrl,
        `CourtListener returned a record with no case name for "${raw}" — unresolved. Confirm by hand before relying on it.`);
    }
    return result(true, 'courtlistener', caseName, hit.url || recapUrl,
      `Resolved via CourtListener: ${caseName}${firstCite ? ', ' + firstCite : ''}${hit.court ? ' (' + hit.court + ')' : ''}.`);
  }

  // --- Unrecognized: honest miss, no guess ---
  return result(false, null, '', '',
    `Unrecognized citation "${raw}" — not a known Canadian neutral/CanLII/SCR or US reporter citation.`);
}

module.exports = { resolve, detect, US_CITE_RX };

// --- self-test: offline (parse/detect only, no network) ---
if (require.main === module) {
  (async () => {
    const fail = (m) => { console.error('FAIL: ' + m); process.exit(1); };
    const ok = (c, m) => { if (!c) fail(m); };

    // Pure detection — parser + regex, no network.
    ok(detect('2008 SCC 9').jurisdiction === 'CA', 'neutral CA detect');
    ok(detect('1999 CanLII 1527 (ON CA)').jurisdiction === 'CA', 'canlii CA detect');
    ok(detect('[2008] 1 SCR 190').jurisdiction === 'CA', 'scr CA detect');
    ok(detect('550 U.S. 544').jurisdiction === 'US', 'US U.S. detect');
    ok(detect('550 US 544').jurisdiction === 'US', 'US bare detect');
    ok(detect('123 F.3d 456').jurisdiction === 'US', 'US F.3d detect');
    ok(detect('137 S. Ct. 1421').jurisdiction === 'US', 'US S.Ct detect');
    ok(detect('not a citation').jurisdiction === null, 'unknown detect');
    ok(detect('').jurisdiction === null, 'empty detect');

    // resolve() with a no-key stub: link-out paths only, never touches the network.
    const stub = {
      canlii: { ...canlii, apiKey: () => null },
      uscourts: { ...uscourts, token: () => null, search: async () => { throw new Error('self-test is offline'); } },
    };
    const r1 = await resolve(stub, '2008 SCC 9');
    ok(r1.resolved === false && r1.source === 'canlii' && /^https?:\/\//.test(r1.url), 'CA no-key link-out');
    const r2 = await resolve(stub, '[2008] 1 SCR 190');
    ok(r2.resolved === false && r2.source === 'canlii', 'SCR link-out');
    const r3 = await resolve(stub, '');
    ok(r3.resolved === false && r3.source === null, 'empty handled, no throw');
    const r4 = await resolve(stub, '!!! garbage %%%');
    ok(r4.resolved === false && r4.source === null, 'garbage handled, no throw');
    const r5 = await resolve(null, '2008 SCC 9');
    ok(r5.resolved === false, 'null kernel handled, no throw');

    console.log('PASS');
  })().catch((e) => { console.error('FAIL (threw): ' + (e && e.message)); process.exit(1); });
}
