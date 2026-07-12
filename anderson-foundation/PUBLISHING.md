# Publishing this site to GitHub Pages (no coding needed)

*Follow this once and the site is live, free, at
`https://ofakyle11.github.io/AndersonFoundation/`.*

## Step 1 — Put the files in the repository

**If Claude (or another tool) already pushed the files, skip to Step 2.**

Uploading by hand:

1. Unzip the site zip on your computer.
2. Open `github.com/ofakyle11/AndersonFoundation` in your browser.
3. Click **Add file → Upload files** (on a brand-new empty repo, click the
   **"uploading an existing file"** link instead).
4. Drag **everything inside the unzipped folder** (not the folder itself) into
   the upload area. Folders like `css`, `js`, `data`, and `assets` drag in fine.
5. Write a commit message like `Add foundation website` and click
   **Commit changes**.

> **Two files the uploader may skip** (their names start with a dot, so some
> computers hide them): `.nojekyll` and the `.github` folder. The site works
> without them — `.nojekyll` is a minor speed-up, and `.github` only powers the
> email-you-when-the-data-file-breaks safety net. To add that safety net later:
> **Add file → Create new file**, type
> `.github/workflows/validate-data.yml` as the name, and paste in the contents
> of that file from the zip.

## Step 2 — Turn on the website (one time)

1. In the repository, open **Settings** (top tab) → **Pages** (left sidebar).
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Branch: **main**, folder: **/ (root)** → **Save**.
4. Wait 1–2 minutes, refresh the Pages settings page, and your live link
   appears at the top: `https://ofakyle11.github.io/AndersonFoundation/`.

## Step 3 — Check it works

- Open the live link — the homepage should show the green "No one should face
  cancer alone" hero.
- Open **Tough Mudder** in the menu — the dashboard should count up the team
  total and show the runner cards.
- On your phone too, if you like.

## Afterwards

- **Updating donations/runners:** see [UPDATING.md](UPDATING.md) — one small
  file, edited right on GitHub, ~1 minute per donation.
- **Linking from your Wix site:** add a menu item or button on
  angusandersonfoundation.org pointing to
  `https://ofakyle11.github.io/AndersonFoundation/tough-mudder.html`
  (label it "Tough Mudder 2026" or "Team Dashboard").
- **Replacing the Wix site entirely** with this one on your own domain:
  see the "Custom-domain cutover" section in [README.md](README.md).
