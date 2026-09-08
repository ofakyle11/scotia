#!/usr/bin/env python3
"""Write a synthetic .treadcap (curved tire, known groove depth) to exercise treadlab without a phone.
   python3 make_synthetic.py out.treadcap --depth32 5 --noise 0.5"""
import argparse, json, math, struct
import numpy as np
ap = argparse.ArgumentParser(); ap.add_argument("out"); ap.add_argument("--depth32", type=float, default=5); ap.add_argument("--noise", type=float, default=0.5); ap.add_argument("--frames", type=int, default=30)
a = ap.parse_args()
W, H = 256, 192; fx = fy = 1600.0 * W / 1920; cx, cy = W / 2, H / 2
depth_m = a.depth32 * 25.4 / 32 / 1000; R = 0.5; rng = np.random.default_rng(1)
out = bytearray(b"TREADCAP"); hdr = json.dumps({"version": 1, "label": "synthetic", "gauge32": a.depth32, "device": "synthetic"}).encode()
out += struct.pack("<I", len(hdr)) + hdr
for i in range(a.frames):
    ys, xs = np.mgrid[0:H, 0:W]
    # back-project rays to a cylinder at 0.2 m with grooves every 20 mm (8 mm wide) along x
    z0 = 0.20
    X = (xs - cx) / fx * z0; Y = -(ys - cy) / fy * z0
    z = z0 + (R - np.sqrt(np.maximum(R * R - Y * Y, 0)))
    groove = ((X * 1000 + 1000) % 20) < 8
    z = z + np.where(groove, depth_m, 0) + rng.normal(0, a.noise / 1000, z.shape)
    conf = np.full((H, W), 2, np.uint8)
    meta = json.dumps({"index": i, "timestamp": i / 30, "width": W, "height": H, "imageWidth": 1920, "imageHeight": 1440, "intrinsics": [1600.0, 1600.0, 960.0, 720.0], "transform": [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1], "smoothed": True}).encode()
    out += struct.pack("<I", len(meta)) + meta + z.astype("<f4").tobytes() + conf.tobytes() + struct.pack("<I", 0)
open(a.out, "wb").write(out); print("wrote", a.out, len(out), "bytes")
