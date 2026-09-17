/* Yard Check report renderer.
 *
 * One module, three users: the web app, the iOS app (bundled as a resource and
 * shown in a web view), and the PC tool that inlines it into a standalone HTML.
 * Works as a browser global `YardCheck` and as a Node module.
 *
 * Input is a survey document (see buildDocument / fromInspections for the shape).
 * compute() derives every per-tire status, condition and fleet statistic from the
 * raw readings and the fleet policy. render() turns that into a paginated report.
 * Nothing about the layout or the numbers lives anywhere else.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.YardCheck = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const WATCH_BAND = 2;            // 32nds above pull point that count as "near pull point"
  const DUAL_TREAD_MISMATCH = 4;   // a dual differing by MORE than this many 32nds is a mismatch
                                   // (the reference shows a 12 vs 8 pair as matched, so exactly 4 passes)
  const DUAL_PSI_MISMATCH = 0.10;  // fractional pressure difference across a dual
  const HIST_MAX = 26;             // histogram bins run 0..HIST_MAX (extended if data exceeds)

  const ROLE_LETTER = { steer: "S", drive: "D", trailer: "T", tag: "TL" };
  const ROLE_LABEL = { steer: "Steer", drive: "Drive", trailer: "Free Rolling", tag: "Trailer Lift" };
  const ROLE_SECTION = { steer: "Steer Axles", drive: "Drive Axles", trailer: "Trailer Axles", tag: "Auxiliary Axles" };
  const VALVE_LABEL = { ok: "", missing: "Missing", replaced: "Replaced", inaccessible: "Inaccessible" };

  const DEFAULT_POLICY = {
    steer:   { pull: 4, recPsi: null, minPsi: null, retreads: false },
    drive:   { pull: 2, recPsi: null, minPsi: null, retreads: true },
    trailer: { pull: 2, recPsi: null, minPsi: null, retreads: true },
    tag:     { pull: 2, recPsi: null, minPsi: null, retreads: true },
  };

  // ------------------------------------------------------------------ helpers
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pct = (n, d) => d ? Math.round(100 * n / d) + "%" : "0%";
  const pc = (n, d) => `${pct(n, d)} (${n})`;
  const num = v => (v == null || v === "" || Number.isNaN(Number(v))) ? null : Number(v);
  const isNum = v => typeof v === "number" && !Number.isNaN(v);

  function configCode(axles) {
    return axles.map(a => (a.dual ? 4 : 2) + (ROLE_LETTER[a.role] || "D")).join("-");
  }

  /** Bridgestone slot numbering, left to right across the axle. */
  function slotNumber(p) {
    if (!p.dual) return p.side === "L" ? 1 : 2;
    if (p.side === "L") return p.inner ? 2 : 1;
    return p.inner ? 3 : 4;
  }

  /** "All : 11R22.5" or "1 - S : 425/65R22.5 , 2,3 - D : 11R22.5" */
  function sizeSummary(axles) {
    const sizes = axles.map(a => a.size || "");
    if (sizes.every(s => s === sizes[0])) return `All : ${sizes[0] || "—"}`;
    const groups = [];
    axles.forEach((a, i) => {
      const key = ROLE_LETTER[a.role] + "|" + (a.size || "");
      const g = groups.find(x => x.key === key);
      if (g) g.idx.push(i + 1); else groups.push({ key, letter: ROLE_LETTER[a.role], size: a.size || "—", idx: [i + 1] });
    });
    return groups.map(g => `${g.idx.join(",")} - ${g.letter} : ${g.size}`).join(" , ");
  }

  /** Short per-vehicle size line: "S: 425/65R22.5, D: 11R22.5, D: 11R22.5" */
  function sizeLine(axles) {
    const sizes = axles.map(a => a.size || "");
    if (sizes.every(s => s === sizes[0])) return `All: ${sizes[0] || "—"}`;
    return axles.map(a => `${ROLE_LETTER[a.role]}: ${a.size || "—"}`).join(", ");
  }

  function policyFor(doc, vehicle, axle) {
    const base = (doc.policy && doc.policy.default) || {};
    const p = Object.assign({}, DEFAULT_POLICY[axle.role] || DEFAULT_POLICY.drive, base[axle.role] || {});
    return p;
  }

  function bandFor(min, pull) {
    if (min == null) return "none";
    if (min <= pull) return "red";
    if (min <= pull + WATCH_BAND) return "orange";
    return "green";
  }

  function inflationBucket(psi, rec) {
    if (psi == null || rec == null || rec <= 0) return "notChecked";
    const r = psi / rec;
    if (r >= 1.20) return "over20";
    if (r >= 0.95) return "within";
    if (r >= 0.90) return "under5";
    if (r >= 0.80) return "under10";
    return "under20";
  }
  const INFLATION_LABELS = [
    ["over20", "20% or More Over-Inflated"], ["within", "Within 5% Under to 20% Over"],
    ["under5", "5% or More Under-Inflated"], ["under10", "10% or More Under-Inflated"],
    ["under20", "20% or More Under-Inflated"], ["notChecked", "Not checked"],
  ];

  // ------------------------------------------------------------------ compute
  function compute(input) {
    const doc = JSON.parse(JSON.stringify(input));
    doc.brand = doc.brand || {};
    doc.brand.name = doc.brand.name || "Scotia Tire & Alignment";
    doc.survey = doc.survey || {};
    doc.survey.generated = doc.survey.generated || new Date().toISOString().slice(0, 10);

    const allTires = [];
    for (const v of doc.vehicles) {
      v.axles = v.axles || [];
      v.configCode = v.configCode || configCode(v.axles);
      v.sizeLine = sizeLine(v.axles);
      v.tires = (v.tires || []).map(t => Object.assign({}, t));
      for (const t of v.tires) {
        const axle = v.axles[t.axle - 1] || { role: "drive", dual: true };
        const pol = policyFor(doc, v, axle);
        t.role = axle.role;
        t.pull = num(t.pull) != null ? num(t.pull) : pol.pull;
        t.recPsi = num(t.recPsi) != null ? num(t.recPsi) : pol.recPsi;
        t.minPsi = num(t.minPsi) != null ? num(t.minPsi) : pol.minPsi;
        const g = [t.inner, t.centre, t.outer].map(num).filter(x => x != null);
        t.min = g.length ? Math.min(...g) : (num(t.min));
        t.psi = num(t.psi);
        t.valveCap = t.valveCap || "ok";
        t.band = bandFor(t.min, t.pull);
        t.immediate = []; t.warning = [];
        if (t.band === "red") t.immediate.push("RTD At or Below Pull Point");
        if (t.band === "orange") t.warning.push("RTD Near Pull Point");
        t.inflation = inflationBucket(t.psi, t.recPsi);
        t.vehicle = v.unit;
        allTires.push(t);
      }
      // Dual pairs: slots (1,2) and (3,4) on dual axles.
      v.dualPairs = [];
      v.axles.forEach((a, i) => {
        if (!a.dual) return;
        for (const [s1, s2] of [[1, 2], [3, 4]]) {
          const A = v.tires.find(t => t.axle === i + 1 && t.slot === s1);
          const B = v.tires.find(t => t.axle === i + 1 && t.slot === s2);
          if (!A || !B || A.min == null || B.min == null) continue;
          const pair = { tires: [A, B], tread: false, inflation: false };
          if (Math.abs(A.min - B.min) > DUAL_TREAD_MISMATCH) {
            pair.tread = true; [A, B].forEach(t => t.warning.push("Tread Depth Mismatch"));
          }
          if (A.psi != null && B.psi != null && Math.abs(A.psi - B.psi) / Math.max(A.psi, B.psi) > DUAL_PSI_MISMATCH) {
            pair.inflation = true; [A, B].forEach(t => t.warning.push("Inflation Mismatch"));
          }
          v.dualPairs.push(pair);
        }
      });
      for (const t of v.tires) {
        t.warning = [...new Set(t.warning)];
        t.conditionText = [...t.immediate, ...t.warning].join(", ");
        t.hasImmediate = t.immediate.length > 0; t.hasWarning = t.warning.length > 0;
        t.status = t.hasImmediate ? "red" : t.hasWarning ? "orange" : t.min == null ? "none" : "green";
      }
      v.hasImmediate = v.tires.some(t => t.hasImmediate);
    }

    // ---- fleet statistics
    const measured = allTires.filter(t => t.min != null);
    const s = doc.stats = {};
    s.tiresInspected = allTires.length;
    s.vehiclesInspected = doc.vehicles.length;
    s.immediate = allTires.filter(t => t.hasImmediate && !t.hasWarning).length;
    s.warning = allTires.filter(t => t.hasWarning && !t.hasImmediate).length;
    s.both = allTires.filter(t => t.hasImmediate && t.hasWarning).length;
    s.withConditions = s.immediate + s.warning + s.both;
    s.withoutConditions = s.tiresInspected - s.withConditions;
    s.immediateCount = allTires.filter(t => t.hasImmediate).length;
    s.bands = { red: 0, orange: 0, green: 0 };
    for (const t of measured) s.bands[t.band]++;
    s.conditionCounts = {};
    for (const t of allTires) for (const c of [...t.immediate, ...t.warning]) s.conditionCounts[c] = (s.conditionCounts[c] || 0) + 1;
    s.immediateTypes = Object.entries(s.conditionCounts).filter(([c]) => c.startsWith("RTD At")).map(([c, n]) => ({ name: c, n }));
    s.warningTypes = Object.entries(s.conditionCounts).filter(([c]) => !c.startsWith("RTD At")).map(([c, n]) => ({ name: c, n }));
    s.inflation = {}; for (const [k] of INFLATION_LABELS) s.inflation[k] = 0;
    for (const t of allTires) s.inflation[t.inflation]++;
    s.valves = { missing: 0, replaced: 0, inaccessible: 0 };
    for (const t of allTires) if (s.valves[t.valveCap] != null) s.valves[t.valveCap]++;
    const pairs = doc.vehicles.flatMap(v => v.dualPairs);
    s.dualPairs = pairs.length;
    s.vehiclesWithDuals = doc.vehicles.filter(v => v.axles.some(a => a.dual)).length;
    s.mismatch = {
      none: pairs.filter(p => !p.tread && !p.inflation).length,
      inflation: pairs.filter(p => p.inflation && !p.tread).length,
      tread: pairs.filter(p => p.tread && !p.inflation).length,
      both: pairs.filter(p => p.tread && p.inflation).length,
    };
    s.mismatched = s.mismatch.inflation + s.mismatch.tread + s.mismatch.both;
    s.histAll = histogram(measured);
    s.histByRole = {};
    for (const role of ["steer", "drive", "trailer", "tag"]) {
      const ts = measured.filter(t => t.role === role);
      if (ts.length || role !== "tag") s.histByRole[role] = { tires: ts.length, hist: histogram(ts), bands: countBands(ts) };
    }
    s.immediateTires = allTires.filter(t => t.hasImmediate);
    s.policies = policyGroups(doc);
    return doc;
  }

  function countBands(ts) { const b = { red: 0, orange: 0, green: 0 }; for (const t of ts) b[t.band]++; return b; }

  function histogram(ts) {
    const max = Math.max(HIST_MAX, ...ts.map(t => Math.round(t.min)));
    const bins = [];
    for (let i = 0; i <= max; i++) bins.push({ depth: i, red: 0, orange: 0, green: 0 });
    for (const t of ts) { const b = bins[Math.max(0, Math.round(t.min))]; if (b) b[t.band]++; }
    return bins;
  }

  function policyGroups(doc) {
    const groups = new Map();
    for (const v of doc.vehicles) {
      const key = v.configCode + " " + sizeSummary(v.axles);
      if (!groups.has(key)) groups.set(key, { key, code: v.configCode, sizes: sizeSummary(v.axles), axles: v.axles, vehicles: [] });
      groups.get(key).vehicles.push(v);
    }
    return [...groups.values()].sort((a, b) => b.vehicles.length - a.vehicles.length || a.key.localeCompare(b.key)).map(g => ({
      title: `${g.vehicles.length} × ${g.code} ${g.sizes}`,
      rows: g.axles.map((a, i) => {
        const pol = policyFor(doc, g.vehicles[0], a);
        const sample = g.vehicles[0].tires.find(t => t.axle === i + 1);
        return {
          tires: g.vehicles.length * (a.dual ? 4 : 2), type: ROLE_LABEL[a.role] || a.role,
          pull: sample && sample.pull != null ? sample.pull : pol.pull, recPsi: pol.recPsi, minPsi: pol.minPsi, retreads: pol.retreads,
        };
      }),
      vehicles: g.vehicles.map(v => v.unit),
    }));
  }

  // ------------------------------------------------------------------ SVG charts
  const C = { red: "#B22222", orange: "#E8760A", green: "#3BAA6B", grey: "#8a8a8a" };

  function histSVG(bins, height) {
    const H = height || 150, W = 760, left = 40, bottom = 26, top = 8;
    const n = bins.length, bw = (W - left - 10) / n;
    const maxV = Math.max(1, ...bins.map(b => b.red + b.orange + b.green));
    const scale = (H - top - bottom) / maxV;
    let out = `<svg viewBox="0 0 ${W} ${H + 70}" class="yc-hist" role="img"><text x="12" y="${(H) / 2}" transform="rotate(-90 12 ${H / 2})" text-anchor="middle" class="yc-axis">Tires</text>`;
    bins.forEach((b, i) => {
      const x = left + i * bw + bw * 0.15, w = bw * 0.7;
      let y = H - bottom;
      for (const k of ["red", "orange", "green"]) {
        if (!b[k]) continue;
        const h = Math.max(2, b[k] * scale);
        y -= h;
        out += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${C[k]}"/>`;
      }
      out += `<text x="${(x + w / 2).toFixed(1)}" y="${H - bottom + 14}" text-anchor="middle" class="yc-axis">${b.depth}</text>`;
    });
    out += `<text x="${left}" y="${H - 2}" class="yc-axis">inches (in 32nds)</text>`;
    // three count rows beneath the bars, one per band
    ["red", "orange", "green"].forEach((k, r) => {
      const y = H + 16 + r * 18;
      out += `<rect x="${left - 30}" y="${y - 10}" width="12" height="12" fill="${C[k]}"/><line x1="0" y1="${y + 5}" x2="${W}" y2="${y + 5}" class="yc-rule"/>`;
      bins.forEach((b, i) => {
        if (!b[k]) return;
        const x = left + i * bw + bw / 2;
        out += `<text x="${x.toFixed(1)}" y="${y}" text-anchor="middle" class="yc-count" fill="${C[k]}">${b[k]}</text>`;
      });
    });
    return out + `</svg>`;
  }

  function bandBarSVG(bands, total) {
    const W = 760, H = 34;
    let x = 0, out = `<svg viewBox="0 0 ${W} ${H}" class="yc-bar" role="img">`;
    for (const k of ["red", "orange", "green"]) {
      const w = total ? W * bands[k] / total : 0;
      if (w > 0) out += `<rect x="${x.toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${H}" fill="${C[k]}"/>`;
      x += w;
    }
    if (!total) out += `<rect x="0" y="0" width="${W}" height="${H}" fill="#ddd"/>`;
    return out + `</svg>`;
  }

  function donutSVG(parts, total) {
    // parts: [{value, color, label}]
    const R = 60, r = 32, cx = 80, cy = 80;
    let out = `<svg viewBox="0 0 260 160" class="yc-donut" role="img">`;
    if (!total) return out + `<circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="#ddd" stroke-width="${R - r}"/></svg>`;
    let a0 = -Math.PI / 2;
    const arc = (a, b, rad) => `${(cx + rad * Math.cos(a)).toFixed(2)} ${(cy + rad * Math.sin(a)).toFixed(2)}`;
    for (const p of parts) {
      if (!p.value) continue;
      const frac = p.value / total, a1 = a0 + frac * 2 * Math.PI, large = frac > 0.5 ? 1 : 0;
      if (frac >= 0.9999) {
        out += `<circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="${p.color}" stroke-width="${R - r}"/>`;
      } else {
        out += `<path d="M ${arc(a0, 0, R)} A ${R} ${R} 0 ${large} 1 ${arc(a1, 0, R)} L ${arc(a1, 0, r)} A ${r} ${r} 0 ${large} 0 ${arc(a0, 0, r)} Z" fill="${p.color}"/>`;
      }
      const mid = (a0 + a1) / 2, lx = cx + (R + 34) * Math.cos(mid), ly = cy + (R + 34) * Math.sin(mid);
      out += `<line x1="${(cx + R * Math.cos(mid)).toFixed(1)}" y1="${(cy + R * Math.sin(mid)).toFixed(1)}" x2="${lx.toFixed(1)}" y2="${ly.toFixed(1)}" stroke="${p.color}" stroke-width="1"/>`;
      out += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" class="yc-count" fill="${p.color}" text-anchor="${Math.cos(mid) >= 0 ? "start" : "end"}" dy="4">${pct(p.value, total)} (${p.value})</text>`;
      a0 = a1;
    }
    return out + `</svg>`;
  }

  function axleDiagram(v) {
    // numbered squares per axle, coloured by status
    let out = `<div class="yc-axles">`;
    v.axles.forEach((a, i) => {
      const slots = a.dual ? [1, 2, 3, 4] : [1, 2];
      const cell = s => {
        const t = v.tires.find(x => x.axle === i + 1 && x.slot === s);
        const cls = t ? t.status : "none";
        return `<span class="yc-sq ${cls}">${s}</span>`;
      };
      const left = a.dual ? cell(1) + cell(2) : cell(1);
      const right = a.dual ? cell(3) + cell(4) : cell(2);
      out += `<div class="yc-axle"><span class="yc-axle-n">${i + 1}</span><span class="yc-side">${left}</span><span class="yc-gap"></span><span class="yc-side">${right}</span></div>`;
    });
    return out + `</div>`;
  }

  // ------------------------------------------------------------------ pages
  const PAGE_BODY_PX = 1010;   // usable height of a Letter page body at 96 dpi, after header/footer
  const VEH_HEADER_PX = 34, VEH_BLOCK_MIN_PX = 120, TIRE_ROW_PX = 41, VEH_NOTE_PX = 32, VEH_GAP_PX = 6;

  function page(title, body, opts) {
    opts = opts || {};
    return { title, body, cover: !!opts.cover, cls: opts.cls || "" };
  }

  function sectionHead(title) { return `<h2 class="yc-h2"><span class="yc-red"></span>${esc(title)}</h2>`; }

  function tile(label, value, cls) { return `<div class="yc-tile"><div class="yc-tile-l">${esc(label)}</div><div class="yc-tile-v ${cls || ""}">${value}</div></div>`; }

  function bandLegend(b, total) {
    return `<div class="yc-legend">
      <div><i class="red"></i><b>At or Below Pull-Point</b><br>${pc(b.red, total)}</div>
      <div><i class="orange"></i><b>With 2/32nds of Pull-Point</b><br>${pc(b.orange, total)}</div>
      <div><i class="green"></i><b>Above Pull-Point</b><br>${pc(b.green, total)}</div></div>`;
  }

  function buildPages(doc) {
    const s = doc.stats, sv = doc.survey, pages = [];

    // 1. cover
    pages.push(page("YARD CHECK", `
      <div class="yc-cover-photo">${doc.brand.coverImage ? `<img src="${esc(doc.brand.coverImage)}" alt="">` : `<div class="yc-cover-ph"></div>`}</div>
      <div class="yc-cover-title"><span>YARD CHECK</span>${logoHTML(doc)}</div>
      <div class="yc-cover-grid">
        <div class="span2"><small>Fleet Name</small><b>${esc(sv.fleet || "")}</b></div>
        <div><small>Location</small><b>${esc(sv.location || "")}</b></div>
        <div><small>Reported By</small><b>${esc(sv.reportedBy || "")}</b></div>
        <div><small>Account Number</small><b>${esc(sv.account || "")}</b></div>
        <div></div>
        <div><small>Yard Check Dates</small><b>${esc((sv.dates || []).join(", "))}</b></div>
        <div><small>Survey ID</small><b>${esc(sv.id || "")}</b></div>
        <div><small>Participants</small><b>${esc((sv.participants || []).join(", "))}</b></div>
      </div>
      <div class="yc-cover-truck"></div>`, { cover: true }));

    // 2. surveys
    pages.push(page("SURVEYS", `<table class="yc-table"><thead><tr><th>Location</th><th>Account #</th><th>Date</th><th>Survey ID</th><th>Participants</th><th>Vehicles</th></tr></thead>
      <tbody><tr><td>${esc(sv.location || "")}</td><td>${esc(sv.account || "")}</td><td>${esc((sv.dates || []).join(", "))}</td><td>${esc(sv.id || "")}</td><td>${esc((sv.participants || []).join(", "))}</td><td>${s.vehiclesInspected}</td></tr></tbody></table>`));

    // 3. management summary
    const total = s.tiresInspected, meas = s.bands.red + s.bands.orange + s.bands.green;
    pages.push(page("MANAGEMENT SUMMARY", `
      <div class="yc-tiles">
        <div class="yc-tile alert"><span class="yc-bang">!</span><div><div class="yc-tile-l">Immediate Action Conditions</div><div class="yc-tile-v red">${s.immediateCount}</div></div></div>
        <div class="yc-tiles-r">${tile("Tires Inspected", total)}${tile("Vehicles Inspected", s.vehiclesInspected)}${tile("Tires without Conditions", `<span class="green">${pct(s.withoutConditions, total)}</span> <small>(${s.withoutConditions})</small>`)}</div>
      </div>
      <div class="yc-cols">
        <div class="yc-card"><h3>Tire Conditions Summary</h3>
          <div class="yc-kv"><span>Tires With Conditions</span><b class="red big">${pct(s.withConditions, total)} <small>(${s.withConditions})</small></b></div>
          <div class="yc-cond-grid">${[...s.immediateTypes, ...s.warningTypes].map(c => `<div><small>${esc(c.name)}</small><b>${pct(c.n, total)} <small>(${c.n})</small></b></div>`).join("") || "<div><small>None</small></div>"}</div>
        </div>
        <div class="yc-card"><h3>Inflation Distribution (PSI)</h3>
          ${INFLATION_LABELS.map(([k, l]) => `<div class="yc-kv"><span>${l}</span><b>${k === "notChecked" ? `<span class="yc-greybar">${pc(s.inflation[k], total)}</span>` : pc(s.inflation[k], total)}</b></div>`).join("")}
        </div>
      </div>
      <div class="yc-card"><h3>Remaining Tread Depth (32nds) Distribution</h3>${histSVG(s.histAll, 110)}
        ${bandBarSVG(s.bands, meas)}${bandLegend(s.bands, meas)}</div>
      <div class="yc-cols">
        <div class="yc-card"><h3>Valves</h3>
          <div class="yc-kv col"><span>Missing Valve Caps</span><b class="orange big">${s.valves.missing} <small>(${pct(s.valves.missing, total)})</small></b></div>
          <div class="yc-kv col"><span>Replaced Valve Caps</span><b class="green big">${s.valves.replaced} <small>(${pct(s.valves.replaced, total)})</small></b></div>
          <div class="yc-kv col"><span>Inaccessible Valves</span><b class="red big">${s.valves.inaccessible} <small>(${pct(s.valves.inaccessible, total)})</small></b></div>
        </div>
        <div class="yc-card yc-mm"><h3>Dual Mismatches</h3><div class="yc-mm-grid"><div>
          <div class="yc-kv col"><span>Inflation Mismatch</span><b class="red big">${pc(s.mismatch.inflation, s.dualPairs)}</b></div>
          <div class="yc-kv col"><span>Tread Depth Mismatch</span><b class="red big">${pc(s.mismatch.tread, s.dualPairs)}</b></div>
          <div class="yc-kv col"><span>Inflation and Tread Depth Mismatch</span><b class="red big">${pc(s.mismatch.both, s.dualPairs)}</b></div></div>
          ${donutSVG([{ value: s.mismatch.none, color: C.green }, { value: s.mismatched, color: C.red }], s.dualPairs)}</div></div>
      </div>`));

    // 4-5. remaining tread depth by axle type
    const roleKeys = Object.keys(s.histByRole);
    for (let i = 0; i < roleKeys.length; i += 3) {
      pages.push(page("REMAINING TREAD DEPTH", roleKeys.slice(i, i + 3).map(role => {
        const r = s.histByRole[role];
        return `<div class="yc-card"><div class="yc-card-head"><h3>${ROLE_SECTION[role]}</h3>${bandLegend(r.bands, r.tires)}</div>${histSVG(r.hist, 130)}</div>`;
      }).join("")));
    }

    // 6. tire conditions
    pages.push(page("TIRE CONDITIONS", `
      <div class="yc-tiles">
        <div class="yc-tile alert"><span class="yc-bang">!</span><div><div class="yc-tile-l">Immediate Action Conditions</div><div class="yc-tile-v red">${s.immediateCount}</div></div></div>
        <div class="yc-tiles-r">${tile("Tires Inspected", total)}${tile("Vehicles Inspected", s.vehiclesInspected)}${tile("Tires With Conditions", `<span class="red">${pct(s.withConditions, total)}</span> <small>(${s.withConditions})</small>`)}</div>
      </div>
      <div class="yc-card">${bandBarSVG({ red: s.immediate, orange: s.warning + s.both, green: s.withoutConditions }, total)}
        <div class="yc-legend four">
          <div><i class="red"></i><b>Immediate Action</b><br>${s.immediate} (${pct(s.immediate, total)}) Tires</div>
          <div><i class="orange"></i><b>Warning Conditions</b><br>${s.warning} (${pct(s.warning, total)}) Tires</div>
          <div><i class="hatch"></i><b>Immediate and Warning</b><br>${s.both} (${pct(s.both, total)}) Tires</div>
          <div><i class="green"></i><b>No Condition</b><br>${s.withoutConditions} (${pct(s.withoutConditions, total)}) Tires</div></div></div>
      <table class="yc-table cond"><thead><tr><th>Immediate Action</th><th class="r">Tires</th><th class="r">% Of Tires</th></tr></thead>
        <tbody>${s.immediateTypes.map(c => `<tr><td><i class="yc-dot red"></i>${esc(c.name)}</td><td class="r">${c.n}</td><td class="r">${pct(c.n, total)}</td></tr>`).join("")}</tbody></table>
      <table class="yc-table cond"><thead><tr><th>Warning Conditions</th><th class="r">Tires</th><th class="r">% Of Tires</th></tr></thead>
        <tbody>${s.warningTypes.map(c => `<tr><td><i class="yc-dot orange"></i>${esc(c.name)}</td><td class="r">${c.n}</td><td class="r">${pct(c.n, total)}</td></tr>`).join("")}</tbody></table>`));

    // 7. mismatching issues
    pages.push(page("MISMATCHING ISSUES", `
      <div class="yc-tiles">
        <div class="yc-tile alert"><span class="yc-bang">!</span><div><div class="yc-tile-l">Duals with Mismatches</div><div class="yc-tile-v red">${pct(s.mismatched, s.dualPairs)} <small>(${s.mismatched})</small></div></div></div>
        <div class="yc-tiles-r">${tile("Dual Pairs Inspected", s.dualPairs)}${tile("Vehicles With Duals", s.vehiclesWithDuals)}</div>
      </div>
      <div class="yc-card yc-mm"><h3>Dual Mismatches</h3><div class="yc-mm-grid"><div>
        <div class="yc-kv col"><span>Not Mismatched</span><b class="green big">${pc(s.mismatch.none, s.dualPairs)}</b></div>
        <div class="yc-kv col"><span>Inflation Mismatch</span><b class="red big">${pc(s.mismatch.inflation, s.dualPairs)}</b></div>
        <div class="yc-kv col"><span>Tread Depth Mismatch</span><b class="red big">${pc(s.mismatch.tread, s.dualPairs)}</b></div>
        <div class="yc-kv col"><span>Inflation and Tread Depth Mismatch</span><b class="red big">${pc(s.mismatch.both, s.dualPairs)}</b></div></div>
        ${donutSVG([{ value: s.mismatch.none, color: C.green }, { value: s.mismatched, color: C.red }], s.dualPairs)}</div></div>
      <div class="yc-card yc-prose"><p>When two tires are run together in a dual assembly, they must be matched. That means they must be nearly the same circumference (less than 4/32nds difference), and air pressure (less than 10% difference). When not properly matched, two problems can potentially occur:</p>
        <p>▫ The larger diameter tire carries more of the load, resulting in it being overloaded and ultimately leading to overheating and possibly failing.</p>
        <p>▫ The smaller diameter tire wears faster and irregularly, because the larger tire's diameter determines the revolutions per mile. Because it is not in proper contact with the road surface, the smaller tire scuffs along, creating rapid wear.</p>
        <p>To verify that duals are mismatched, a physical measurement of the diameter, inflation, or circumference of both tires must be taken.</p></div>`));

    // 8+. maintenance policies (paginated by estimated height)
    const polBlocks = s.policies.map(g => ({
      h: 40 + g.rows.length * 34 + 34 + 16,
      html: `<div class="yc-pol"><div class="yc-pol-title">${esc(g.title)}</div>
        <table class="yc-table pol"><thead><tr><th>Tires</th><th>Axle Type</th><th>Pull Point<br><small>(inches (in 32nds))</small></th><th>Rec. PSI</th><th>Min. PSI</th><th>Retreads Allowed</th></tr></thead>
        <tbody>${g.rows.map(r => `<tr><td>${r.tires}</td><td>${esc(r.type)}</td><td>${r.pull}</td><td>${r.recPsi ?? "—"}</td><td>${r.minPsi ?? "—"}</td><td>${r.retreads ? "Yes" : "No"}</td></tr>`).join("")}</tbody></table>
        <div class="yc-pol-foot"><b>Location:</b> Fleet Policy &nbsp;&nbsp;&nbsp; <b>Vehicles:</b> ${esc(g.vehicles.join(", "))}</div></div>`,
    }));
    packBlocks(polBlocks, PAGE_BODY_PX).forEach(html => pages.push(page("MAINTENANCE POLICIES", html)));

    // immediate action details
    const detHead = `<table class="yc-table veh"><thead><tr><th class="veh">Vehicle</th><th></th><th>RTD<br><small>(inches (in 32nds))</small></th><th>PSI</th><th>Conditions</th><th>Valve Cap</th><th>Notes</th></tr></thead><tbody>`;
    const iaRows = s.immediateTires.map(t => tireRow(t, doc.vehicles.find(v => v.unit === t.vehicle), true)).join("");
    pages.push(page("IMMEDIATE ACTION DETAILS", detHead + iaRows + `</tbody></table>`));

    // vehicle details, paginated with continuation
    const vehBlocks = [];
    for (const v of doc.vehicles) vehBlocks.push(...vehicleBlocks(v));
    packBlocks(vehBlocks, PAGE_BODY_PX).forEach(html => pages.push(page("VEHICLE DETAILS", detHead + html + `</tbody></table>`, { cls: "veh" })));

    return pages;
  }

  /** Greedy pagination of blocks {h, html}. */
  function packBlocks(blocks, limit) {
    const pagesOut = []; let cur = "", used = 0;
    for (const b of blocks) {
      if (used + b.h > limit && cur) { pagesOut.push(cur); cur = ""; used = 0; }
      cur += b.html; used += b.h;
    }
    if (cur || !pagesOut.length) pagesOut.push(cur);
    return pagesOut;
  }

  function tireRow(t, v, withVehicle) {
    const vehCell = withVehicle ? `<td class="veh"><b>${esc(v ? v.unit : t.vehicle)}</b><br><small>${esc(v ? v.type || "" : "")}</small></td>` : ``;
    const psi = `${t.psi == null ? "--" : t.psi} / ${t.recPsi == null ? "--" : t.recPsi}`;
    return `<tr class="yc-tire">${vehCell}<td class="pos">${t.axle}-${t.slot}</td><td class="rtd"><b>${t.min == null ? "--" : t.min}</b> / ${t.pull}</td><td>${psi}</td><td class="cond">${esc(t.conditionText)}</td><td>${VALVE_LABEL[t.valveCap] || ""}</td><td class="note">${esc(t.notes || "")}</td></tr>`;
  }

  /** A vehicle becomes one or more blocks: header block + rows in chunks so a long vehicle can continue on the next page. */
  function vehicleBlocks(v) {
    const rows = v.tires.slice().sort((a, b) => a.axle - b.axle || a.slot - b.slot);
    const head = (cont, span) => `<tr class="yc-veh-head"><td class="veh" rowspan="${span}"><b>${esc(v.unit)}</b><br>${esc(v.type || "")}<br>${esc(v.configCode)}${axleDiagram(v)}</td><td colspan="6" class="sizes">${cont ? "(continued) " : ""}${esc(v.sizeLine)}</td></tr>`;
    const blocks = [];
    const perChunk = 20;
    for (let i = 0; i < rows.length; i += perChunk) {
      const chunk = rows.slice(i, i + perChunk);
      const isLast = i + perChunk >= rows.length;
      const noteRow = isLast && v.notes ? `<tr class="yc-veh-note"><td colspan="6">${esc(v.notes)}</td></tr>` : "";
      const diagramH = 30 + v.axles.length * 42;
      blocks.push({
        h: Math.max(VEH_BLOCK_MIN_PX, VEH_HEADER_PX + diagramH, VEH_HEADER_PX + chunk.length * TIRE_ROW_PX) + (noteRow ? VEH_NOTE_PX : 0) + VEH_GAP_PX,
        html: `<tbody class="yc-veh">${head(i > 0, 1 + chunk.length + (noteRow ? 1 : 0))}${chunk.map(t => tireRow(t, v, false)).join("")}${noteRow}</tbody>`,
      });
    }
    return blocks;
  }

  function logoHTML(doc) {
    if (doc.brand.logo) return `<img class="yc-logo" src="${esc(doc.brand.logo)}" alt="${esc(doc.brand.name)}">`;
    return `<span class="yc-logo-text">${esc(doc.brand.name)}</span>`;
  }

  // ------------------------------------------------------------------ render
  function render(input) {
    const doc = input.stats ? input : compute(input);
    const pages = buildPages(doc);
    const n = pages.length;
    const gen = `Report Generated ${esc(doc.survey.generated)}`;
    return `<div class="yc-report">` + pages.map((p, i) => `
      <section class="yc-page ${p.cover ? "cover" : ""} ${p.cls}">
        ${p.cover ? "" : `<header class="yc-head">${sectionHead(p.title)}${logoHTML(doc)}</header>`}
        <div class="yc-body">${p.body}</div>
        <footer class="yc-foot"><span class="yc-foot-brand">${esc(doc.brand.name)}</span><span class="yc-foot-fleet">${esc(doc.survey.fleet || "")}</span><span class="yc-foot-gen">${gen}</span><span class="yc-foot-n">${i + 1}/${n}</span></footer>
      </section>`).join("") + `</div>`;
  }

  function mount(input, el) { el.innerHTML = render(input); }

  // ------------------------------------------------------------------ adapters
  /** Build a survey document from the web app's data structures. */
  function fromInspections(inspections, survey, policy, brand) {
    const vehicles = inspections.map(ins => {
      const axles = axlesFromPositions(ins.positions, ins.readings);
      const tires = ins.positions.map(p => {
        const r = ins.readings[p.code] || {};
        return { axle: p.axle, slot: slotNumber(p), code: p.code, inner: r.inner, centre: r.centre, outer: r.outer,
                 psi: r.pressure, valveCap: r.valveCap || "ok", notes: r.notes || "" };
      });
      return { unit: ins.unit, type: ins.vehicleType || "", axles, tires, notes: ins.notes || "" };
    });
    return { survey, policy: { default: policy || {} }, brand: brand || {}, vehicles };
  }

  function axlesFromPositions(positions, readings) {
    const byAxle = new Map();
    for (const p of positions) {
      if (!byAxle.has(p.axle)) byAxle.set(p.axle, { role: p.role, dual: !!p.dual, size: "" });
      const r = readings && readings[p.code];
      if (r && r.size && !byAxle.get(p.axle).size) byAxle.get(p.axle).size = r.size;
    }
    return [...byAxle.keys()].sort((a, b) => a - b).map(k => byAxle.get(k));
  }

  return { compute, render, mount, fromInspections, configCode, slotNumber, sizeSummary, sizeLine, bandFor, inflationBucket, DEFAULT_POLICY, WATCH_BAND, DUAL_TREAD_MISMATCH, DUAL_PSI_MISMATCH };
});
