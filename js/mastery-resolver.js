/* Shotbreak — Character + Location Mastery: unified per-shot ref resolver */
(function () {
  'use strict';

  var CHAR_ROLES = ['lead', 'supporting', 'background', 'crowd', 'voice_only'];
  var ROLE_RANK = { lead: 0, supporting: 1, background: 2, crowd: 3, voice_only: 4 };

  function isHttpsUrl(u) {
    return u && typeof u === 'string' && u.trim().startsWith('https://');
  }

  function normalizeLocationKey(name) {
    return String(name || '').trim().toUpperCase().replace(/\s+/g, ' ');
  }

  function parseHeadingMeta(heading) {
    var h = String(heading || '');
    var m = h.match(/^\s*(INT\.|EXT\.|I\/E\.?|INT\/EXT\.?)\s+(.+?)(?:\s*[—\-–]\s*(.+))?$/i);
    var loc = m ? m[2].trim() : '';
    var tod = m ? String(m[3] || '').trim() : '';
    return { key: normalizeLocationKey(loc), name: loc, intExt: m ? m[1] : '', timeOfDay: tod };
  }

  function inferCharRole(name, desc) {
    var blob = (String(name) + ' ' + String(desc || '')).toLowerCase();
    if (/\b(crowd|extras|ninety|dozens|mob|army of|group of|identically dressed)\b/.test(blob)) return 'crowd';
    if (/\b(background|extra|bystander|passerby)\b/.test(blob)) return 'background';
    return 'lead';
  }

  function ensureCharacterMastery(c) {
    if (!c) return c;
    if (!c.role || CHAR_ROLES.indexOf(c.role) < 0) c.role = inferCharRole(c.name, c.description);
    if (!c.lockLevel) {
      if (c.locked && c.imageUrl) c.lockLevel = 'photo';
      else if (c.locked) c.lockLevel = 'text';
      else c.lockLevel = 'none';
    }
    if (typeof c.consistencyPhrase !== 'string') c.consistencyPhrase = '';
    return c;
  }

  function ensureLocationEntry(loc) {
    if (!loc) return loc;
    if (!loc.id) loc.id = 'loc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    if (!loc.key) loc.key = normalizeLocationKey(loc.name);
    if (!loc.lockLevel) {
      if (loc.locked && loc.plateUrl) loc.lockLevel = 'photo';
      else if (loc.locked) loc.lockLevel = 'text';
      else loc.lockLevel = 'none';
    }
    if (typeof loc.consistencyPhrase !== 'string') loc.consistencyPhrase = '';
    if (!Array.isArray(loc.sceneIndices)) loc.sceneIndices = [];
    if (!loc.plateUrl && loc.reference_image_url) loc.plateUrl = loc.reference_image_url;
    return loc;
  }

  function findCharInBible(p, name) {
    var target = String(name || '').toUpperCase();
    return (p.characterBible || []).find(function (c) {
      return String(c.name || '').toUpperCase() === target;
    }) || null;
  }

  function resolveCharPhotoFromStore(p, charName) {
    var store = (p.assets && p.assets.characterPhotos) || {};
    var key = charName;
    if (!store[key]) {
      var target = String(charName).toUpperCase();
      Object.keys(store).forEach(function (k) {
        if (!key || String(k).toUpperCase() === target) key = k;
      });
    }
    if (!store[key]) return null;
    var models = store[key];
    var url = null;
    Object.keys(models).forEach(function (m) {
      var arr = models[m] || [];
      for (var i = arr.length - 1; i >= 0; i--) {
        if (arr[i] && isHttpsUrl(arr[i].url)) { url = arr[i].url; return; }
      }
    });
    return url;
  }

  function resolveCharPhotoUrl(p, charName, bibleEntry) {
    var c = bibleEntry || findCharInBible(p, charName);
    if (c) {
      ensureCharacterMastery(c);
      if (c.role === 'crowd' || c.role === 'voice_only') return null;
      if (c.lockLevel === 'none' || c.lockLevel === 'text') return null;
      if (isHttpsUrl(c.imageUrl)) return c.imageUrl;
    }
    return resolveCharPhotoFromStore(p, charName);
  }

  function syncLocationBible(p) {
    if (!p) return p;
    if (!p.locationBible) p.locationBible = [];
    var byKey = {};
    p.locationBible.forEach(function (loc) {
      ensureLocationEntry(loc);
      if (loc.key) byKey[loc.key] = loc;
    });

    (p.scenes || []).forEach(function (s, si) {
      var meta = parseHeadingMeta(s.heading);
      if (!meta.key) return;
      var loc = byKey[meta.key];
      if (!loc) {
        loc = ensureLocationEntry({
          name: meta.name,
          key: meta.key,
          description: (s.background && s.background.description) || '',
          plateUrl: (s.background && s.background.reference_image_url) || null,
          locked: !!(s.background && s.background.locked),
          consistencyPhrase: '',
          sceneIndices: []
        });
        p.locationBible.push(loc);
        byKey[meta.key] = loc;
      }
      if (loc.sceneIndices.indexOf(si) < 0) loc.sceneIndices.push(si);
      if (!loc.description && s.background && s.background.description) loc.description = s.background.description;
      if (!loc.plateUrl && s.background && s.background.reference_image_url) loc.plateUrl = s.background.reference_image_url;
      if (s.background && s.background.locked) loc.locked = true;
    });

    (p.assets && p.assets.locationPhotos || []).forEach(function (ph) {
      if (!ph || !ph.url) return;
      if (ph.locationKey) {
        var lk = normalizeLocationKey(ph.locationKey);
        var entry = byKey[lk];
        if (entry && !entry.plateUrl) entry.plateUrl = ph.url;
      }
    });

    return p;
  }

  function ensureMasteryProject(p) {
    if (!p) return p;
    (p.characterBible || []).forEach(ensureCharacterMastery);
    syncLocationBible(p);
    return p;
  }

  function locationPlateForScene(p, sceneIdx, shot) {
    var scene = p.scenes && p.scenes[sceneIdx];
    if (!scene) return null;
    var meta = parseHeadingMeta(scene.heading);
    var loc = (p.locationBible || []).find(function (l) { return l.key === meta.key; });
    if (shot && shot.background && isHttpsUrl(shot.background.reference_image_url)) {
      return shot.background.reference_image_url;
    }
    if (loc && (loc.locked || loc.lockLevel === 'photo' || loc.lockLevel === 'full') && isHttpsUrl(loc.plateUrl)) {
      return loc.plateUrl;
    }
    if (loc && isHttpsUrl(loc.plateUrl)) return loc.plateUrl;
    var photos = (p.assets && p.assets.locationPhotos) || [];
    for (var i = 0; i < photos.length; i++) {
      var ph = photos[i];
      if (!ph || !isHttpsUrl(ph.url)) continue;
      if (ph.locationKey && normalizeLocationKey(ph.locationKey) === meta.key) return ph.url;
    }
    if (photos.length && isHttpsUrl(photos[0].url) && !photos[0].locationKey) return photos[0].url;
    return null;
  }

  function getBestCharPrompt(name, p, bibleEntry) {
    if (bibleEntry && bibleEntry.consistencyPhrase) return bibleEntry.consistencyPhrase;
    if (bibleEntry && bibleEntry.userLockedPrompt) return bibleEntry.userLockedPrompt;
    if (bibleEntry && bibleEntry.cleanPrompt) return bibleEntry.cleanPrompt;
    if (bibleEntry && bibleEntry.description) return bibleEntry.description;
    if (p && p.characterDescriptions && p.characterDescriptions[name]) return p.characterDescriptions[name];
    return '';
  }

  function resolveShotMastery(p, sceneIdx, shotIdx, opts) {
    opts = opts || {};
    ensureMasteryProject(p);
    var scene = p.scenes && p.scenes[sceneIdx];
    var shot = scene && scene.shots ? scene.shots[shotIdx] : null;
    if (!shot) {
      return {
        character_image_url: null,
        location_image_url: null,
        reference_images: [],
        promptAdditions: [],
        characterRefs: [],
        locationRef: null
      };
    }

    var names = opts.characters_in_frame || shot.characters_in_frame || [];
    var charRefs = [];
    var crowdPhrases = [];
    var promptBits = [];

    names.forEach(function (n) {
      var bible = findCharInBible(p, n);
      if (bible) ensureCharacterMastery(bible);
      var role = bible ? bible.role : inferCharRole(n, '');
      if (role === 'crowd') {
        var crowdDesc = getBestCharPrompt(n, p, bible) || n;
        crowdPhrases.push(crowdDesc);
        return;
      }
      if (role === 'voice_only') return;
      var url = resolveCharPhotoUrl(p, n, bible);
      if (url || role === 'lead' || role === 'supporting') {
        charRefs.push({ name: n, url: url, role: role });
      }
      var phrase = getBestCharPrompt(n, p, bible);
      if (phrase && (bible && bible.lockLevel !== 'none')) {
        promptBits.push(n + ': ' + phrase.slice(0, 160));
      }
    });

    charRefs.sort(function (a, b) {
      return (ROLE_RANK[a.role] || 9) - (ROLE_RANK[b.role] || 9);
    });

    var locUrl = locationPlateForScene(p, sceneIdx, shot);
    var meta = parseHeadingMeta(scene.heading);
    var locEntry = (p.locationBible || []).find(function (l) { return l.key === meta.key; });
    var locRef = locEntry ? {
      key: locEntry.key,
      name: locEntry.name,
      url: locUrl
    } : (locUrl ? { key: meta.key, name: meta.name, url: locUrl } : null);

    if (locEntry && locEntry.consistencyPhrase) {
      promptBits.unshift('Location: ' + locEntry.consistencyPhrase);
    } else if (locEntry && locEntry.description && (locEntry.locked || locEntry.lockLevel !== 'none')) {
      promptBits.unshift('Location: ' + locEntry.description.slice(0, 180));
    }

    if (crowdPhrases.length) {
      promptBits.push('Crowd/extras: ' + crowdPhrases.join('; '));
    }

    var reference_images = [];
    charRefs.forEach(function (cr) {
      if (cr.url && reference_images.indexOf(cr.url) < 0) reference_images.push(cr.url);
    });
    if (locUrl && reference_images.indexOf(locUrl) < 0) reference_images.push(locUrl);
    reference_images = reference_images.slice(0, 3);

    return {
      character_image_url: charRefs.length && charRefs[0].url ? charRefs[0].url : null,
      location_image_url: locUrl || null,
      reference_images: reference_images,
      promptAdditions: promptBits,
      characterRefs: charRefs,
      locationRef: locRef,
      characters_in_frame: names
    };
  }

  function enrichPrompt(basePrompt, mastery) {
    var base = String(basePrompt || '').trim();
    var adds = (mastery && mastery.promptAdditions) || [];
    if (!adds.length) return base;
    var block = adds.join('. ').replace(/\s+/g, ' ').trim();
    if (!block) return base;
    if (base.toLowerCase().indexOf(block.toLowerCase().slice(0, 40)) >= 0) return base;
    var merged = (base + ' ' + block).replace(/\s+/g, ' ').trim();
    return merged.length > 900 ? merged.slice(0, 897) + '...' : merged;
  }

  function applyToSubmitBody(body, mastery) {
    body = body || {};
    mastery = mastery || {};
    if (mastery.character_image_url) body.character_image_url = mastery.character_image_url;
    if (mastery.location_image_url) body.location_image_url = mastery.location_image_url;
    if (mastery.reference_images && mastery.reference_images.length) {
      body.reference_images = mastery.reference_images;
    }
    if (body.prompt && mastery.promptAdditions && mastery.promptAdditions.length) {
      body.prompt = enrichPrompt(body.prompt, mastery);
    }
    return body;
  }

  function resolveForTimeline(state, clip) {
    state = state || {};
    clip = clip || {};
    var chars = state.characters || {};
    var names = (clip.characters || []).filter(Boolean);
    var charRefs = [];
    var promptBits = [];

    names.forEach(function (n) {
      var c = chars[n];
      var role = (c && c.role) || inferCharRole(n, c && c.description);
      if (role === 'crowd') {
        if (c && c.description) promptBits.push('Crowd: ' + c.description.slice(0, 120));
        return;
      }
      if (role === 'voice_only') return;
      var url = null;
      if (c && c.faceLock && isHttpsUrl(c.refUrl)) url = c.refUrl;
      else if (c && isHttpsUrl(c.refUrl)) url = c.refUrl;
      charRefs.push({ name: n, url: url, role: role });
      if (c && c.description) promptBits.push(n + ': ' + c.description.slice(0, 120));
    });

    charRefs.sort(function (a, b) {
      return (ROLE_RANK[a.role] || 9) - (ROLE_RANK[b.role] || 9);
    });

    var meta = parseHeadingMeta(clip.heading || '');
    var locName = (clip.params && clip.params.scene && clip.params.scene.location) || meta.name || '';
    var locUrl = null;
    var bible = state.locationBible || [];
    var key = meta.key || normalizeLocationKey(String(locName).replace(/^\s*(INT\.|EXT\.)\s+/i, ''));
    var locEntry = bible.find(function (l) { return l.key === key; });
    if (locEntry && locEntry.locked) {
      if (isHttpsUrl(locEntry.plateUrl)) locUrl = locEntry.plateUrl;
      if (locEntry.consistencyPhrase) {
        promptBits.unshift('Location: ' + locEntry.consistencyPhrase);
      } else if (locEntry.description) {
        promptBits.unshift('Location: ' + locEntry.description.slice(0, 160));
      }
    }

    var reference_images = [];
    charRefs.forEach(function (cr) {
      if (cr.url && reference_images.indexOf(cr.url) < 0) reference_images.push(cr.url);
    });
    if (locUrl && reference_images.indexOf(locUrl) < 0) reference_images.push(locUrl);

    return {
      character_image_url: charRefs.length && charRefs[0].url ? charRefs[0].url : null,
      location_image_url: locUrl,
      reference_images: reference_images.slice(0, 3),
      promptAdditions: promptBits,
      characterRefs: charRefs,
      locationRef: locEntry || null
    };
  }

  window.SBMastery = {
    CHAR_ROLES: CHAR_ROLES,
    normalizeLocationKey: normalizeLocationKey,
    parseHeadingMeta: parseHeadingMeta,
    ensureCharacterMastery: ensureCharacterMastery,
    ensureLocationEntry: ensureLocationEntry,
    ensureMasteryProject: ensureMasteryProject,
    syncLocationBible: syncLocationBible,
    resolveShotMastery: resolveShotMastery,
    resolveForTimeline: resolveForTimeline,
    enrichPrompt: enrichPrompt,
    applyToSubmitBody: applyToSubmitBody,
    inferCharRole: inferCharRole
  };
})();