# Real-tire regression fixtures

Every `.treadcap` in this directory is a trimmed recording from a real phone on a real tire,
with the dial-gauge reading in its header. `test_regression.py` measures each one on every run
and fails if the estimate drifts from the gauge by more than 1/32, or from the value pinned in
`expected.json` by more than 0.001 mm. Until the first file lands here, every accuracy number in
the test suite is synthetic, and `test_regression.py` says so on every run.

## Checking in the first capture (owner, Windows, ten minutes)

1. On the phone: **menu → Record raw LiDAR capture**, type the gauge reading, record the
   groove while sweeping 10 cm to 30 cm. Share the file to the PC. It is about 45 MB:
   150 frames × (256×192 float32 depth + confidence + a 640 px JPEG).
2. On the PC, from the repo root:

   ```
   python3 tools/treadlab/treadlab.py info  capture.treadcap
   python3 tools/treadlab/treadlab.py pose  capture.treadcap
   python3 tools/treadlab/treadlab.py trim  capture.treadcap --out tools/treadlab/fixtures/<phone>_<unit>_<pos>_<gauge>of32.treadcap
   ```

   `trim` keeps the first 12 frames that passed the pose gate (what a scan would have averaged),
   drops the JPEGs and writes the depth and confidence maps byte-for-byte: about 3 MB, which
   plain git handles. Do not use Git LFS for these; CI checkouts would spend the LFS bandwidth
   quota and the Windows PC would need the LFS client.
3. Pin the numbers and commit both files together:

   ```
   cd tools/treadlab && python3 treadlab.py measure --json fixtures/*.treadcap > fixtures/expected.json
   git add fixtures && git commit -m "fixture: iPhone 16 Pro, unit 214053 LF, gauge 7/32"
   ```

   If `measure` is more than 1/32 from the gauge, commit it anyway: a red CI on a real tire is the
   honest state of the project, and the file is what the maths gets tuned against. Mark it
   `xfail` in `test_regression.py` with the reason, do not lower the tolerance.

## Naming

`<device>_<unit>_<position>_<gauge>of32.treadcap`, e.g. `iPhone16Pro_214053_LF_7of32.treadcap`.
The header already carries `device`, `deviceID`, `system`, `gauge32`, `label` and `created`;
the name is for humans reading a CI log.

## Budget

Keep the directory under ~30 MB (ten fixtures). Beyond that, keep one per phone model per
depth band (2–4, 5–8, 9+ /32) and move the rest to a release asset.

## When a fixture changes value

`expected.json` pins what the estimator reads today. A commit that changes the maths must
regenerate it in the same commit, so the review shows exactly how many 32nds every real tire
moved. A fixture that moves without a maths change means something environmental (numpy,
platform) and is worth understanding before merging.
