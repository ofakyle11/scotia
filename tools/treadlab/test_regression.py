#!/usr/bin/env python3
"""Regression gates for the estimator. Pure Python: no phone, no Swift toolchain.

Three things, each a different kind of drift:

1. Golden numbers: fixed-seed synthetic captures must measure to the same mm as last time.
   Any change to the maths moves these, so a change is a deliberate, reviewed update of
   GOLDEN below, never a silent shift.
2. Parameter parity with Swift: every tunable the README says to "copy into the Swift file"
   is read back out of the Swift source and compared with the Python defaults.
3. Real-tire fixtures: every tools/treadlab/fixtures/*.treadcap (trimmed phone captures with
   the dial-gauge reading in the header) must read within FIELD_TOL_32 of the gauge AND match
   its pinned value in fixtures/expected.json.
"""
import glob
import json
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import make_synthetic
import treadlab
from treadlab import MM, measure

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
FIXTURES = HERE / "fixtures"
FIELD_TOL_32 = 1.0        # the proposition: within 1/32 of the dial gauge on a real tire
GOLDEN_TOL_MM = 1e-6      # fixed seed, seeded RNG: differences this small are LAPACK noise
PINNED_TOL_MM = 1e-3      # measure --json rounds depth_mm to 4 decimals


# ---------------------------------------------------------------- 1. golden numbers

# (depth32, noise_mm, curved, radius_m, seed) -> (depth_mm, usable frames). Regenerate with
#   python3 test_regression.py --print-golden
# and paste, in the same commit as the estimator change that moved them.
GOLDEN = {
    (2, 0.5, True, 0.5, 15): (1.4807766473354462, 6),
    (3, 1.0, True, 0.5, 22): (2.2045520147906554, 6),
    (4, 0.5, False, 0.5, 29): (3.079736007578925, 6),
    (4, 0.5, True, 0.5, 29): (3.1075775917585724, 6),
    (6, 0.3, True, 0.3, 43): (4.757810176382884, 6),
    (8, 0.5, True, 0.5, 57): (6.348903900136679, 6),
    (12, 0.5, True, 0.5, 85): (9.511164481126746, 6),
}


def _golden_capture(tmp_path, key):
    depth32, noise, curved, radius, seed = key
    p = tmp_path / "g.treadcap"
    make_synthetic.write_capture(p, depth32=depth32, noise=noise, frames=6, curved=curved, radius=radius, seed=seed)
    return p


@pytest.mark.parametrize("key", sorted(GOLDEN))
def test_golden_synthetic_numbers_are_unchanged(tmp_path, key):
    want_mm, want_usable = GOLDEN[key]
    _, res, per = measure(_golden_capture(tmp_path, key))
    assert res is not None
    usable = sum(1 for x in per if x)
    got = res["depth_mm"]
    print(f"\n  {key}: {got/MM:.3f}/32 (truth {key[0]}/32), golden {want_mm/MM:.3f}/32, drift {(got-want_mm)/MM:+.4f}/32")
    assert usable == want_usable
    assert abs(got - want_mm) < GOLDEN_TOL_MM, (
        f"estimator output moved by {(got - want_mm)/MM:+.4f}/32 on a fixed synthetic capture. "
        f"If that is intended, regenerate GOLDEN (python3 test_regression.py --print-golden) in this commit.")


@pytest.mark.parametrize("key", sorted(GOLDEN))
def test_golden_captures_still_read_within_half_a_32nd(tmp_path, key):
    """Independent of the pin: the golden captures must also still be *right*."""
    _, res, _ = measure(_golden_capture(tmp_path, key))
    assert abs(res["depth_mm"] / MM - key[0]) < 0.5


# ---------------------------------------------------------------- 2. parameter parity with Swift

SWIFT_ESTIMATOR = REPO / "TreadScanner/TreadScanner/Depth/LiDAR/TreadDepthEstimator.swift"
SWIFT_SESSION = REPO / "TreadScanner/TreadScanner/Depth/LiDAR/LiDARSession.swift"


SWIFT_SETTINGS = REPO / "TreadScanner/TreadScanner/Depth/ScanSettings.swift"


def _swift_value(src, name):
    m = re.search(rf"\b(?:var|let)\s+{name}\s*(?::\s*[\w<>]+)?\s*=\s*([^\s/]+)", src)
    assert m, f"{name} not found in Swift source"
    v = m.group(1)
    if v.startswith("."):
        return v[1:]
    # A value defined once in ScanSettings and referenced from here (roiFraction is shared with
    # the on-screen reticle): follow the reference so the parity test reads the real number.
    ref = re.fullmatch(r"ScanSettings\.(\w+)", v)
    if ref:
        return _swift_value(SWIFT_SETTINGS.read_text(), ref.group(1))
    return int(v, 0) if re.fullmatch(r"0x[0-9A-Fa-f]+|\d+", v) else float(v)


@pytest.mark.skipif(not SWIFT_ESTIMATOR.exists(), reason="Swift sources not checked out")
def test_estimator_defaults_match_swift():
    src = SWIFT_ESTIMATOR.read_text()
    est = treadlab.Estimator()
    expect = {
        "surfaceModel": est.model, "grooveThresholdMM": est.thr0, "maxTreadDepthMM": est.max_depth,
        "ransacIterations": est.iters, "ransacInlierMM": est.inlier,
        "minSurfacePoints": est.min_surface, "minGroovePoints": est.min_groove, "seed": est.seed,
    }
    got = {k: _swift_value(src, k) for k in expect}
    assert got == expect, "TreadDepthEstimator.swift and treadlab.Estimator() defaults differ"


@pytest.mark.skipif(not SWIFT_SESSION.exists(), reason="Swift sources not checked out")
def test_session_roi_and_smoothing_match_swift_and_cli_defaults():
    src = SWIFT_SESSION.read_text()
    # CLI defaults are the ones `measure`/`sweep` use when nothing is passed.
    import inspect
    sig = inspect.signature(treadlab.measure)
    assert _swift_value(src, "roiFraction") == sig.parameters["roi"].default
    assert _swift_value(src, "smoothingRadius") == sig.parameters["smooth"].default
    assert sig.parameters["inlier"].default == treadlab.Estimator().inlier


# ---------------------------------------------------------------- 3. real-tire fixtures

def _load_expected(fixtures_dir):
    f = fixtures_dir / "expected.json"
    if not f.exists():
        return {}
    doc = json.loads(f.read_text())
    return {Path(r["file"]).name: r for r in doc.get("results", [])}


def _check_fixture(path, expected):
    header, res, per = measure(path)
    gauge = header.get("gauge32")
    assert gauge is not None, f"{path.name}: no gauge32 in header; the fixture is useless without the dial-gauge reading"
    assert res is not None, f"{path.name}: no usable frames"
    err32 = res["depth_mm"] / MM - gauge
    print(f"\n  {path.name}: {res['depth_mm']/MM:.2f}/32 vs gauge {gauge}/32, error {err32:+.2f}/32, "
          f"{sum(1 for x in per if x)}/{len(per)} frames, {header.get('device')}")
    assert abs(err32) <= FIELD_TOL_32, f"{path.name}: {err32:+.2f}/32 from the gauge"
    pin = expected.get(path.name)
    assert pin is not None, (
        f"{path.name} has no entry in fixtures/expected.json. Pin it: "
        f"cd tools/treadlab && python3 treadlab.py measure --json fixtures/*.treadcap > fixtures/expected.json")
    assert abs(res["depth_mm"] - pin["depth_mm"]) < PINNED_TOL_MM, (
        f"{path.name}: now {res['depth_mm']:.4f} mm, pinned {pin['depth_mm']:.4f} mm "
        f"({(res['depth_mm'] - pin['depth_mm'])/MM:+.3f}/32). Regenerate expected.json in this commit if intended.")
    assert sum(1 for x in per if x) == pin["frames_usable"]


REAL_FIXTURES = sorted(FIXTURES.glob("*.treadcap")) if FIXTURES.exists() else []


@pytest.mark.parametrize("path", REAL_FIXTURES, ids=[p.name for p in REAL_FIXTURES])
def test_real_tire_fixture_reads_the_gauge(path):
    _check_fixture(path, _load_expected(FIXTURES))


def test_no_real_fixtures_yet_is_reported_not_hidden():
    """Until the first phone capture is checked in, say so in the test output every run."""
    if not REAL_FIXTURES:
        print("\n  NO REAL-TIRE FIXTURES YET: every accuracy number in this suite is synthetic. "
              "See tools/treadlab/fixtures/README.md for how to check in the first capture.")


def test_fixture_pipeline_end_to_end_on_a_trimmed_synthetic(tmp_path):
    """Proves the trim -> expected.json -> fixture-test loop works before any real file exists."""
    full = tmp_path / "phone.treadcap"
    make_synthetic.write_capture(full, depth32=4, noise=0.5, frames=40, sweep_distance=True, label="unit 1 LF")
    fx = tmp_path / "fixtures"; fx.mkdir()
    out = fx / "iphone_4of32.treadcap"
    rc = treadlab.main(["trim", str(full), "--out", str(out), "--frames", "6"])
    assert rc == 0 and out.exists()
    header, frames = treadlab.read_treadcap(out)
    assert len(frames) == 6 and all(f["meta"]["inGate"] for f in frames)
    assert header["trimmedFrom"] == "phone.treadcap" and header["originalFrames"] == 40
    assert all(len(f["jpeg"]) == 0 for f in frames)
    # no expected.json yet: the test must fail with instructions, not pass silently
    with pytest.raises(AssertionError, match="expected.json"):
        _check_fixture(out, _load_expected(fx))
    # pin it the documented way, then it passes
    import io, contextlib
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        treadlab.main(["measure", "--json", str(out)])
    (fx / "expected.json").write_text(buf.getvalue())
    _check_fixture(out, _load_expected(fx))
    # and a drifted pin fails loudly
    doc = json.loads((fx / "expected.json").read_text()); doc["results"][0]["depth_mm"] += 0.05
    (fx / "expected.json").write_text(json.dumps(doc))
    with pytest.raises(AssertionError, match="pinned"):
        _check_fixture(out, _load_expected(fx))


if __name__ == "__main__" and "--print-golden" in sys.argv:
    import tempfile
    d = Path(tempfile.mkdtemp())
    print("GOLDEN = {")
    for key in sorted(GOLDEN):
        _, res, per = measure(_golden_capture(d, key))
        print(f"    {key}: ({res['depth_mm']!r}, {sum(1 for x in per if x)}),")
    print("}")
