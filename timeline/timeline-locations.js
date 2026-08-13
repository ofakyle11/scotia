/* Timeline — Location bible + lock plates for visual coherence */
window.SBLocations = (function () {
  function esc (s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  function cleanLocName (name) {
    return String(name || '')
      .replace(/^\s*(?:at|inside|outside|near)\s+(?:the\s+)?/i, '')
      .replace(/^\s*in\s+(?:the\s+)?/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parseLocFromText (raw) {
    const t = String(raw || '').trim();
    if (!t) return '';
    const locTag = t.match(/\bLocation:\s*([^.;\n]{3,120})/i);
    if (locTag) {
      const n = cleanLocName(locTag[1].trim());
      if (n.length > 2 && !/^SCENE\s*\d*$/i.test(n)) return n;
    }
    const slug = t.match(/\b(?:INT\.|EXT\.|INT\/EXT\.|I\/E\.?)\s+([^\n.!?\]]{2,120})/i);
    if (slug) {
      const n = cleanLocName(slug[1].split(/\s*[-—–]\s*/)[0].trim());
      if (n.length > 2 && !/^SCENE\s*\d*$/i.test(n) && !/^(DAY|NIGHT|MORNING|EVENING|CONTINUOUS)$/i.test(n)) return n;
    }
    const atM = t.match(/\b(?:at|in|inside|outside|near)\s+(?:the\s+)?([A-Za-z][A-Za-z0-9 .'\-/&,]{4,100})/i);
    if (atM) {
      const n = cleanLocName(atM[1].replace(/[.,;]+$/, '').trim());
      if (n.length > 4 && !/^SCENE\s*\d*$/i.test(n)) return n;
    }
    const direct = cleanLocName(t);
    if (direct.length > 2 && !/^SCENE\s*\d*$/i.test(direct) && !/^(DAY|NIGHT|MORNING|EVENING)$/i.test(direct)) return direct;
    return '';
  }

  function getClipLocationRaw (clip) {
    const p = clip.params && clip.params.scene;
    const vals = [p && p.location, clip.location, clip.sceneLocation, clip.setting && clip.setting.location];
    for (let i = 0; i < vals.length; i++) {
      const v = String(vals[i] || '').trim();
      if (v) return v;
    }
    return '';
  }

  function locKey (name) {
    if (window.SBMastery && window.SBMastery.normalizeLocationKey) {
      return window.SBMastery.normalizeLocationKey(name);
    }
    return String(name || '').trim().toUpperCase().replace(/\s+/g, ' ');
  }

  function parseHeading (heading) {
    if (window.SBParser && window.SBParser.parseSceneHeading) {
      return window.SBParser.parseSceneHeading(heading);
    }
    if (window.SBMastery) {
      const meta = window.SBMastery.parseHeadingMeta(heading);
      return { key: meta.key, name: meta.name, timeOfDay: meta.timeOfDay || '', raw: heading };
    }
    return { key: '', name: '', timeOfDay: '', raw: heading };
  }

  function clipLocationMeta (clip) {
    const heading = clip.heading || '';
    const fields = [getClipLocationRaw(clip), heading, clip.description, clip.dialogue, clip.label];
    let fromAny = '';
    for (let i = 0; i < fields.length; i++) {
      fromAny = parseLocFromText(fields[i]);
      if (fromAny) break;
    }
    const meta = parseHeading(heading);
    if (meta.key) {
      meta.name = cleanLocName(meta.name) || meta.name;
      meta.key = locKey(meta.name);
      return meta;
    }
    if (fromAny) {
      return { key: locKey(fromAny), name: fromAny, timeOfDay: (clip.params && clip.params.scene && clip.params.scene.timeOfDay) || '', raw: heading };
    }
    return { key: '', name: '', timeOfDay: '', raw: heading };
  }

  function ensureEntry (loc) {
    if (window.SBMastery) return window.SBMastery.ensureLocationEntry(loc);
    if (!loc.key) loc.key = locKey(loc.name);
    if (!Array.isArray(loc.clipIndices)) loc.clipIndices = [];
    return loc;
  }

  function upsertLocation (bible, byKey, payload, clipIndex) {
    const key = payload.key;
    if (!key) return;
    let loc = byKey[key];
    if (!loc) {
      loc = ensureEntry({
        name: payload.name,
        key: key,
        description: payload.description || payload.heading || payload.name || '',
        plateUrl: null,
        locked: false,
        consistencyPhrase: '',
        clipIndices: []
      });
      bible.push(loc);
      byKey[key] = loc;
    }
    if (clipIndex != null && loc.clipIndices.indexOf(clipIndex) < 0) loc.clipIndices.push(clipIndex);
    if (payload.heading && !loc.description) loc.description = payload.heading.slice(0, 160);
    if (payload.name && !loc.name) loc.name = payload.name;
  }

  function syncFromClips (clips, bible) {
    bible = bible || [];
    const byKey = {};
    bible.forEach(function (loc) {
      ensureEntry(loc);
      if (loc.key) byKey[loc.key] = loc;
    });

    (clips || []).forEach(function (clip, ci) {
      const meta = clipLocationMeta(clip);
      upsertLocation(bible, byKey, {
        key: meta.key,
        name: meta.name,
        heading: clip.heading || meta.raw,
        description: (clip.heading || meta.name || '').slice(0, 160)
      }, ci);
    });

    return bible;
  }

  function mergeFromScenes (scenes, clips, bible) {
    bible = bible || [];
    const byKey = {};
    bible.forEach(function (loc) {
      ensureEntry(loc);
      if (loc.key) byKey[loc.key] = loc;
    });

    (scenes || []).forEach(function (sc, si) {
      const meta = parseHeading(sc.heading || '');
      if (!meta.key) return;
      const clipIdx = [];
      (clips || []).forEach(function (clip, ci) {
        if (clip.sceneIdx === si) clipIdx.push(ci);
      });
      upsertLocation(bible, byKey, {
        key: meta.key,
        name: meta.name,
        heading: sc.heading,
        description: (sc.heading || meta.name || '').slice(0, 160)
      }, null);
      const loc = byKey[meta.key];
      if (loc && clipIdx.length) {
        clipIdx.forEach(function (ci) {
          if (loc.clipIndices.indexOf(ci) < 0) loc.clipIndices.push(ci);
        });
      }
    });

    return bible;
  }

  function mergeFromScript (text, bible) {
    if (!window.SBParser || !window.SBParser.extractLocationsFromText) return bible;
    bible = bible || [];
    const byKey = {};
    bible.forEach(function (loc) {
      ensureEntry(loc);
      if (loc.key) byKey[loc.key] = loc;
    });

    const found = window.SBParser.extractLocationsFromText(text);
    Object.keys(found).forEach(function (key) {
      const row = found[key];
      upsertLocation(bible, byKey, {
        key: row.key,
        name: row.name,
        heading: row.heading,
        description: (row.heading || row.name || '').slice(0, 160)
      }, null);
    });

    return bible;
  }

  function syncAll (state, scriptOverride) {
    state = state || {};
    let bible = state.locationBible || [];
    bible = syncFromClips(state.clips || [], bible);
    if (state.parseResult && state.parseResult.scenes) {
      bible = mergeFromScenes(state.parseResult.scenes, state.clips || [], bible);
    }
    const scriptBlob = String(scriptOverride || state.scriptText || '').trim();
    if (scriptBlob && (/\b(?:INT\.|EXT\.|INT\/EXT\.|I\/E\.)/i.test(scriptBlob) || /^\s*Location:\s/im.test(scriptBlob))) {
      bible = mergeFromScript(scriptBlob, bible);
    }
    return bible;
  }

  function renderList (bible, selectedKey) {
    const locs = (bible || []).filter(function (l) { return l && l.name; });
    if (!locs.length) {
      return '<div class="empty-hint">No locations found. Your script needs <strong>INT.</strong> / <strong>EXT.</strong> scene headings on their own lines. PDF paste? Click <strong>Unflatten</strong> in the script editor, then <strong>Re-parse timeline</strong>.</div>';
    }
    return '<div class="loc-grid">' + locs.map(function (loc) {
      const sel = selectedKey === loc.key ? ' selected' : '';
      const thumb = loc.plateUrl
        ? '<img src="' + esc(loc.plateUrl) + '" alt="">'
        : '<span class="ph">📍</span>';
      const lock = loc.locked ? '<span class="lock-badge">🔒 Locked</span>' : '';
      const clips = (loc.clipIndices || []).length;
      return '<div class="loc-card' + sel + '" data-key="' + esc(loc.key) + '">' +
        '<div class="loc-thumb">' + thumb + '</div>' +
        '<div class="loc-name">' + esc(loc.name) + '</div>' +
        '<div class="loc-meta">' + clips + ' clip' + (clips === 1 ? '' : 's') + '</div>' +
        lock +
        '</div>';
    }).join('') + '</div>';
  }

  function renderEditor (key, loc) {
    if (!key || !loc) {
      return '<div class="empty-hint">Select a location to lock its look, upload a reference plate, and feed every matching clip on generate.</div>';
    }
    const aliasNote = (loc.aliases && loc.aliases.length)
      ? '<div class="empty-hint" style="margin-bottom:8px">Also used as: <strong>' + esc(loc.aliases.join(', ')) + '</strong> — all clips share this lock.</div>'
      : '';
    return '<div class="loc-editor">' +
      '<h4>📍 ' + esc(loc.name) + '</h4>' +
      aliasNote +
      '<div class="field"><label>Scene heading / description</label><textarea data-k="description">' + esc(loc.description || '') + '</textarea></div>' +
      '<div class="field"><label>Consistency phrase (injected into prompt when locked)</label><input data-k="consistencyPhrase" value="' + esc(loc.consistencyPhrase || '') + '" placeholder="e.g. rain-slick neon alley, same brick walls"></div>' +
      '<div class="field"><label><span>Lock location</span><span class="toggle' + (loc.locked ? ' on' : '') + '" data-k="locked"></span></label></div>' +
      (loc.plateUrl ? '<div class="ref-preview"><img src="' + esc(loc.plateUrl) + '" alt="plate"></div>' : '<div class="empty-hint" style="margin:6px 0">No reference plate yet — upload one for image-to-video matching.</div>') +
      '<button type="button" class="tb-btn gold" id="btnUploadLocPlate">Upload location plate</button>' +
      (loc.plateUrl ? '<button type="button" class="tb-btn" id="btnClearLocPlate">Remove plate</button>' : '') +
      '</div>';
  }

  function lockedNames (bible) {
    return (bible || []).filter(function (l) { return l && l.locked && l.name; }).map(function (l) { return l.name; });
  }

  return {
    syncFromClips: syncFromClips,
    mergeFromScenes: mergeFromScenes,
    mergeFromScript: mergeFromScript,
    syncAll: syncAll,
    renderList: renderList,
    renderEditor: renderEditor,
    lockedNames: lockedNames,
    clipLocationMeta: clipLocationMeta
  };
})();