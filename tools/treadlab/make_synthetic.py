#!/usr/bin/env python3
"""Write a synthetic .treadcap (curved tire, known groove depth) to exercise treadlab without a phone.
   python3 make_synthetic.py out.treadcap --depth32 5 --noise 0.5

`build_capture` / `write_capture` are importable so the test suite can generate the same
captures in memory without shelling out.
"""
import argparse, json, struct
import numpy as np

W, H = 256, 192
IMAGE_W, IMAGE_H = 1920, 1440
INTRINSICS = [1600.0, 1600.0, 960.0, 720.0]


def build_capture(depth32=5.0, noise=0.5, frames=30, curved=True, grooves=True,
                  confidence=2, label="synthetic", gauge32=None, seed=1,
                  width=W, height=H, radius=0.5):
    """Return the bytes of a synthetic .treadcap.

    depth32   groove depth in 32nds of an inch (ground truth)
    curved    True  -> tread lies on a cylinder of `radius` m (the real case)
              False -> flat tread surface
    grooves   False -> no grooves at all (degenerate: nothing to measure)
    confidence 0/1/2 -> ARKit confidence written for every pixel (2 == high)
    gauge32   header gauge reading; defaults to depth32
    """
    w, h = width, height
    fx = fy = INTRINSICS[0] * w / IMAGE_W
    cx, cy = w / 2, h / 2
    depth_m = depth32 * 25.4 / 32 / 1000
    rng = np.random.default_rng(seed)
    header = {"version": 1, "label": label,
              "gauge32": depth32 if gauge32 is None else gauge32,
              "device": "synthetic"}
    hdr = json.dumps(header).encode()
    out = bytearray(b"TREADCAP") + struct.pack("<I", len(hdr)) + hdr
    ys, xs = np.mgrid[0:h, 0:w]
    for i in range(frames):
        # back-project rays to a surface at 0.2 m with grooves every 20 mm (8 mm wide) along x
        z0 = 0.20
        X = (xs - cx) / fx * z0
        Y = -(ys - cy) / fy * z0
        z = np.full(Y.shape, z0, float)
        if curved:
            z = z + (radius - np.sqrt(np.maximum(radius * radius - Y * Y, 0)))
        if grooves:
            z = z + np.where(((X * 1000 + 1000) % 20) < 8, depth_m, 0)
        z = z + rng.normal(0, noise / 1000, z.shape)
        conf = np.full((h, w), confidence, np.uint8)
        meta = json.dumps({"index": i, "timestamp": i / 30, "width": w, "height": h,
                           "imageWidth": IMAGE_W, "imageHeight": IMAGE_H,
                           "intrinsics": INTRINSICS,
                           "transform": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                           "smoothed": True}).encode()
        out += struct.pack("<I", len(meta)) + meta + z.astype("<f4").tobytes() + conf.tobytes() + struct.pack("<I", 0)
    return bytes(out)


def write_capture(path, **kw):
    data = build_capture(**kw)
    with open(path, "wb") as f:
        f.write(data)
    return data


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--depth32", type=float, default=5)
    ap.add_argument("--noise", type=float, default=0.5)
    ap.add_argument("--frames", type=int, default=30)
    ap.add_argument("--flat", action="store_true", help="flat tread instead of a curved tire")
    a = ap.parse_args()
    data = write_capture(a.out, depth32=a.depth32, noise=a.noise, frames=a.frames, curved=not a.flat)
    print("wrote", a.out, len(data), "bytes")
