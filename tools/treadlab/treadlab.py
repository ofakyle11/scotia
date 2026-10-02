#!/usr/bin/env python3
"""treadlab: offline analysis of .treadcap LiDAR captures from the Tread Scanner app.

Usage:
  python3 treadlab.py info    capture.treadcap [--json]
  python3 treadlab.py measure capture.treadcap [--model plane|quadratic] [--roi 0.35] [--smooth 1] [--inlier 0.6] [--json]
  python3 treadlab.py report  *.treadcap [--csv out.csv] [--json]   # scan vs gauge for many captures
  python3 treadlab.py sweep   *.treadcap [--json]                   # try parameter combos, print the best
  python3 treadlab.py pose    capture.treadcap [--json]             # which holding distance agreed with the gauge
  python3 treadlab.py trim    capture.treadcap --out fixture.treadcap [--frames 12]   # git-sized regression fixture

measure/report/sweep use only the frames that passed the phone's pose gate (what a scan would
have averaged); --all-frames uses every recorded frame.

Unreadable captures are reported on stderr and skipped; the rest are still summarised.
Tests: python3 -m pytest tools/treadlab -q  (synthetic captures, no phone needed).

The estimator here is a line-for-line port of TreadDepthEstimator.swift so numbers match the
phone. Tune here, then copy the winning parameters into the Swift file.
Requires numpy. Point-cloud approach inspired by Apple's WWDC20 scene-depth sample and the
open ARKit point-cloud repos; curvature model from the FindSurface-style plane/cylinder work.
"""
import argparse, json, math, struct, sys
from pathlib import Path
import numpy as np

# ---------------- file format ----------------
class CaptureError(Exception):
    """A .treadcap file that cannot be read (missing, wrong format, truncated, corrupt)."""


def _need(data, off, n, what):
    if off + n > len(data):
        raise CaptureError(f"file is truncated: need {n} more bytes for {what} at offset {off}, only {len(data) - off} left")


def read_treadcap(path):
    """Parse a .treadcap file. Raises CaptureError with a human-readable message on any problem.

    A trailing partial frame is dropped with a warning rather than failing the whole file, so a
    capture the phone was still writing when it was shared is still usable.
    """
    try:
        with open(path, "rb") as f:
            data = f.read()
    except OSError as e:
        raise CaptureError(f"cannot read file: {e.strerror or e}") from e
    if len(data) < 12 or data[:8] != b"TREADCAP":
        raise CaptureError("not a .treadcap file (missing TREADCAP magic)")
    off = 8
    (hlen,) = struct.unpack_from("<I", data, off); off += 4
    _need(data, off, hlen, "header JSON")
    try:
        header = json.loads(data[off:off + hlen])
    except (ValueError, UnicodeDecodeError) as e:
        raise CaptureError(f"corrupt header JSON: {e}") from e
    if not isinstance(header, dict):
        raise CaptureError("corrupt header: expected a JSON object")
    off += hlen
    frames, truncated = [], False
    while off < len(data):
        start = off
        try:
            _need(data, off, 4, "frame length")
            (mlen,) = struct.unpack_from("<I", data, off); off += 4
            _need(data, off, mlen, "frame metadata")
            meta = json.loads(data[off:off + mlen]); off += mlen
            w, h = int(meta["width"]), int(meta["height"])
            if w <= 0 or h <= 0 or w * h > 50_000_000:
                raise CaptureError(f"implausible frame size {w}x{h}")
            _need(data, off, w * h * 4, "depth map")
            depth = np.frombuffer(data, dtype="<f4", count=w * h, offset=off).reshape(h, w); off += w * h * 4
            _need(data, off, w * h, "confidence map")
            conf = np.frombuffer(data, dtype=np.uint8, count=w * h, offset=off).reshape(h, w); off += w * h
            _need(data, off, 4, "jpeg length")
            (jlen,) = struct.unpack_from("<I", data, off); off += 4
            _need(data, off, jlen, "jpeg")
            jpeg = data[off:off + jlen]; off += jlen
            for k in ("intrinsics", "imageWidth", "imageHeight"):
                if k not in meta:
                    raise CaptureError(f"frame {len(frames)} metadata is missing {k!r}")
            if len(meta["intrinsics"]) != 4:
                raise CaptureError(f"frame {len(frames)} intrinsics must have 4 values")
        except CaptureError:
            if frames and start > 8:      # a partial frame at the end: keep what we have
                truncated = True
                break
            raise
        except (ValueError, KeyError, TypeError) as e:
            raise CaptureError(f"corrupt frame {len(frames)} at offset {start}: {e}") from e
        frames.append({"meta": meta, "depth": depth, "conf": conf, "jpeg": jpeg})
    if truncated:
        print(f"warning: {path}: trailing partial frame ignored ({len(frames)} complete frames)", file=sys.stderr)
    if not frames:
        raise CaptureError("no frames in file")
    return header, frames

# ---------------- point extraction (mirrors LiDARSession.extract) ----------------
def extract_points(fr, roi=0.35, smooth=1):
    d, c, m = fr["depth"], fr["conf"], fr["meta"]
    h, w = d.shape
    fx, fy, cx, cy = m["intrinsics"]
    sx, sy = w / m["imageWidth"], h / m["imageHeight"]
    fx *= sx; fy *= sy; cx *= sx; cy *= sy
    high = (c == 2) & (d > 0.05) & (d < 0.6)
    if smooth > 0:
        # mean of high-confidence neighbours in a (2r+1)^2 box
        num = np.zeros_like(d); den = np.zeros_like(d)
        dv = np.where(high, d, 0.0); hv = high.astype(np.float32)
        for dy in range(-smooth, smooth + 1):
            for dx in range(-smooth, smooth + 1):
                num += np.roll(np.roll(dv, dy, 0), dx, 1)
                den += np.roll(np.roll(hv, dy, 0), dx, 1)
        z = np.where(den >= 3, num / np.maximum(den, 1), np.nan)
    else:
        z = np.where(high, d, np.nan)
    x0, x1 = int(w * (0.5 - roi / 2)), int(w * (0.5 + roi / 2))
    y0, y1 = int(h * (0.5 - roi / 2)), int(h * (0.5 + roi / 2))
    ys, xs = np.mgrid[y0:y1, x0:x1]
    zz = z[y0:y1, x0:x1]
    ok = high[y0:y1, x0:x1] & ~np.isnan(zz)
    zz, xs, ys = zz[ok], xs[ok], ys[ok]
    px = (xs - cx) / fx * zz
    py = -(ys - cy) / fy * zz
    return np.stack([px, py, -zz], 1), high[y0:y1, x0:x1].mean()

# ---------------- estimator (mirrors TreadDepthEstimator.swift) ----------------
class SplitMix64:
    """Same generator as SplitMix64 in TreadDepthEstimator.swift, so RANSAC draws the same three
    points per iteration here as on the phone. Checked against Vigna's splitmix64.c reference
    vector in the tests."""
    MASK = (1 << 64) - 1

    def __init__(self, seed):
        self.state = seed & self.MASK

    def next(self):
        self.state = (self.state + 0x9E3779B97F4A7C15) & self.MASK
        z = self.state
        z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & self.MASK
        z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & self.MASK
        return z ^ (z >> 31)


class Estimator:
    def __init__(self, model="quadratic", groove_threshold=1.0, max_depth=30.0, iters=120, inlier=0.6, min_surface=60, min_groove=12, seed=0x5EED, separation_sigmas=1.5):
        self.model, self.thr0, self.max_depth, self.iters, self.inlier = model, groove_threshold, max_depth, iters, inlier
        self.min_surface, self.min_groove, self.seed = min_surface, min_groove, seed
        self.separation_sigmas = separation_sigmas    # floor must clear the threshold by this many sigma

    def fit_plane(self, P):
        rng = SplitMix64(self.seed); best, best_in = None, 0; inl = self.inlier / 1000
        n_pts = len(P)
        for _ in range(self.iters):
            # Swift: points[Int(rng.next() % UInt64(points.count))], three draws in a, b, c order.
            a = P[rng.next() % n_pts]; b = P[rng.next() % n_pts]; c = P[rng.next() % n_pts]
            n = np.cross(b - a, c - a); L = np.linalg.norm(n)
            if L < 1e-12: continue
            u = n / L
            if u[2] < 0: u = -u
            d = -u.dot(a)
            cnt = int(np.sum(np.abs(P @ u + d) <= inl))
            if cnt > best_in: best_in, best = cnt, (u, d)
        if best is None: return None
        u, d = best
        In = P[np.abs(P @ u + d) <= inl]
        if len(In) < 3: return best
        cen = In.mean(0); R = In - cen
        w, v = np.linalg.eigh(R.T @ R); n = v[:, 0]
        if n[2] < 0: n = -n
        return n, -n.dot(cen)

    def frame(self, P):
        if len(P) < self.min_surface: return None
        pl = self.fit_plane(P)
        if pl is None: return None
        u, d = pl
        plane_dist = -(P @ u + d) * 1000
        dist = plane_dist
        if self.model == "quadratic":
            idx = (dist >= -2 * self.inlier) & (dist <= self.inlier)   # surface only, not groove walls
            if idx.sum() >= 30:
                n = u; seed = np.array([1., 0, 0]) if abs(n[0]) < 0.9 else np.array([0, 1., 0])
                uu = np.cross(n, seed); uu /= np.linalg.norm(uu); vv = np.cross(n, uu)
                org = P[idx].mean(0); r = P[idx] - org; x = (r @ uu) * 1000; y = (r @ vv) * 1000
                A = np.stack([x*x, y*y, x*y, x, y, np.ones_like(x)], 1)
                try:
                    c = np.linalg.lstsq(A, -dist[idx], rcond=None)[0]
                except np.linalg.LinAlgError:
                    c = None
                if c is not None and np.all(np.isfinite(c)):
                    r = P - org; x = (r @ uu) * 1000; y = (r @ vv) * 1000
                    dist = dist + (c[0]*x*x + c[1]*y*y + c[2]*x*y + c[3]*x + c[4]*y + c[5])
                    # The asymmetric band biases the constant term toward the camera; re-centre on
                    # the symmetric RANSAC inlier set (median is unbiased for symmetric noise).
                    sym = np.abs(plane_dist) <= self.inlier
                    if sym.sum() >= 30: dist = dist - np.median(dist[sym])
        # Points above the plane: never groove. Not capped at 3*inlier (that saturated sigma ~1.2 mm).
        above = -dist[(dist < 0) & (dist > -self.max_depth)]
        if len(above) < self.min_surface // 2: return None
        sigma = 1.4826 * np.median(above); thr = max(self.thr0, 3 * sigma)
        is_surface = np.abs(dist) <= self.inlier
        surface = int(np.sum(is_surface))
        # Swift uses `if surface ... else if candidate`, so a point inside the inlier band is never
        # also a groove candidate. Mirror that (it only differs when inlier >= threshold, e.g. sweep's
        # inlier=1.2 against the 1.0 mm default threshold).
        cand = np.sort(dist[~is_surface & (dist > thr) & (dist < self.max_depth)])
        if surface < self.min_surface or len(cand) < self.min_groove: return None
        window = 2 * self.inlier; bs = be = hi = 0
        for lo in range(len(cand)):
            while hi < len(cand) and cand[hi] - cand[lo] <= window: hi += 1
            if hi - lo > be - bs: bs, be = lo, hi
        floor = cand[bs:be]
        if len(floor) < self.min_groove: return None
        depth = float(floor.mean())
        # A floor hugging the threshold is the surface noise tail (bald tire) or a truncated
        # shallow groove; both read deep. Refuse rather than report.
        if depth - thr < self.separation_sigmas * sigma: return None
        return {"depth_mm": depth, "groove_pts": int(len(floor)), "surface_pts": surface, "sigma_mm": float(sigma)}

    def combine(self, frames):
        if not frames: return None
        d = np.sort([f["depth_mm"] for f in frames]); t = len(d) // 10 if len(d) >= 10 else 0
        # Trimmed mean for the location; SD of ALL frames (trimming shrinks it to ~0.7x).
        return {"depth_mm": float(d[t:len(d) - t].mean()), "sd_mm": float(d.std(ddof=1)) if len(d) > 1 else 1.5, "frames": len(frames)}

MM = 25.4 / 32

def in_gate(frame):
    """Whether the phone would have accumulated this frame into a scan. A raw capture is a
    10-30 cm sweep (ScanSettings.captureFrames, SIDELOAD.md) and records every frame; the app's
    45-frame scan only ever averages frames whose pose passed the gate (LiDARDepthProvider), so
    a tool number averaged over the whole sweep is not the number the phone would show.
    Frames without the key (captures made before pose logging) are kept."""
    g = frame["meta"].get("inGate")
    return True if g is None else bool(g)


def measure(path, model="quadratic", roi=0.35, smooth=1, inlier=0.6, gated=True, **kw):
    header, frames = read_treadcap(path)
    est = Estimator(model=model, inlier=inlier, **kw)
    per = [est.frame(extract_points(f, roi, smooth)[0]) if (not gated or in_gate(f)) else None for f in frames]
    res = est.combine([p for p in per if p])
    return header, res, per

def warn(msg):
    print(f"warning: {msg}", file=sys.stderr)

def distinct_depth_frames(frames):
    """How many frames carry a depth map not seen in the frame before, and the rate they arrive at.

    ARKit hands out a frame 30-60 times a second, but the LiDAR depth map behind it has been
    measured to refresh at only 15 Hz (Tondo, Riley, Morgenthal, Sensors 2023, doi:10.3390/s23187832),
    so consecutive frames can be byte-identical. A scan that averages 45 frames may hold a dozen
    real measurements; the ± band is a spread over those, not over 45. The first real capture
    answers this for the shop's own phones, so report it up front.
    """
    distinct, prev = 0, None
    for f in frames:
        cur = f["depth"].tobytes()
        if cur != prev:
            distinct += 1
        prev = cur
    ts = [f["meta"].get("timestamp") for f in frames]
    ts = [t for t in ts if isinstance(t, (int, float))]
    span = (ts[-1] - ts[0]) if len(ts) >= 2 else 0
    hz = round(distinct / span, 1) if span > 0 and distinct > 1 else None
    return distinct, hz

# ---------------- what kind of depth map is this? ----------------
# iPhone LiDAR is ~576 physical dots (System Plus teardown of the iPhone 12 Pro / iPad Pro module)
# fused with the colour image into a 256x192 (ARKit) or 320x240 (AVFoundation) map. At 20 cm the
# dots sit ~10 mm apart while map pixels sit ~1 mm apart, so most pixels are interpolation, not
# measurement. Whether a groove floor is measured or guessed decides whether this app can work,
# and a single real capture answers it without a gauge: if neighbouring pixels carry independent
# noise, the lag-1 pixel difference is as noisy as the lag-8 one; if the map is interpolated from
# a ~10 px dot pitch, lag-1 differences are far smoother than lag-8 ones.
F16_STEPS_MM = (0.0610, 0.1221, 0.2441, 0.4883)     # Float16 ULP for 6-12, 12-25, 25-50, 50-100 cm

def depth_diagnostics(frames, roi=0.35, max_frames=10):
    """Per-capture diagnostics of the raw map inside the ROI: NaN/zero share, value
    granularity (Float16 somewhere upstream?) and the lag-1 / lag-8 noise ratio."""
    # Differences are taken along both image axes; the axis with the smaller lag-8 spread is
    # the one running along the grooves, where lag-8 pairs do not straddle a groove wall.
    diffs = {(ax, lag): [] for ax in (0, 1) for lag in (1, 8)}
    nan, zero, total, steps = 0, 0, 0, []
    for fr in frames[:max_frames]:
        d = fr["depth"].astype(np.float64)
        h, w = d.shape
        x0, x1 = int(w * (0.5 - roi / 2)), int(w * (0.5 + roi / 2))
        y0, y1 = int(h * (0.5 - roi / 2)), int(h * (0.5 + roi / 2))
        r = d[y0:y1, x0:x1]
        total += r.size; nan += int(np.isnan(r).sum()); zero += int((r == 0).sum())
        ok = np.isfinite(r) & (r > 0.05) & (r < 0.6)
        if ok.sum() < 50:
            continue
        u = np.unique(r[ok])
        if len(u) > 1:
            steps.append(float(np.min(np.diff(u))))
        for (ax, lag), acc in diffs.items():
            if ax == 1:
                a, b, m = r[:, lag:], r[:, :-lag], ok[:, lag:] & ok[:, :-lag]
            else:
                a, b, m = r[lag:, :], r[:-lag, :], ok[lag:, :] & ok[:-lag, :]
            if m.sum() > 50:
                acc.append(np.abs(a[m] - b[m]))
    out = {"nan_fraction": round(nan / total, 4) if total else None,
           "zero_fraction": round(zero / total, 4) if total else None,
           "depth_step_mm": None, "float16_quantised": None,
           "noise_lag1_mm": None, "noise_lag8_mm": None, "sampling_ratio": None, "sampling": "unknown"}
    if steps:
        step = float(np.median(steps)) * 1000
        out["depth_step_mm"] = round(step, 4)
        out["float16_quantised"] = any(abs(step - s) < 0.1 * s for s in F16_STEPS_MM)
    # MAD-based sigma of a difference of two samples; divide by sqrt(2) for per-pixel sigma.
    sig = lambda v: 1.4826 * float(np.median(np.concatenate(v))) / math.sqrt(2) * 1000
    axes = [ax for ax in (0, 1) if diffs[(ax, 1)] and diffs[(ax, 8)]]
    if axes:
        ax = min(axes, key=lambda ax: sig(diffs[(ax, 8)]))
        s1, s8 = sig(diffs[(ax, 1)]), sig(diffs[(ax, 8)])
        out["noise_lag1_mm"] = round(s1, 4); out["noise_lag8_mm"] = round(s8, 4)
        if s8 > 0:
            ratio = s1 / s8
            out["sampling_ratio"] = round(ratio, 3)
            out["sampling"] = "per-pixel" if ratio > 0.6 else ("interpolated" if ratio < 0.35 else "mixed")
    return out

def cmd_info(a):
    bad = 0
    out = []
    for p in a.files:
        try:
            h, fr = read_treadcap(p)
        except CaptureError as e:
            warn(f"{p}: {e}"); bad += 1; continue
        m = fr[0]["meta"]
        # Seconds and frames-per-second actually recorded, from the ARFrame timestamps. ARKit
        # delivers depth on every frame (60 Hz on current phones), so this says how long the
        # phone really recorded, which sets how far a sweep could have travelled.
        ts = [f["meta"].get("timestamp") for f in fr]
        ts = [t for t in ts if isinstance(t, (int, float))]
        seconds = round(ts[-1] - ts[0], 2) if len(ts) >= 2 and ts[-1] > ts[0] else None
        fps = round((len(ts) - 1) / (ts[-1] - ts[0]), 1) if seconds else None
        dist = [f["meta"].get("distanceM") for f in fr]
        dist = [d for d in dist if isinstance(d, (int, float))]
        span = (round(min(dist) * 100, 1), round(max(dist) * 100, 1)) if dist else None
        distinct, hz = distinct_depth_frames(fr)
        diag = depth_diagnostics(fr, getattr(a, "roi", 0.35))
        out.append({"file": p, "label": h.get("label"), "gauge32": h.get("gauge32"), "frames": len(fr),
                    "seconds": seconds, "fps": fps, "distance_cm": span,
                    "distinct_depth_frames": distinct, "effective_depth_hz": hz,
                    "width": m.get("width"), "height": m.get("height"), "smoothed": m.get("smoothed"),
                    "source": h.get("source", "arkit"), "filtered": m.get("filtered"),
                    "device": h.get("device"), "deviceID": h.get("deviceID"), "system": h.get("system"),
                    "diagnostics": diag})
        if not getattr(a, "json", False):
            timing = f" {seconds} s @ {fps} fps" if seconds else ""
            where = f" distance {span[0]}-{span[1]} cm" if span else ""
            fresh = f" distinct={distinct}" + ("" if hz is None else f" ({hz:.1f} Hz new depth)")
            print(f"{p}: label={h.get('label')!r} gauge={h.get('gauge32')} frames={len(fr)}{timing}{where}{fresh} depth={m.get('width')}x{m.get('height')} smoothed={m.get('smoothed')} source={h.get('source', 'arkit')} device={h.get('device')} iOS {h.get('system')}")
            print(f"   map: nan {diag['nan_fraction']} zero {diag['zero_fraction']} step {diag['depth_step_mm']} mm"
                  f" float16={diag['float16_quantised']} noise lag1 {diag['noise_lag1_mm']} / lag8 {diag['noise_lag8_mm']} mm"
                  f" ratio {diag['sampling_ratio']} -> {diag['sampling']}")
    if getattr(a, "json", False):
        print(json.dumps({"captures": out, "unreadable": bad}, indent=2))
    return 1 if bad and not out else 0

def cmd_measure(a):
    results, bad = [], 0
    for p in a.files:
        try:
            h, res, per = measure(p, a.model, a.roi, a.smooth, a.inlier, gated=not getattr(a, "all_frames", False))
        except CaptureError as e:
            warn(f"{p}: {e}"); bad += 1
            results.append({"file": p, "error": str(e), "depth_32": None})
            continue
        ok = sum(1 for x in per if x)
        g = h.get("gauge32")
        row = {"file": p, "label": h.get("label"), "gauge_32": g, "frames_total": len(per), "frames_usable": ok,
               "model": a.model, "roi": a.roi, "smooth": a.smooth, "inlier_mm": a.inlier}
        if not res:
            row.update({"depth_32": None, "error": "no usable frames"})
            results.append(row)
            if not getattr(a, "json", False):
                print(f"{p}: no usable frames ({ok}/{len(per)} frames produced a groove estimate)")
            continue
        row.update({"depth_mm": round(res["depth_mm"], 4), "depth_32": round(res["depth_mm"] / MM, 3),
                    "sd_mm": round(res["sd_mm"], 4), "sd_32": round(res["sd_mm"] / MM, 3),
                    "error_32": round(res["depth_mm"] / MM - g, 3) if g is not None else None})
        results.append(row)
        if not getattr(a, "json", False):
            line = f"{p}: {res['depth_mm']/MM:.2f}/32 ± {res['sd_mm']/MM:.2f}  ({res['depth_mm']:.2f} mm, {ok}/{len(per)} frames usable)"
            if g is not None: line += f"  gauge {g}/32  error {res['depth_mm']/MM - g:+.2f}/32"
            print(line)
    if getattr(a, "json", False):
        print(json.dumps({"results": results}, indent=2))
    return 1 if bad == len(a.files) else 0

def cmd_report(a, model=None, roi=None, smooth=None, inlier=None, quiet=False):
    model, roi, smooth, inlier = model or a.model, roi or a.roi, (a.smooth if smooth is None else smooth), inlier or a.inlier
    as_json = (not quiet) and getattr(a, "json", False)
    errs, rows, skipped = [], [], []
    for p in a.files:
        try:
            h, res, per = measure(p, model, roi, smooth, inlier, gated=not getattr(a, "all_frames", False))
        except CaptureError as e:
            if not quiet: warn(f"{p}: skipped, {e}")
            skipped.append({"file": p, "reason": str(e)}); continue
        g = h.get("gauge32")
        if res is None:
            if not quiet: warn(f"{p}: skipped, no usable frames (0/{len(per)})")
            skipped.append({"file": p, "reason": "no usable frames"}); continue
        if g is None:
            if not quiet: warn(f"{p}: skipped, no gauge32 reading in the header")
            skipped.append({"file": p, "reason": "no gauge reading"}); continue
        e = res["depth_mm"] / MM - g; errs.append(e)
        rows.append([p, h.get("label", ""), g, round(res["depth_mm"] / MM, 2), round(res["sd_mm"] / MM, 2), round(e, 2), res["frames"], h.get("device", "?")])
    if not errs:
        if as_json:
            print(json.dumps({"summary": None, "rows": [], "skipped": skipped}, indent=2))
        elif not quiet:
            print(f"No captures with both a result and a gauge value ({len(skipped)} skipped).")
        return None
    e = np.array(errs); within = float(np.mean(np.abs(e) <= 1) * 100)
    # pass/fail agreement at the legal thresholds (4/32 steer, 2/32 others; check both)
    dis = sum(1 for r in rows for lim in (4, 2) if (r[2] <= lim) != (r[3] <= lim))
    summary = {"rmse": float(np.sqrt((e**2).mean())), "bias": float(e.mean()), "within": within,
               "dis": dis, "n": len(e), "skipped": len(skipped)}
    if not quiet:
        if getattr(a, "csv", None):
            import csv
            with open(a.csv, "w", newline="") as f:
                w = csv.writer(f); w.writerow(["file", "label", "gauge_32", "scan_32", "sd_32", "error_32", "frames", "device"]); w.writerows(rows)
        if as_json:
            keys = ["file", "label", "gauge_32", "scan_32", "sd_32", "error_32", "frames"]
            print(json.dumps({"params": {"model": model, "roi": roi, "smooth": smooth, "inlier_mm": inlier},
                              "summary": {**summary, "rmse_32": summary["rmse"], "bias_32": summary["bias"]},
                              "rows": [dict(zip(keys, r)) for r in rows],
                              "skipped": skipped,
                              "csv": getattr(a, "csv", None)}, indent=2))
        else:
            print(f"model={model} roi={roi} smooth={smooth} inlier={inlier}  n={len(e)}  bias {e.mean():+.2f}/32  RMSE {summary['rmse']:.2f}/32  within ±1/32: {within:.0f}%  threshold disagreements: {dis}  skipped: {len(skipped)}")
            for r in rows: print("  ", *r)
        devices = {}
        for r in rows:
            devices.setdefault(r[7] if len(r) > 7 else "?", []).append(r[5])
        if len(devices) > 1:
            print("   by phone:")
            for dev, errs in sorted(devices.items()):
                arr = np.array(errs)
                print(f"     {dev}: n={len(arr)} bias {arr.mean():+.2f}/32 RMSE {np.sqrt((arr**2).mean()):.2f}/32")
            if getattr(a, "csv", None): print("wrote", a.csv)
    return summary

# A combination is only allowed to win on RMSE if it measured essentially as many captures as the
# best combination did. Otherwise a setting that only manages 2 of 10 tires (and gets those 2 nearly
# right) would outrank one that measures all 10 slightly less precisely.
COVERAGE_FLOOR = 0.9

def sweep(a, quiet=True):
    results = []
    thr = Estimator().thr0            # default groove threshold, mm
    for model in ("plane", "quadratic"):
        for roi in (0.25, 0.35, 0.45):
            for smooth in (0, 1, 2):
                for inlier in (0.5, 0.6, 0.8, 1.2):
                    # A band at or above the threshold straddles groove wall and floor in the mode
                    # window (4/32 reads 3.5/32), so it must not be allowed to win on RMSE.
                    if inlier >= thr: continue
                    r = cmd_report(a, model, roi, smooth, inlier, quiet=True)
                    if r: results.append({"model": model, "roi": roi, "smooth": smooth, "inlier_mm": inlier, **r})
    if not results:
        return []
    best_n = max(r["n"] for r in results)
    for r in results:
        r["coverage"] = r["n"] / best_n
        r["eligible"] = r["coverage"] >= COVERAGE_FLOOR
    results.sort(key=lambda r: (not r["eligible"], r["rmse"], -r["n"]))
    return results

def cmd_sweep(a):
    results = sweep(a)
    if not results:
        print("No parameter combination produced a usable result on these captures.")
        return 1
    best_n = max(r["n"] for r in results)
    if getattr(a, "json", False):
        print(json.dumps({"best_n": best_n, "coverage_floor": COVERAGE_FLOOR, "combos": results}, indent=2))
        return 0
    print(f"best first (rmse /32, model, roi, smooth, inlier mm, n, bias, within±1, disagreements); "
          f"best coverage n={best_n}, combos below {COVERAGE_FLOOR:.0%} coverage are ranked last:")
    for r in results[:12]:
        mark = "" if r["eligible"] else "  [low coverage]"
        print(f"  {r['rmse']:.2f}  {r['model']:9s} roi={r['roi']} smooth={r['smooth']} inlier={r['inlier_mm']}  "
              f"n={r['n']}  bias {r['bias']:+.2f}  within {r['within']:.0f}%  dis {r['dis']}{mark}")
    return 0

# A distance band needs this many usable frames before it can be named "closest to the gauge";
# one lucky frame is not evidence. At 30 Hz and 4 cm/s a 2 cm band gets ~15 frames.
POSE_MIN_FRAMES = 5
# "Agrees with the gauge" means within this many 32nds (the accuracy target).
POSE_TOL_32 = 1.0


def pose_verdict(rows, gauge):
    """Plain-language summary of one capture's distance table.

    Returns {"closest": row | None, "verdict": "pass"|"fail"|"insufficient"|"no-gauge", "text": [...]}.
    Only bands with >= POSE_MIN_FRAMES usable frames count; the band with the smallest |error|
    wins, ties broken by lower sd. The text says what to do next in words a technician can act on.
    """
    if gauge is None:
        return {"closest": None, "verdict": "no-gauge",
                "text": ["No gauge reading in this capture, so it cannot be scored. Record again and type the dial-gauge reading first."]}
    eligible = [r for r in rows if r["error_32"] is not None and r["usable"] >= POSE_MIN_FRAMES]
    usable = sum(r["usable"] for r in rows); total = sum(r["frames"] for r in rows)
    if not eligible:
        thin = [r for r in rows if r["error_32"] is not None]
        text = [f"NOT ENOUGH DATA: {usable} of {total} frames produced a groove reading and no 2 cm band has "
                f"{POSE_MIN_FRAMES} or more."]
        if usable >= POSE_MIN_FRAMES:
            text.append("The frames were readable but spread too thinly over distance: the sweep was too fast. "
                        "Record again at about 4 cm per second, or hold each distance for a second.")
        else:
            text.append("The phone could not see a groove floor at any distance it was held. "
                        "Try: clean dry tread, the widest groove, and a slower sweep.")
        if thin:
            text.append("Bands with too few frames to trust: " +
                        ", ".join(f"{r['distance_cm']} cm ({r['usable']} frame{'s' if r['usable'] != 1 else ''})" for r in thin) + ".")
        return {"closest": None, "verdict": "insufficient", "text": text}
    best = min(eligible, key=lambda r: (abs(r["error_32"]), r["sd_32"] if r["sd_32"] is not None else 99))
    good = [r for r in eligible if abs(r["error_32"]) <= POSE_TOL_32]
    if good:
        lo = min(int(r["distance_cm"].split("-")[0]) for r in good)
        hi = max(int(r["distance_cm"].split("-")[1]) for r in good)
        text = [f"PASS: at {best['distance_cm']} cm the phone read {best['depth_32']:.2f}/32 against the gauge's {gauge:g}/32 "
                f"(off by {best['error_32']:+.2f}/32, {best['usable']} frames, spread ±{best['sd_32'] if best['sd_32'] is not None else 0:.2f}).",
                f"Bands within ±{POSE_TOL_32:g}/32 of the gauge: " + ", ".join(r["distance_cm"] + " cm" for r in good) +
                f". That is the working range; set ScanSettings.minDistanceM/maxDistanceM to {lo/100:.2f}/{hi/100:.2f} if it holds on more tires."]
        verdict = "pass"
    else:
        text = [f"FAIL: no distance band read within ±{POSE_TOL_32:g}/32 of the gauge's {gauge:g}/32. "
                f"Closest was {best['distance_cm']} cm at {best['depth_32']:.2f}/32 (off by {best['error_32']:+.2f}/32, {best['usable']} frames).",
                "On this tire the phone does not agree with the gauge. Do not trust a scan reading until more captures say otherwise."]
        verdict = "fail"
    return {"closest": best, "verdict": verdict, "text": text}


def cmd_pose(a):
    """Which holding distance actually reads well.

    Every frame in a capture stores the distance, tilt and motion it was taken at,
    whether or not it was inside the on-screen gate. Bucketing the per-frame depth
    estimates by distance shows the sensor's real working range instead of assuming
    the gate's limits were right.
    """
    MMv = 25.4 / 32
    out, bad = [], 0
    for p in a.files:
        try:
            header, frames = read_treadcap(p)
        except CaptureError as e:
            warn(f"{p}: {e}"); bad += 1; continue
        est = Estimator(model=a.model, inlier=a.inlier)
        gauge = header.get("gauge32")
        buckets = {}
        for f in frames:
            m = f["meta"]
            d = m.get("distanceM")
            if d is None:
                continue
            cm = int(d * 100)
            lo = cm - (cm % 2)                     # 2 cm buckets
            r = est.frame(extract_points(f, a.roi, a.smooth)[0])
            b = buckets.setdefault(lo, {"n": 0, "usable": 0, "depths": [],
                                        "tilt": [], "conf": [], "gated": 0})
            b["n"] += 1
            if m.get("inGate"): b["gated"] += 1
            if m.get("tiltDegrees") is not None: b["tilt"].append(m["tiltDegrees"])
            if m.get("highConfidenceFraction") is not None: b["conf"].append(m["highConfidenceFraction"])
            if r:
                b["usable"] += 1
                b["depths"].append(r["depth_mm"])
        rows = []
        for lo in sorted(buckets):
            b = buckets[lo]
            mean = float(np.mean(b["depths"])) if b["depths"] else None
            sd = float(np.std(b["depths"])) if len(b["depths"]) > 1 else None
            rows.append({
                "distance_cm": f"{lo}-{lo+2}", "frames": b["n"],
                "usable": b["usable"], "in_gate": b["gated"],
                "depth_32": round(mean / MMv, 2) if mean is not None else None,
                "sd_32": round(sd / MMv, 2) if sd is not None else None,
                "error_32": round(mean / MMv - gauge, 2) if (mean is not None and gauge is not None) else None,
                "mean_tilt_deg": round(float(np.mean(b["tilt"])), 1) if b["tilt"] else None,
                "mean_conf": round(float(np.mean(b["conf"])), 2) if b["conf"] else None,
            })
        v = pose_verdict(rows, gauge)
        out.append({"file": p, "label": header.get("label"), "gauge32": gauge, "buckets": rows,
                    "verdict": v["verdict"], "closest": v["closest"], "summary": v["text"]})
        if not getattr(a, "json", False):
            print(f"{p}  label={header.get('label')!r}  gauge={gauge}/32")
            if not rows:
                print("   no per-frame distance recorded (capture predates pose logging)")
                continue
            print(f"   {'dist cm':>8} {'frames':>7} {'usable':>7} {'in gate':>8} {'depth/32':>9} {'sd':>6} {'err':>7} {'tilt':>6} {'conf':>6}")
            for r in rows:
                fmt = lambda v, w, d=2: (f"{v:>{w}.{d}f}" if isinstance(v, float) else f"{'-':>{w}}")
                print(f"   {r['distance_cm']:>8} {r['frames']:>7} {r['usable']:>7} {r['in_gate']:>8}"
                      f" {fmt(r['depth_32'],9)} {fmt(r['sd_32'],6)} {fmt(r['error_32'],7)}"
                      f" {fmt(r['mean_tilt_deg'],6,1)} {fmt(r['mean_conf'],6)}")
            for line in v["text"]:
                print("   " + line)
    if getattr(a, "json", False):
        print(json.dumps({"captures": out, "unreadable": bad}, indent=2))
    return 1 if bad and not out else 0


def expand_files(files):
    """Expand shell wildcards that the shell did not. On Windows, cmd.exe and PowerShell pass
    `*.treadcap` through literally; on Unix the shell has already expanded it and this is a
    no-op. A pattern that matches nothing is kept as-is so the usual per-file warning names it.
    """
    import glob
    out = []
    for f in files:
        if any(ch in f for ch in "*?["):
            matches = sorted(glob.glob(f))
            out.extend(matches if matches else [f])
        else:
            out.append(f)
    return out


def cmd_trim(a):
    """Cut a phone capture down to a fixture that can live in git.

    A phone capture is 150 frames with a 640 px JPEG each, about 45 MB. The regression fixture
    keeps the first N in-gate frames (what a scan would have averaged), drops the JPEGs, and
    leaves the header, metadata, depth and confidence maps byte-for-byte as recorded, so
    `measure`, `report` and `pose` read it exactly like the original.
    """
    try:
        header, frames = read_treadcap(a.files[0])
    except CaptureError as e:
        print(f"error: {a.files[0]}: {e}", file=sys.stderr); return 2
    keep = [f for f in frames if (a.all_frames or in_gate(f))][:a.frames]
    if len(keep) < a.frames:
        warn(f"{a.files[0]}: only {len(keep)} {'frames' if a.all_frames else 'in-gate frames'} available, wanted {a.frames}")
    if not keep:
        print("error: nothing to keep", file=sys.stderr); return 2
    header = dict(header, trimmedFrom=Path(a.files[0]).name, originalFrames=len(frames))
    hdr = json.dumps(header).encode()
    out = bytearray(b"TREADCAP") + struct.pack("<I", len(hdr)) + hdr
    for f in keep:
        meta = json.dumps(f["meta"]).encode()
        out += struct.pack("<I", len(meta)) + meta + f["depth"].tobytes() + f["conf"].tobytes() + struct.pack("<I", 0)
    with open(a.out, "wb") as fh:
        fh.write(out)
    print(f"wrote {a.out}: {len(keep)} of {len(frames)} frames, {len(out)/1e6:.2f} MB, gauge {header.get('gauge32')}/32, {header.get('device')}")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["info", "measure", "report", "sweep", "pose", "trim"])
    ap.add_argument("files", nargs="+")
    ap.add_argument("--model", default="quadratic", choices=["plane", "quadratic"])
    ap.add_argument("--roi", type=float, default=0.35)
    ap.add_argument("--smooth", type=int, default=1)
    ap.add_argument("--inlier", type=float, default=0.6, help="RANSAC inlier band, mm")
    ap.add_argument("--csv")
    ap.add_argument("--json", action="store_true", help="emit machine-readable JSON on stdout")
    ap.add_argument("--all-frames", action="store_true",
                    help="measure/report/sweep/trim: use every recorded frame, not only the ones that passed the pose gate")
    ap.add_argument("--out", help="trim: output .treadcap path")
    ap.add_argument("--frames", type=int, default=12, help="trim: frames to keep (default 12)")
    a = ap.parse_args(argv)
    a.files = expand_files(a.files)
    if a.cmd == "trim" and (not a.out or len(a.files) != 1):
        ap.error("trim takes exactly one input capture and --out")
    fn = {"info": cmd_info, "measure": cmd_measure, "report": cmd_report,
          "sweep": cmd_sweep, "pose": cmd_pose, "trim": cmd_trim}[a.cmd]
    try:
        rc = fn(a)
    except CaptureError as e:      # anything that escaped a per-file handler
        print(f"error: {e}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        return 130
    return rc if isinstance(rc, int) else 0

if __name__ == "__main__":
    sys.exit(main())
