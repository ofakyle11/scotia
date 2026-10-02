# Getting the scanner onto your iPhone from a Windows PC

This installs the real app, with LiDAR tread scanning, using a **free Apple ID**.
No Apple Developer Program, no $130.

The catch: Apple stops a free-signed app from opening after **7 days**. Renewing
takes about two minutes with the phone plugged in. If that becomes annoying, the
$130/year enrolment removes it and switches you to TestFlight, where builds last
90 days and install over the air.

**You need:** a Windows PC, the USB cable, an iPhone 12 Pro or newer (the LiDAR
scanner only exists on Pro models), and an Apple ID.

**Which Apple ID.** Use the one you would later enrol in the Developer Program
with. Signing claims the app's bundle id `ca.scotiatire.treadscanner` for that
Apple ID's free "personal team", and Apple will not let a *different* team
register the same id afterwards (the paid TestFlight build would then fail at
"An App ID with Identifier ... is not available").

**Free Apple ID limits (Apple's, not ours):** apps stop opening after 7 days;
at most 3 sideloaded apps on the phone at once; at most 10 new App IDs per 7
days. Leave Sideloadly's "Change Bundle ID" option off: each change burns one
of the 10 and loses the inspections stored on the phone.

---

## 1. Get the app file

1. Open https://github.com/ofakyle11/scotia/actions/workflows/ios-unsigned-ipa.yml
2. Click the newest run at the top. Wait for the green tick if it is still going.
3. Scroll to **Artifacts** at the bottom and click **TreadScanner-unsigned-ipa**.
   A zip downloads.
4. Unzip it. Inside is `TreadScanner-unsigned-b<build>-<commit>.ipa`. That is the
   app. The build number and commit in the name are also shown in the app under
   Settings → Scanner → Build, and written into every raw capture, so a reading
   can always be tied to the exact build that produced it.

## 2. Install Sideloadly (once)

1. Go to https://sideloadly.io and download the Windows version.
2. Sideloadly needs the **web version of iTunes**, not the Microsoft Store one.
   If iTunes or "Apple Devices" was installed from the Microsoft Store,
   uninstall it first (Settings → Apps). The Sideloadly page links the right
   iTunes download; install that.
3. Run the Sideloadly installer. Restart the PC if it asks.

## 3. Put it on the phone

1. Plug the iPhone into the PC. On the phone, tap **Trust** and enter your passcode.
2. Open Sideloadly.
3. Drag the `TreadScanner-unsigned-b<build>-<commit>.ipa` file onto the Sideloadly window.
4. In **Apple ID**, type your Apple ID email. Click **Start**.
5. Enter your Apple ID password when asked. It goes to Apple, not to us.
   - With two-factor authentication, Sideloadly then asks for the 6-digit code
     that appears on the iPhone. Type it in. **Do not use an app-specific
     password**: Sideloadly only accepts those with a paid developer account.
6. Wait for **Done**.

## 4. Turn on Developer Mode, then trust it on the phone

iOS 16 and later refuse to run a sideloaded app until Developer Mode is on.
The switch only appears after the first app has been installed.

1. On the iPhone: **Settings → Privacy & Security**, scroll to the bottom,
   **Developer Mode** → on. The phone asks to **restart**; let it. After the
   restart it asks once more to turn Developer Mode on; confirm.
2. **Settings → General → VPN & Device Management**. Tap your Apple ID under
   *Developer App*, then **Trust**.
3. Open **Tread Scanner** from the home screen. Settings → Scanner → Build
   should show the build number from the file you installed.

## 5. Check the scanner actually works

1. Tap **+**, enter any unit number, pick **Tractor (3 axle)**, tap **Start**.
2. On the LF tire, tap the **scope icon** beside the Centre groove.
3. Allow camera access.
4. Hold the phone 12 to 30 cm from the tread, flat to the tire. The frame turns
   green when distance, tilt and steadiness are all acceptable. Hold still.
5. The ring fills in 2 to 3 seconds and shows a depth with a ± band.

**If the scope icon is missing**, the phone has no LiDAR. It is on iPhone 12 Pro,
13 Pro, 14 Pro, 15 Pro, 16 Pro and the Max versions of those. Plain and Plus
models have no depth sensor, and the app correctly hides scanning on them.

## 6. Renewing every 7 days

Plug the phone in, open Sideloadly, drag the same file on, click Start. Your
inspections stay on the phone; only the signature expires.

AltStore (https://altstore.io) can do this refresh over Wi-Fi automatically while
the PC is on the same network, if you would rather not plug in weekly.

---

## Read the tread before you trust it

The scanner has never been tested against a real tire. Everything measured so far
was synthetic. Before it goes near a customer's invoice, use
**menu → Record raw LiDAR capture**: type the dial-gauge reading, then record the
groove while sweeping the phone slowly from about 10 cm out to 30 cm.

Every frame is saved with the distance and angle it was taken at, whether or not
the on-screen frame was green. That matters: the green limits are my estimates,
not measurements. If iPhone LiDAR turns out to need 20 cm rather than the 12 cm
I assumed, the recording still captures it and the analysis says so.

Each capture is about 45 MB, so email will not carry it. Two ways to the PC:

- **Cable:** plug in, open the **Apple Devices** app (or iTunes) on the PC,
  pick the phone, **Files** tab, **Tread Scanner**, drag the `Captures` folder
  to the desktop.
- **No cable:** on the phone, open **Files → On My iPhone → Tread Scanner →
  Captures** and share the file to Google Drive or OneDrive.

Then run:

```bash
python3 tools/treadlab/treadlab.py info capture.treadcap   # confirms which app build recorded it
python3 tools/treadlab/treadlab.py pose capture.treadcap
```

It prints measured depth against the gauge for each 2 cm band of distance, and
names the band that read closest. That sets the scanner's real working range from
evidence. Do this before trusting a single reading on a customer's invoice.
