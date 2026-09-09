# Getting the scanner onto your iPhone from a Windows PC

This installs the real app, with LiDAR tread scanning, using a **free Apple ID**.
No Apple Developer Program, no $130.

The catch: Apple stops a free-signed app from opening after **7 days**. Renewing
takes about two minutes with the phone plugged in. If that becomes annoying, the
$130/year enrolment removes it and switches you to TestFlight, where builds last
90 days and install over the air.

**You need:** a Windows PC, the USB cable, an iPhone 12 Pro or newer (the LiDAR
scanner only exists on Pro models), and any Apple ID.

---

## 1. Get the app file

1. Open https://github.com/ofakyle11/scotia/actions/workflows/ios-unsigned-ipa.yml
2. Click the newest run at the top. Wait for the green tick if it is still going.
3. Scroll to **Artifacts** at the bottom and click **TreadScanner-unsigned-ipa**.
   A zip downloads.
4. Unzip it. Inside is `TreadScanner-unsigned.ipa`. That is the app.

## 2. Install Sideloadly (once)

1. Go to https://sideloadly.io and download the Windows version.
2. Run the installer. It installs Apple's iTunes drivers if you do not have them.
   Say yes.
3. Restart the PC if it asks.

## 3. Put it on the phone

1. Plug the iPhone into the PC. On the phone, tap **Trust** and enter your passcode.
2. Open Sideloadly.
3. Drag `TreadScanner-unsigned.ipa` onto the Sideloadly window.
4. In **Apple ID**, type your Apple ID email. Click **Start**.
5. Enter your Apple ID password when asked. It goes to Apple, not to us.
   - If you use two-factor authentication, Apple may reject the normal password.
     Create an app-specific password at https://account.apple.com under Sign-In
     and Security, and paste that instead.
6. Wait for **Done**.

## 4. Trust it on the phone

iOS will not open an app from an unknown developer until you say so.

1. On the iPhone: **Settings → General → VPN & Device Management**.
2. Tap your Apple ID under *Developer App*, then **Trust**.
3. Open **Tread Scanner** from the home screen.

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

Share the file to the PC and run:

```bash
python3 tools/treadlab/treadlab.py pose capture.treadcap
```

It prints measured depth against the gauge for each 2 cm band of distance, and
names the band that read closest. That sets the scanner's real working range from
evidence. Do this before trusting a single reading on a customer's invoice.
