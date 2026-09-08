# Tread Scanner (iOS)

Walk around a truck, point an iPhone Pro at each tire, and the tread depth in
32nds lands in a Google Sheet. Native Swift/SwiftUI, iOS 17+, no third-party
packages.

**You do not need a Mac.** GitHub builds the app on Apple hardware in the
cloud and uploads it to TestFlight. You install it on the iPhone from the
TestFlight app. Section 2 walks through the one-time setup.

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

## 1. What you need

- An iPhone 12 Pro or newer for scanning (any iPhone on iOS 17 runs the app
  with manual entry). Install the free **TestFlight** app from the App Store.
- An **Apple Developer Program** membership, about $130 CAD / $99 USD per
  year: https://developer.apple.com/programs/enroll/. Enroll as an individual
  or as the business. Approval usually takes 1-2 days. This is required for
  any iPhone install that does not come from a Mac.
- This GitHub repo. Builds run on GitHub's free macOS runners.
- Optional: a Google account and a Google Sheet for the live spreadsheet
  (section 3).

## 2. One-time setup for cloud builds (about 30 minutes once Apple approves you)

### 2a. App Store Connect API key

1. Sign in at https://appstoreconnect.apple.com.
2. Users and Access → **Integrations** → App Store Connect API → **Team Keys**
   → **+**. Name: "GitHub Actions". Access: **Admin**. Generate.
3. Download the `.p8` file. Apple only lets you download it once; keep it.
4. Note the **Key ID** (next to the key) and the **Issuer ID** (top of page).

### 2b. Team ID

https://developer.apple.com/account → Membership details → **Team ID**
(10 characters, like `A1B2C3D4E5`).

### 2c. Private repo for signing certificates

The build needs a place to keep the Apple signing certificate. This repo is
public, so use a separate private one.

1. https://github.com/new → name `scotia-ios-certs`, **Private**, no
   README, Create.
2. https://github.com/settings/personal-access-tokens → **Generate new
   token** (fine-grained). Repository access: only `scotia-ios-certs`.
   Permissions: Contents → **Read and write**. Expiration: 1 year. Copy the
   token.
3. Build the authorization string. On any computer or phone with a terminal,
   or at https://www.base64encode.org, base64-encode
   `ofakyle11:<the token>` (your GitHub username, a colon, the token).

### 2d. Add the secrets to this repo

https://github.com/ofakyle11/scotia/settings/secrets/actions → **New
repository secret**, one per row:

| Name | Value |
|---|---|
| `ASC_KEY_ID` | Key ID from 2a |
| `ASC_ISSUER_ID` | Issuer ID from 2a |
| `ASC_KEY_P8` | The whole contents of the `.p8` file, including the BEGIN/END lines |
| `APPLE_TEAM_ID` | Team ID from 2b |
| `MATCH_GIT_URL` | `https://github.com/ofakyle11/scotia-ios-certs.git` |
| `MATCH_GIT_BASIC_AUTHORIZATION` | The base64 string from 2c |
| `MATCH_PASSWORD` | Any long passphrase you make up. It encrypts the certificates. Save it. |
| `GOOGLE_CLIENT_ID` | Optional, from section 3 |
| `SPREADSHEET_ID` | Optional, from section 3 |

### 2e. Build and install

1. https://github.com/ofakyle11/scotia/actions → **iOS TestFlight** → **Run
   workflow** → pick the branch → Run. About 15-20 minutes. The first run
   also creates the app record in App Store Connect and the signing
   certificate.
2. App Store Connect → Apps → **Scotia Tread Scanner** → **TestFlight**. The
   build shows "Processing" for about 10 minutes, then is ready.
3. Same page → Internal Testing → **+** → create a group "Shop" → add
   yourself (Users and Access must list you; the account holder already is).
   Add technicians the same way, up to 100 internal testers.
4. On the iPhone, open TestFlight. Accept the invite (email or the app), tap
   **Install**. Updates appear in TestFlight each time you run the workflow.

Every push that touches `TreadScanner/` also runs the **iOS CI** workflow,
which builds the app and runs the unit tests on a simulator. Green check =
safe to ship; no Apple account needed for that one.

## 3. Google Sheets setup (one time, about 10 minutes)

1. Go to https://console.cloud.google.com and create a project, e.g.
   "Tread Scanner".
2. APIs & Services → Library: enable **Google Sheets API**.
3. APIs & Services → OAuth consent screen: External, fill in the app name and
   your email. Add scopes `.../auth/spreadsheets` and
   `.../auth/userinfo.email`. Add the technicians' Google accounts as test
   users (or publish the app later).
4. APIs & Services → Credentials → Create credentials → OAuth client ID.
   Application type **iOS**. Bundle ID `ca.scotiatire.treadscanner`.
   Copy the client ID; it looks like
   `1234567890-abcdefg.apps.googleusercontent.com`.
5. Add it as the `GOOGLE_CLIENT_ID` secret (2d). The build derives the
   reversed form used for the sign-in redirect automatically.
6. Create a Google Sheet. Copy the ID from its URL
   (`docs.google.com/spreadsheets/d/<ID>/edit`) into the `SPREADSHEET_ID`
   secret, or type it into Settings inside the app.
7. Run the TestFlight workflow again, update the app, then in the app:
   menu → Settings → Sign in with Google.

No client secret is used. The app uses OAuth PKCE, and tokens are stored in
the iOS Keychain.

## 4. Using it in the shop

1. Tap **+**, enter the customer and unit, pick the axle preset, Start.
2. The app opens the first tire (LF). Tap the scope icon beside a groove,
   hold the phone 12-30 cm from the tread, flat to the tire. When the frame
   turns green, hold still. The ring fills in about 2-3 seconds. Accept.
   The scan moves to the next groove automatically.
3. Inner duals: read a gauge and type the number.
4. Save & next walks you around the truck. The diagram colours each tire.
5. When every position is filled, tap **Finish & send to spreadsheet**.
   Rows append when the phone has signal. Or share a CSV from the menu.

## 5. Verify the scanner (do this first week)

Menu → **Verify scanner vs gauge**. For 20+ grooves across steer, drive and
trailer tires, new to worn: scan, then type the dial-gauge reading. The
screen shows bias, RMSE and % within ±1/32. Rows also land on the `Verify`
tab. Pass criteria from the plan: 90% within ±1/32, zero pass/fail
disagreements at 4/32 and 2/32. If it fails, the app is still a fast
gauge-plus-spreadsheet tool while the scan engine is tuned (see
`Depth/LiDAR/TreadDepthEstimator.swift`; the knobs are at the top).

## 5b. Tune the scanner on real tires (raw captures)

Menu → **Record raw LiDAR capture**. Type the gauge reading, record 60 frames
of the groove, then share the `.treadcap` file to a computer (AirDrop, Files,
email). On the computer:

```bash
pip install numpy
python3 tools/treadlab/treadlab.py report *.treadcap    # scan vs gauge
python3 tools/treadlab/treadlab.py sweep  *.treadcap    # best ROI / smoothing / surface model
```

The tool runs the exact estimator the phone runs, so a parameter that wins
there wins in the app. See `tools/treadlab/README.md` and the plan document
section 6b.

## 6. Checklist after a build installs

- [ ] iOS CI workflow is green for the commit you shipped.
- [ ] New inspection, 3-axle tractor: 10 positions, LF opens first.
- [ ] Scan gates on distance and tilt (hints change as you move the phone).
- [ ] Accepting a scan fills the groove, method shows Scan with a ± value.
- [ ] Finish: inspection shows the orange sync icon, then green once online;
      10 rows appear in the sheet with the header row on first sync.
- [ ] Airplane mode: finish shows pending; disable airplane mode, rows sync.
- [ ] Share CSV opens the share sheet with a 7-line file for a 2-axle truck.
- [ ] Non-Pro iPhone: scope buttons hidden, manual entry works.

## 7. Building on a Mac instead (optional)

```bash
brew install xcodegen
cd TreadScanner
cp TreadScanner/App/Config.example.plist TreadScanner/App/Config.plist
export DEVELOPMENT_TEAM=YOURTEAMID
export GOOGLE_REVERSED_CLIENT_ID=com.googleusercontent.apps.YOUR-CLIENT-ID
xcodegen generate
open TreadScanner.xcodeproj
```

Select the target, Signing & Capabilities, your Team, plug in the iPhone,
Run. Product → Test runs the unit tests.

## Layout

```
.github/workflows/ios-ci.yml         build + test on a simulator, every push
.github/workflows/ios-testflight.yml sign + upload to TestFlight, on demand
TreadScanner/
  project.yml                  XcodeGen spec
  Gemfile, fastlane/           signing (match) and TestFlight upload lanes
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
