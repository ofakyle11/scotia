#!/usr/bin/env python3
"""treadlab: offline analysis of .treadcap LiDAR captures from the Tread Scanner app.

Usage:
  python3 treadlab.py info    capture.treadcap [--json]
  python3 treadlab.py measure capture.treadcap [--model plane|quadratic] [--roi 0.35] [--smooth 1] [--inlier 0.6] [--json]
  python3 treadlab.py report  *.treadcap [--csv out.csv] [--json]   # scan vs gauge for many captures
  python3 treadlab.py sweep   *.treadcap [--json]                   # try parameter combos, print the best

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
class Estimator:
    def __init__(self, model="quadratic", groove_threshold=1.0, max_depth=30.0, iters=120, inlier=0.6, min_surface=60, min_groove=12, seed=0x5EED):
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
                try:
                    c = np.linalg.lstsq(A, -dist[idx], rcond=None)[0]
                except np.linalg.LinAlgError:
                    c = None
                if c is not None and np.all(np.isfinite(c)):
                    r = P - org; x = (r @ uu) * 1000; y = (r @ vv) * 1000
                    dist = dist + (c[0]*x*x + c[1]*y*y + c[2]*x*y + c[3]*x + c[4]*y + c[5])
        above = -dist[(dist < 0) & (dist > -3 * self.inlier)]     # points above the plane: never groove
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
        return {"depth_mm": float(floor.mean()), "groove_pts": int(len(floor)), "surface_pts": surface, "sigma_mm": float(sigma)}

    def combine(self, frames):
        if not frames: return None
        d = np.sort([f["depth_mm"] for f in frames]); t = len(d) // 10 if len(d) >= 10 else 0
        d = d[t:len(d) - t]
        return {"depth_mm": float(d.mean()), "sd_mm": float(d.std(ddof=1)) if len(d) > 1 else 1.5, "frames": len(frames)}

MM = 25.4 / 32
def measure(path, model="quadratic", roi=0.35, smooth=1, inlier=0.6, **kw):
    header, frames = read_treadcap(path)
    est = Estimator(model=model, inlier=inlier, **kw)
    per = [est.frame(extract_points(f, roi, smooth)[0]) for f in frames]
    res = est.combine([p for p in per if p])
    return header, res, per

def warn(msg):
    print(f"warning: {msg}", file=sys.stderr)

def cmd_info(a):
    bad = 0
    out = []
    for p in a.files:
        try:
            h, fr = read_treadcap(p)
        except CaptureError as e:
            warn(f"{p}: {e}"); bad += 1; continue
        m = fr[0]["meta"]
        out.append({"file": p, "label": h.get("label"), "gauge32": h.get("gauge32"), "frames": len(fr),
                    "width": m.get("width"), "height": m.get("height"), "smoothed": m.get("smoothed"),
                    "device": h.get("device"), "deviceID": h.get("deviceID"), "system": h.get("system")})
        if not getattr(a, "json", False):
            print(f"{p}: label={h.get('label')!r} gauge={h.get('gauge32')} frames={len(fr)} depth={m.get('width')}x{m.get('height')} smoothed={m.get('smoothed')} device={h.get('device')} iOS {h.get('system')}")
    if getattr(a, "json", False):
        print(json.dumps({"captures": out, "unreadable": bad}, indent=2))
    return 1 if bad and not out else 0

def cmd_measure(a):
    results, bad = [], 0
    for p in a.files:
        try:
            h, res, per = measure(p, a.model, a.roi, a.smooth, a.inlier)
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
            h, res, per = measure(p, model, roi, smooth, inlier)
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
    for model in ("plane", "quadratic"):
        for roi in (0.25, 0.35, 0.45):
            for smooth in (0, 1, 2):
                for inlier in (0.5, 0.6, 0.8, 1.2):
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
        out.append({"file": p, "label": header.get("label"), "gauge32": gauge, "buckets": rows})
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
            best = [r for r in rows if r["error_32"] is not None]
            if best:
                b = min(best, key=lambda r: abs(r["error_32"]))
                print(f"   closest to the gauge: {b['distance_cm']} cm, off by {b['error_32']:+.2f}/32")
    if getattr(a, "json", False):
        print(json.dumps({"captures": out, "unreadable": bad}, indent=2))
    return 1 if bad and not out else 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["info", "measure", "report", "sweep", "pose"])
    ap.add_argument("files", nargs="+")
    ap.add_argument("--model", default="quadratic", choices=["plane", "quadratic"])
    ap.add_argument("--roi", type=float, default=0.35)
    ap.add_argument("--smooth", type=int, default=1)
    ap.add_argument("--inlier", type=float, default=0.6, help="RANSAC inlier band, mm")
    ap.add_argument("--csv")
    ap.add_argument("--json", action="store_true", help="emit machine-readable JSON on stdout")
    a = ap.parse_args(argv)
    fn = {"info": cmd_info, "measure": cmd_measure, "report": cmd_report,
          "sweep": cmd_sweep, "pose": cmd_pose}[a.cmd]
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
