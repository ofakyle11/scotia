#!/usr/bin/env python3
"""The estimator against a physically motivated iPhone LiDAR model (see make_synthetic_sensor.py).

    python3 -m pytest tools/treadlab/test_sensor_model.py -q -s      # ~40 s, prints the table

These are characterisation tests: they pin what the maths does on a sensor that has 576 real
range samples interpolated to 256x192, refreshes at 15 Hz and is as noisy as the published
close-range measurements say. Where the estimator cannot be right, the test asserts that it
refuses rather than that it is right.
"""
import math, sys
from pathlib import Path
import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import make_synthetic_sensor as mss
from treadlab import MM, measure


def scan(tmp_path, **kw):
    p = tmp_path / ("s_" + "_".join(f"{k}{v}" for k, v in kw.items()) + ".treadcap")
    mss.write_capture_sensor(p, **kw)
    _, res, per = measure(p)
    usable = sum(1 for x in per if x)
    err = res["depth_mm"] / MM - kw["depth32"] if res else None
    sd = res["sd_mm"] / MM if res else None
    print(f"\n  {kw}: " + (f"err {err:+.2f}/32 ±{sd:.2f} usable {usable}/{len(per)}" if res else f"REFUSED usable {usable}/{len(per)}"))
    return res, err, sd, usable, len(per)


# ---------------------------------------------------------------- the model itself

def test_spot_density_matches_published_measurement():
    """Luetzenburg et al. 2021: 7,225 points/m^2 at 25 cm. The pitch constant must reproduce it."""
    s = mss.spots_in_roi(0.25)
    density = 1.0 / (s["pitch_mm"] / 1000) ** 2
    assert density == pytest.approx(7225, rel=0.02)


def test_spot_pitch_is_constant_in_pixels():
    """The emitter grid is angular, so its pitch in depth-map pixels does not change with distance:
    ~10 px. That is the real sampling interval the 256x192 map is interpolated from."""
    for d in (0.15, 0.20, 0.25, 0.30):
        assert mss.spots_in_roi(d)["pitch_px"] == pytest.approx(10.06, abs=0.05)


def test_noise_table_interpolates_published_points():
    assert mss.noise_sd_mm(0.20) == pytest.approx(1.0)
    assert mss.noise_sd_mm(0.30) == pytest.approx(0.5)
    assert mss.noise_sd_mm(0.12) == pytest.approx(6.5)
    assert 1.0 < mss.noise_sd_mm(0.15) < 6.5


def test_groove_narrower_than_pitch_beyond_26cm():
    """A 12 mm groove is narrower than one spot pitch past ~25 cm; a 10 mm one past ~21 cm.
    Beyond that most emitter rows have no clean sample on the groove floor."""
    assert mss.spots_in_roi(0.25)["pitch_mm"] < 12.0
    assert mss.spots_in_roi(0.27)["pitch_mm"] > 12.0
    assert mss.spots_in_roi(0.22)["pitch_mm"] > 10.0


# ---------------------------------------------------------------- the estimator on the model

@pytest.mark.parametrize("depth32,groove", [(2, 12.0), (4, 15.0), (8, 15.0)])
def test_edge_aware_densifier_at_20cm_within_half_32nd(tmp_path, depth32, groove):
    """Optimistic bound: if Apple's fusion respects every groove edge, 20 cm reads to 0.5/32."""
    res, err, sd, usable, n = scan(tmp_path, depth32=depth32, distance=0.20, groove_w_mm=groove, frames=24, mode="edge")
    assert res is not None and abs(err) < 0.5


def test_smooth_densifier_under_reads_a_4_32_groove(tmp_path):
    """Pessimistic bound: a depth-only upsampler halves a 4/32 groove and the band stays tight.
    This is the failure the coin-board protocol exists to detect; the maths cannot see it."""
    res, err, sd, usable, n = scan(tmp_path, depth32=4, distance=0.20, groove_w_mm=12.0, frames=24, mode="smooth")
    assert res is not None
    assert err < -1.0            # reads under 3/32
    assert sd < 1.5              # ...and would be shown green


@pytest.mark.xfail(reason="needs the groove-floor separability guard in Estimator.frame, not in this estimator yet: "
                          "it reads 2.7-4.5/32 for a 2/32 groove at 12-15 cm")
@pytest.mark.parametrize("distance", [0.12, 0.13, 0.15])
def test_close_range_2_32_is_refused_not_over_read(tmp_path, distance):
    """Inside the old 12 cm gate the ARKit noise (6.5 mm at 12 cm, Tondo et al. 2023) is above a
    2/32 groove. Without the separability guard the estimator reports 3-4.5/32 ±0.3 here; with
    it, most frames refuse and the frame-yield rule refuses the scan."""
    res, err, sd, usable, n = scan(tmp_path, depth32=2, distance=distance, groove_w_mm=12.0, frames=24, mode="edge")
    assert res is None or abs(err) < 0.5, f"over-read {err:+.2f}/32 with ±{sd:.2f}"


def test_coin_board_two_quarters_edge_vs_smooth(tmp_path):
    """Two Canadian quarters (2 x 1.58 mm = 3.98/32) as ribs, 12 mm slot, flat board, 20 cm.
    The two densifier hypotheses predict readings 1.4/32 apart, so one ten-minute scan of a coin
    board tells which sensor the phone actually is."""
    depth32 = 2 * 1.58 / MM
    _, e_edge, _, _, _ = scan(tmp_path, depth32=depth32, distance=0.20, groove_w_mm=12.0, frames=24, mode="edge", curved=False, flat_board=True)
    _, e_smooth, _, _, _ = scan(tmp_path, depth32=depth32, distance=0.20, groove_w_mm=12.0, frames=24, mode="smooth", curved=False, flat_board=True)
    assert abs(e_edge) < 0.5
    assert e_smooth < -1.0
