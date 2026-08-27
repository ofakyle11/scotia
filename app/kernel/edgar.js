'use strict';
// EDGAR connector — the SEC's official full-text search API. Free and public;
// the SEC's fair-access policy requires a declared User-Agent contact and
// courteous request rates, so a contact must be configured before searching.
const FTS = 'https://efts.sec.gov/LATEST/search-index';

async function search(q, { forms, contact } = {}) {
  if (!contact) return { ok: false, status: 0, message: 'EDGAR fair-access requires a declared contact — an admin sets it in this room first.' };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    let url = `${FTS}?q=${encodeURIComponent(q)}`;
    if (forms) url += `&forms=${encodeURIComponent(forms)}`;
    const r = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json', 'user-agent': 'Chambers-platform ' + contact } });
    const body = await r.json().catch(() => null);
    if (!r.ok) return { ok: false, status: r.status, message: r.status === 429 ? 'SEC rate limit — slow down (max 10 req/s).' : `EDGAR error ${r.status}.` };
    const hits = ((body.hits || {}).hits || []).slice(0, 20).map((h) => {
      const s = h._source || {};
      const [adsh, doc] = String(h._id || '').split(':');
      const cik = (s.ciks || [])[0] || '';
      return {
        company: (s.display_names || []).join('; '), cik,
        form: s.form || s.file_type || (s.root_forms || []).join(', '),
        date: s.file_date || '', description: s.file_description || '',
        adsh: s.adsh || adsh, doc,
        url: filingUrl(cik, s.adsh || adsh, doc),
      };
    });
    return { ok: true, total: (((body.hits || {}).total) || {}).value ?? hits.length, results: hits };
  } catch (e) {
    return { ok: false, status: 0, message: e.name === 'AbortError' ? 'EDGAR timed out.' : 'Network error: ' + e.message };
  } finally { clearTimeout(timer); }
}

function filingUrl(cik, adsh, doc) {
  if (!cik || !adsh) return '';
  const cikInt = String(parseInt(cik, 10));
  const acc = String(adsh).replace(/-/g, '');
  return doc ? `https://www.sec.gov/Archives/edgar/data/${cikInt}/${acc}/${doc}`
             : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cikInt}`;
}

const uiSearch = (q) => 'https://efts.sec.gov/LATEST/search-index?q=' + encodeURIComponent(q);
const links = { fullTextUi: 'https://www.sec.gov/edgar/search/', edgar: 'https://www.sec.gov/edgar' };

module.exports = { search, filingUrl, links, uiSearch };
