#!/usr/bin/env python3
"""Physically motivated iPhone LiDAR model for synthetic .treadcap files.

make_synthetic.py draws every one of the 256x192 depth pixels as an independent measurement
with Gaussian noise. The phone does not work like that. What the hardware and the published
measurements say (sources below):

  * The emitter is a Lumentum VCSEL, 8x8 dots through a 3x3 DOE = 576 spots over roughly the
    wide camera's 60x48 deg field (System Plus teardown; Luetzenburg et al. 2021 measured
    7,225 points/m^2 at 25 cm, i.e. one real range sample every ~11.8 mm at 25 cm).
  * ARKit fuses those 576 ranges with the RGB image "using advanced machine learning
    algorithms to create a dense depth map" (WWDC20 10611). The 256x192 map is interpolation.
  * The depth map is refreshed at 15 Hz, not 60 (Tondo et al. 2023, Sensors 23:7832), and
    smoothedSceneDepth is additionally averaged over time (Apple docs).
  * Static noise of the ARKit output on a dark plate: SD 6.5 mm at 12 cm, 1.0 mm at 20 cm,
    0.5 mm at 30 cm, 0.3 mm at 40 cm (same paper, Table 1).

This module keeps the .treadcap format of make_synthetic.py and adds `build_capture_sensor`,
which renders a truck tread (ribs + grooves on a 0.5 m cylinder), samples it with a sparse
spot grid of finite spot size, densifies the sparse samples the way a guided upsampler would,
applies 15 Hz refresh + temporal smoothing, and writes the result as a 60 Hz capture that
treadlab.py / TreadDepthEstimator.swift can be run on unchanged.

Two densification modes bound what Apple's undisclosed network can do:
  "smooth"  bilinear across the spot grid, no knowledge of where the groove edges are
            (pessimistic: this is what any depth-only upsampler does).
  "edge"    each pixel is filled only from spots that fell on the same RGB segment
            (groove or rib) within 1.5 spot pitches (optimistic: assumes the RGB image
            segments every groove edge perfectly). Where no same-segment spot exists the
            pixel falls back to "smooth", which is what forces the network to invent depth.
"""
import argparse, json, struct, math, warnings
import numpy as np

import make_synthetic as ms

MM32 = 25.4 / 32

# --- sensor constants (see docstring for sources) ------------------------------------------
SPOT_PITCH_DEG = 2.7         # 1/sqrt(7225 /m^2) = 11.8 mm at 25 cm  ->  atan(0.0118/0.25)
SPOT_DIAMETER_FRACTION = 0.25  # spot diameter as a fraction of pitch (dot photos; not published)
RAW_HZ = 15.0                # measured refresh of the ARKit depth map
FRAME_HZ = 60.0
EMA_ALPHA = 0.5              # smoothedSceneDepth temporal filter strength (not published)
# ARKit-output noise SD (mm) vs distance (m), Tondo et al. 2023 Table 1 (dark plate, iPhone 13 Pro)
NOISE_TABLE = [(0.12, 6.5), (0.20, 1.0), (0.30, 0.5), (0.40, 0.3), (1.00, 0.9)]


def noise_sd_mm(z):
    """Log-log interpolation of the measured ARKit noise table."""
    ds = np.log([d for d, _ in NOISE_TABLE]); ss = np.log([s for _, s in NOISE_TABLE])
    return float(np.exp(np.interp(math.log(z), ds, ss)))


def tread_truth(X, Y, z0, depth_m, groove_w=0.012, rib_pitch=0.040, radius=0.5, curved=True,
                flat_board=False):
    """Ground-truth range along each ray and a groove label.

    X, Y are metres on the nominal plane at range z0 (small-angle, same as make_synthetic).
    Grooves run along Y (circumferential), repeating every rib_pitch in X.
    """
    z = np.full(X.shape, z0, float)
    if curved and not flat_board:
        z = z + (radius - np.sqrt(np.maximum(radius * radius - Y * Y, 0)))
    phase = (X + 1.0) % rib_pitch
    groove = phase < groove_w
    z = z + np.where(groove, depth_m, 0.0)
    return z, groove


def build_capture_sensor(depth32=4.0, distance=0.20, groove_w_mm=12.0, frames=45, mode="edge",
                         jitter=True, curved=True, radius=0.5, flat_board=False,
                         spot_pitch_deg=SPOT_PITCH_DEG, spot_frac=SPOT_DIAMETER_FRACTION,
                         noise_scale=1.0, label="sensor-model", gauge32=None, seed=1,
                         width=ms.W, height=ms.H, conf_edges=1):
    """Bytes of a synthetic .treadcap rendered through the sensor model.

    depth32       groove depth, 32nds (ground truth)
    distance      camera-to-rib distance, metres
    groove_w_mm   groove width (truck tires: 10-15 mm)
    mode          "smooth" | "edge" densification (see module docstring)
    jitter        hand tremor: the spot grid lands at a random phase on each raw sample
    noise_scale   multiply the measured noise table (e.g. 2.0 for sun / wet / blacker rubber)
    conf_edges    ARKit confidence written at segment edges (1 = medium, so the app drops them)
    """
    w, h = width, height
    fx = fy = ms.INTRINSICS[0] * w / ms.IMAGE_W
    cx, cy = w / 2, h / 2
    depth_m = depth32 * MM32 / 1000
    groove_w = groove_w_mm / 1000
    rng = np.random.default_rng(seed)
    header = {"version": 1, "label": label, "gauge32": depth32 if gauge32 is None else gauge32,
              "device": "synthetic-sensor-model",
              "model": {"mode": mode, "distance": distance, "groove_w_mm": groove_w_mm,
                        "spot_pitch_deg": spot_pitch_deg, "spot_frac": spot_frac,
                        "noise_sd_mm": noise_sd_mm(distance) * noise_scale, "raw_hz": RAW_HZ}}
    hdr = json.dumps(header).encode()
    out = bytearray(b"TREADCAP") + struct.pack("<I", len(hdr)) + hdr

    # Dense ground truth + RGB segmentation at depth-map resolution (what the network sees).
    ys, xs = np.mgrid[0:h, 0:w]
    Xp = (xs - cx) / fx * distance
    Yp = -(ys - cy) / fy * distance
    truth, groove_px = tread_truth(Xp, Yp, distance, depth_m, groove_w, curved=curved,
                                   radius=radius, flat_board=flat_board)

    # Spot grid in pixels: pitch is angular, so constant in pixels (~10 px) at every distance.
    pitch_px = fx * math.tan(math.radians(spot_pitch_deg))
    spot_r_px = 0.5 * spot_frac * pitch_px
    nx = int(w / pitch_px) + 3; ny = int(h / pitch_px) + 3
    gi, gj = np.mgrid[0:ny, 0:nx]
    sigma = noise_sd_mm(distance) * noise_scale / 1000
    # Sub-samples inside one spot (disc) for the mixed-pixel integration.
    k = 7
    su, sv = np.mgrid[-1:1:k * 1j, -1:1:k * 1j]
    disc = (su * su + sv * sv) <= 1.0
    su, sv = su[disc] * spot_r_px, sv[disc] * spot_r_px

    def raw_sample():
        """One real LiDAR refresh: sparse spots -> mixed-pixel ranges -> densified map."""
        ox, oy = (rng.uniform(-0.5, 0.5, 2) * pitch_px) if jitter else (0.0, 0.0)
        sx = gj * pitch_px + ox - pitch_px; sy = gi * pitch_px + oy - pitch_px
        # Integrate truth over the spot footprint.
        px = sx[..., None] + su; py = sy[..., None] + sv
        Xs = (px - cx) / fx * distance; Ys = -(py - cy) / fy * distance
        zs, gs = tread_truth(Xs, Ys, distance, depth_m, groove_w, curved=curved, radius=radius,
                             flat_board=flat_board)
        gfrac = gs.mean(-1)
        z_groove = np.where(gs, zs, np.nan); z_rib = np.where(~gs, zs, np.nan)
        with np.errstate(all="ignore"), warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)        # all-NaN slices are expected
            zg = np.nanmean(z_groove, -1); zr = np.nanmean(z_rib, -1)
        # dToF on a straddling spot: the histogram has two peaks. If one clearly dominates the
        # range is that peak; if not, the fit lands in between (area-weighted mean).
        dominant = np.where(gfrac >= 0.5, zg, zr)
        mixed = np.nanmean(zs, -1)
        z_spot = np.where((gfrac > 0.65) | (gfrac < 0.35), dominant, mixed)
        z_spot = z_spot + rng.normal(0, sigma, z_spot.shape)
        spot_label = gfrac >= 0.5
        inside = (sx >= -pitch_px) & (sx <= w + pitch_px) & (sy >= -pitch_px) & (sy <= h + pitch_px)

        # Densify. Bilinear over the regular spot grid first ("smooth").
        u = (xs - ox + pitch_px) / pitch_px; v = (ys - oy + pitch_px) / pitch_px
        j0 = np.clip(np.floor(u).astype(int), 0, nx - 2); i0 = np.clip(np.floor(v).astype(int), 0, ny - 2)
        fu = np.clip(u - j0, 0, 1); fv = np.clip(v - i0, 0, 1)
        smooth = (z_spot[i0, j0] * (1 - fu) * (1 - fv) + z_spot[i0, j0 + 1] * fu * (1 - fv)
                  + z_spot[i0 + 1, j0] * (1 - fu) * fv + z_spot[i0 + 1, j0 + 1] * fu * fv)
        if mode == "smooth":
            return smooth
        # "edge": inverse-distance weighting over same-segment spots within 1.5 pitches.
        num = np.zeros((h, w)); den = np.zeros((h, w))
        for di in range(-1, 3):
            for dj in range(-1, 3):
                ii = np.clip(i0 + di, 0, ny - 1); jj = np.clip(j0 + dj, 0, nx - 1)
                same = spot_label[ii, jj] == groove_px
                d2 = (sx[ii, jj] - xs) ** 2 + (sy[ii, jj] - ys) ** 2
                ok = same & (d2 <= (1.5 * pitch_px) ** 2) & inside[ii, jj]
                wgt = np.where(ok, 1.0 / np.maximum(d2, 0.25), 0.0)
                num += wgt * np.nan_to_num(z_spot[ii, jj]); den += wgt
        return np.where(den > 0, num / np.maximum(den, 1e-12), smooth)

    # Confidence: medium at segment edges (ARKit marks depth discontinuities down), high elsewhere,
    # low everywhere when the sensor is below its working range.
    edge = np.zeros_like(groove_px)
    edge[:, 1:] |= groove_px[:, 1:] != groove_px[:, :-1]
    edge[:, :-1] |= groove_px[:, :-1] != groove_px[:, 1:]
    conf = np.where(edge, conf_edges, 2).astype(np.uint8)
    if distance < 0.12:
        conf[:] = 0

    # Timeline: a new raw sample every FRAME_HZ/RAW_HZ frames, EMA-smoothed; frames in between
    # are the linear interpolation ARKit appears to perform (alias analysis in Tondo et al.).
    step = int(round(FRAME_HZ / RAW_HZ))
    n_raw = frames // step + 2
    raws = [raw_sample() for _ in range(n_raw)]
    smoothed = [raws[0]]
    for r in raws[1:]:
        smoothed.append(EMA_ALPHA * r + (1 - EMA_ALPHA) * smoothed[-1])
    for i in range(frames):
        a, t = divmod(i, step)
        z = smoothed[a] * (1 - t / step) + smoothed[a + 1] * (t / step)
        meta = json.dumps({"index": i, "timestamp": i / FRAME_HZ, "width": w, "height": h,
                           "imageWidth": ms.IMAGE_W, "imageHeight": ms.IMAGE_H,
                           "intrinsics": ms.INTRINSICS,
                           "transform": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                           "smoothed": True, "distanceM": distance, "tiltDegrees": 2.0,
                           "motionMPerS": 0.01, "highConfidenceFraction": float((conf == 2).mean()),
                           "inGate": bool(0.12 <= distance <= 0.30)}).encode()
        out += struct.pack("<I", len(meta)) + meta + z.astype("<f4").tobytes() + conf.tobytes() + struct.pack("<I", 0)
    return bytes(out)


def write_capture_sensor(path, **kw):
    data = build_capture_sensor(**kw)
    with open(path, "wb") as f:
        f.write(data)
    return data


def spots_in_roi(distance, roi=0.35, groove_w_mm=12.0, rib_pitch_mm=40.0,
                 spot_pitch_deg=SPOT_PITCH_DEG, spot_frac=SPOT_DIAMETER_FRACTION):
    """Back-of-envelope: how many real range samples the ROI contains, and how many of those
    land cleanly inside a groove. Independent of the simulation; a skeptic can redo it by hand."""
    fx = ms.INTRINSICS[0]; half_w = ms.IMAGE_W / 2 / fx; half_h = ms.IMAGE_H / 2 / fx
    roi_w = 2 * half_w * distance * roi; roi_h = 2 * half_h * distance * roi
    pitch = distance * math.tan(math.radians(spot_pitch_deg)); spot = spot_frac * pitch
    n = roi_w * roi_h / pitch ** 2
    clean_groove = n * max(0.0, groove_w_mm / 1000 - spot) / (rib_pitch_mm / 1000)
    clean_rib = n * max(0.0, (rib_pitch_mm - groove_w_mm) / 1000 - spot) / (rib_pitch_mm / 1000)
    return {"distance_cm": distance * 100, "pitch_mm": pitch * 1000, "spot_mm": spot * 1000,
            "roi_mm": (roi_w * 1000, roi_h * 1000), "spots_in_roi": n,
            "clean_groove_spots": clean_groove, "clean_rib_spots": clean_rib,
            "noise_sd_mm": noise_sd_mm(distance),
            "groove_px": groove_w_mm / 1000 / distance * ms.INTRINSICS[0] * ms.W / ms.IMAGE_W,
            "pitch_px": ms.INTRINSICS[0] * ms.W / ms.IMAGE_W * math.tan(math.radians(spot_pitch_deg))}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--depth32", type=float, default=4)
    ap.add_argument("--distance", type=float, default=0.20)
    ap.add_argument("--groove", type=float, default=12.0, help="groove width mm")
    ap.add_argument("--frames", type=int, default=45)
    ap.add_argument("--mode", choices=["smooth", "edge"], default="edge")
    ap.add_argument("--no-jitter", action="store_true")
    ap.add_argument("--flat", action="store_true")
    ap.add_argument("--noise-scale", type=float, default=1.0)
    a = ap.parse_args()
    data = write_capture_sensor(a.out, depth32=a.depth32, distance=a.distance, groove_w_mm=a.groove,
                                frames=a.frames, mode=a.mode, jitter=not a.no_jitter,
                                curved=not a.flat, noise_scale=a.noise_scale)
    print("wrote", a.out, len(data), "bytes")
