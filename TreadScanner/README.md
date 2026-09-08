# Tread Scanner (iOS)

Walk around a truck, point an iPhone Pro at each tire, and the tread depth in
32nds lands in a Google Sheet. Native Swift/SwiftUI, iOS 17+, no third-party
packages.

Read `../TREAD_SCANNER_PLAN.md` for the background and the accuracy caveats.
Short version: iPhone LiDAR has never been proven to read tread to 1/32", so
this app measures groove depth *relative to the tread surface*, averages many
frames, shows a ± band on every scan, and ships a **Verify** mode that logs
scan-vs-gauge pairs so you find out quickly how well it tracks a real gauge.
Every scanned number can be overridden by hand.

## What is in the app

- Inspections: customer, unit, plate, VIN, odometer, technician, axle preset.
- Axle presets: 2-axle truck, 3-axle tractor, tandem and tri-axle trailer,
  custom. TMC position codes (LF, RF, L2O, L2I, LRO, LRI ...).
- Per tire: inner / centre / outer groove in 32nds, minimum reported, status
  OK / WATCH / REPLACE (defaults 4/32 steer, 2/32 others, editable), photo,
  pressure, DOT, brand/model/size, notes. Uneven-wear warning when grooves
  differ by 3/32 or more.
- LiDAR scan with distance / tilt / hold-still gating and a progress ring.
  Inner duals default to manual entry.
- Google Sheets sync, offline-first: rows queue on the phone and append to the
  `Inspections` tab when online. Header row is created automatically.
- CSV share (email, AirDrop, Files) as the no-network fallback.
- Verify mode: scan then enter gauge value; pairs go to a `Verify` tab with
  bias / RMSE / % within ±1/32 shown live.

## Requirements

- Mac with Xcode 15 or newer and [XcodeGen](https://github.com/yonaskolb/XcodeGen).
- Apple Developer account (free account is enough to run on your own phone).
- iPhone 12 Pro or newer for scanning. Any iPhone on iOS 17 runs the app with
  manual entry.
- A Google account and a Google Sheet to receive the rows.

## 1. Generate and open the project

```bash
brew install xcodegen
cd TreadScanner
cp TreadScanner/App/Config.example.plist TreadScanner/App/Config.plist
xcodegen generate
open TreadScanner.xcodeproj
```

In Xcode: select the `TreadScanner` target, Signing & Capabilities, pick your
Team. Plug in the iPhone, choose it as the run destination, press Run. The
first run asks you to trust the developer certificate on the phone
(Settings > General > VPN & Device Management).

## 2. Google Sheets setup (one time, about 10 minutes)

1. Go to https://console.cloud.google.com and create a project, e.g.
   "Tread Scanner".
2. APIs & Services > Library: enable **Google Sheets API**.
3. APIs & Services > OAuth consent screen: External, fill in the app name and
   your email. Add scopes `.../auth/spreadsheets` and
   `.../auth/userinfo.email`. Add the technicians' Google accounts as test
   users (or publish the app later).
4. APIs & Services > Credentials > Create credentials > OAuth client ID.
   Application type **iOS**. Bundle ID `ca.scotiatire.treadscanner`.
   Copy the client ID; it looks like
   `1234567890-abcdefg.apps.googleusercontent.com`.
5. Put it in `TreadScanner/App/Config.plist` under `GoogleClientID`.
6. In `project.yml`, set `GOOGLE_REVERSED_CLIENT_ID` to the reversed form:
   `com.googleusercontent.apps.1234567890-abcdefg`. Run `xcodegen generate`
   again. (This is the URL scheme Google redirects back to after sign-in.)
7. Create a Google Sheet. Copy the ID from its URL
   (`docs.google.com/spreadsheets/d/<ID>/edit`) into `SpreadsheetID` in
   `Config.plist`, or type it into Settings inside the app.
8. In the app: menu > Settings > Sign in with Google.

No client secret is used. The app uses OAuth PKCE, and tokens are stored in
the iOS Keychain.

## 3. Using it in the shop

1. Tap **+**, enter the customer and unit, pick the axle preset, Start.
2. The app opens the first tire (LF). Tap the scope icon beside a groove,
   hold the phone 12-30 cm from the tread, flat to the tire. When the frame
   turns green, hold still. The ring fills in about 2-3 seconds. Accept.
   The scan moves to the next groove automatically.
3. Inner duals: read a gauge and type the number.
4. Save & next walks you around the truck. The diagram colours each tire.
5. When every position is filled, tap **Finish & send to spreadsheet**.
   Rows append when the phone has signal. Or share a CSV from the menu.

## 4. Verify the scanner (do this first week)

Menu > **Verify scanner vs gauge**. For 20+ grooves across steer, drive and
trailer tires, new to worn: scan, then type the dial-gauge reading. The
screen shows bias, RMSE and % within ±1/32. Rows also land on the `Verify`
tab. Pass criteria from the plan: 90% within ±1/32, zero pass/fail
disagreements at 4/32 and 2/32. If it fails, the app is still a fast
gauge-plus-spreadsheet tool while the scan engine is tuned (see
`Depth/LiDAR/TreadDepthEstimator.swift`; the knobs are at the top).

## 5. Verification checklist for a build

- [ ] `xcodegen generate` succeeds, project builds for device with no errors.
- [ ] Product > Test: all tests in `TreadScannerTests` pass (estimator recovers
      a synthetic 5.0 mm groove, 32nds round-trip, presets, CSV columns).
- [ ] New inspection, 3-axle tractor: 10 positions, LF opens first.
- [ ] Scan gates on distance and tilt (hints change as you move the phone).
- [ ] Accepting a scan fills the groove, method shows Scan with a ± value.
- [ ] Finish: inspection shows the orange sync icon, then green once online;
      10 rows appear in the sheet with the header row on first sync.
- [ ] Airplane mode: finish shows pending; disable airplane mode, rows sync.
- [ ] Share CSV opens the share sheet with a 7-line file for a 2-axle truck.
- [ ] Non-Pro iPhone or simulator: scope buttons hidden, manual entry works.

## Layout

```
TreadScanner/
  project.yml                  XcodeGen spec
  TreadScanner/
    App/                       entry point, Config.plist loader
    Models/                    SwiftData models, axle presets, thresholds
    Depth/                     DepthProvider protocol, manual + LiDAR providers
    Depth/LiDAR/               ARKit session, point-cloud extraction, estimator
    Export/                    spreadsheet columns, CSV
    Export/GoogleSheets/       OAuth PKCE, Sheets API, offline sync queue
    Views/                     SwiftUI screens
    Support/                   units, keychain, photo storage
  TreadScannerTests/           XCTest unit tests
```
