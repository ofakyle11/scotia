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

Every command takes `--json`, which prints the same numbers as a single JSON
document on stdout (warnings stay on stderr) so results can be piped into other
tools: `python3 treadlab.py report --json *.treadcap | jq '.summary.rmse'`.
`measure` gives one object per file with `depth_32`/`error_32`, or `depth_32:
null` plus an `error` string for a file that could not be measured; `report`
gives `params`, `summary`, `rows` and the `skipped` list; `sweep` gives every
combination in ranked order.

Bad input is never a traceback. A file that is not a `.treadcap`, is empty,
truncated or has a corrupt header is reported as a one-line warning on stderr;
`report` and `sweep` skip it and still summarise the remaining captures, and the
skipped count is printed with the summary. A capture whose frames all fail
(no grooves, low confidence, too few points) is reported as "no usable frames".
A capture truncated part-way through a frame keeps its complete frames.

`sweep` is the point: record 20+ tires, run it, and copy the winning
parameters into `TreadScanner/TreadScanner/Depth/LiDAR/TreadDepthEstimator.swift`
and `LiDARSession.swift` (roiFraction, smoothingRadius, surfaceModel).
It ranks by RMSE against the gauge, but only among combinations that measured
at least 90% as many captures as the best combination did, so a setting that
measures 2 of 10 tires very precisely cannot outrank one that measures all 10.
Low-coverage combinations are still listed, marked `[low coverage]`, last.

No phone yet? `python3 make_synthetic.py test.treadcap --depth32 5 --noise 0.5`
writes a synthetic curved-tire capture so the pipeline can be exercised
(`--flat` for a flat one). `build_capture()` / `write_capture()` in that file are
importable, which is how the tests make their captures.

## Tests

```bash
pip install numpy pytest
python3 -m pytest tools/treadlab -q      # ~100 s, no phone required
```

`test_treadlab.py` runs entirely on synthetic captures: file round-trip
(frame count, dimensions, gauge and header fields), accuracy at 2/32, 4/32,
8/32 and 12/32 with realistic noise (each asserted within 0.5/32 of truth, flat
and curved), the curvature case (the quadratic model on a 0.5 m-radius tire, and
a 0.3 m one), the exactness of the 1/32 = 0.79375 mm conversion, degenerate
inputs (no grooves, all-low-confidence, too few points, empty/corrupt/truncated
files) returning `None` rather than crashing, the CLI's error handling and
`--json` output, and the `sweep` ranking checked against an independently
computed RMSE.

Where the ideas came from: Apple's WWDC20 scene-depth point cloud sample and
the ARKit point-cloud repos (unprojection with scaled intrinsics), the
LiDAR depth-map capture repo (keep 32-bit depth and confidence, never a
lossy image), and FindSurface-style surface fitting (a tire is curved, so
the tread surface is fit with a quadratic rather than a plane).
