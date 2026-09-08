/* Scotia Tread Scanner – web stopgap. Manual/gauge entry, photos, CSV, optional Google Sheets.
   Same presets, thresholds and spreadsheet columns as the iOS app. Data lives in localStorage. */
(() => {
"use strict";

// ---------- storage ----------
const DB = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
};
const state = {
  inspections: DB.get("inspections", []),
  settings: Object.assign({ technician: "", steer: 4, other: 2, watch: 2, mm: false, clientId: "", spreadsheetId: "", sheetName: "Inspections" }, DB.get("settings", {})),
  queue: DB.get("queue", []),
};
const saveAll = () => { DB.set("inspections", state.inspections); DB.set("settings", state.settings); DB.set("queue", state.queue); };

// ---------- domain ----------
const PRESETS = {
  TRUCK_2A:   { label: "Straight truck (2 axle)", axles: [{dual:false, role:"steer"}, {dual:true, role:"drive"}] },
  TRACTOR_3A: { label: "Tractor (3 axle)", axles: [{dual:false, role:"steer"}, {dual:true, role:"drive"}, {dual:true, role:"drive"}] },
  TRAILER_2A: { label: "Tandem trailer", axles: [{dual:true, role:"trailer"}, {dual:true, role:"trailer"}] },
  TRAILER_3A: { label: "Tri-axle trailer", axles: [{dual:true, role:"trailer"}, {dual:true, role:"trailer"}, {dual:true, role:"trailer"}] },
  CUSTOM:     { label: "Custom", axles: [{dual:false, role:"steer"}, {dual:true, role:"drive"}] },
};
function positions(axles) {
  const out = [];
  axles.forEach((a, i) => {
    const n = i + 1, letter = n === 1 ? "F" : n === axles.length ? "R" : String(n);
    for (const side of ["L", "R"]) {
      if (a.dual) {
        out.push({ code: side + letter + "O", axle: n, side, dual: true, inner: false, role: a.role });
        out.push({ code: side + letter + "I", axle: n, side, dual: true, inner: true, role: a.role });
      } else out.push({ code: side + letter, axle: n, side, dual: false, inner: false, role: a.role });
    }
  });
  return out;
}
const MM = 25.4 / 32;
const fmt32 = v => v == null ? "—" : (Math.round(v * 2) / 2).toString().replace(/\.5$/, ".5") + "/32";
const fmtDepth = v => v == null ? "—" : state.settings.mm ? (v * MM).toFixed(1) + " mm" : fmt32(v);
function status(min, role) {
  if (min == null) return "none";
  const lim = role === "steer" ? state.settings.steer : state.settings.other;
  if (min <= lim) return "REPLACE";
  if (min <= lim + state.settings.watch) return "WATCH";
  return "OK";
}
const grooves = r => [r?.inner, r?.centre, r?.outer].filter(v => v != null && v !== "");
const minOf = r => { const g = grooves(r); return g.length ? Math.min(...g) : null; };
const shortId = ins => { const d = new Date(ins.date); const p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}-${ins.id.slice(0,4).toUpperCase()}`; };

const HEADER = ["inspection_id","date","technician","customer","unit_number","plate","vin","odometer","axle_config","position","brand","model","size","dot_code","depth_inner_32nds","depth_centre_32nds","depth_outer_32nds","depth_min_32nds","depth_min_mm","pressure_psi","status","method","photo_url","notes","scan_confidence_32nds"];
const num = (v, d = 1) => v == null || v === "" ? "" : Number(v).toFixed(d);
function rows(ins) {
  return ins.positions.map(p => {
    const r = ins.readings[p.code] || {};
    const min = minOf(r), st = status(min, p.role);
    return [shortId(ins), new Date(ins.date).toISOString(), ins.technician, ins.customer, ins.unit, ins.plate, ins.vin, ins.odometer ?? "",
      ins.preset, p.code, r.brand || "", r.model || "", r.size || "", r.dot || "",
      num(r.inner), num(r.centre), num(r.outer), num(min), min == null ? "" : (min * MM).toFixed(2), r.pressure ?? "",
      st === "none" ? "" : st, min == null ? "" : "manual", r.photo ? `${shortId(ins)}_${p.code}.jpg` : "", r.notes || "", ""];
  });
}
const csvEsc = c => /[",\r\n]/.test(c = String(c)) ? `"${c.replace(/"/g, '""')}"` : c;
const csv = ins => [HEADER, ...rows(ins)].map(r => r.map(csvEsc).join(",")).join("\r\n") + "\r\n";

// ---------- google sheets (optional) ----------
let gToken = null;
async function ensureToken() {
  if (gToken && gToken.exp > Date.now()) return gToken.value;
  if (!state.settings.clientId) throw new Error("Set the Google client ID in Settings.");
  if (!window.google?.accounts?.oauth2) await new Promise((ok, no) => { const s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.onload = ok; s.onerror = () => no(new Error("Could not load Google sign-in")); document.head.appendChild(s); });
  return new Promise((ok, no) => {
    const tc = google.accounts.oauth2.initTokenClient({ client_id: state.settings.clientId, scope: "https://www.googleapis.com/auth/spreadsheets",
      callback: r => { if (r.error) return no(new Error(r.error)); gToken = { value: r.access_token, exp: Date.now() + (r.expires_in - 60) * 1000 }; ok(gToken.value); } });
    tc.requestAccessToken();
  });
}
async function sheets(method, path, body) {
  const t = await ensureToken();
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${state.settings.spreadsheetId}${path}`, { method, headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`Sheets ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return res.json();
}
async function ensureSheet() {
  const name = state.settings.sheetName;
  const meta = await sheets("GET", "?fields=sheets.properties.title");
  if (!meta.sheets.some(s => s.properties.title === name)) await sheets("POST", ":batchUpdate", { requests: [{ addSheet: { properties: { title: name } } }] });
  const first = await sheets("GET", `/values/${encodeURIComponent(`'${name}'!A1:A1`)}`);
  if (!first.values?.length) await sheets("PUT", `/values/${encodeURIComponent(`'${name}'!A1`)}?valueInputOption=RAW`, { range: `'${name}'!A1`, majorDimension: "ROWS", values: [HEADER] });
}
async function flushQueue() {
  if (!state.queue.length || !navigator.onLine || !state.settings.spreadsheetId) return;
  try {
    await ensureSheet();
    while (state.queue.length) {
      const item = state.queue[0];
      await sheets("POST", `/values/${encodeURIComponent(`'${state.settings.sheetName}'!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { majorDimension: "ROWS", values: item.rows });
      const ins = state.inspections.find(i => i.id === item.id); if (ins) ins.sync = "synced";
      state.queue.shift(); saveAll();
    }
    toast("Synced to Google Sheets");
  } catch (e) { const ins = state.inspections.find(i => i.id === state.queue[0]?.id); if (ins) ins.sync = "failed"; saveAll(); toast(e.message); }
  render();
}
window.addEventListener("online", flushQueue);

// ---------- UI helpers ----------
const view = document.getElementById("view"), titleEl = document.getElementById("title"), backBtn = document.getElementById("back"), menuBtn = document.getElementById("menu");
const h = (tag, attrs = {}, ...kids) => { const el = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === "on") Object.entries(v).forEach(([e, f]) => el.addEventListener(e, f)); else if (k === "html") el.innerHTML = v; else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v); } el.append(...kids.flat().filter(k => k != null).map(k => typeof k === "string" ? document.createTextNode(k) : k)); return el; };
let toastTimer; function toast(msg) { const t = document.getElementById("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 3000); }
const field = (label, input) => h("div", {}, h("label", {}, label), input);
const inp = (opts, val = "") => { const el = h("input", opts); el.value = val ?? ""; return el; };

// ---------- routing ----------
let route = { name: "home" };
const go = (r, push = true) => { route = r; if (push) history.pushState(r, ""); render(); };
window.addEventListener("popstate", e => { route = e.state || { name: "home" }; render(); });
backBtn.onclick = () => history.back();
const findIns = id => state.inspections.find(i => i.id === id);

function render() {
  view.innerHTML = "";
  backBtn.hidden = route.name === "home";
  menuBtn.hidden = !["home", "inspection", "report"].includes(route.name);
  ({ home, newIns, inspection, tire, settings, report, history: unitHistory })[route.name]();
  window.scrollTo(0, 0);
}

// ---------- screens ----------
function home() {
  titleEl.textContent = "Tread Scanner";
  menuBtn.onclick = () => actionSheet([
    ["Settings", () => go({ name: "settings" })],
    state.inspections.length ? ["Export all inspections (CSV)", exportAllCSV] : null,
  ]);
  if (!window.matchMedia("(display-mode: standalone)").matches && !navigator.standalone) {
    view.append(h("div", { class: "card install" }, h("b", {}, "Add to Home Screen"), h("div", { class: "muted" }, "In Safari tap Share, then \"Add to Home Screen\". The app then opens full screen and works offline.")));
  }
  view.append(h("button", { class: "primary", on: { click: () => go({ name: "newIns" }) } }, "+ New inspection"));
  if (state.queue.length) view.append(h("div", { class: "muted", style: "margin:10px 0" }, `${state.queue.reduce((n, q) => n + q.rows.length, 0)} rows waiting to sync. `, h("a", { href: "#", on: { click: e => { e.preventDefault(); flushQueue(); } } }, "Sync now")));
  const list = h("div", { class: "card list" });
  if (!state.inspections.length) list.append(h("div", { class: "muted" }, "No inspections yet. Tap + to start walking around a truck."));
  [...state.inspections].sort((a, b) => b.date - a.date).forEach(ins => {
    const done = ins.positions.filter(p => minOf(ins.readings[p.code]) != null).length;
    list.append(h("div", { class: "item", on: { click: () => go({ name: "inspection", id: ins.id }) } },
      h("div", { style: "flex:1" }, h("b", {}, `Unit ${ins.unit || "?"}`), h("div", { class: "muted" }, `${ins.customer || "No customer"} · ${PRESETS[ins.preset]?.label || ins.preset}`), h("div", { class: "muted" }, new Date(ins.date).toLocaleDateString())),
      h("div", { style: "text-align:right" }, h("div", {}, `${done}/${ins.positions.length}`), h("div", { class: "muted" }, ins.sync === "synced" ? "✓ synced" : ins.sync === "pending" ? "⟳ pending" : ins.sync === "failed" ? "! failed" : ins.complete ? "done" : ""))));
  });
  view.append(list);
  view.append(h("div", { class: "muted", style: "text-align:center" }, "Web version: gauge entry only. LiDAR scanning needs the iPhone app."));
}

function newIns() {
  titleEl.textContent = "New inspection";
  const customers = [...new Set(state.inspections.map(i => i.customer).filter(Boolean))];
  const f = { customer: inp({ list: "customers", autocapitalize: "words" }), unit: inp({}), plate: inp({ autocapitalize: "characters" }), vin: inp({ autocapitalize: "characters" }), odo: inp({ type: "number", inputmode: "numeric", style: "font-size:16px;text-align:left" }), tech: inp({ autocapitalize: "words" }, state.settings.technician) };
  const preset = h("select", {}, ...Object.entries(PRESETS).map(([k, p]) => h("option", { value: k }, p.label))); preset.value = "TRACTOR_3A";
  let custom = PRESETS.CUSTOM.axles.map(a => ({ ...a }));
  const customBox = h("div", { hidden: true });
  const summary = h("div", { class: "muted" });
  const axles = () => preset.value === "CUSTOM" ? custom : PRESETS[preset.value].axles;
  function drawCustom() {
    customBox.innerHTML = "";
    custom.forEach((a, i) => {
      const role = h("select", { on: { change: e => { a.role = e.target.value; refresh(); } } }, ...["steer", "drive", "trailer", "tag"].map(r => h("option", { value: r, selected: a.role === r }, r)));
      const dual = h("button", { on: { click: () => { a.dual = !a.dual; refresh(); } } }, a.dual ? "Dual" : "Single");
      const del = h("button", { class: "danger", on: { click: () => { custom.splice(i, 1); refresh(); } } }, "✕");
      customBox.append(h("div", { class: "row", style: "margin:6px 0" }, h("span", { class: "muted", style: "flex:0 0 60px" }, `Axle ${i + 1}`), role, dual, h("span", { style: "flex:0 0 48px" }, del)));
    });
    customBox.append(h("button", { on: { click: () => { custom.push({ dual: true, role: "drive" }); refresh(); } } }, "+ Add axle"));
  }
  function refresh() { customBox.hidden = preset.value !== "CUSTOM"; if (!customBox.hidden) drawCustom(); const p = positions(axles()); summary.textContent = `${p.length} tire positions: ${p.map(x => x.code).join(" ")}`; }
  preset.onchange = refresh; refresh();
  view.append(
    h("datalist", { id: "customers" }, ...customers.map(c => h("option", { value: c }))),
    h("div", { class: "card" }, h("h2", {}, "Customer & vehicle"), field("Customer / fleet", f.customer), field("Unit number", f.unit), field("Plate", f.plate), field("VIN", f.vin), field("Odometer (km)", f.odo)),
    h("div", { class: "card" }, h("h2", {}, "Technician"), f.tech),
    h("div", { class: "card" }, h("h2", {}, "Axle configuration"), preset, customBox, summary),
    h("button", { class: "primary", on: { click: () => {
      if (!f.unit.value.trim()) return toast("Enter a unit number");
      state.settings.technician = f.tech.value.trim();
      const ins = { id: crypto.randomUUID(), date: Date.now(), customer: f.customer.value.trim(), unit: f.unit.value.trim(), plate: f.plate.value.trim(), vin: f.vin.value.trim(), odometer: f.odo.value ? Number(f.odo.value) : null, technician: f.tech.value.trim(), preset: preset.value, positions: positions(axles()), readings: {}, notes: "", complete: false, sync: "" };
      state.inspections.push(ins); saveAll();
      history.replaceState({ name: "inspection", id: ins.id }, "");
      go({ name: "tire", id: ins.id, code: ins.positions[0].code });
    } } }, "Start")
  );
}

function diagram(ins, nextCode) {
  const d = h("div", { class: "diagram" });
  const axleNums = [...new Set(ins.positions.map(p => p.axle))];
  for (const n of axleNums) {
    const ts = ins.positions.filter(p => p.axle === n);
    const side = list => h("div", { class: "side" }, ...list.map(p => { const r = ins.readings[p.code], m = minOf(r), st = status(m, p.role);
      return h("button", { class: `tire ${st}${p.code === nextCode ? " next" : ""}`, on: { click: () => go({ name: "tire", id: ins.id, code: p.code }) } }, p.code, h("small", {}, fmt32(m))); }));
    const L = ts.filter(p => p.side === "L").sort((a, b) => (a.inner ? 1 : 0) - (b.inner ? 1 : 0));
    const R = ts.filter(p => p.side === "R").sort((a, b) => (b.inner ? 1 : 0) - (a.inner ? 1 : 0));
    d.append(h("div", { class: "axle" }, side(L), h("div", { class: "bar" }), side(R)));
  }
  return d;
}

function inspection() {
  const ins = findIns(route.id); if (!ins) return go({ name: "home" }, false);
  titleEl.textContent = `Unit ${ins.unit}`;
  const next = ins.positions.find(p => minOf(ins.readings[p.code]) == null);
  menuBtn.onclick = () => actionSheet([
    ["Customer report (print / PDF)", () => go({ name: "report", id: ins.id })],
    ["Unit history", () => go({ name: "history", unit: ins.unit, customer: ins.customer })],
    ["Share / download CSV", () => exportCSV(ins)],
    ins.complete ? ["Re-send to Google Sheets", () => enqueue(ins)] : null,
    ins.complete ? ["Reopen inspection", () => { ins.complete = false; saveAll(); render(); }] : null,
    ["Delete inspection", () => { if (confirm("Delete this inspection?")) { state.inspections = state.inspections.filter(i => i !== ins); saveAll(); go({ name: "home" }, false); } }, "danger"],
  ]);
  view.append(diagram(ins, next?.code));
  if (next) view.append(h("button", { class: "primary", style: "margin:12px 0", on: { click: () => go({ name: "tire", id: ins.id, code: next.code }) } }, `Next: ${next.code} · ${describe(next)}`));
  else if (!ins.complete) view.append(h("button", { class: "green", style: "margin:12px 0", on: { click: () => finish(ins) } }, "Finish & send to spreadsheet"));
  const counts = { REPLACE: 0, WATCH: 0, OK: 0 };
  ins.positions.forEach(p => { const s = status(minOf(ins.readings[p.code]), p.role); if (counts[s] != null) counts[s]++; });
  view.append(h("div", { style: "margin:8px 0" }, h("span", { class: "badge REPLACE pill" }, `${counts.REPLACE} replace`), h("span", { class: "badge WATCH pill" }, `${counts.WATCH} watch`), h("span", { class: "badge OK pill" }, `${counts.OK} ok`), h("span", { class: "muted" }, ins.sync ? ` · ${ins.sync}` : "")));
  const list = h("div", { class: "card list" });
  ins.positions.forEach(p => { const r = ins.readings[p.code], m = minOf(r), st = status(m, p.role);
    list.append(h("div", { class: "item", on: { click: () => go({ name: "tire", id: ins.id, code: p.code }) } },
      h("span", { class: `badge ${st}`, style: "width:14px;height:14px;padding:0;border-radius:50%" }), h("b", { style: "width:44px" }, p.code), h("span", { class: "muted", style: "flex:1" }, describe(p)),
      h("span", { class: "muted", style: "font-size:12px" }, grooves(r).map(fmt32).join(" · ")), h("b", {}, fmtDepth(m)))); });
  view.append(list);
  const notes = h("textarea", { rows: 2, placeholder: "Inspection notes", on: { change: e => { ins.notes = e.target.value; saveAll(); } } }); notes.value = ins.notes; view.append(notes);
}
const describe = p => `${p.side === "L" ? "Left" : "Right"} axle ${p.axle}${p.dual ? (p.inner ? " inner" : " outer") : ""} · ${p.role}`;

function tire() {
  const ins = findIns(route.id); if (!ins) return go({ name: "home" }, false);
  const p = ins.positions.find(x => x.code === route.code);
  const r = ins.readings[p.code] || (ins.readings[p.code] = {});
  titleEl.textContent = p.code;
  const g = {}; const mk = k => g[k] = inp({ type: "number", inputmode: "decimal", step: "0.5", min: "0", max: "40", placeholder: "—" }, r[k]);
  const statusEl = h("span", { class: "badge none" }, "—"), minEl = h("b", {}, "—"), warn = h("div", { class: "muted", style: "color:var(--watch)", hidden: true });
  const live = () => { const vals = ["inner", "centre", "outer"].map(k => g[k].value === "" ? null : Number(g[k].value)).filter(v => v != null); const m = vals.length ? Math.min(...vals) : null; const st = status(m, p.role); statusEl.className = `badge ${st}`; statusEl.textContent = st === "none" ? "—" : st; minEl.textContent = fmtDepth(m); const spread = vals.length ? Math.max(...vals) - Math.min(...vals) : 0; warn.hidden = spread < 3; warn.textContent = `Grooves differ by ${fmt32(spread)}. Check alignment and inflation.`; };
  ["inner", "centre", "outer"].forEach(mk); Object.values(g).forEach(i => i.oninput = live);
  const extra = { pressure: inp({ type: "number", inputmode: "numeric", style: "font-size:16px;text-align:left" }, r.pressure), dot: inp({ autocapitalize: "characters" }, r.dot), brand: inp({}, r.brand), model: inp({}, r.model), size: inp({ placeholder: "11R22.5" }, r.size), notes: inp({}, r.notes) };
  const img = h("img", { class: "photo", hidden: !r.photo, src: r.photo || "" });
  const file = h("input", { type: "file", accept: "image/*", capture: "environment", hidden: true, on: { change: async e => { const f = e.target.files[0]; if (!f) return; r.photo = await shrink(f); img.src = r.photo; img.hidden = false; } } });
  const save = () => { ["inner", "centre", "outer"].forEach(k => r[k] = g[k].value === "" ? null : Number(g[k].value)); r.pressure = extra.pressure.value ? Number(extra.pressure.value) : null; ["dot", "brand", "model", "size", "notes"].forEach(k => r[k] = extra[k].value.trim()); r.updated = Date.now(); saveAll(); };
  view.append(
    h("div", { class: "card" }, h("div", { class: "row" }, h("div", {}, h("div", { style: "font-size:28px;font-weight:800" }, p.code), h("div", { class: "muted" }, describe(p))), h("div", { style: "flex:0;text-align:right" }, statusEl)),
      p.inner ? h("div", { class: "muted", style: "margin-top:8px" }, "Inner dual: read the gauge and type the value.") : null),
    h("div", { class: "card" }, h("h2", {}, "Tread depth (32nds)"),
      ...[["inner", "Inner"], ["centre", "Centre"], ["outer", "Outer"]].map(([k, l]) => h("div", { class: "groove" }, h("span", {}, l), g[k], h("span", { class: "muted" }, "/32"))),
      h("div", { class: "row", style: "margin-top:8px" }, h("span", {}, "Minimum"), h("div", { style: "text-align:right" }, minEl)), warn),
    h("div", { class: "card" }, h("h2", {}, "Photo"), img, h("button", { style: "width:100%;margin-top:8px", on: { click: () => file.click() } }, r.photo ? "Retake photo" : "📷 Take photo"), file),
    h("div", { class: "card" }, h("h2", {}, "Tire details (optional)"), field("Pressure (psi)", extra.pressure), field("DOT code", extra.dot), field("Brand", extra.brand), field("Model", extra.model), field("Size", extra.size), field("Notes", extra.notes)),
    h("button", { class: "primary", on: { click: () => { save(); const i = ins.positions.indexOf(p); const order = [...ins.positions.slice(i + 1), ...ins.positions.slice(0, i)]; const nxt = order.find(x => minOf(ins.readings[x.code]) == null); route = { name: "inspection", id: ins.id }; history.replaceState(route, ""); if (nxt) go({ name: "tire", id: ins.id, code: nxt.code }); else render(); } } }, "Save & next"),
    h("button", { style: "width:100%;margin-top:8px", on: { click: () => { save(); history.back(); } } }, "Save")
  );
  live();
  setTimeout(() => (p.inner ? g.centre : g.inner).focus(), 50);
}
function shrink(file) {
  return new Promise(ok => { const url = URL.createObjectURL(file); const im = new Image(); im.onload = () => { const s = Math.min(1, 1000 / Math.max(im.width, im.height)); const c = document.createElement("canvas"); c.width = im.width * s; c.height = im.height * s; c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url); ok(c.toDataURL("image/jpeg", 0.75)); }; im.src = url; });
}

function finish(ins) {
  ins.complete = true; saveAll();
  if (state.settings.spreadsheetId && state.settings.clientId) enqueue(ins);
  else { toast("Saved. Add Google Sheets details in Settings, or share the CSV."); render(); }
}
function enqueue(ins) { state.queue.push({ id: ins.id, rows: rows(ins) }); ins.sync = "pending"; saveAll(); render(); flushQueue(); }
async function exportCSV(ins) {
  const text = csv(ins), name = `tread_${ins.unit}_${shortId(ins)}.csv`;
  const blob = new Blob([text], { type: "text/csv" }), f = new File([blob], name, { type: "text/csv" });
  if (navigator.canShare?.({ files: [f] })) { try { await navigator.share({ files: [f], title: name }); return; } catch (e) { if (e.name === "AbortError") return; } }
  const a = h("a", { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove();
}
function actionSheet(items) {
  const sheet = h("div", { class: "sheet", on: { click: e => { if (e.target === sheet) sheet.remove(); } } }, h("div", { class: "card" }, ...items.filter(Boolean).map(([l, f, cls]) => h("button", { class: cls || "", on: { click: () => { sheet.remove(); f(); } } }, l)), h("button", { on: { click: () => sheet.remove() } }, "Cancel")));
  document.body.append(sheet);
}

// ---------- customer report (print to PDF from Safari's share sheet) ----------
function report() {
  const ins = findIns(route.id); if (!ins) return go({ name: "home" }, false);
  titleEl.textContent = "Report";
  menuBtn.onclick = () => actionSheet([["Print / Save as PDF", () => window.print()], ["Share CSV", () => exportCSV(ins)]]);
  const counts = { REPLACE: [], WATCH: [], OK: [] };
  ins.positions.forEach(p => { const st = status(minOf(ins.readings[p.code]), p.role); if (counts[st]) counts[st].push(p.code); });
  const rep = h("div", { class: "report" },
    h("div", { class: "rep-head" },
      h("div", {}, h("div", { class: "rep-brand" }, "Scotia Tire & Alignment"), h("div", { class: "rep-title" }, "Tire tread inspection")),
      h("div", { class: "rep-meta" }, h("div", {}, h("b", {}, "Unit "), ins.unit), h("div", {}, h("b", {}, "Customer "), ins.customer || "—"), h("div", {}, h("b", {}, "Date "), new Date(ins.date).toLocaleString()),
        h("div", {}, h("b", {}, "Plate "), ins.plate || "—"), h("div", {}, h("b", {}, "VIN "), ins.vin || "—"), h("div", {}, h("b", {}, "Odometer "), ins.odometer != null ? `${ins.odometer.toLocaleString()} km` : "—"), h("div", {}, h("b", {}, "Technician "), ins.technician || "—"), h("div", {}, h("b", {}, "Ref "), shortId(ins)))),
    h("div", { class: "rep-summary" },
      h("div", { class: "rep-stat REPLACE" }, h("b", {}, String(counts.REPLACE.length)), h("span", {}, "Replace now"), h("small", {}, counts.REPLACE.join(" ") || "—")),
      h("div", { class: "rep-stat WATCH" }, h("b", {}, String(counts.WATCH.length)), h("span", {}, "Replace soon"), h("small", {}, counts.WATCH.join(" ") || "—")),
      h("div", { class: "rep-stat OK" }, h("b", {}, String(counts.OK.length)), h("span", {}, "OK"), h("small", {}, counts.OK.join(" ") || "—"))),
    diagram(ins, null),
    h("div", { class: "rep-tablewrap" }, h("table", { class: "rep-table" },
      h("thead", {}, h("tr", {}, ...["Position", "Inner", "Centre", "Outer", "Min", "PSI", "Status", "Notes"].map(t => h("th", {}, t)))),
      h("tbody", {}, ...ins.positions.map(p => { const r = ins.readings[p.code] || {}, m = minOf(r), st = status(m, p.role);
        return h("tr", {}, h("td", {}, h("b", {}, p.code), h("div", { class: "muted", style: "font-size:11px" }, describe(p))), h("td", {}, fmt32(r.inner)), h("td", {}, fmt32(r.centre)), h("td", {}, fmt32(r.outer)),
          h("td", {}, h("b", {}, fmtDepth(m))), h("td", {}, r.pressure ?? "—"), h("td", {}, h("span", { class: `badge ${st}` }, st === "none" ? "—" : st)), h("td", { class: "muted" }, [r.notes, (r.brand || r.size) ? `${r.brand} ${r.size}`.trim() : "", (grooves(r).length > 1 && Math.max(...grooves(r)) - Math.min(...grooves(r)) >= 3) ? "uneven wear" : ""].filter(Boolean).join(" · "))); })))),
    ins.notes ? h("p", { class: "rep-notes" }, h("b", {}, "Notes: "), ins.notes) : null,
    h("div", { class: "rep-photos" }, ...ins.positions.filter(p => ins.readings[p.code]?.photo).map(p => h("figure", {}, h("img", { src: ins.readings[p.code].photo }), h("figcaption", {}, `${p.code} · ${fmtDepth(minOf(ins.readings[p.code]))}`)))),
    h("p", { class: "rep-foot" }, `Minimums: ${state.settings.steer}/32 steer, ${state.settings.other}/32 drive & trailer (Canada NSC / US FMCSA). WATCH = within ${state.settings.watch}/32 of the minimum. Depths in 32nds of an inch, lowest of three grooves.`)
  );
  view.append(h("button", { class: "primary noprint", style: "margin-bottom:12px", on: { click: () => window.print() } }, "Print / Save as PDF"), rep);
}

// ---------- unit history ----------
function unitHistory() {
  const unit = route.unit;
  const list = state.inspections.filter(i => i.unit === unit && (!route.customer || i.customer === route.customer)).sort((a, b) => a.date - b.date);
  titleEl.textContent = `Unit ${unit} history`;
  if (!list.length) { view.append(h("div", { class: "card muted" }, "No inspections for this unit.")); return; }
  const codes = [...new Set(list.flatMap(i => i.positions.map(p => p.code)))];
  const roleOf = c => list.flatMap(i => i.positions).find(p => p.code === c)?.role || "drive";
  // Wear rate: 32nds per 10,000 km between first and last inspection with odometer, per position.
  const withOdo = list.filter(i => i.odometer != null);
  const rate = c => {
    const pts = withOdo.map(i => [i.odometer, minOf(i.readings[c])]).filter(([, d]) => d != null);
    if (pts.length < 2) return null;
    const [o0, d0] = pts[0], [o1, d1] = pts[pts.length - 1];
    return o1 > o0 ? (d0 - d1) / (o1 - o0) * 10000 : null;
  };
  view.append(h("div", { class: "card" }, h("h2", {}, `${list.length} inspections`), h("div", { class: "muted" }, `${new Date(list[0].date).toLocaleDateString()} → ${new Date(list[list.length - 1].date).toLocaleDateString()}${withOdo.length > 1 ? ` · ${(withOdo[withOdo.length - 1].odometer - withOdo[0].odometer).toLocaleString()} km` : ""}`)));
  const wrap = h("div", { class: "card", style: "overflow-x:auto;padding:0" });
  const tbl = h("table", { class: "hist" });
  tbl.append(h("thead", {}, h("tr", {}, h("th", {}, "Pos"), ...list.map(i => h("th", {}, new Date(i.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }), h("div", { class: "muted", style: "font-weight:400" }, i.odometer != null ? `${Math.round(i.odometer / 1000)}k` : ""))), h("th", {}, "Wear /10k km"))));
  tbl.append(h("tbody", {}, ...codes.map(c => h("tr", {}, h("td", {}, h("b", {}, c)), ...list.map(i => { const m = minOf(i.readings[c]); const st = status(m, roleOf(c)); return h("td", {}, h("span", { class: `badge ${st}` }, fmt32(m))); }),
    h("td", {}, rate(c) != null ? h("span", { class: "muted" }, `${rate(c).toFixed(1)}/32`) : h("span", { class: "muted" }, "—"))))));
  wrap.append(tbl); view.append(wrap);
  view.append(h("div", { class: "muted", style: "margin-top:8px" }, "Wear rate needs odometer readings on at least two inspections. Projected life = (current depth − minimum) ÷ rate."));
  const proj = codes.map(c => { const r = rate(c), last = list[list.length - 1], m = minOf(last.readings[c]); if (!r || r <= 0 || m == null) return null; const lim = roleOf(c) === "steer" ? state.settings.steer : state.settings.other; return [c, Math.max(0, (m - lim) / r * 10000)]; }).filter(Boolean).sort((a, b) => a[1] - b[1]);
  if (proj.length) view.append(h("div", { class: "card" }, h("h2", {}, "Projected km to minimum"), ...proj.slice(0, 6).map(([c, km]) => h("div", { class: "row", style: "padding:4px 0" }, h("b", { style: "flex:0 0 50px" }, c), h("span", {}, `${Math.round(km / 1000).toLocaleString()}k km`)))));
}

function exportAllCSV() {
  const all = [HEADER, ...state.inspections.flatMap(rows)].map(r => r.map(csvEsc).join(",")).join("\r\n") + "\r\n";
  const blob = new Blob([all], { type: "text/csv" }), name = `tread_all_${new Date().toISOString().slice(0, 10)}.csv`, f = new File([blob], name, { type: "text/csv" });
  if (navigator.canShare?.({ files: [f] })) { navigator.share({ files: [f], title: name }).catch(() => {}); return; }
  const a = h("a", { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove();
}

function settings() {
  titleEl.textContent = "Settings";
  const s = state.settings;
  const f = { technician: inp({}, s.technician), steer: inp({ type: "number", inputmode: "numeric", style: "font-size:16px" }, s.steer), other: inp({ type: "number", inputmode: "numeric", style: "font-size:16px" }, s.other), watch: inp({ type: "number", inputmode: "numeric", style: "font-size:16px" }, s.watch), clientId: inp({ autocapitalize: "off", placeholder: "1234-abc.apps.googleusercontent.com" }, s.clientId), spreadsheetId: inp({ autocapitalize: "off", placeholder: "from the sheet URL" }, s.spreadsheetId), sheetName: inp({}, s.sheetName) };
  const mm = h("input", { type: "checkbox", style: "width:auto" }); mm.checked = s.mm;
  const save = () => { s.technician = f.technician.value.trim(); s.steer = Number(f.steer.value) || 4; s.other = Number(f.other.value) || 2; s.watch = Number(f.watch.value) || 0; s.mm = mm.checked; s.clientId = f.clientId.value.trim(); s.spreadsheetId = f.spreadsheetId.value.trim(); s.sheetName = f.sheetName.value.trim() || "Inspections"; gToken = null; saveAll(); };
  view.append(
    h("div", { class: "card" }, h("h2", {}, "Technician"), f.technician),
    h("div", { class: "card" }, h("h2", {}, "Thresholds (32nds)"), field("Steer minimum", f.steer), field("Drive / trailer minimum", f.other), field("Watch band above minimum", f.watch), h("div", { class: "muted", style: "margin-top:8px" }, "Defaults 4/32 steer, 2/32 others (Canada NSC / US FMCSA)."), h("label", { class: "row", style: "margin-top:10px" }, mm, h("span", {}, "Show millimetres instead of 32nds"))),
    h("div", { class: "card" }, h("h2", {}, "Google Sheets (optional)"), field("Web OAuth client ID", f.clientId), field("Spreadsheet ID", f.spreadsheetId), field("Tab name", f.sheetName),
      h("div", { class: "muted", style: "margin-top:8px" }, `Google Cloud console → Credentials → OAuth client ID, type Web application, authorized JavaScript origin: ${location.origin}. Enable the Sheets API. Add technicians as test users.`),
      h("button", { style: "width:100%;margin-top:10px", on: { click: async () => { save(); try { await ensureToken(); toast("Google connected"); flushQueue(); } catch (e) { toast(e.message); } } } }, "Connect Google")),
    h("div", { class: "card muted" }, "Web stopgap of the Scotia Tread Scanner. Data is stored on this device only. The iPhone app adds LiDAR scanning."),
    h("button", { class: "primary", on: { click: () => { save(); toast("Saved"); history.back(); } } }, "Save")
  );
}

// ---------- boot ----------
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
history.replaceState(route, "");
render();
flushQueue();
})();
