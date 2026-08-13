/* SHOTBREAK Producer Suite — Tax Incentive Decoder (our own jurisdiction
 * comparison table, in the spirit of taxincentivedecoder.com, built on the
 * verified program terms in SBBudget.INCENTIVES).
 *
 * Enter a budget (or pull it from the top sheet / script estimate) and every
 * jurisdiction shows estimated recovery and net cost, sortable. */
(function (root) {
  'use strict';

  var budget = 5e6;
  var sortKey = 'net'; // net | recovery | name

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function fm(n) { return SBBudget.fmtMoney(n); }
  function num(v) { var n = parseFloat(String(v).replace(/[^0-9.]/g, '')); return isFinite(n) ? n : 0; }

  function rows() {
    return SBBudget.INCENTIVES.filter(function (i) { return i.id !== 'none'; }).map(function (i) {
      var recLow = budget * i.qualPct * i.rate[0];
      var recHigh = budget * i.qualPct * i.rate[1];
      var recMid = (recLow + recHigh) / 2;
      return {
        id: i.id, label: i.label, note: i.note || '',
        rate: i.rate, qualPct: i.qualPct,
        recLow: recLow, recHigh: recHigh, recMid: recMid,
        net: budget - recMid,
        belowMin: i.minSpend ? budget < i.minSpend : false,
        overCap: i.budgetCap ? budget > i.budgetCap : false
      };
    });
  }

  function render() {
    var el = $('inTable');
    if (!el) return;
    var list = rows();
    if (sortKey === 'name') list.sort(function (a, b) { return a.label.localeCompare(b.label); });
    else if (sortKey === 'recovery') list.sort(function (a, b) { return b.recMid - a.recMid; });
    else list.sort(function (a, b) { return a.net - b.net; });
    var eligible = list.filter(function (r) { return !r.belowMin && !r.overCap; });
    var bestId = eligible.length ? eligible[0].id : null;
    if (sortKey !== 'net') bestId = null;

    var h = '<table class="in-table"><thead><tr>' +
      '<th data-k="name">Jurisdiction</th>' +
      '<th>Headline terms</th>' +
      '<th style="text-align:right">Qualified %</th>' +
      '<th data-k="recovery" style="text-align:right">Est. recovery</th>' +
      '<th data-k="net" style="text-align:right">Net cost ▾</th>' +
      '<th>Notes</th></tr></thead><tbody>';
    list.forEach(function (r) {
      var flags = (r.belowMin ? ' <span class="bud-warn">below min spend</span>' : '') +
        (r.overCap ? ' <span class="bud-warn">above program cap</span>' : '');
      h += '<tr' + (r.id === bestId ? ' class="in-best"' : '') + '>' +
        '<td class="in-name">' + esc(r.label.split('—')[0].trim()) + flags + '</td>' +
        '<td>' + esc(r.label.split('—').slice(1).join('—').trim()) + '</td>' +
        '<td class="mono">' + Math.round(r.qualPct * 100) + '%</td>' +
        '<td class="mono good">' + fm(r.recLow) + (Math.round(r.recHigh) > Math.round(r.recLow) ? ' – ' + fm(r.recHigh) : '') + '</td>' +
        '<td class="mono"><b>' + fm(r.net) + '</b></td>' +
        '<td class="in-note">' + esc(r.note) + '</td></tr>';
    });
    h += '</tbody></table>';
    el.innerHTML = h;
    el.querySelectorAll('th[data-k]').forEach(function (th) {
      th.addEventListener('click', function () { sortKey = th.dataset.k; render(); });
    });
  }

  function setBudget(n, label) {
    budget = Math.max(0, n);
    var inp = $('inBudget');
    if (inp) inp.value = budget ? budget.toLocaleString('en-US') : '';
    render();
    if (label && root.psToast) psToast('Comparing incentives on ' + fm(budget) + ' (' + label + ')');
  }

  function estimatorPrefs() {
    try { return JSON.parse((root.localStorage && root.localStorage.getItem('SB_Budget_v1')) || 'null') || {}; } catch (e) { return {}; }
  }

  function init() {
    if (!$('inTable')) return;
    var inp = $('inBudget');
    if (inp) inp.addEventListener('change', function () { setBudget(num(inp.value)); });
    var fromSheet = $('inFromSheet');
    if (fromSheet) fromSheet.addEventListener('click', function () {
      try {
        var d = JSON.parse(localStorage.getItem('SB_BudgetSheet_v1') || 'null');
        if (d && root.SBBudgetSheet) return setBudget(Math.round(SBBudgetSheet.sheetTotals(d).grand), 'top-sheet grand total');
      } catch (e) {}
      if (root.psToast) psToast('No saved top sheet yet — use the Budget tab first');
    });
    var fromEst = $('inFromEst');
    if (fromEst) fromEst.addEventListener('click', function () {
      var st = root.psProjectState ? root.psProjectState() : {};
      if (!st.scriptText && !(st.clips || []).length) return root.psToast && psToast('No script in the timeline yet');
      var prod = SBBudget.estimateProduction(SBBudget.analyze(st), estimatorPrefs());
      setBudget(Math.round(prod.total.likely), 'script estimate, likely');
    });
    setBudget(budget);
  }

  root.SBIncentives = { init: init, render: render, setBudget: setBudget, rows: rows };
})(typeof window !== 'undefined' ? window : globalThis);
