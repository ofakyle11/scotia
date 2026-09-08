#!/usr/bin/env python3
"""treadlab: offline analysis of .treadcap LiDAR captures from the Tread Scanner app.

Usage:
  python3 treadlab.py info    capture.treadcap
  python3 treadlab.py measure capture.treadcap [--model plane|quadratic] [--roi 0.35] [--smooth 1]
  python3 treadlab.py report  *.treadcap [--csv out.csv]     # scan vs gauge for many captures
  python3 treadlab.py sweep   *.treadcap                     # try parameter combos, print the best

The estimator here is a line-for-line port of TreadDepthEstimator.swift so numbers match the
phone. Tune here, then copy the winning parameters into the Swift file.
Requires numpy. Point-cloud approach inspired by Apple's WWDC20 scene-depth sample and the
open ARKit point-cloud repos; curvature model from the FindSurface-style plane/cylinder work.
"""
import argparse, json, math, struct, sys
from pathlib import Path
import numpy as np

# ---------------- file format ----------------
def read_treadcap(path):
    with open(path, "rb") as f:
        data = f.read()
    assert data[:8] == b"TREADCAP", "not a .treadcap file"
    off = 8
    (hlen,) = struct.unpack_from("<I", data, off); off += 4
    header = json.loads(data[off:off + hlen]); off += hlen
    frames = []
    while off < len(data):
        (mlen,) = struct.unpack_from("<I", data, off); off += 4
        meta = json.loads(data[off:off + mlen]); off += mlen
        w, h = meta["width"], meta["height"]
        depth = np.frombuffer(data, dtype="<f4", count=w * h, offset=off).reshape(h, w); off += w * h * 4
        conf = np.frombuffer(data, dtype=np.uint8, count=w * h, offset=off).reshape(h, w); off += w * h
        (jlen,) = struct.unpack_from("<I", data, off); off += 4
        jpeg = data[off:off + jlen]; off += jlen
        frames.append({"meta": meta, "depth": depth, "conf": conf, "jpeg": jpeg})
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
class Estimator:
    def __init__(self, model="quadratic", groove_threshold=1.0, max_depth=30.0, iters=120, inlier=1.2, min_surface=60, min_groove=12, seed=0x5EED):
        self.model, self.thr0, self.max_depth, self.iters, self.inlier = model, groove_threshold, max_depth, iters, inlier
        self.min_surface, self.min_groove, self.seed = min_surface, min_groove, seed

    def fit_plane(self, P):
        rng = np.random.default_rng(self.seed); best, best_in = None, 0; inl = self.inlier / 1000
        for _ in range(self.iters):
            a, b, c = P[rng.integers(len(P), size=3)]
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
        dist = -(P @ u + d) * 1000
        if self.model == "quadratic":
            idx = (dist >= -2 * self.inlier) & (dist <= self.inlier)   # surface only, not groove walls
            if idx.sum() >= 30:
                n = u; seed = np.array([1., 0, 0]) if abs(n[0]) < 0.9 else np.array([0, 1., 0])
                uu = np.cross(n, seed); uu /= np.linalg.norm(uu); vv = np.cross(n, uu)
                org = P[idx].mean(0); r = P[idx] - org; x = (r @ uu) * 1000; y = (r @ vv) * 1000
                A = np.stack([x*x, y*y, x*y, x, y, np.ones_like(x)], 1)
                c = np.linalg.lstsq(A, -dist[idx], rcond=None)[0]
                r = P - org; x = (r @ uu) * 1000; y = (r @ vv) * 1000
                dist = dist + (c[0]*x*x + c[1]*y*y + c[2]*x*y + c[3]*x + c[4]*y + c[5])
        above = -dist[(dist < 0) & (dist > -3 * self.inlier)]     # points above the plane: never groove
        if len(above) < self.min_surface // 2: return None
        sigma = 1.4826 * np.median(above); thr = max(self.thr0, 3 * sigma)
        surface = int(np.sum(np.abs(dist) <= self.inlier))
        cand = np.sort(dist[(dist > thr) & (dist < self.max_depth)])
        if surface < self.min_surface or len(cand) < self.min_groove: return None
        window = 2 * self.inlier; bs = be = hi = 0
        for lo in range(len(cand)):
            while hi < len(cand) and cand[hi] - cand[lo] <= window: hi += 1
            if hi - lo > be - bs: bs, be = lo, hi
        floor = cand[bs:be]
        if len(floor) < self.min_groove: return None
        return {"depth_mm": float(floor.mean()), "groove_pts": int(len(floor)), "surface_pts": surface, "sigma_mm": float(sigma)}

    def combine(self, frames):
        if not frames: return None
        d = np.sort([f["depth_mm"] for f in frames]); t = len(d) // 10 if len(d) >= 10 else 0
        d = d[t:len(d) - t]
        return {"depth_mm": float(d.mean()), "sd_mm": float(d.std(ddof=1)) if len(d) > 1 else 1.5, "frames": len(frames)}

MM = 25.4 / 32
def measure(path, model="quadratic", roi=0.35, smooth=1, **kw):
    header, frames = read_treadcap(path)
    est = Estimator(model=model, **kw)
    per = [est.frame(extract_points(f, roi, smooth)[0]) for f in frames]
    res = est.combine([p for p in per if p])
    return header, res, per

def cmd_info(a):
    for p in a.files:
        h, fr = read_treadcap(p)
        m = fr[0]["meta"] if fr else {}
        print(f"{p}: label={h.get('label')!r} gauge={h.get('gauge32')} frames={len(fr)} depth={m.get('width')}x{m.get('height')} smoothed={m.get('smoothed')} device={h.get('device')} iOS {h.get('system')}")

def cmd_measure(a):
    for p in a.files:
        h, res, per = measure(p, a.model, a.roi, a.smooth)
        ok = sum(1 for x in per if x)
        if not res: print(f"{p}: no usable frames ({ok}/{len(per)})"); continue
        g = h.get("gauge32")
        line = f"{p}: {res['depth_mm']/MM:.2f}/32 ± {res['sd_mm']/MM:.2f}  ({res['depth_mm']:.2f} mm, {ok}/{len(per)} frames usable)"
        if g is not None: line += f"  gauge {g}/32  error {res['depth_mm']/MM - g:+.2f}/32"
        print(line)

def cmd_report(a, model=None, roi=None, smooth=None, quiet=False):
    model, roi, smooth = model or a.model, roi or a.roi, smooth or a.smooth
    errs, rows = [], []
    for p in a.files:
        h, res, per = measure(p, model, roi, smooth)
        g = h.get("gauge32")
        if res and g is not None:
            e = res["depth_mm"] / MM - g; errs.append(e)
            rows.append([p, h.get("label", ""), g, round(res["depth_mm"] / MM, 2), round(res["sd_mm"] / MM, 2), round(e, 2), res["frames"]])
    if not errs:
        if not quiet: print("No captures with both a result and a gauge value.")
        return None
    e = np.array(errs); within = np.mean(np.abs(e) <= 1) * 100
    # pass/fail agreement at the legal thresholds (4/32 steer, 2/32 others; check both)
    dis = sum(1 for r in rows for lim in (4, 2) if (r[2] <= lim) != (r[3] <= lim))
    if not quiet:
        print(f"model={model} roi={roi} smooth={smooth}  n={len(e)}  bias {e.mean():+.2f}/32  RMSE {np.sqrt((e**2).mean()):.2f}/32  within ±1/32: {within:.0f}%  threshold disagreements: {dis}")
        for r in rows: print("  ", *r)
        if getattr(a, "csv", None):
            import csv
            with open(a.csv, "w", newline="") as f:
                w = csv.writer(f); w.writerow(["file", "label", "gauge_32", "scan_32", "sd_32", "error_32", "frames"]); w.writerows(rows)
            print("wrote", a.csv)
    return {"rmse": float(np.sqrt((e**2).mean())), "bias": float(e.mean()), "within": float(within), "dis": dis, "n": len(e)}

def cmd_sweep(a):
    results = []
    for model in ("plane", "quadratic"):
        for roi in (0.25, 0.35, 0.45):
            for smooth in (0, 1, 2, 3):
                r = cmd_report(a, model, roi, smooth, quiet=True)
                if r: results.append((r["rmse"], model, roi, smooth, r))
    results.sort(key=lambda t: t[0])
    print("best first (rmse /32, model, roi, smooth, bias, within±1, disagreements):")
    for rmse, model, roi, smooth, r in results[:10]:
        print(f"  {rmse:.2f}  {model:9s} roi={roi} smooth={smooth}  bias {r['bias']:+.2f}  within {r['within']:.0f}%  dis {r['dis']}")

if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["info", "measure", "report", "sweep"])
    ap.add_argument("files", nargs="+")
    ap.add_argument("--model", default="quadratic", choices=["plane", "quadratic"])
    ap.add_argument("--roi", type=float, default=0.35)
    ap.add_argument("--smooth", type=int, default=1)
    ap.add_argument("--csv")
    a = ap.parse_args()
    {"info": cmd_info, "measure": cmd_measure, "report": cmd_report, "sweep": cmd_sweep}[a.cmd](a)
