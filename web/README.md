# Tread Scanner – web stopgap

Live at **https://scotia-tread-scanner.netlify.app**

Use it on the iPhone today while the native app waits on the Apple Developer
enrolment: open the link in Safari, tap Share, then **Add to Home Screen**.
It then opens full screen, works offline, and keeps its data on the phone.

What it does: same inspection flow, axle presets, TMC position codes,
thresholds, photos, and 25-column spreadsheet layout as the iOS app.
Tread depth is typed from a gauge. Export a CSV from the inspection menu
(share sheet or download), or connect Google Sheets in Settings.

What it cannot do: LiDAR scanning. Safari has no access to the depth sensor.
That stays with the native app in `../TreadScanner`.

## Google Sheets from the web app

1. Google Cloud console → APIs & Services → Library → enable Google Sheets API.
2. Credentials → Create credentials → OAuth client ID → **Web application**.
   Authorized JavaScript origin: `https://scotia-tread-scanner.netlify.app`.
3. Paste the client ID and the spreadsheet ID into Settings in the app and
   tap Connect Google. Finished inspections then append rows; offline ones
   queue and sync when back online.

## Deploying changes

Plain static files, no build step.

Deploys are **automatic**: every push to any branch that touches `web/**`
runs `.github/workflows/web-deploy.yml`, which zips this folder and posts it
to the Netlify site. You can also start one by hand from the Actions tab
(Web Deploy → Run workflow). The run log and job summary print the resulting
deploy state and URL.

One secret is required: **`NETLIFY_AUTH_TOKEN`** (a Netlify personal access
token), set at the repository's Settings > Secrets and variables > Actions.
Without it the workflow fails immediately with a message saying so.

The manual path still works for a one-off deploy from your machine:
`NETLIFY_AUTH_TOKEN=... ./deploy.sh`. The token is never stored in the repo.
