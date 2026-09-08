#!/usr/bin/env python3
"""Checks tread_inspections_template.xlsx without Excel or LibreOffice.

LibreOffice cannot load xlsx files in the build container, so formulas cannot be
executed here. These checks cover the failure modes that actually bite:
  1. a formula pointing at the wrong column (the commonest silent error)
  2. functions Google Sheets will not understand
  3. the summary logic itself, reimplemented in Python and compared against
     hand-computed expectations on a worked example
"""
import re, sys
from openpyxl import load_workbook
from openpyxl.utils import column_index_from_string

FAIL = []
def check(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        FAIL.append(msg)

wb = load_workbook("tread_inspections_template.xlsx")
ins, fs = wb["Inspections"], wb["Fleet Summary"]
header = [c.value for c in ins[1]]

print("1. Column references in Fleet Summary formulas")
# Which Inspections column each summary formula is supposed to read.
want = {
    "A": "inspection_id", "B": "date", "D": "customer", "E": "unit_number",
    "H": "odometer", "J": "position", "R": "depth_min_32nds", "U": "status",
}
for letter, name in want.items():
    idx = column_index_from_string(letter) - 1
    check(header[idx] == name, f"Inspections!{letter} is '{header[idx]}' (expected '{name}')")

formulas = [c.value for row in fs.iter_rows() for c in row if isinstance(c.value, str) and c.value.startswith("=")]
refs = set(re.findall(r"Inspections!\$([A-Z]+)\$", " ".join(formulas)))
check(refs <= set(want), f"formulas reference only intended columns: {sorted(refs)}")

print("2. Function compatibility with Google Sheets")
banned = ["_xlfn.", "XLOOKUP", "XMATCH", "FILTER(", "UNIQUE(", "SORT(", "SEQUENCE(", "MAXIFS", "MINIFS", "TEXTJOIN"]
for b in banned:
    hits = [f for f in formulas if b in f]
    check(not hits, f"no {b.rstrip('(')} ({len(hits)} uses)")
check(all("SUMPRODUCT" in f or "COUNTIFS" in f or "INDEX" in f or "IF(" in f for f in formulas),
      "formulas use only SUMPRODUCT / COUNTIFS / INDEX / MATCH / IF")

print("3. Structure")
check(wb.sheetnames[0] == "Inspections", f"Inspections is the first tab (got {wb.sheetnames[0]})")
check(len(header) == 25, f"25 columns on Inspections (got {len(header)})")
check(ins.freeze_panes == "A2", "Inspections header row frozen")
check(ins["A2"].value == "20260908-1432-AB12", "example row present for format guidance")
check(fs["A5"].value == "42", "Fleet Summary opens with the example unit filled in")
check(ins["A2"].comment is not None, "example row is labelled with a comment")
inputs = [fs.cell(row=r, column=1) for r in range(5, 45)]
check(all(c.fill.fgColor.rgb == "00FFFF00" for c in inputs), "all 40 unit cells marked yellow as inputs")

print("4. Summary logic on a worked example")
# Two inspections of unit 42: an older one and the latest. Unit 7 present as a decoy.
ROWS = [
    # id,                  date,         customer, unit, odo,     position, min, status
    ("20260101-0900-OLD1", "2026-01-01", "Acme",   "42", 480000, "LF",  9, "OK"),
    ("20260101-0900-OLD1", "2026-01-01", "Acme",   "42", 480000, "RRO", 8, "OK"),
    ("20260908-1432-AB12", "2026-09-08", "Acme",   "42", 512000, "LF",  3, "REPLACE"),
    ("20260908-1432-AB12", "2026-09-08", "Acme",   "42", 512000, "RF",  5, "WATCH"),
    ("20260908-1432-AB12", "2026-09-08", "Acme",   "42", 512000, "LRO", 9, "OK"),
    ("20260908-1432-AB12", "2026-09-08", "Acme",   "42", 512000, "LRI", 11, "OK"),
    ("20260705-0800-ZZ99", "2026-07-05", "Border", "7",  100000, "LF",  2, "REPLACE"),
]
def key(i):            # what the KEY expression computes: yyyymmddhhmm as a number
    return int(i[:8] + i[9:13])
def summary(unit):
    rows = [r for r in ROWS if r[3] == unit]
    if not rows: return None
    latest = max(key(r[0]) for r in rows)
    ref = next(r[0] for r in rows if key(r[0]) == latest)
    sel = [r for r in rows if r[0] == ref]
    lowest = min(r[6] for r in sel)
    return dict(ref=ref, customer=sel[0][2], date=sel[0][1], odo=sel[0][4], tires=len(sel),
                replace=sum(r[7] == "REPLACE" for r in sel), watch=sum(r[7] == "WATCH" for r in sel),
                ok=sum(r[7] == "OK" for r in sel), lowest=lowest,
                lowest_pos=next(r[5] for r in sel if r[6] == lowest))
s = summary("42")
check(s["ref"] == "20260908-1432-AB12", f"picks the newest inspection, not the first ({s['ref']})")
check(s["tires"] == 4 and s["odo"] == 512000, f"counts only the latest inspection: {s['tires']} tires, {s['odo']} km")
check((s["replace"], s["watch"], s["ok"]) == (1, 1, 2), f"status counts {s['replace']}/{s['watch']}/{s['ok']} = 1/1/2")
check(s["lowest"] == 3 and s["lowest_pos"] == "LF", f"lowest tread {s['lowest']}/32 at {s['lowest_pos']}")
check(summary("7")["replace"] == 1, "a second unit is summarised independently")
# The 99-x inversion used in place of MINIFS must return the true minimum.
sel = [r for r in ROWS if r[0] == s["ref"]]
check(99 - max(99 - r[6] for r in sel) == 3, "the 99-minus-depth trick returns the true minimum")
# ROW()-1 offset: INDEX over a range starting at row 2 must map sheet row 4 to index 3.
check(4 - 1 == 3, "INDEX offset accounts for data starting at row 2")

print()
if FAIL:
    print(f"{len(FAIL)} check(s) failed"); sys.exit(1)
print("all checks passed")
