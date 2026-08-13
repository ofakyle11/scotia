/* SHOTBREAK Producer Suite — Budget Top Sheet (our own take on the Movie
 * Magic / CineSpend workflow, implemented from scratch for the web).
 *
 * Three-level hierarchy: Top Sheet → account categories → line items with
 * an Amt × Units × Rate calculator, estimated vs actual columns, automatic
 * contingency, and one-click seeding from the script-driven estimator
 * (SBBudget). Autosaves to localStorage; save/load as .json; print for PDF. */
(function (root) {
  'use strict';

  var KEY = 'SB_BudgetSheet_v1';

  /* Standard feature top-sheet skeleton with common starter line items. */
  var DEFAULT_CATEGORIES = [
    { acct: '1000',  name: 'Story & Rights',      items: ['Option / purchase', 'Screenplay / writer fees'] },
    { acct: '2000',  name: 'Producers Unit',      items: ['Producer fee', 'Line producer / UPM'] },
    { acct: '3000',  name: 'Direction',           items: ['Director fee'] },
    { acct: '4000',  name: 'Cast',                items: ['Leads', 'Supporting cast', 'Day players', 'Background & extras', 'Casting director', 'Cast fringes'] },
    { acct: '5000',  name: 'Production Staff',    items: ['ADs & production office', 'Script supervisor', 'PAs'] },
    { acct: '6000',  name: 'Camera',              items: ['Camera crew', 'Camera package rental'] },
    { acct: '7000',  name: 'Sound',               items: ['Sound mixer & boom', 'Sound package'] },
    { acct: '8000',  name: 'Grip & Electric',     items: ['G&E crew', 'G&E package & truck'] },
    { acct: '9000',  name: 'Art Department',      items: ['Production designer & crew', 'Set dressing & props', 'Stunts / SFX units'] },
    { acct: '10000', name: 'Wardrobe',            items: ['Costume designer & crew', 'Purchases & rentals'] },
    { acct: '11000', name: 'Makeup & Hair',       items: ['HMU crew', 'Supplies'] },
    { acct: '12000', name: 'Transportation',      items: ['Drivers & vehicles', 'Fuel & parking'] },
    { acct: '13000', name: 'Locations',           items: ['Location fees', 'Permits', 'Travel & living'] },
    { acct: '14000', name: 'Media & Stock',       items: ['Storage / media', 'Expendables'] },
    { acct: '15000', name: 'Post-Production',     items: ['Editorial', 'VFX', 'Sound design & mix', 'Music', 'Color / DI'] },
    { acct: '16000', name: 'Insurance & Legal',   items: ['Production insurance', 'Legal & finance', 'Completion bond'] },
    { acct: '17000', name: 'Publicity',           items: ['Unit publicist / stills'] },
    { acct: '18000', name: 'General Expenses',    items: ['Production office', 'Payroll fringes', 'Miscellaneous'] }
  ];

  /* Estimator account → top-sheet category routing for seeding. */
  var SEED_MAP = { '4100': '4000', '4200': '4000', '4400': '4000', '4500': '4000', '8500': '8000', '9900': '9000', '13500': '13000', '15200': '15000', '15400': '15000', '15600': '15000', '15800': '15000', '16500': '16000', '16800': '16000' };

  var _uid = 0;
  function uid() { return 'li' + (++_uid) + '_' + Math.random().toString(36).slice(2, 7); }

  function blankItem(desc) {
    return { id: uid(), desc: desc || 'New line item', amt: '', units: '', rate: '', est: 0, actual: 0, notes: '' };
  }

  function blankSheet() {
    return {
      name: 'Untitled Budget',
      preparedBy: '',
      contingencyPct: 10,
      categories: DEFAULT_CATEGORIES.map(function (c) {
        return { acct: c.acct, name: c.name, items: c.items.map(function (d) { return blankItem(d); }) };
      })
    };
  }

  function num(v) { var n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; }

  /* Amt × Units × Rate wins when all three are set; manual estimate otherwise. */
  function itemEst(it) {
    var a = num(it.amt), u = num(it.units), r = num(it.rate);
    if (a > 0 && u > 0 && r > 0) return a * u * r;
    return num(it.est);
  }
  function catTotals(cat) {
    var est = 0, act = 0;
    cat.items.forEach(function (it) { est += itemEst(it); act += num(it.actual); });
    return { est: est, actual: act };
  }
  function sheetTotals(sheet) {
    var sub = 0, act = 0;
    sheet.categories.forEach(function (c) { var t = catTotals(c); sub += t.est; act += t.actual; });
    var cont = sub * num(sheet.contingencyPct) / 100;
    return { subtotal: sub, contingency: cont, grand: sub + cont, actual: act };
  }

  /* Seed the estimated column from SBBudget's script-driven estimate
   * (midpoint of each line's low–high range). */
  function seedFromEstimate(sheet, prod) {
    var byAcct = {};
    sheet.categories.forEach(function (c) { byAcct[c.acct] = c; });
    sheet.categories.forEach(function (c) { c.items = []; });
    Object.keys(prod.groups).forEach(function (gname) {
      var g = prod.groups[gname];
      Object.keys(g).forEach(function (label) {
        var range = g[label];
        if (!range || range[1] <= 0) return;
        var m = label.match(/^(\d{4,5})\s*·\s*(.+)$/);
        var acct = m ? m[1] : null, desc = m ? m[2] : label;
        if (acct === '19000') return; // contingency is auto-computed
        var target = byAcct[SEED_MAP[acct] || acct] || byAcct['18000'];
        var it = blankItem(desc);
        it.est = Math.round((range[0] + range[1]) / 2);
        it.notes = 'est. range ' + SBBudget.fmtMoney(range[0]) + ' – ' + SBBudget.fmtMoney(range[1]);
        target.items.push(it);
      });
    });
    sheet.contingencyPct = 10;
    return sheet;
  }

  /* CSV export — one row per line item plus category subtotals and the
   * sheet totals; opens clean in Excel / Sheets. */
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function sheetToCsv(sheet) {
    var rows = [['Account', 'Category', 'Line item', 'Amt', 'Units', 'Rate', 'Estimated', 'Actual', 'Notes']];
    sheet.categories.forEach(function (c) {
      c.items.forEach(function (it) {
        rows.push([c.acct, c.name, it.desc, it.amt, it.units, it.rate, Math.round(itemEst(it)), num(it.actual) || '', it.notes]);
      });
      var t = catTotals(c);
      if (t.est || t.actual) rows.push([c.acct, c.name, 'SUBTOTAL', '', '', '', Math.round(t.est), Math.round(t.actual) || '', '']);
    });
    var tot = sheetTotals(sheet);
    rows.push(['', '', 'SUBTOTAL (all categories)', '', '', '', Math.round(tot.subtotal), Math.round(tot.actual) || '', '']);
    rows.push(['19000', 'Contingency', sheet.contingencyPct + '%', '', '', '', Math.round(tot.contingency), '', '']);
    rows.push(['', '', 'GRAND TOTAL', '', '', '', Math.round(tot.grand), '', '']);
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\n');
  }

  /* ── persistence ─────────────────────────────────────────────────── */
  var sheet = null;
  var selected = 0;
  var saveTimer = null;

  function load() {
    try { var d = JSON.parse((root.localStorage && root.localStorage.getItem(KEY)) || 'null'); if (d && d.categories) return d; } catch (e) {}
    return blankSheet();
  }
  function persist() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { root.localStorage && root.localStorage.setItem(KEY, JSON.stringify(sheet)); } catch (e) {}
    }, 300);
  }

  /* ── rendering ───────────────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function fm(n) { return SBBudget.fmtMoney(n); }

  function renderTopSheet() {
    var el = $('bsTopSheet');
    if (!el) return;
    var tot = sheetTotals(sheet);
    var h = '<div class="bs-head">' +
      '<input id="bsName" value="' + esc(sheet.name) + '" title="Budget title">' +
      '<div class="bs-sub">Prepared by <input id="bsPrep" value="' + esc(sheet.preparedBy) + '" placeholder="name">' +
      ' · Contingency <input id="bsCont" class="bs-cont" value="' + esc(sheet.contingencyPct) + '">%</div></div>';
    sheet.categories.forEach(function (c, i) {
      var t = catTotals(c);
      var pct = tot.grand > 0 ? Math.round(t.est / tot.grand * 100) : 0;
      h += '<div class="bs-row' + (i === selected ? ' on' : '') + '" data-i="' + i + '">' +
        '<span class="bs-acct">' + esc(c.acct) + '</span>' +
        '<span class="bs-name">' + esc(c.name) + '</span>' +
        '<span class="bs-amt">' + (t.est ? fm(t.est) : '—') + '</span>' +
        '<span class="bs-pct">' + (t.est ? pct + '%' : '') + '</span></div>';
    });
    h += '<div class="bs-row bs-total-row"><span class="bs-acct"></span><span class="bs-name">Subtotal</span><span class="bs-amt">' + fm(tot.subtotal) + '</span><span class="bs-pct"></span></div>';
    h += '<div class="bs-row bs-total-row"><span class="bs-acct">19000</span><span class="bs-name">Contingency (' + esc(sheet.contingencyPct) + '%)</span><span class="bs-amt">' + fm(tot.contingency) + '</span><span class="bs-pct"></span></div>';
    h += '<div class="bs-row bs-grand"><span class="bs-acct"></span><span class="bs-name">GRAND TOTAL' + (tot.actual ? ' · actual ' + fm(tot.actual) : '') + '</span><span class="bs-amt">' + fm(tot.grand) + '</span><span class="bs-pct"></span></div>';
    el.innerHTML = h;

    el.querySelectorAll('.bs-row[data-i]').forEach(function (row) {
      row.addEventListener('click', function () { selected = +row.dataset.i; renderTopSheet(); renderDetail(); });
    });
    var nameEl = $('bsName'), prepEl = $('bsPrep'), contEl = $('bsCont');
    if (nameEl) nameEl.addEventListener('change', function () { sheet.name = nameEl.value; persist(); });
    if (prepEl) prepEl.addEventListener('change', function () { sheet.preparedBy = prepEl.value; persist(); });
    if (contEl) contEl.addEventListener('change', function () { sheet.contingencyPct = Math.max(0, Math.min(30, num(contEl.value))); persist(); renderTopSheet(); });
  }

  function renderDetail() {
    var el = $('bsDetail');
    if (!el) return;
    var cat = sheet.categories[selected];
    if (!cat) { el.innerHTML = '<div class="ps-empty">Select a category on the left</div>'; return; }
    var t = catTotals(cat);
    var h = '<div class="bsd-title">' + esc(cat.acct) + ' · ' + esc(cat.name) + '</div>';
    h += '<table class="bsd-table"><thead><tr><th style="min-width:180px">Line item</th><th>Amt</th><th></th><th>Units</th><th></th><th>Rate</th><th style="text-align:right">Estimated</th><th style="text-align:right">Actual</th><th style="min-width:140px">Notes</th><th></th></tr></thead><tbody>';
    cat.items.forEach(function (it) {
      var calc = num(it.amt) > 0 && num(it.units) > 0 && num(it.rate) > 0;
      h += '<tr data-id="' + it.id + '">' +
        '<td><input class="bsd-desc" data-f="desc" value="' + esc(it.desc) + '"></td>' +
        '<td style="width:56px"><input data-f="amt" value="' + esc(it.amt) + '" placeholder="–"></td><td class="bsd-x">×</td>' +
        '<td style="width:56px"><input data-f="units" value="' + esc(it.units) + '" placeholder="–"></td><td class="bsd-x">×</td>' +
        '<td style="width:76px"><input data-f="rate" value="' + esc(it.rate) + '" placeholder="–"></td>' +
        '<td style="width:96px">' + (calc
          ? '<div class="bsd-tot" title="Amt × Units × Rate">' + fm(itemEst(it)) + '</div>'
          : '<input data-f="est" value="' + (num(it.est) || '') + '" placeholder="0">') + '</td>' +
        '<td style="width:96px"><input data-f="actual" value="' + (num(it.actual) || '') + '" placeholder="–"></td>' +
        '<td><input data-f="notes" value="' + esc(it.notes) + '" placeholder=""></td>' +
        '<td><button class="bsd-del" title="Delete line">✕</button></td></tr>';
    });
    h += '</tbody></table>';
    h += '<div class="bsd-foot"><button class="tb-btn" id="bsdAdd">+ Line item</button><span class="bsd-cat-tot">' + fm(t.est) + (t.actual ? ' · actual ' + fm(t.actual) : '') + '</span></div>';
    el.innerHTML = h;

    el.querySelectorAll('tr[data-id]').forEach(function (tr) {
      var it = cat.items.find(function (x) { return x.id === tr.dataset.id; });
      if (!it) return;
      tr.querySelectorAll('input[data-f]').forEach(function (inp) {
        inp.addEventListener('change', function () {
          it[inp.dataset.f] = inp.value;
          persist();
          renderTopSheet();
          renderDetail();
        });
      });
      var del = tr.querySelector('.bsd-del');
      if (del) del.addEventListener('click', function () {
        cat.items = cat.items.filter(function (x) { return x.id !== it.id; });
        persist(); renderTopSheet(); renderDetail();
      });
    });
    var add = $('bsdAdd');
    if (add) add.addEventListener('click', function () { cat.items.push(blankItem()); persist(); renderDetail(); renderTopSheet(); });
  }

  /* ── toolbar ─────────────────────────────────────────────────────── */
  function estimatorPrefs() {
    try { return JSON.parse((root.localStorage && root.localStorage.getItem('SB_Budget_v1')) || 'null') || {}; } catch (e) { return {}; }
  }

  function wireToolbar() {
    var seed = $('bsSeed');
    if (seed) seed.addEventListener('click', function () {
      var st = root.psProjectState ? root.psProjectState() : {};
      if (!st.scriptText && !(st.clips || []).length) return root.psToast && psToast('No script in the timeline yet — import one first');
      var analysis = SBBudget.analyze(st);
      // Board feedback: real day assignments + breakdown tags from the
      // Schedule tab sharpen cast spans and special-unit day counts.
      var ov = (root.SBScheduleBoard && SBScheduleBoard.boardOverrides) ? SBScheduleBoard.boardOverrides() : {};
      var prod = SBBudget.estimateProduction(analysis, Object.assign({}, estimatorPrefs(), ov));
      seedFromEstimate(sheet, prod);
      if (sheet.name === 'Untitled Budget') sheet.name = (st.projectName || 'Untitled Film') + ' — budget';
      persist(); renderTopSheet(); renderDetail();
      var usedBoard = ov.castDood && Object.keys(ov.castDood).length;
      if (root.psToast) psToast('Seeded — ' + SBBudget.fmtMoney(sheetTotals(sheet).grand) + ' grand total' + (usedBoard ? ' (using your stripboard schedule' + (ov.unitOverrides ? ' + breakdown tags' : '') + ')' : ''));
    });
    var csv = $('bsCsv');
    if (csv) csv.addEventListener('click', function () {
      var blob = new Blob([sheetToCsv(sheet)], { type: 'text/csv' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (sheet.name || 'budget').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '.csv';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    });
    var add = $('bsAddItem');
    if (add) add.addEventListener('click', function () { sheet.categories[selected].items.push(blankItem()); persist(); renderDetail(); renderTopSheet(); });
    var save = $('bsSave');
    if (save) save.addEventListener('click', function () {
      var blob = new Blob([JSON.stringify(sheet, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (sheet.name || 'budget').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '.budget.json';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    });
    var loadBtn = $('bsLoad'), file = $('bsFile');
    if (loadBtn && file) {
      loadBtn.addEventListener('click', function () { file.click(); });
      file.addEventListener('change', function () {
        var f = file.files[0]; file.value = '';
        if (!f) return;
        f.text().then(function (txt) {
          var d = JSON.parse(txt);
          if (!d || !Array.isArray(d.categories)) throw new Error('Not a budget file');
          sheet = d; selected = 0; persist(); renderTopSheet(); renderDetail();
          if (root.psToast) psToast('Loaded ' + (sheet.name || 'budget'));
        }).catch(function (e) { if (root.psToast) psToast('Load failed: ' + e.message); });
      });
    }
    var print = $('bsPrint');
    if (print) print.addEventListener('click', function () { window.print(); });
    var reset = $('bsReset');
    if (reset) reset.addEventListener('click', function () {
      if (!confirm('Start a new blank top sheet? The current sheet will be replaced (save it first if needed).')) return;
      sheet = blankSheet(); selected = 0; persist(); renderTopSheet(); renderDetail();
    });
  }

  function init() {
    if (!$('bsTopSheet')) return;
    sheet = load();
    renderTopSheet();
    renderDetail();
    wireToolbar();
  }

  root.SBBudgetSheet = {
    init: init,
    // exposed for tests
    blankSheet: blankSheet,
    itemEst: itemEst,
    catTotals: catTotals,
    sheetTotals: sheetTotals,
    seedFromEstimate: seedFromEstimate,
    sheetToCsv: sheetToCsv,
    DEFAULT_CATEGORIES: DEFAULT_CATEGORIES
  };
})(typeof window !== 'undefined' ? window : globalThis);
