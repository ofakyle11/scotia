# Scotia Tread Scanner – Master Plan

_Last updated 8 September 2026. Source of truth for the project. Everything
referenced here lives in this repo on branch `claude/truck-tire-depth-scanner-3fsnpo`._

## 1. Goal

A technician walks around a commercial truck or trailer with an iPhone, points
it at each tire, and the app records tread depth in 32nds of an inch for every
wheel position, flags anything at or near the legal minimum, and delivers the
whole inspection as a spreadsheet.

| Fact that shapes the design | Value |
|---|---|
| Unit of precision | 1/32" = 0.79 mm |
| Steer legal minimum (Canada NSC / US FMCSA) | 4/32" = 3.2 mm |
| Drive and trailer legal minimum | 2/32" = 1.6 mm |
| iPhone LiDAR depth map | 256 × 192 points, about 1 mm per point at 20 cm |
| Raw LiDAR noise per point | several mm; must be averaged and measured relative to the tread surface |

The scanner is unproven at 1/32" and is treated as such: every scan carries a
confidence band, every number can be typed over, and the app collects the data
that proves or disproves it in the first weeks.

## 2. Where things stand today

| Piece | State | Where |
|---|---|---|
| Web app (add to home screen) | **Live.** Gauge entry, photos, customer report, unit history, CSV export | https://scotia-tread-scanner.netlify.app · `web/` |
| iPhone app | Built. Compiles and passes 39 unit tests in cloud CI. Not yet on a phone | `TreadScanner/` |
| LiDAR scanner | Implemented with curvature-corrected fit and confidence band. Tuned on synthetic tires only | `TreadScanner/TreadScanner/Depth/LiDAR/` |
| Customer report | Both apps. Prints from Safari; exports as a Letter PDF on iPhone | `Views/Review/` · `web/app.js` |
| Unit history | Both apps. Depth per position over time, wear rate per 10,000 km, projected km to minimum | `Views/Review/UnitHistoryView.swift` |
| Raw capture + analysis tool | Built, 53 tests. Records real tires for offline tuning | `tools/treadlab/` |
| Spreadsheet workbook | Built. Inspections tab plus a Fleet Summary that reads the latest inspection per unit | `spreadsheet/` |
| Cloud build to TestFlight | Written. Waiting on Apple Developer enrolment and secrets | `.github/workflows/ios-testflight.yml` |
| Web auto-deploy | Written. Waiting on a `NETLIFY_AUTH_TOKEN` secret | `.github/workflows/web-deploy.yml` |

## 3. How the pieces fit

```
  iPhone (Safari, today)            iPhone Pro (TestFlight, after Apple enrolment)
  ┌──────────────────────┐          ┌──────────────────────────────────────────┐
  │ Web app              │          │ Native app                               │
  │ gauge entry, photos  │          │ LiDAR scan ─► TreadDepthEstimator        │
  │ same presets/columns │          │ gauge / manual entry                     │
  └──────────┬───────────┘          │ Raw capture ─► .treadcap files ──────────┼──► tools/treadlab (computer)
             │ CSV                  └──────────┬───────────────────────────────┘        tune, copy params back
             ▼                                 │ CSV  (Sheets sync optional)
     Google Sheets  ◄──────────────────────────┘
     one row per tire, 25 columns, Inspections tab
```

Both apps share the same axle presets, TMC position codes, thresholds and
spreadsheet columns, so rows from either can sit in the same sheet.

## 4. The spreadsheet

One row per tire position. Columns, in order:

```
inspection_id, date, technician, customer, unit_number, plate, vin, odometer,
axle_config, position, brand, model, size, dot_code,
depth_inner_32nds, depth_centre_32nds, depth_outer_32nds, depth_min_32nds, depth_min_mm,
pressure_psi, status, method, photo_url, notes, scan_confidence_32nds
```

- `status` is OK, WATCH or REPLACE against 4/32 steer and 2/32 others, with a
  configurable watch band (default 2/32 above the minimum).
- `method` is scan, gauge or manual. Auditable.
- Three grooves per tire; `depth_min_32nds` is what the status uses. A spread of
  3/32 or more across grooves is flagged in the app as an alignment or inflation
  lead, which feeds the alignment side of the business.

**Getting rows in (CSV, decided):** finish an inspection, share the CSV, then in
Google Sheets: File → Import → Upload → Append to current sheet. Same columns
every time, so filters and pivots on unit number keep working.

**The workbook** in `spreadsheet/` is ready to upload to Google Drive. Four tabs:
Inspections (matching the CSV exactly), Fleet Summary (type unit numbers into the
yellow column and it reports that unit's latest inspection: tires replaced,
watched and OK, lowest tread and where it is, and a plain-English action),
Thresholds, and a README. `sample_inspection.csv` is a real 10-row tractor
inspection for testing the import before real data exists.

Its formulas are written for Google Sheets, so `MAXIFS` and `MINIFS` are avoided
and `SUMPRODUCT` used instead. They have not been executed, because LibreOffice
cannot load xlsx files in the build container. `spreadsheet/verify_template.py`
checks the column references, function compatibility and summary logic instead,
and `spreadsheet/README.md` gives the exact figures to expect from the sample so
one glance confirms the tab works.

**Later, if wanted:** direct Sheets sync is already coded in both apps. It needs a
Google Cloud project with the Sheets API and an OAuth client (about 10 minutes,
steps in `TreadScanner/README.md` §3). Then rows append themselves when the
phone has signal, and offline inspections queue.

## 5. Axle presets and positions

| Preset | Positions |
|---|---|
| Straight truck, 2 axle | LF RF · LRO LRI RRO RRI (6) |
| Tractor, 3 axle | LF RF · L2O L2I R2O R2I · LRO LRI RRO RRI (10) |
| Tandem trailer | LFO LFI RFO RFI · LRO LRI RRO RRI (8) |
| Tri-axle trailer | 12 |
| Custom | any axle count, single or dual per axle |

Codes follow TMC convention: side, axle (F, number, R), O/I for duals. Inner
duals default to gauge entry; a phone cannot see them.

## 6. The LiDAR scanner, and how it gets trusted

**Measurement method.** Depth is measured relative to the tread surface, not
absolutely, which cancels most of the LiDAR's error. Per frame: high-confidence
depth points in the centre region → 3×3 smoothing → RANSAC plane through the
tread blocks (±0.6 mm band, so a 2/32 groove cannot swallow the plane) → a
least-squares quadratic surface, because a 0.5 m truck tire sags 0.9 mm across
the patch → groove floors found as the densest cluster below that surface.
About 45 frames are averaged while the overlay gates on distance (12–30 cm),
tilt (<10°) and stillness. Result: depth plus a ± band; over ±1.5/32 is shown
amber and asks for a rescan or a gauge.

**Synthetic results so far** (curved tire, per-point noise 0.5–1.2 mm): 2/32
reads 1.87, 3/32 reads 2.84, 5/32 reads 5.01, 8/32 reads 8.03. Real tires will
be worse; that is what the program below is for.

**Borrowed from open source**

| Idea | Source | Used for |
|---|---|---|
| Keep 32-bit depth + confidence, never a lossy picture | ioridev/LiDAR-Depth-Map-Capture-for-iOS | Raw capture mode, `.treadcap` files |
| Unproject depth pixels with intrinsics scaled to the depth map | Apple WWDC20 sample; Waley-Z, isakdiaz point-cloud repos | `LiDARSession.extract`, mirrored in treadlab |
| Fit geometry to the cloud, not just a plane | CurvSurf FindSurface demos | Quadratic tread surface |
| Analyse on a computer, iterate fast | kentaroy47/apple-lidar-stream; KalTire tread notebook | `tools/treadlab` measure / report / sweep |
| Apple's temporally filtered depth | Common to the LiDAR streaming repos | `smoothedSceneDepth` |

**Accuracy program (first two weeks with the TestFlight build)**

1. 20+ grooves across steer, drive and trailer tires, new to worn, some dirty.
   For each: menu → Record raw LiDAR capture, type the dial-gauge reading,
   record 60 frames at 15–25 cm.
2. Share the files to a computer. `python3 tools/treadlab/treadlab.py sweep *.treadcap`
   tries every combination of region size, smoothing, inlier band and surface
   model and prints the best.
3. Copy the winners into `TreadDepthEstimator.swift` / `LiDARSession.swift`.
   CI rebuilds, TestFlight ships it.
4. Verify mode in the app on another 20 grooves. **Pass:** 90% within ±1/32
   and zero pass/fail disagreements at 4/32 and 2/32.
5. Fails after two rounds → the app is still a fast gauge-and-spreadsheet tool,
   and a vendor scan SDK (Anyline or similar, paid) slots in behind the same
   `DepthProvider` interface. Nothing else changes.

## 7. Timeline

| When | What | Who |
|---|---|---|
| Now | Use the web app in the shop. Add to home screen, gauge readings, customer report, CSV into the workbook | Shop |
| Day 0–2 | Enrol in Apple Developer Program ($130 CAD/yr). Approval 1–2 days | You |
| Day 2 | Create App Store Connect API key, private certs repo, add 7 GitHub secrets (README §2, 30 min) | You |
| Day 2 | Run the TestFlight workflow. Install on an iPhone 12 Pro or newer. I fix anything the first signed build trips on | You + me |
| Week 1–2 | Accuracy program above: 20 raw captures, sweep, ship tuned parameters, 20 verify pairs | Shop + me |
| Week 2 | Decision: LiDAR passes, or gauge path, or vendor SDK trial | You |
| Week 3–4 | Field pilot with 2–3 fleet customers. Fix what breaks. Optional: Sheets direct sync, PDF customer report, per-truck history tab | Shop + me |
| Later | Android (gauge path only, no depth sensor), multi-technician accounts, CVSA/NSC-ready records | as needed |

## 8. Your to-do list

The items only you can do, in order:

1. Open https://scotia-tread-scanner.netlify.app on the iPhone, Share → Add to
   Home Screen. Run one real inspection and import the CSV into a Google Sheet.
2. Revoke the Netlify token pasted in chat and make a new one if needed.
3. Enrol at developer.apple.com/programs/enroll.
4. Once approved: App Store Connect API key (Admin role), Team ID, private
   GitHub repo `scotia-ios-certs`, fine-grained token, then the secrets table in
   `TreadScanner/README.md` §2d.
5. Actions → iOS TestFlight → Run workflow. Add yourself as an internal tester.
   Install TestFlight on the phone.
6. Tell me when the build is on the phone. Then start recording raw captures.

## 9. Costs

| Item | Cost |
|---|---|
| Apple Developer Program | ~$130 CAD / year |
| GitHub Actions macOS builds | free (public repo) |
| Netlify hosting for the web app | free tier |
| Google Sheets / Cloud project | free |
| Dial tread depth gauge (calibration reference) | $20–60 |
| Vendor scan SDK, only if LiDAR fails | quote required; the one real variable |

## 10. Risks

- **Scan accuracy.** Handled by the confidence band, gauge override, and the
  accuracy program. Worst case is a very good gauge-plus-spreadsheet app.
- **Dirt, water, sun.** Camera methods struggle. The overlay refuses bad
  captures rather than guessing; the quality gate is in the scan screen.
- **Inner duals.** Unreachable by phone. Gauge entry stays the path.
- **Regulatory use.** If readings feed CVSA/NSC records, keep the photo and
  `method` on every row. Already done.
- **Public repo.** Fine for the code. Certificates go in a private repo;
  secrets never in git. The Netlify token from chat must be revoked.
