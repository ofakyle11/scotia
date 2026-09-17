#!/usr/bin/env python3
"""Build a Yard Check report (Bridgestone-style) from Tread Scanner CSV exports.

  python3 yardcheck.py build export1.csv export2.csv -o GFL_2026-09-17.html
      [--policy policy.json] [--logo logo.png] [--brand "Scotia Tire & Alignment"]
      [--survey-id 165881] [--pdf]

Reads the CSV the apps export (the first 25 columns are enough; the 12 yard-check
columns added in September 2026, config_code, slot, valve_cap and the policy
columns, are used when present), groups rows into vehicles
and yard checks, and writes a single self-contained HTML file with the shared
renderer (web/yardcheck.js) inlined. Open it in any browser and print to PDF.
--pdf writes the PDF directly when Playwright's Chromium is installed.

The numbers in the report are computed by yardcheck.js, the same code the phone
uses, so a CSV round trip gives the same result as the app screen.
"""
import argparse, csv, json, os, re, sys
from collections import OrderedDict
from pathlib import Path

HERE = Path(__file__).resolve().parent
WEB = HERE.parent.parent / "web"

DEFAULT_POLICY = {
    "steer":   {"pull": 4, "recPsi": None, "minPsi": None, "retreads": False},
    "drive":   {"pull": 2, "recPsi": None, "minPsi": None, "retreads": True},
    "trailer": {"pull": 2, "recPsi": None, "minPsi": None, "retreads": True},
    "tag":     {"pull": 2, "recPsi": None, "minPsi": None, "retreads": True},
}

def fnum(v):
    if v is None: return None
    v = str(v).strip()
    if v == "" or v == "--": return None
    try: return float(v) if "." in v else int(v)
    except ValueError: return None

def parse_code(code):
    """TMC code -> (side, axle_letter, dual, inner). 'L2O' -> ('L','2',True,False)."""
    m = re.fullmatch(r"([LR])(F|R|\d+)([OI])?", code.strip().upper())
    if not m: raise ValueError(f"unrecognised position code {code!r}")
    side, letter, oi = m.groups()
    return side, letter, oi is not None, oi == "I"

def axle_index(letter, n_axles):
    if letter == "F": return 1
    if letter == "R": return n_axles
    return int(letter)

def count_axles(codes):
    letters = {parse_code(c)[1] for c in codes}
    nums = [int(x) for x in letters if x.isdigit()]
    has_f, has_r = "F" in letters, "R" in letters
    if nums: return max(nums) + (1 if has_r else 0)
    return (1 if has_f else 0) + (1 if has_r else 0)

def slot(side, dual, inner):
    if not dual: return 1 if side == "L" else 2
    if side == "L": return 2 if inner else 1
    return 3 if inner else 4

def role_for(row, letter, dual, cfg):
    r = (row.get("axle_role") or "").strip().lower()
    if r in DEFAULT_POLICY: return r
    if cfg:  # infer from a config code like 2S-4D-4D
        parts = cfg.split("-")
        idx = None
        try: idx = axle_index(letter, len(parts)) - 1
        except Exception: pass
        if idx is not None and 0 <= idx < len(parts):
            code = re.sub(r"^\d+", "", parts[idx])
            return {"S": "steer", "D": "drive", "T": "trailer", "TL": "tag"}.get(code, "drive")
    return "steer" if letter == "F" and not dual else "drive"

def read_rows(paths):
    rows = []
    for p in paths:
        with open(p, newline="", encoding="utf-8-sig") as f:
            for r in csv.DictReader(f):
                if r.get("unit_number") or r.get("position"): rows.append(r)
    return rows

def build_documents(rows, policy=None, brand=None, survey_id=None):
    """Group rows -> list of survey documents (one per yard check)."""
    groups = OrderedDict()
    for r in rows:
        key = r.get("survey_id") or f"{r.get('customer','')}|{(r.get('date') or '')[:10]}"
        groups.setdefault(key, []).append(r)
    if survey_id and survey_id in groups: groups = {survey_id: groups[survey_id]}
    docs = []
    for key, grows in groups.items():
        by_ins = OrderedDict()
        for r in grows: by_ins.setdefault(r["inspection_id"], []).append(r)
        vehicles = []
        for iid, irows in by_ins.items():
            codes = [r["position"] for r in irows]
            n = count_axles(codes)
            cfg = irows[0].get("config_code") or ""
            if not re.fullmatch(r"\d+(S|D|T|TL)(-\d+(S|D|T|TL))*", cfg): cfg = ""
            axles = {}
            tires = []
            for r in irows:
                side, letter, dual, inner = parse_code(r["position"])
                ai = axle_index(letter, n)
                role = role_for(r, letter, dual, cfg)
                a = axles.setdefault(ai, {"role": role, "dual": dual, "size": ""})
                if r.get("size") and not a["size"]: a["size"] = r["size"].strip()
                t = {"axle": ai, "slot": int(r["slot"]) if r.get("slot") else slot(side, dual, inner), "code": r["position"],
                     "inner": fnum(r.get("depth_inner_32nds")), "centre": fnum(r.get("depth_centre_32nds")), "outer": fnum(r.get("depth_outer_32nds")),
                     "psi": fnum(r.get("pressure_psi")), "valveCap": (r.get("valve_cap") or "ok").strip() or "ok", "notes": r.get("notes") or ""}
                for src, dst in (("pull_point_32nds", "pull"), ("rec_psi", "recPsi"), ("min_psi", "minPsi")):
                    v = fnum(r.get(src))
                    if v is not None: t[dst] = v
                tires.append(t)
            first = irows[0]
            vehicles.append({"unit": first.get("unit_number", ""), "type": first.get("vehicle_type", ""),
                             "axles": [axles[k] for k in sorted(axles)], "tires": tires, "notes": ""})
        first = grows[0]
        dates = sorted({(r.get("date") or "")[:10] for r in grows if r.get("date")})
        doc = {
            "survey": {"id": first.get("survey_id") or key.replace("|", "-"), "fleet": first.get("customer", ""), "location": first.get("location", ""),
                       "account": "", "dates": dates, "reportedBy": first.get("reported_by") or first.get("technician", ""), "participants": []},
            "policy": {"default": policy or DEFAULT_POLICY},
            "brand": brand or {"name": "Scotia Tire & Alignment"},
            "vehicles": vehicles,
        }
        docs.append(doc)
    return docs

def render_html(doc, title=None):
    js = (WEB / "yardcheck.js").read_text(encoding="utf-8")
    css = (WEB / "yardcheck.css").read_text(encoding="utf-8")
    data = json.dumps(doc).replace("</", "<\\/")
    title = title or f"Yard Check {doc['survey'].get('fleet','')} {' '.join(doc['survey'].get('dates', []))}".strip()
    return f"""<!doctype html><html><head><meta charset="utf-8"><title>{title}</title>
<style>html,body{{margin:0;background:#777}}{css}
@media screen{{.yc-report{{zoom:var(--fit,1)}}}}</style></head><body>
<div id="r"></div>
<script>{js}</script>
<script>const DOC={data};YardCheck.mount(DOC,document.getElementById("r"));
const fit=()=>document.documentElement.style.setProperty("--fit",Math.min(1,(innerWidth-8)/830));fit();addEventListener("resize",fit);</script>
</body></html>"""

def write_pdf(html_path, pdf_path):
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("Playwright is not installed; open the HTML in a browser and print to PDF (Letter, no margins).", file=sys.stderr)
        return False
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        pg = b.new_page()
        pg.goto(Path(html_path).resolve().as_uri())
        pg.emulate_media(media="print")
        pg.pdf(path=str(pdf_path), format="Letter", print_background=True, margin={"top": "0", "bottom": "0", "left": "0", "right": "0"})
        b.close()
    return True

def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["build", "doc"])
    ap.add_argument("csv", nargs="+")
    ap.add_argument("-o", "--out", help="output .html (build) or .json (doc); default derived from the fleet and date")
    ap.add_argument("--policy", help="policy.json with steer/drive/trailer/tag pull points and PSI")
    ap.add_argument("--logo", help="logo image file, embedded into the report")
    ap.add_argument("--brand", default="Scotia Tire & Alignment")
    ap.add_argument("--survey-id", help="only this yard check when the CSVs hold several")
    ap.add_argument("--pdf", action="store_true", help="also write a PDF next to the HTML (needs Playwright)")
    a = ap.parse_args(argv)
    policy = json.load(open(a.policy)) if a.policy else None
    brand = {"name": a.brand}
    if a.logo:
        import base64, mimetypes
        mt = mimetypes.guess_type(a.logo)[0] or "image/png"
        brand["logo"] = f"data:{mt};base64," + base64.b64encode(open(a.logo, "rb").read()).decode()
    docs = build_documents(read_rows(a.csv), policy, brand, a.survey_id)
    if not docs:
        print("no rows found", file=sys.stderr); return 1
    if len(docs) > 1 and a.cmd == "build":
        print(f"note: {len(docs)} yard checks found; building all (use --survey-id to pick one)", file=sys.stderr)
    for doc in docs:
        stem = a.out or f"yardcheck_{re.sub(r'[^A-Za-z0-9]+','_',doc['survey']['fleet']) or 'fleet'}_{(doc['survey']['dates'] or ['undated'])[0]}"
        if len(docs) > 1 and a.out: stem = f"{Path(a.out).with_suffix('')}_{doc['survey']['id']}"
        stem = str(Path(stem).with_suffix(""))
        if a.cmd == "doc":
            Path(stem + ".json").write_text(json.dumps(doc, indent=2)); print("wrote", stem + ".json"); continue
        html = render_html(doc)
        Path(stem + ".html").write_text(html, encoding="utf-8")
        print(f"wrote {stem}.html  ({len(doc['vehicles'])} vehicles, {sum(len(v['tires']) for v in doc['vehicles'])} tires)")
        if a.pdf and write_pdf(stem + ".html", stem + ".pdf"): print("wrote", stem + ".pdf")
    return 0

if __name__ == "__main__":
    sys.exit(main())
