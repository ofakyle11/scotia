/* SHOTBREAK Producer Suite — Stripboard Scheduler + Day-Out-of-Days (our own
 * web take on the classic AD stripboard workflow CineSched implements on
 * macOS; written from scratch).
 *
 * Scenes come from the parsed screenplay, sized in eighths of a page, color
 * coded day/night. Drag strips between the Boneyard and shoot days (or
 * auto-schedule at a target pages/day pace). The DOOD report maps every cast
 * member across shoot days with the standard SW / W / H / WF / SWF codes. */
(function (root) {
  'use strict';

  var KEY = 'SB_ScheduleBoard_v1';

  function formatEighths(e) {
    e = Math.max(0, Math.round(e));
    var whole = Math.floor(e / 8), rem = e % 8;
    if (!whole && !rem) return '0';
    if (!whole) return rem + '/8';
    if (!rem) return String(whole);
    return whole + ' ' + rem + '/8';
  }

  /* Parse "15", "1 7/8", "7/8", "2.5" (pages) → eighths. */
  function parseEighths(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return null;
    var m = s.match(/^(\d+)\s+(\d)\/8$/);
    if (m) return (+m[1]) * 8 + (+m[2]);
    m = s.match(/^(\d)\/8$/);
    if (m) return +m[1];
    m = s.match(/^(\d+(?:\.\d+)?)$/);
    if (m) {
      var n = parseFloat(m[1]);
      return s.indexOf('.') >= 0 ? Math.max(1, Math.round(n * 8)) : Math.max(1, Math.round(n));
    }
    return null;
  }

  var TAG_KEYS = ['stunts', 'sfx', 'vfx', 'water', 'animals', 'vehicles'];
  var TAG_LABEL = { stunts: 'ST', sfx: 'SFX', vfx: 'VFX', water: 'WTR', animals: 'ANM', vehicles: 'VEH' };

  function ensureScene(sc) {
    sc.tags = sc.tags || {};
    sc.extras = sc.extras || 0;
    sc.notes = sc.notes || '';
    return sc;
  }

  function locOf(heading) {
    return String(heading || '')
      .replace(/^\s*(?:\d+[A-Z]?[.\s-]*)?(INT\.|EXT\.|INT\/EXT\.|I\/E\.?)\s*/i, '')
      .split(/\s+[-—–]\s+/)[0].trim().toUpperCase() || 'UNKNOWN';
  }

  /* Build scene strips from the timeline's saved script. */
  function scenesFromScript(st) {
    var chunks = SBBudget.splitScenes(st.scriptText || '');
    if (chunks.length < 2 && (st.clips || []).length) {
      // No sluglines — fall back to one strip per unique clip heading
      var seen = {}, out = [];
      (st.clips || []).forEach(function (c) {
        var h = String(c.heading || '').trim() || 'Scene';
        if (seen[h]) { seen[h].eighths += 1; return; }
        seen[h] = { heading: h, eighths: 1, text: c.description || '' };
        out.push(seen[h]);
      });
      chunks = out;
    }
    var analysis = SBBudget.analyze(st);
    var castByScene = {};
    Object.keys(analysis.sceneCast || {}).forEach(function (name) {
      analysis.sceneCast[name].forEach(function (i) {
        (castByScene[i] = castByScene[i] || []).push(name);
      });
    });
    return chunks.map(function (sc, i) {
      return {
        id: 'sc' + (i + 1),
        num: i + 1,
        heading: sc.heading || ('Scene ' + (i + 1)),
        eighths: sc.eighths || 1,
        dn: /\b(NIGHT|DUSK|EVENING|MIDNIGHT|PRE-DAWN)\b/i.test(sc.heading || '') ? 'night' : 'day',
        cast: castByScene[i] || [],
        day: -1
      };
    });
  }

  /* Fill days at the target eighths/day pace.
   * mode 'script' (default): script order. mode 'location': group scenes by
   * location (then day/night) first — fewer company moves, the way ADs
   * actually board a show. Scene numbers are preserved either way. */
  function autoScheduleModel(scenes, pagesPerDay, mode) {
    var perDay = Math.max(1, (pagesPerDay || 4.5) * 8);
    var order = scenes.slice();
    if (mode === 'location') {
      order.sort(function (a, b) {
        var la = locOf(a.heading), lb = locOf(b.heading);
        if (la !== lb) return la < lb ? -1 : 1;
        if (a.dn !== b.dn) return a.dn === 'day' ? -1 : 1; // shoot day work before night per location
        return a.num - b.num;
      });
    }
    var day = 0, used = 0;
    order.forEach(function (sc) {
      if (used > 0 && used + sc.eighths > perDay) { day++; used = 0; }
      sc.day = day;
      used += sc.eighths;
    });
    return scenes;
  }

  /* Board-derived overrides for the budget estimator: exact cast spans from
   * real day assignments, and special-unit day counts from breakdown tags.
   * Returns {} when the board has nothing scheduled. */
  function boardOverridesModel(scenes) {
    var scheduled = scenes.filter(function (s) { return s.day >= 0; });
    if (!scheduled.length) return {};
    var m = doodMatrix(scenes);
    var castDood = {};
    m.rows.forEach(function (r) {
      castDood[r.name] = { workDays: r.wrk, spanDays: r.tot, spanWeeks: Math.max(1, Math.ceil(r.tot / 5)) };
    });
    function tagDays(key) {
      var days = {};
      scheduled.forEach(function (sc) { if (sc.tags && sc.tags[key]) days[sc.day] = 1; });
      return Object.keys(days).length;
    }
    var anyTags = scheduled.some(function (sc) {
      return (sc.tags && TAG_KEYS.some(function (k) { return sc.tags[k]; })) || sc.extras > 0;
    });
    var out = { castDood: castDood };
    if (anyTags) {
      out.unitOverrides = {
        stuntDays: tagDays('stunts'),
        pyroDays: tagDays('sfx'),
        waterDays: tagDays('water'),
        animalDays: tagDays('animals'),
        extrasDays: scheduled.reduce(function (a, sc) { return a + (sc.extras || 0); }, 0)
      };
    }
    return out;
  }

  /* DOOD matrix: rows per cast member, one column per shoot day, standard
   * codes — SW start, W work, H hold (idle day inside the span), WF finish,
   * SWF single-day role. */
  function doodMatrix(scenes) {
    var byActor = {};
    var maxDay = -1;
    scenes.forEach(function (sc) {
      if (sc.day < 0) return;
      if (sc.day > maxDay) maxDay = sc.day;
      (sc.cast || []).forEach(function (name) {
        (byActor[name] = byActor[name] || new Set()).add(sc.day);
      });
    });
    var days = maxDay + 1;
    var rows = Object.keys(byActor).map(function (name) {
      var workSet = byActor[name];
      var first = Infinity, last = -Infinity;
      workSet.forEach(function (d) { if (d < first) first = d; if (d > last) last = d; });
      var codes = [];
      for (var d = 0; d < days; d++) {
        if (d < first || d > last) codes.push('');
        else if (workSet.has(d)) {
          if (first === last) codes.push('SWF');
          else if (d === first) codes.push('SW');
          else if (d === last) codes.push('WF');
          else codes.push('W');
        } else codes.push('H');
      }
      var work = workSet.size;
      var hold = Math.max(0, (last - first + 1) - work);
      return { name: name, codes: codes, tot: last - first + 1, wrk: work, hld: hold };
    });
    rows.sort(function (a, b) { return b.wrk - a.wrk || a.name.localeCompare(b.name); });
    return { days: days, rows: rows };
  }

  /* ── persistence ─────────────────────────────────────────────────── */
  var board = null;
  function load() {
    try {
      var d = JSON.parse((root.localStorage && root.localStorage.getItem(KEY)) || 'null');
      if (d && Array.isArray(d.scenes)) {
        d.scenes.forEach(ensureScene);
        d.dayMeta = d.dayMeta || {};
        d.mode = d.mode || 'script';
        return d;
      }
    } catch (e) {}
    return { pace: 4.5, scenes: [], dayMeta: {}, mode: 'script' };
  }
  function persist() {
    try { root.localStorage && root.localStorage.setItem(KEY, JSON.stringify(board)); } catch (e) {}
  }

  /* ── rendering ───────────────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

  function stripHtml(sc) {
    ensureScene(sc);
    var badges = TAG_KEYS.filter(function (k) { return sc.tags[k]; })
      .map(function (k) { return '<span class="ps-tagchip">' + TAG_LABEL[k] + '</span>'; }).join('');
    if (sc.extras > 0) badges += '<span class="ps-tagchip">BG×' + sc.extras + '</span>';
    return '<div class="ps-strip ' + sc.dn + '" draggable="true" data-id="' + sc.id + '" title="Double-click to edit breakdown · ' + esc(sc.cast.join(', ')) + '">' +
      '<b>' + sc.num + '</b> · ' + esc(sc.heading.length > 46 ? sc.heading.slice(0, 45) + '…' : sc.heading) +
      '<div class="ps-strip-meta">' + formatEighths(sc.eighths) + ' pg' + (sc.cast.length ? ' · ' + esc(sc.cast.slice(0, 3).join(', ')) + (sc.cast.length > 3 ? ' +' + (sc.cast.length - 3) : '') : '') + ' ' + badges + '</div></div>';
  }

  function render() {
    var bone = $('sbBoneyard'), daysEl = $('sbDays');
    if (!bone || !daysEl) return;
    var unsched = board.scenes.filter(function (s) { return s.day < 0; });
    bone.innerHTML = unsched.map(stripHtml).join('') || '<div class="ps-empty">All scenes scheduled</div>';
    var boneMeta = $('sbBoneMeta');
    if (boneMeta) boneMeta.textContent = unsched.length ? unsched.length + ' scenes · ' + formatEighths(unsched.reduce(function (a, s) { return a + s.eighths; }, 0)) + ' pg' : '';

    var maxDay = board.scenes.reduce(function (m, s) { return Math.max(m, s.day); }, -1);
    var dayCount = Math.max(maxDay + 2, 1); // always one empty trailing day to drop into
    var targetEighths = board.pace * 8;
    var h = '';
    for (var d = 0; d < dayCount; d++) {
      var scs = board.scenes.filter(function (s) { return s.day === d; });
      var e = scs.reduce(function (a, s) { return a + s.eighths; }, 0);
      var hasCS = board.dayMeta && board.dayMeta[d] && (board.dayMeta[d].call || board.dayMeta[d].notes);
      h += '<div class="ps-day"><div class="ps-day-head"><span>Day ' + (d + 1) +
        ' <button type="button" class="ps-cs-btn' + (hasCS ? ' has' : '') + '" data-cs="' + d + '" title="Call sheet">📋</button></span>' +
        '<span class="ps-day-meta' + (e > targetEighths ? ' over' : '') + '">' + formatEighths(e) + ' / ' + formatEighths(targetEighths) + ' pg</span></div>' +
        '<div class="ps-strips" data-day="' + d + '">' + scs.map(stripHtml).join('') + '</div></div>';
    }
    daysEl.innerHTML = h;
    daysEl.querySelectorAll('.ps-cs-btn').forEach(function (b) {
      b.addEventListener('click', function (ev) { ev.stopPropagation(); openCallSheet(+b.dataset.cs); });
    });
    wireDnD();
    wireEditors();
    renderDood(false);
  }

  /* ── per-scene breakdown editor (double-click a strip) ───────────── */
  function wireEditors() {
    document.querySelectorAll('#pane-schedule .ps-strip').forEach(function (el) {
      el.addEventListener('dblclick', function () { openEditor(el.dataset.id); });
    });
  }

  function openEditor(id) {
    var sc = board.scenes.find(function (s) { return s.id === id; });
    if (!sc) return;
    ensureScene(sc);
    var wrap = $('sbEditModal');
    if (!wrap) return;
    var tagBoxes = TAG_KEYS.map(function (k) {
      return '<label class="ps-tagbox"><input type="checkbox" data-tag="' + k + '"' + (sc.tags[k] ? ' checked' : '') + '> ' +
        k.charAt(0).toUpperCase() + k.slice(1) + '</label>';
    }).join('');
    wrap.querySelector('.modal-card').innerHTML =
      '<div class="modal-head"><span>Scene ' + sc.num + ' — breakdown</span><button type="button" class="tb-btn" id="sbEdClose">✕</button></div>' +
      '<div class="sbed-grid">' +
      '<label>Slugline<input id="sbEdHeading" value="' + esc(sc.heading) + '"></label>' +
      '<div class="sbed-row">' +
      '<label>Pages (eighths)<input id="sbEdEighths" value="' + formatEighths(sc.eighths) + '" placeholder="e.g. 1 7/8"></label>' +
      '<label>Day / Night<select id="sbEdDn"><option value="day"' + (sc.dn === 'day' ? ' selected' : '') + '>Day</option><option value="night"' + (sc.dn === 'night' ? ' selected' : '') + '>Night</option></select></label>' +
      '<label>Background / extras<input id="sbEdExtras" type="number" min="0" step="1" value="' + (sc.extras || 0) + '"></label>' +
      '</div>' +
      '<label>Cast (comma-separated)<input id="sbEdCast" value="' + esc(sc.cast.join(', ')) + '"></label>' +
      '<div class="sbed-tags">' + tagBoxes + '</div>' +
      '<label>Notes<textarea id="sbEdNotes" rows="3">' + esc(sc.notes) + '</textarea></label>' +
      '</div>' +
      '<div class="script-actions"><span class="script-meta">Tags drive the stunt/SFX/water/animal unit days and extras count in the budget seed.</span>' +
      '<div class="script-btns"><button type="button" class="tb-btn" id="sbEdDelete">Delete scene</button>' +
      '<button type="button" class="tb-btn gold" id="sbEdSave">Save</button></div></div>';
    wrap.classList.remove('hidden');
    $('sbEdClose').onclick = function () { wrap.classList.add('hidden'); };
    $('sbEdDelete').onclick = function () {
      if (!confirm('Delete scene ' + sc.num + ' from the board?')) return;
      board.scenes = board.scenes.filter(function (s) { return s.id !== sc.id; });
      wrap.classList.add('hidden');
      persist(); render();
    };
    $('sbEdSave').onclick = function () {
      sc.heading = $('sbEdHeading').value.trim() || sc.heading;
      var e = parseEighths($('sbEdEighths').value);
      if (e != null) sc.eighths = e;
      sc.dn = $('sbEdDn').value === 'night' ? 'night' : 'day';
      sc.extras = Math.max(0, parseInt($('sbEdExtras').value, 10) || 0);
      sc.cast = $('sbEdCast').value.split(',').map(function (s) { return s.trim().toUpperCase(); }).filter(Boolean);
      TAG_KEYS.forEach(function (k) { sc.tags[k] = wrap.querySelector('input[data-tag="' + k + '"]').checked; });
      sc.notes = $('sbEdNotes').value;
      wrap.classList.add('hidden');
      persist(); render();
      if (root.psToast) psToast('Scene ' + sc.num + ' breakdown saved');
    };
  }

  /* ── call sheets ─────────────────────────────────────────────────── */
  function openCallSheet(d) {
    var wrap = $('sbCallModal');
    if (!wrap) return;
    var meta = (board.dayMeta[d] = board.dayMeta[d] || { call: '', date: '', notes: '' });
    var scs = board.scenes.filter(function (s) { return s.day === d; });
    var m = doodMatrix(board.scenes);
    var locs = [];
    scs.forEach(function (sc) { var L = locOf(sc.heading); if (locs.indexOf(L) < 0) locs.push(L); });
    var castRows = m.rows.filter(function (r) { return r.codes[d]; }).map(function (r) {
      return '<tr><td>' + esc(r.name) + '</td><td>' + r.codes[d] + '</td></tr>';
    }).join('');
    var sceneRows = scs.map(function (sc) {
      return '<tr><td>' + sc.num + '</td><td>' + esc(sc.heading) + '</td><td>' + (sc.dn === 'night' ? 'N' : 'D') + '</td><td>' + formatEighths(sc.eighths) + '</td><td>' + esc(sc.cast.join(', ')) + (sc.extras ? ' +' + sc.extras + ' BG' : '') + '</td></tr>';
    }).join('');
    wrap.querySelector('.modal-card').innerHTML =
      '<div class="modal-head"><span>Call sheet — Day ' + (d + 1) + '</span><button type="button" class="tb-btn" id="sbCsClose">✕</button></div>' +
      '<div id="sbCsSheet" class="cs-sheet">' +
      '<div class="cs-head"><div class="cs-title">' + esc((root.psProjectState ? psProjectState().projectName : '') || 'Untitled Film') + '</div>' +
      '<div class="cs-fields">Day ' + (d + 1) + ' · Date <input id="sbCsDate" value="' + esc(meta.date) + '" placeholder="MM/DD"> · General call <input id="sbCsCall" value="' + esc(meta.call) + '" placeholder="7:00 AM"></div></div>' +
      '<h4>Scenes (' + formatEighths(scs.reduce(function (a, s) { return a + s.eighths; }, 0)) + ' pages)</h4>' +
      '<table class="cs-table"><thead><tr><th>#</th><th>Set</th><th>D/N</th><th>Pgs</th><th>Cast</th></tr></thead><tbody>' + (sceneRows || '<tr><td colspan="5">No scenes scheduled</td></tr>') + '</tbody></table>' +
      '<h4>Cast calls</h4>' +
      '<table class="cs-table"><thead><tr><th>Cast</th><th>Status</th></tr></thead><tbody>' + (castRows || '<tr><td colspan="2">—</td></tr>') + '</tbody></table>' +
      '<h4>Locations</h4><div class="cs-locs">' + (locs.map(esc).join(' · ') || '—') + '</div>' +
      '<h4>Notes</h4><textarea id="sbCsNotes" rows="3" class="script-editor" style="width:100%">' + esc(meta.notes) + '</textarea>' +
      '</div>' +
      '<div class="script-actions"><span class="script-meta">SW start · W work · H hold · WF finish</span>' +
      '<div class="script-btns"><button type="button" class="tb-btn" id="sbCsPrint">Print / PDF</button>' +
      '<button type="button" class="tb-btn gold" id="sbCsSave">Save</button></div></div>';
    wrap.classList.remove('hidden');
    function saveMeta() {
      meta.date = $('sbCsDate').value;
      meta.call = $('sbCsCall').value;
      meta.notes = $('sbCsNotes').value;
      persist();
    }
    $('sbCsClose').onclick = function () { saveMeta(); wrap.classList.add('hidden'); render(); };
    $('sbCsSave').onclick = function () { saveMeta(); wrap.classList.add('hidden'); render(); if (root.psToast) psToast('Call sheet saved'); };
    $('sbCsPrint').onclick = function () {
      saveMeta();
      document.body.classList.add('cs-printing');
      window.print();
      setTimeout(function () { document.body.classList.remove('cs-printing'); }, 500);
    };
  }

  function wireDnD() {
    document.querySelectorAll('#pane-schedule .ps-strip').forEach(function (el) {
      el.addEventListener('dragstart', function (ev) {
        ev.dataTransfer.setData('text/plain', el.dataset.id);
        ev.dataTransfer.effectAllowed = 'move';
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', function () { el.classList.remove('dragging'); });
    });
    document.querySelectorAll('#pane-schedule .ps-strips').forEach(function (zone) {
      zone.addEventListener('dragover', function (ev) { ev.preventDefault(); zone.classList.add('dragover'); });
      zone.addEventListener('dragleave', function () { zone.classList.remove('dragover'); });
      zone.addEventListener('drop', function (ev) {
        ev.preventDefault();
        zone.classList.remove('dragover');
        var id = ev.dataTransfer.getData('text/plain');
        var sc = board.scenes.find(function (s) { return s.id === id; });
        if (!sc) return;
        sc.day = parseInt(zone.dataset.day, 10);
        persist();
        render();
      });
    });
  }

  function renderDood(show) {
    var wrap = $('sbDoodWrap');
    if (!wrap) return;
    if (show === false && wrap.classList.contains('hidden')) return;
    var m = doodMatrix(board.scenes);
    if (!m.rows.length || m.days < 1) {
      wrap.innerHTML = '<div class="ps-empty">Schedule scenes with cast to generate the Day-out-of-Days.</div>';
      if (show) wrap.classList.remove('hidden');
      return;
    }
    var h = '<h3>Day-out-of-Days</h3><div style="overflow-x:auto"><table class="dood-table"><thead><tr><th>Cast</th>';
    for (var d = 0; d < m.days; d++) h += '<th>D' + (d + 1) + '</th>';
    h += '<th>TOT</th><th>WRK</th><th>HLD</th></tr></thead><tbody>';
    m.rows.forEach(function (r) {
      h += '<tr><td>' + esc(r.name) + '</td>';
      r.codes.forEach(function (c) {
        var cls = c === 'SW' || c === 'SWF' ? 'sw' : c === 'WF' ? 'wf' : c === 'H' ? 'h' : '';
        h += '<td' + (cls ? ' class="' + cls + '"' : '') + '>' + c + '</td>';
      });
      h += '<td>' + r.tot + '</td><td>' + r.wrk + '</td><td>' + r.hld + '</td></tr>';
    });
    h += '</tbody></table></div><div class="dood-legend">SW = Start Work · W = Work · H = Hold · WF = Work Finish · SWF = Start/Work/Finish · TOT span · WRK worked · HLD holds</div>';
    wrap.innerHTML = h;
    if (show) wrap.classList.remove('hidden');
  }

  /* ── toolbar ─────────────────────────────────────────────────────── */
  function wireToolbar() {
    var seed = $('sbSeed');
    if (seed) seed.addEventListener('click', function () {
      var st = root.psProjectState ? root.psProjectState() : {};
      if (!st.scriptText && !(st.clips || []).length) return root.psToast && psToast('No script in the timeline yet — import one first');
      var scenes = scenesFromScript(st);
      if (!scenes.length) return root.psToast && psToast('No scenes found — check the script parses on the timeline page');
      board.scenes = scenes;
      persist(); render();
      if (root.psToast) psToast(scenes.length + ' scene strips built (' + formatEighths(scenes.reduce(function (a, s) { return a + s.eighths; }, 0)) + ' pages)');
    });
    var auto = $('sbAuto');
    if (auto) auto.addEventListener('click', function () {
      if (!board.scenes.length) return root.psToast && psToast('Seed scenes from the script first');
      autoScheduleModel(board.scenes, board.pace, board.mode);
      persist(); render();
      var days = board.scenes.reduce(function (m, s) { return Math.max(m, s.day); }, -1) + 1;
      if (root.psToast) psToast('Scheduled ' + days + ' shoot days at ' + board.pace + ' pages/day' + (board.mode === 'location' ? ', grouped by location' : ''));
    });
    var mode = $('sbMode');
    if (mode) {
      mode.value = board.mode || 'script';
      mode.addEventListener('change', function () { board.mode = mode.value; persist(); });
    }
    var pace = $('sbPace');
    if (pace) {
      pace.value = board.pace;
      pace.addEventListener('change', function () {
        board.pace = Math.max(1, Math.min(12, parseFloat(pace.value) || 4.5));
        persist(); render();
      });
    }
    var clear = $('sbClear');
    if (clear) clear.addEventListener('click', function () {
      board.scenes.forEach(function (s) { s.day = -1; });
      persist(); render();
    });
    var dood = $('sbDood');
    if (dood) dood.addEventListener('click', function () {
      var wrap = $('sbDoodWrap');
      if (wrap.classList.contains('hidden')) renderDood(true);
      else wrap.classList.add('hidden');
    });
    var print = $('sbPrint');
    if (print) print.addEventListener('click', function () { renderDood(true); window.print(); });
  }

  function init() {
    if (!$('sbDays')) return;
    board = load();
    render();
    wireToolbar();
  }

  /* Live board overrides for the budget seed (empty object if never inited
   * or nothing scheduled). */
  function boardOverrides() {
    if (board && board.scenes) return boardOverridesModel(board.scenes);
    try {
      var d = JSON.parse((root.localStorage && root.localStorage.getItem(KEY)) || 'null');
      if (d && Array.isArray(d.scenes)) return boardOverridesModel(d.scenes.map(ensureScene));
    } catch (e) {}
    return {};
  }

  root.SBScheduleBoard = {
    init: init,
    boardOverrides: boardOverrides,
    // exposed for tests
    scenesFromScript: scenesFromScript,
    autoScheduleModel: autoScheduleModel,
    boardOverridesModel: boardOverridesModel,
    doodMatrix: doodMatrix,
    formatEighths: formatEighths,
    parseEighths: parseEighths,
    locOf: locOf
  };
})(typeof window !== 'undefined' ? window : globalThis);
