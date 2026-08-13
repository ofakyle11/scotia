/* Timeline — Character enricher agent (Grok via enrich-characters Netlify fn) */
window.SBEnrich = (function () {
  function escRe(s) {
    return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function buildTrustedCast(state) {
    const set = new Set();
    (state.clips || []).forEach(function (clip) {
      (clip.characters || []).forEach(function (n) {
        const up = String(n || '').toUpperCase().trim();
        if (up) set.add(up);
      });
    });
    Object.keys(state.characters || {}).forEach(function (n) {
      const up = String(n || '').toUpperCase().trim();
      if (up) set.add(up);
    });
    const parseMap = state.parseResult && state.parseResult.characters;
    if (parseMap) {
      Object.keys(parseMap).forEach(function (n) {
        const up = String(n || '').toUpperCase().trim();
        if (up) set.add(up);
      });
    }
    return Array.from(set).sort();
  }

  function linesMentioningName(text, name) {
    const up = String(name || '').toUpperCase().trim();
    if (!up || !text) return [];
    const re = new RegExp(escRe(up), 'i');
    const out = [];
    String(text).split(/\r?\n/).forEach(function (line) {
      const t = line.trim();
      if (t && re.test(t) && out.indexOf(t) < 0) out.push(t);
    });
    return out.slice(0, 12);
  }

  function buildEvidencePacks(state, trusted) {
    const script = String(state.scriptText || '');
    const packs = {};
    (trusted || []).forEach(function (name) {
      const up = String(name).toUpperCase().trim();
      const c = state.characters && state.characters[up];
      const lines = linesMentioningName(script, up);
      const clipNotes = [];
      let hasDialogue = false;
      (state.clips || []).forEach(function (clip, ci) {
        const inFrame = (clip.characters || []).some(function (n) {
          return String(n || '').toUpperCase().trim() === up;
        });
        const blob = ((clip.heading || '') + ' ' + (clip.description || '') + ' ' + (clip.dialogue || '')).toUpperCase();
        if (!inFrame && blob.indexOf(up) < 0) return;
        if (clip.dialogue && inFrame) hasDialogue = true;
        if (clip.description) clipNotes.push('Clip ' + (clip.num || ci + 1) + ' action: ' + String(clip.description).slice(0, 200));
        linesMentioningName(clip.description || '', up).forEach(function (l) {
          if (lines.indexOf(l) < 0) lines.push(l);
        });
      });
      packs[up] = {
        hasDialogue: hasDialogue,
        userLocked: !!(c && c._descLocked),
        existingDescription: c && c.description ? String(c.description).slice(0, 280) : '',
        lines: lines.slice(0, 14),
        clipNotes: clipNotes.slice(0, 6),
      };
    });
    return packs;
  }

  function isJunkDescription(text, name) {
    if (window.SBCharacters && typeof window.SBCharacters.isWeakAppearanceText === 'function') {
      return window.SBCharacters.isWeakAppearanceText(text, name);
    }
    const d = String(text || '').trim();
    return !d || /^Dialogue\s+(?:in\s+clip|\(clip)/i.test(d);
  }

  function repairAllCharacterDescriptions(characters) {
    if (!characters || !window.SBCharacters || typeof window.SBCharacters.sanitizeDescription !== 'function') return 0;
    let n = 0;
    Object.keys(characters).forEach(function (name) {
      const c = characters[name];
      if (!c || c._descLocked) return;
      const clean = window.SBCharacters.sanitizeDescription(c.description || '', name);
      if (clean !== (c.description || '')) {
        c.description = clean;
        n++;
      }
    });
    return n;
  }

  function mergeAgentResult(state, agentData) {
    if (!agentData || !agentData.characters || !state.characters) return 0;
    let merged = 0;
    Object.entries(agentData.characters).forEach(function (entry) {
      const name = entry[0];
      const row = entry[1];
      const up = String(name).toUpperCase().trim();
      if (!up || !row) return;
      if (!state.characters[up]) {
        state.characters[up] = Object.assign({}, window.SBCharacters.DEFAULTS);
      }
      const c = state.characters[up];
      if (c._descLocked) return;

      const desc = window.SBCharacters.sanitizeDescription(row.description || '', up);
      const conf = row.confidence || 'medium';
      const generic = window.SBCharacters.isGenericAppearanceText && window.SBCharacters.isGenericAppearanceText(desc);
      const specific = window.SBCharacters.hasSpecificAppearanceCues && window.SBCharacters.hasSpecificAppearanceCues(desc);
      if (desc && !isJunkDescription(desc, up) && !generic && conf !== 'low' && specific) {
        const prev = String(c.description || '').trim();
        const better = window.SBCharacters.isBetterDescription && window.SBCharacters.isBetterDescription(desc, prev, up);
        if (!prev || isJunkDescription(prev, up) || better) {
          c.description = desc;
          merged++;
        }
      } else if (isJunkDescription(c.description, up)) {
        c.description = '';
      }

      if (row.wardrobe && String(row.wardrobe).trim() && !c._wardrobeLocked) {
        c.wardrobe = String(row.wardrobe).trim().slice(0, 120);
      }
      if (row.bodyType && ['Slender', 'Average', 'Athletic', 'Stocky', 'Tall', 'Petite'].indexOf(row.bodyType) >= 0) {
        c.bodyType = row.bodyType;
      }
      if (row.role && ['lead', 'supporting', 'background', 'crowd', 'voice_only'].indexOf(row.role) >= 0) {
        c.role = row.role;
      }
    });
    repairAllCharacterDescriptions(state.characters);
    return merged;
  }

  async function enrichViaAgent(state, opts) {
    opts = opts || {};
    const trusted = buildTrustedCast(state);
    if (!trusted.length) return { ok: false, reason: 'no_cast', merged: 0 };

    let headers = opts.headers || null;
    if (!headers && typeof opts.getHeaders === 'function') {
      try {
        headers = await opts.getHeaders();
      } catch (e) {
        return { ok: false, reason: 'not_signed_in', merged: 0, fallback: true };
      }
    }
    if (!headers) return { ok: false, reason: 'no_auth', merged: 0, fallback: true };

    const payload = {
      trustedNames: trusted,
      evidence: buildEvidencePacks(state, trusted),
      scriptExcerpt: String(state.scriptText || '').slice(0, 7000),
    };

    try {
      const res = await fetch('/.netlify/functions/enrich-characters', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(function () { return {}; });

      if (data.fallback) {
        return {
          ok: false,
          reason: data.detail || data.error || 'AI unavailable',
          fallback: true,
          merged: 0,
        };
      }

      if (!res.ok) {
        return {
          ok: false,
          reason: data.error || ('HTTP ' + res.status),
          fallback: !!data.fallback,
          merged: 0,
        };
      }

      const merged = mergeAgentResult(state, data);
      return {
        ok: true,
        merged: merged,
        enriched: data.enriched || merged,
        total: data.total || trusted.length,
        provider: data.provider || 'grok',
      };
    } catch (e) {
      return { ok: false, reason: e.message || 'network', merged: 0, fallback: true };
    }
  }

  return {
    buildTrustedCast: buildTrustedCast,
    buildEvidencePacks: buildEvidencePacks,
    repairAllCharacterDescriptions: repairAllCharacterDescriptions,
    mergeAgentResult: mergeAgentResult,
    enrichViaAgent: enrichViaAgent,
  };
})();