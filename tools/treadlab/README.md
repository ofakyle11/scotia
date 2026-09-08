# treadlab – offline LiDAR analysis

The phone app can record raw LiDAR frames of a tire to a `.treadcap` file
(menu → Record raw LiDAR capture), with the dial-gauge reading typed in.
Share those files to a computer and this tool runs the same estimator as the
app on them, so the maths can be tuned against real tread without rebuilding
the app for every guess.

```bash
pip install numpy
python3 treadlab.py info    *.treadcap          # what is in each file
python3 treadlab.py measure capture.treadcap    # depth estimate for one capture
python3 treadlab.py report  *.treadcap --csv results.csv   # scan vs gauge across many
python3 treadlab.py sweep   *.treadcap          # try model/ROI/smoothing combos, best first
```

`sweep` is the point: record 20+ tires, run it, and copy the winning
parameters into `TreadScanner/TreadScanner/Depth/LiDAR/TreadDepthEstimator.swift`
and `LiDARSession.swift` (roiFraction, smoothingRadius, surfaceModel).

No phone yet? `python3 make_synthetic.py test.treadcap --depth32 5 --noise 0.5`
writes a synthetic curved-tire capture so the pipeline can be exercised.

Where the ideas came from: Apple's WWDC20 scene-depth point cloud sample and
the ARKit point-cloud repos (unprojection with scaled intrinsics), the
LiDAR depth-map capture repo (keep 32-bit depth and confidence, never a
lossy image), and FindSurface-style surface fitting (a tire is curved, so
the tread surface is fit with a quadratic rather than a plane).
