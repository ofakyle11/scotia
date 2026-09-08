# Truck Tread Depth Scanner – Build Plan

Goal: a technician walks around a commercial truck or trailer with an iPhone,
points it at each tire, and the app records tread depth in 32nds of an inch
per tire position, then pushes the whole inspection into a spreadsheet.

---

## 1. The hard truth about iPhone LiDAR first

The "telemeter" on iPhone Pro models is the LiDAR scanner, exposed through
ARKit's scene depth API. It matters for the plan because it sets what is
realistically achievable:

| Measurement | Size |
|---|---|
| 1/32" (our unit of precision) | 0.79 mm |
| Steer tire legal minimum (Canada NSC / DOT) | 4/32" = 3.2 mm |
| Drive/trailer legal minimum | 2/32" = 1.6 mm |
| ARKit LiDAR depth map resolution | 256 x 192 points |
| ARKit LiDAR depth noise at 0.3-1 m | roughly 5-10 mm per point |

Raw LiDAR depth is 5 to 10 times too coarse to read a groove to 1/32".
Pointing the Measure app at a tire will not give a usable tread reading.

What does work on a phone camera:

1. **Photogrammetry / computer vision from the RGB camera.** Several vendors
   (Anyline Tire Tread SDK, for example) sell an SDK that reads tread depth
   from a short video sweep of the tire and claim about ±1/32" accuracy.
   This is the proven "scan with a phone" route, but it is a paid license.
2. **LiDAR plus heavy averaging at very close range.** Averaging hundreds of
   depth frames across a groove can get to 1-2 mm precision in good
   conditions. Good enough for pass/fail flags, marginal for exact 32nds.
   Needs a validation study before we trust it.
3. **Bluetooth digital tread depth gauge.** A BLE gauge in the groove is
   accurate to 0.1 mm and costs under $200. The phone handles vehicle,
   position, photos, thresholds and the spreadsheet. Slower than a scan,
   but correct on day one.

Recommendation: build the app so the reading source is pluggable. Ship with
manual and BLE gauge entry first, run a short accuracy study on LiDAR and a
vendor SDK trial in parallel, then pick the scan engine with real data
instead of guessing.

---

## 2. What the app does (scope)

**Inspection flow**

1. Start inspection: pick or create a customer/fleet, enter unit number,
   plate, VIN (barcode/OCR scan of the door sticker), odometer, technician.
2. Pick axle configuration (presets below). App draws the truck top-down
   and lights up the next tire position.
3. For each tire: capture depth (scan, gauge, or manual), take a photo,
   optional pressure, DOT code, brand/model/size, notes.
4. App flags any tire under threshold (configurable: 4/32 steer, 2/32
   others by default, plus a "recommend replacement soon" band).
5. Finish: review sheet, sign-off, export.

**Axle presets** (each position is a row in the spreadsheet)

| Preset | Positions |
|---|---|
| Straight truck 2-axle | LF, RF, LRO, LRI, RRO, RRI (6) |
| Tractor 3-axle | LF, RF, LFO, LFI, RFO, RFI, LRO, LRI, RRO, RRI (10) |
| Tandem trailer | LFO, LFI, RFO, RFI, LRO, LRI, RRO, RRI (8) |
| Tri-axle trailer | 12 |
| Custom | technician adds axles, single or dual |

Position codes follow TMC (Technology & Maintenance Council) convention:
side (L/R), axle (F/R or numbered), and O/I for outer/inner duals.

**Per tire, record three groove readings** (inner, centre, outer) and store
the minimum as the reported depth. Uneven wear across grooves is itself a
finding (alignment or inflation problem), which ties back to the alignment
side of the business.

**Export targets**

- CSV and XLSX via the iOS share sheet (email, AirDrop, Files) – phase 1.
- Google Sheets append via Sheets API, or Excel Online via Microsoft Graph,
  one row per tire plus an inspection summary row – phase 2.
- PDF customer report with photos and flagged tires – phase 2.

**Spreadsheet columns**

```
inspection_id, date, technician, customer, unit_number, plate, vin, odometer,
axle_config, position, brand, model, size, dot_code,
depth_inner_32nds, depth_centre_32nds, depth_outer_32nds, depth_min_32nds,
depth_min_mm, pressure_psi, status (OK / WATCH / REPLACE), method
(scan / gauge / manual), photo_url, notes
```

---

## 3. Technical approach

**Platform:** native iOS, Swift + SwiftUI. LiDAR depth, ARKit, and the
Vision framework are only fully available natively. React Native or
Flutter would need a native module for every interesting part, so they buy
nothing here. Android can follow later if fleet customers demand it, but
Android phones mostly lack a depth sensor, which pushes Android toward the
camera-only or BLE gauge path anyway.

**Minimum device:** iPhone 12 Pro or newer (LiDAR). Non-Pro iPhones still
run the app with gauge/manual entry.

**Architecture**

```
SwiftUI views
  └─ Inspection view model
       ├─ DepthProvider (protocol)
       │    ├─ ManualDepthProvider
       │    ├─ BLEGaugeDepthProvider   (CoreBluetooth)
       │    ├─ LiDARDepthProvider      (ARKit sceneDepth + averaging)
       │    └─ VendorSDKDepthProvider  (Anyline or similar, if licensed)
       ├─ Local store (SwiftData / SQLite), offline first
       └─ Exporters: CSV, XLSX, Google Sheets, Graph, PDF
```

Offline first matters: shops and yards have poor signal. Everything saves
locally and syncs when connected.

**LiDAR measurement approach (for the accuracy study)**

1. Technician holds phone 15-25 cm from the tread, roughly perpendicular,
   with a live overlay showing target distance and tilt.
2. Capture 2-3 seconds of ARKit depth frames plus confidence maps.
3. Use the RGB frame and Vision to segment tread blocks vs grooves.
4. Fit a plane (or cylinder, using the known tire radius) to the tread
   block surface. Depth = distance from groove-floor points to that
   surface, averaged over many frames and points, keep only high-confidence
   pixels.
5. Convert mm to 32nds, report the value with a confidence band.

Fitting a surface to the tread blocks and measuring relative to it cancels
most of the absolute LiDAR error, which is the reason this might reach
~1 mm even though single points are noisier.

**Accuracy study protocol**

- 20+ tires across steer, drive, and trailer, new to worn.
- Ground truth: calibrated dial gauge, three grooves each.
- Compare LiDAR method, vendor SDK trial, and phone-camera-only approach.
- Pass criteria: 90% of readings within ±1/32" of gauge, and zero
  pass/fail misclassifications at the 4/32 and 2/32 thresholds.

---

## 4. Phases and rough effort

| Phase | Deliverable | Effort |
|---|---|---|
| 0. Decide | Confirm scope above, pick Apple developer account, order a BLE gauge and request vendor SDK trial | 1 week |
| 1. Core app | Inspection flow, axle presets, manual entry, thresholds, photos, local storage, CSV/XLSX share | 4-5 weeks |
| 2. BLE gauge | Pair a Bluetooth tread gauge, readings drop straight into the active position | 1-2 weeks |
| 3. LiDAR study | Prototype the depth provider, run the accuracy protocol, write up results | 3-4 weeks (parallel with 1-2) |
| 4. Scan engine | Ship LiDAR provider if it passed, or integrate vendor SDK, or stay gauge-based | 2-6 weeks depending on outcome |
| 5. Cloud sync | Google Sheets / Excel Online append, PDF report, multi-tech accounts | 3-4 weeks |
| 6. Field pilot | Two or three fleet customers, fix what breaks, App Store or TestFlight release | 4 weeks |

A usable app that records to a spreadsheet exists at the end of phase 1.
The scanner question is answered with data by the end of phase 3.

---

## 5. Costs and dependencies

- Apple Developer Program: about $130 CAD/year.
- iPhone 12 Pro or newer for development and testing.
- BLE digital tread depth gauge: $100-200.
- Vendor scan SDK (if chosen): typically per-scan or per-device licensing,
  quote required. Budget this as the main variable cost.
- Google Cloud or Microsoft 365 credentials for the sheet sync.

---

## 6. Risks

- **Scan accuracy.** Covered by the pluggable provider and the study. Worst
  case the product is a very good gauge-plus-spreadsheet app.
- **Lighting and dirt.** Camera-based methods struggle with mud, water,
  and direct sun. The overlay must guide the technician and refuse bad
  captures rather than guess.
- **Dual inner tires.** Hard to reach with a phone. Gauge or manual entry
  stays as the fallback for inner duals.
- **Regulatory use.** If readings feed CVSA/NSC inspection records, the
  method needs to be defensible. Keep the raw photo and the method column
  on every reading.

---

## 7. Status and next steps

**Scope decision (Sept 2026):** LiDAR scanning and Google Sheets sync were
pulled into v1 instead of waiting for the accuracy study. The app is built in
`TreadScanner/` (Swift/SwiftUI, XcodeGen project). See `TreadScanner/README.md`
for Mac setup, Google Cloud setup, and the verification checklist.

What is built:

- Inspection flow, all axle presets plus custom, manual entry, thresholds,
  photos, local SwiftData store, CSV share.
- LiDAR depth provider: plane-fit relative measurement, 5x5 depth smoothing,
  multi-frame averaging, ± band on every scan, distance/tilt/motion gating.
- Google Sheets append with OAuth PKCE, offline queue, header auto-creation.
- Verify mode that logs scan vs gauge pairs to a `Verify` tab (the accuracy
  study from section 3, now built into the app).

**Interim web version:** https://scotia-tread-scanner.netlify.app (add to
home screen). Gauge entry, photos, CSV, optional Google Sheets. No LiDAR;
Safari cannot reach the sensor. Source in `web/`.

Next steps:

1. No Mac needed. GitHub Actions builds and tests on every push, and the
   "iOS TestFlight" workflow signs and uploads the app so it installs on the
   iPhone through TestFlight. Setup (Apple Developer enrolment, API key,
   repo secrets) is in `TreadScanner/README.md` section 2.
2. Google Cloud console: enable Sheets API, create the iOS OAuth client, add
   the client ID and spreadsheet ID as repo secrets.
3. Run Verify mode on 20+ grooves in the shop during week one. Tune the
   estimator knobs in `TreadDepthEstimator.swift` against that data.
4. Decide on the scan engine with the Verify numbers: keep LiDAR, add a
   vendor SDK behind the same `DepthProvider` interface, or lean on the
   gauge path. The rest of the app does not change either way.
