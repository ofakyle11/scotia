"""Tests for the CSV -> yard check document builder. Run: python3 -m pytest -q test_yardcheck.py"""
import csv, io, json, subprocess, sys
from pathlib import Path
import yardcheck as yc

HERE = Path(__file__).resolve().parent
SAMPLE = HERE.parent.parent / "spreadsheet" / "sample_inspection.csv"

def test_parse_codes():
    assert yc.parse_code("LF") == ("L", "F", False, False)
    assert yc.parse_code("R2I") == ("R", "2", True, True)
    assert yc.parse_code("LRO") == ("L", "R", True, False)

def test_axle_count_and_index():
    assert yc.count_axles(["LF", "RF", "LRO", "LRI", "RRO", "RRI"]) == 2
    assert yc.count_axles(["LF", "RF", "L2O", "L2I", "R2O", "R2I", "LRO", "LRI", "RRO", "RRI"]) == 3
    assert yc.count_axles(["LFO", "LFI", "RFO", "RFI", "L2O", "L2I", "R2O", "R2I", "LRO", "LRI", "RRO", "RRI"]) == 3
    assert yc.axle_index("F", 3) == 1 and yc.axle_index("R", 3) == 3 and yc.axle_index("2", 3) == 2

def test_slots_match_bridgestone_numbering():
    assert yc.slot("L", False, False) == 1 and yc.slot("R", False, False) == 2
    assert [yc.slot(s, True, i) for s, i in (("L", False), ("L", True), ("R", True), ("R", False))] == [1, 2, 3, 4]

def test_sample_csv_builds_one_tractor():
    docs = yc.build_documents(yc.read_rows([SAMPLE]))
    assert len(docs) == 1
    v = docs[0]["vehicles"][0]
    assert v["unit"] == "42"
    assert [a["role"] for a in v["axles"]] == ["steer", "drive", "drive"]
    assert [a["dual"] for a in v["axles"]] == [False, True, True]
    assert all(a["size"] == "11R22.5" for a in v["axles"])
    assert len(v["tires"]) == 10
    lf = next(t for t in v["tires"] if t["code"] == "LF")
    assert (lf["axle"], lf["slot"], lf["inner"]) == (1, 1, 3)

def test_old_axle_config_preset_code_is_not_a_config_code():
    # the 25-column export carries axle_config=TRACTOR_3A; it must not be parsed as a config
    docs = yc.build_documents(yc.read_rows([SAMPLE]))
    v = docs[0]["vehicles"][0]
    assert v["axles"][0]["role"] == "steer"

def _rows(spec):
    """spec: list of (inspection_id, unit, survey_id, position, depth, extra dict)"""
    out = []
    for iid, unit, sid, pos, depth, extra in spec:
        r = {"inspection_id": iid, "date": "2026-09-17T09:00:00", "technician": "MF", "customer": "GFL", "unit_number": unit,
             "position": pos, "depth_inner_32nds": depth, "depth_centre_32nds": depth, "depth_outer_32nds": depth, "survey_id": sid}
        r.update(extra); out.append(r)
    return out

def test_groups_by_survey_and_applies_policy_columns():
    rows = _rows([
        ("i1", "A", "S1", "LF", 5, {"axle_role": "steer", "pull_point_32nds": 5, "rec_psi": 100}),
        ("i1", "A", "S1", "RF", 9, {"axle_role": "steer", "pull_point_32nds": 5, "rec_psi": 100}),
        ("i2", "B", "S2", "LF", 12, {}), ("i2", "B", "S2", "RF", 12, {}),
    ])
    docs = yc.build_documents(rows)
    assert [d["survey"]["id"] for d in docs] == ["S1", "S2"]
    a = docs[0]["vehicles"][0]["tires"]
    assert a[0]["pull"] == 5 and a[0]["recPsi"] == 100
    assert "pull" not in docs[1]["vehicles"][0]["tires"][0]     # falls back to policy in the renderer

def test_renderer_agrees_on_csv_document(tmp_path):
    """The same numbers must come out of yardcheck.js for a CSV-built document."""
    rows = _rows([
        ("i1", "A", "S1", "LF", 5, {}), ("i1", "A", "S1", "RF", 7, {}),
        ("i1", "A", "S1", "LRO", 14, {}), ("i1", "A", "S1", "LRI", 8, {}), ("i1", "A", "S1", "RRO", 14, {}), ("i1", "A", "S1", "RRI", 14, {}),
    ])
    doc = yc.build_documents(rows, policy={"steer": {"pull": 5}, "drive": {"pull": 5}})[0]
    p = tmp_path / "doc.json"; p.write_text(json.dumps(doc))
    js = f"""const YC=require({json.dumps(str(yc.WEB / 'yardcheck.js'))});const d=YC.compute(require({json.dumps(str(p))}));
      console.log(JSON.stringify({{cfg:d.vehicles[0].configCode, imm:d.stats.immediateCount, warn:d.stats.warning, bands:d.stats.bands, mm:d.stats.mismatch}}))"""
    out = json.loads(subprocess.check_output(["node", "-e", js]).decode())
    assert out["cfg"] == "2S-4D"
    assert out["imm"] == 1                      # LF at pull point
    assert out["warn"] == 3                     # RF near + the mismatched dual (14 vs 8)
    assert out["bands"] == {"red": 1, "orange": 1, "green": 4}
    assert out["mm"] == {"none": 1, "inflation": 0, "tread": 1, "both": 0}

def test_html_is_self_contained(tmp_path):
    docs = yc.build_documents(yc.read_rows([SAMPLE]))
    html = yc.render_html(docs[0])
    assert "YardCheck.mount(" in html and "<script src" not in html and "<link" not in html
    assert "yc-page" in html  # css present
