#!/usr/bin/env python3
"""Test suite for treadlab. Runs entirely on synthetic captures - no phone required.

    pip install numpy pytest
    python3 -m pytest tools/treadlab -q
"""
import json
import struct
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import make_synthetic
import treadlab
from treadlab import MM, CaptureError, Estimator, extract_points, measure, read_treadcap

HERE = Path(__file__).resolve().parent
TOL_32 = 0.5           # accuracy requirement: within 0.5/32 of the dial gauge


def cli(*args):
    return subprocess.run([sys.executable, str(HERE / "treadlab.py"), *args],
                          capture_output=True, text=True)


@pytest.fixture(scope="module")
def caps(tmp_path_factory):
    """One realistic curved capture per tread depth, reused across tests."""
    d = tmp_path_factory.mktemp("caps")
    out = {}
    for depth in (2, 4, 8, 12):
        p = d / f"tire_{depth}.treadcap"
        make_synthetic.write_capture(p, depth32=depth, noise=0.5, frames=12, curved=True)
        out[depth] = p
    return out


# ---------------------------------------------------------------- units

def test_32nds_conversion_is_exact():
    assert MM == 25.4 / 32
    assert MM == pytest.approx(0.79375, abs=0.0)
    assert 2 * MM == pytest.approx(1.5875, abs=1e-12)      # 2/32 legal minimum, drive/trailer
    assert 4 * MM == pytest.approx(3.175, abs=1e-12)       # 4/32 legal minimum, steer
    for n in (1, 2, 4, 8, 12, 32):
        assert (n * MM) / MM == pytest.approx(n, abs=1e-12)
    assert 32 * MM == pytest.approx(25.4, abs=1e-12)       # 32/32 == one inch


# ---------------------------------------------------------------- round trip

def test_round_trip_preserves_frames_dims_gauge_and_header(tmp_path):
    p = tmp_path / "rt.treadcap"
    make_synthetic.write_capture(p, depth32=6, noise=0.4, frames=7, label="rt-label", gauge32=6)
    header, frames = read_treadcap(p)
    assert header["label"] == "rt-label"
    assert header["gauge32"] == 6
    assert header["version"] == 1
    assert header["device"] == "synthetic"
    assert len(frames) == 7
    for i, f in enumerate(frames):
        assert f["depth"].shape == (make_synthetic.H, make_synthetic.W)
        assert f["conf"].shape == (make_synthetic.H, make_synthetic.W)
        assert f["depth"].dtype == np.dtype("<f4")
        assert f["meta"]["index"] == i
        assert f["meta"]["width"] == make_synthetic.W
        assert f["meta"]["height"] == make_synthetic.H
        assert f["meta"]["intrinsics"] == make_synthetic.INTRINSICS
        assert f["meta"]["imageWidth"] == make_synthetic.IMAGE_W
        assert (f["conf"] == 2).all()
        assert np.isfinite(f["depth"]).all()


def test_round_trip_depth_values_survive_byte_for_byte(tmp_path):
    p = tmp_path / "rt2.treadcap"
    make_synthetic.write_capture(p, depth32=3, noise=0.0, frames=2, curved=False)
    _, frames = read_treadcap(p)
    z = frames[0]["depth"]
    # Noiseless flat tire: exactly two distinct depths, land and groove floor, 3/32 apart.
    lo, hi = float(z.min()), float(z.max())
    assert (hi - lo) * 1000 == pytest.approx(3 * MM, abs=1e-3)


# ---------------------------------------------------------------- accuracy

@pytest.mark.parametrize("depth32", [2, 4, 8, 12])
def test_accuracy_curved_tire_within_half_32nd(caps, depth32, record_property):
    header, res, per = measure(caps[depth32])
    assert res is not None, f"{depth32}/32 capture produced no result"
    est32 = res["depth_mm"] / MM
    err = est32 - depth32
    record_property("error_32", err)
    print(f"\n  {depth32}/32 curved: estimate {est32:.3f}/32  error {err:+.3f}/32  "
          f"({sum(1 for p in per if p)}/{len(per)} frames)")
    assert abs(err) < TOL_32, f"{depth32}/32: estimated {est32:.3f}/32, error {err:+.3f}/32"


@pytest.mark.parametrize("depth32", [2, 4, 8, 12])
def test_accuracy_flat_tire_within_half_32nd(tmp_path, depth32):
    p = tmp_path / f"flat_{depth32}.treadcap"
    make_synthetic.write_capture(p, depth32=depth32, noise=0.5, frames=10, curved=False)
    _, res, _ = measure(p)
    assert res is not None
    err = res["depth_mm"] / MM - depth32
    print(f"\n  {depth32}/32 flat: error {err:+.3f}/32")
    assert abs(err) < TOL_32


def test_curvature_quadratic_beats_plane_on_a_curved_tire(tmp_path):
    """The whole reason for the quadratic model: a 0.5 m radius sags ~1 mm across the patch.

    Shown over a wide ROI, where the sag is largest and a plane visibly under-reads.
    """
    p = tmp_path / "curved.treadcap"
    make_synthetic.write_capture(p, depth32=4, noise=0.3, frames=10, curved=True, radius=0.5)
    _, quad, _ = measure(p, model="quadratic", roi=0.6)
    _, plane, _ = measure(p, model="plane", roi=0.6)
    assert quad is not None
    q_err = abs(quad["depth_mm"] / MM - 4)
    p_err = abs(plane["depth_mm"] / MM - 4) if plane else float("inf")
    print(f"\n  curved 4/32: quadratic err {q_err:.3f}/32, plane err {p_err:.3f}/32")
    assert q_err < TOL_32
    assert q_err <= p_err + 1e-9, "quadratic model should not be worse than plane on a curved tire"


def test_sharper_curvature_still_accurate(tmp_path):
    p = tmp_path / "sharp.treadcap"
    make_synthetic.write_capture(p, depth32=6, noise=0.3, frames=10, curved=True, radius=0.3)
    _, res, _ = measure(p, model="quadratic")
    assert res is not None
    err = res["depth_mm"] / MM - 6
    print(f"\n  R=0.3 m 6/32: error {err:+.3f}/32")
    assert abs(err) < TOL_32


def test_repeatability_is_deterministic(caps):
    a = measure(caps[8])[1]
    b = measure(caps[8])[1]
    assert a["depth_mm"] == b["depth_mm"]


# ---------------------------------------------------------------- degenerate inputs

def test_flat_surface_with_no_grooves_returns_none(tmp_path):
    p = tmp_path / "nogroove.treadcap"
    make_synthetic.write_capture(p, depth32=0, noise=0.4, frames=8, curved=False, grooves=False)
    _, res, per = measure(p)
    assert res is None
    assert all(x is None for x in per)


def test_curved_surface_with_no_grooves_returns_none(tmp_path):
    p = tmp_path / "nogroove_curved.treadcap"
    make_synthetic.write_capture(p, depth32=0, noise=0.4, frames=8, curved=True, grooves=False)
    _, res, _ = measure(p)
    assert res is None


@pytest.mark.parametrize("conf", [0, 1])
def test_all_low_confidence_returns_none(tmp_path, conf):
    p = tmp_path / f"lowconf{conf}.treadcap"
    make_synthetic.write_capture(p, depth32=6, noise=0.4, frames=5, confidence=conf)
    header, res, per = measure(p)
    assert res is None
    assert all(x is None for x in per)
    _, frames = read_treadcap(p)
    pts, frac = extract_points(frames[0])
    assert len(pts) == 0 and frac == 0


def test_too_few_points_returns_none(tmp_path):
    """A tiny ROI leaves far fewer than minSurfacePoints."""
    p = tmp_path / "tiny.treadcap"
    make_synthetic.write_capture(p, depth32=6, noise=0.4, frames=4)
    _, res, per = measure(p, roi=0.02)
    assert res is None
    assert all(x is None for x in per)


def test_estimator_handles_empty_and_tiny_point_sets():
    est = Estimator()
    assert est.frame(np.zeros((0, 3))) is None
    assert est.frame(np.zeros((2, 3))) is None
    assert est.frame(np.random.default_rng(0).normal(size=(50, 3)) * 0.01) is None
    assert est.combine([]) is None


def test_estimator_handles_degenerate_collinear_points():
    P = np.stack([np.linspace(0, 0.1, 200), np.zeros(200), np.full(200, -0.2)], 1)
    assert est_or_none(P) is None


def est_or_none(P):
    return Estimator().frame(P)


def test_not_a_treadcap_file(tmp_path):
    p = tmp_path / "notes.txt"
    p.write_bytes(b"hello, this is not a capture at all")
    with pytest.raises(CaptureError) as e:
        read_treadcap(p)
    assert "not a .treadcap" in str(e.value)


def test_empty_file(tmp_path):
    p = tmp_path / "empty.treadcap"
    p.write_bytes(b"")
    with pytest.raises(CaptureError):
        read_treadcap(p)


def test_missing_file(tmp_path):
    with pytest.raises(CaptureError):
        read_treadcap(tmp_path / "does_not_exist.treadcap")


def test_header_only_file_has_no_frames(tmp_path):
    data = make_synthetic.build_capture(frames=1)
    hlen = struct.unpack_from("<I", data, 8)[0]
    p = tmp_path / "hdronly.treadcap"
    p.write_bytes(data[:12 + hlen])
    with pytest.raises(CaptureError) as e:
        read_treadcap(p)
    assert "no frames" in str(e.value)


def test_corrupt_header_json(tmp_path):
    p = tmp_path / "badhdr.treadcap"
    body = b"{not json at all"
    p.write_bytes(b"TREADCAP" + struct.pack("<I", len(body)) + body)
    with pytest.raises(CaptureError) as e:
        read_treadcap(p)
    assert "header" in str(e.value)


def test_truncated_mid_frame_keeps_complete_frames(tmp_path):
    full = make_synthetic.build_capture(depth32=6, noise=0.4, frames=4)
    p = tmp_path / "trunc.treadcap"
    p.write_bytes(full[:int(len(full) * 0.62)])       # cuts inside the third frame
    header, frames = read_treadcap(p)
    assert 1 <= len(frames) < 4
    assert header["gauge32"] == 6


def test_truncated_before_any_frame_raises(tmp_path):
    full = make_synthetic.build_capture(depth32=6, frames=4)
    hlen = struct.unpack_from("<I", full, 8)[0]
    p = tmp_path / "trunc0.treadcap"
    p.write_bytes(full[:12 + hlen + 40])              # header plus a shred of frame 0
    with pytest.raises(CaptureError):
        read_treadcap(p)


def test_garbage_frame_size_raises(tmp_path):
    full = bytearray(make_synthetic.build_capture(frames=2))
    hlen = struct.unpack_from("<I", full, 8)[0]
    off = 12 + hlen
    mlen = struct.unpack_from("<I", full, off)[0]
    meta = json.loads(full[off + 4:off + 4 + mlen])
    meta["width"] = 99999999
    new = json.dumps(meta).encode()
    p = tmp_path / "badsize.treadcap"
    p.write_bytes(bytes(full[:off]) + struct.pack("<I", len(new)) + new + bytes(full[off + 4 + mlen:]))
    with pytest.raises(CaptureError):
        read_treadcap(p)


# ---------------------------------------------------------------- CLI robustness

def make_bad_files(d):
    (d / "notes.txt").write_bytes(b"just some text")
    (d / "empty.treadcap").write_bytes(b"")
    full = make_synthetic.build_capture(depth32=6, frames=3)
    hlen = struct.unpack_from("<I", full, 8)[0]
    (d / "truncated.treadcap").write_bytes(full[:12 + hlen + 30])
    (d / "corrupt.treadcap").write_bytes(b"TREADCAP" + struct.pack("<I", 5) + b"{{{{{")
    return ["notes.txt", "empty.treadcap", "truncated.treadcap", "corrupt.treadcap"]


@pytest.mark.parametrize("name", ["notes.txt", "empty.treadcap", "truncated.treadcap", "corrupt.treadcap"])
@pytest.mark.parametrize("cmd", ["info", "measure", "report"])
def test_cli_bad_file_gives_message_not_traceback(tmp_path, cmd, name):
    make_bad_files(tmp_path)
    r = cli(cmd, str(tmp_path / name))
    assert "Traceback" not in r.stderr, r.stderr
    assert "warning" in r.stderr.lower() or "error" in (r.stderr + r.stdout).lower()


def test_cli_no_usable_frames_is_reported(tmp_path):
    p = tmp_path / "nogroove.treadcap"
    make_synthetic.write_capture(p, depth32=0, noise=0.4, frames=6, curved=False, grooves=False)
    r = cli("measure", str(p))
    assert r.returncode == 0
    assert "no usable frames" in r.stdout
    assert "Traceback" not in r.stderr


def test_cli_report_skips_bad_files_and_summarises_the_rest(tmp_path, caps):
    make_bad_files(tmp_path)
    files = [str(tmp_path / n) for n in ("notes.txt", "empty.treadcap", "truncated.treadcap", "corrupt.treadcap")]
    files += [str(caps[4]), str(caps[8])]
    r = cli("report", *files)
    assert r.returncode == 0
    assert "Traceback" not in r.stderr
    assert r.stderr.lower().count("warning") >= 4
    assert "n=2" in r.stdout and "RMSE" in r.stdout


def test_cli_sweep_skips_bad_files_and_still_ranks(tmp_path, caps):
    make_bad_files(tmp_path)
    files = [str(tmp_path / "notes.txt"), str(caps[2]), str(caps[8])]
    r = cli("sweep", *files)
    assert r.returncode == 0
    assert "Traceback" not in r.stderr
    assert "best first" in r.stdout


# ---------------------------------------------------------------- JSON output

def test_measure_json_is_valid(caps):
    r = cli("measure", "--json", str(caps[4]), str(caps[8]))
    assert r.returncode == 0, r.stderr
    doc = json.loads(r.stdout)
    assert len(doc["results"]) == 2
    for row in doc["results"]:
        assert row["depth_32"] is not None
        assert abs(row["error_32"]) < TOL_32


def test_measure_json_includes_bad_files(tmp_path, caps):
    make_bad_files(tmp_path)
    r = cli("measure", "--json", str(tmp_path / "notes.txt"), str(caps[4]))
    doc = json.loads(r.stdout)
    assert doc["results"][0]["depth_32"] is None and doc["results"][0]["error"]
    assert doc["results"][1]["depth_32"] is not None


def test_report_json_is_valid(tmp_path, caps):
    make_bad_files(tmp_path)
    r = cli("report", "--json", str(tmp_path / "empty.treadcap"), str(caps[2]), str(caps[12]))
    assert r.returncode == 0, r.stderr
    doc = json.loads(r.stdout)
    assert doc["summary"]["n"] == 2
    assert doc["summary"]["skipped"] == 1
    assert len(doc["rows"]) == 2
    assert doc["params"]["model"] == "quadratic"
    assert doc["summary"]["rmse"] < TOL_32


def test_info_json_is_valid(caps):
    r = cli("info", "--json", str(caps[2]))
    doc = json.loads(r.stdout)
    assert doc["captures"][0]["frames"] == 12
    assert doc["captures"][0]["gauge32"] == 2


def test_report_json_no_results_is_still_valid_json(tmp_path):
    make_bad_files(tmp_path)
    r = cli("report", "--json", str(tmp_path / "empty.treadcap"))
    doc = json.loads(r.stdout)
    assert doc["summary"] is None and len(doc["skipped"]) == 1


# ---------------------------------------------------------------- sweep ranking

class Args:
    def __init__(self, files, **kw):
        self.files = [str(f) for f in files]
        self.model, self.roi, self.smooth, self.inlier = "quadratic", 0.35, 1, 0.6
        self.csv, self.json = None, False
        self.__dict__.update(kw)


def independent_rmse(files, model, roi, smooth, inlier):
    """RMSE in 32nds computed here, without touching cmd_report's bookkeeping."""
    errs = []
    for f in files:
        try:
            h, res, _ = measure(f, model, roi, smooth, inlier)
        except CaptureError:
            continue
        if res and h.get("gauge32") is not None:
            errs.append(res["depth_mm"] / MM - h["gauge32"])
    if not errs:
        return None, 0
    return float(np.sqrt(np.mean(np.square(errs)))), len(errs)


def test_report_rmse_matches_an_independent_computation(caps):
    files = list(caps.values())
    for model, roi, smooth, inlier in [("quadratic", 0.35, 1, 0.6), ("plane", 0.25, 0, 0.8)]:
        got = treadlab.cmd_report(Args(files), model, roi, smooth, inlier, quiet=True)
        want, n = independent_rmse(files, model, roi, smooth, inlier)
        assert got["n"] == n
        assert got["rmse"] == pytest.approx(want, rel=1e-9)


def test_sweep_ranking_is_a_true_rmse_ordering_among_eligible_combos(caps):
    combos = treadlab.sweep(Args(list(caps.values())))
    assert combos
    for c in combos:
        want, n = independent_rmse(list(caps.values()), c["model"], c["roi"], c["smooth"], c["inlier_mm"])
        assert c["n"] == n
        assert c["rmse"] == pytest.approx(want, rel=1e-9)
    eligible = [c for c in combos if c["eligible"]]
    assert [c["rmse"] for c in eligible] == sorted(c["rmse"] for c in eligible)
    # ineligible (low-coverage) combos are all ranked after the eligible ones
    assert all(c["eligible"] for c in combos[:len(eligible)])
    assert combos[0]["eligible"]
    print(f"\n  sweep: {len(combos)} combos, best {combos[0]['model']} roi={combos[0]['roi']} "
          f"smooth={combos[0]['smooth']} inlier={combos[0]['inlier_mm']} rmse={combos[0]['rmse']:.3f}/32 n={combos[0]['n']}")


def test_low_coverage_combo_cannot_win(monkeypatch, tmp_path):
    """A combo that measures 2 of 10 tires perfectly must not outrank one that measures all 10."""
    files = [tmp_path / f"t{i}.treadcap" for i in range(10)]
    for f in files:
        f.touch()

    def fake_report(a, model=None, roi=None, smooth=None, inlier=None, quiet=True):
        if (model, roi) == ("plane", 0.25):
            return {"rmse": 0.01, "bias": 0.0, "within": 100.0, "dis": 0, "n": 2, "skipped": 8}
        if (model, roi) == ("quadratic", 0.45):
            return {"rmse": 0.30, "bias": 0.0, "within": 100.0, "dis": 0, "n": 10, "skipped": 0}
        return {"rmse": 0.90, "bias": 0.0, "within": 90.0, "dis": 0, "n": 10, "skipped": 0}

    monkeypatch.setattr(treadlab, "cmd_report", fake_report)
    combos = treadlab.sweep(Args(files))
    assert combos[0]["n"] == 10
    assert combos[0]["rmse"] == pytest.approx(0.30)
    tiny = [c for c in combos if c["n"] == 2][0]
    assert not tiny["eligible"]
    assert combos.index(tiny) > 0


def test_near_full_coverage_still_competes_on_rmse(monkeypatch, tmp_path):
    """9 of 10 with a much better RMSE is still allowed to win over 10 of 10."""
    files = [tmp_path / f"t{i}.treadcap" for i in range(10)]
    for f in files:
        f.touch()

    def fake_report(a, model=None, roi=None, smooth=None, inlier=None, quiet=True):
        n = 9 if (model, roi) == ("plane", 0.25) else 10
        rmse = 0.10 if n == 9 else 0.80
        return {"rmse": rmse, "bias": 0.0, "within": 100.0, "dis": 0, "n": n, "skipped": 10 - n}

    monkeypatch.setattr(treadlab, "cmd_report", fake_report)
    combos = treadlab.sweep(Args(files))
    assert combos[0]["n"] == 9 and combos[0]["eligible"]
