# How to update the Tough Mudder dashboard

*This guide is for foundation volunteers. No coding experience needed — every update
is done right on the GitHub website. The whole thing takes about a minute.*

Everything on the dashboard — the big total, each runner's total, and the donor
lists — comes from **one file**: [`data/tough-mudder.json`](data/tough-mudder.json).
Edit that file and the site updates itself. All totals are calculated automatically;
you never have to do math.

---

## The three golden rules

1. **Keep the double quotes.** Every name and value stays wrapped in straight quotes: `"Jane D."`
2. **Commas go BETWEEN entries** — and never after the last entry in a list.
3. **Don't paste from Word or Google Docs.** They replace straight quotes `"` with curly quotes `“` which breaks the file. Type directly into the GitHub editor.

If you break something anyway — don't panic. See [Fixing a mistake](#fixing-a-mistake) below. The live site never goes blank; worst case it shows "tracker being updated" until the fix.

---

## Adding a donation

1. Open the repository on GitHub and click into **`data`** → **`tough-mudder.json`**.
2. Click the **pencil icon** (✏️ "Edit this file") at the top right of the file view.
3. Press **Ctrl+F** (Cmd+F on Mac) and search for the runner's name.
4. Find their `"donations": [` list. Copy the top line — everything from `{` to `},` — and paste it directly **above** itself. New donations go at the **top** of the list.
5. Edit your pasted line: the donor's name, the amount (a plain number — no `$`), and today's date.

   ```json
   { "donor": "Jane D.", "amount": 50, "message": "Go get 'em!", "date": "2026-07-12" },
   ```

   - `"message"` and `"date"` are optional — you can delete those parts.
   - Amount only, no dollar sign: `50` not `$50`.
6. Scroll up and update the `"updated"` date near the top of the file.
7. Click **Commit changes…** (green button). Write a short note like
   `Add $50 donation from Jane to Angus`, keep **"Commit directly to the main branch"** selected, and confirm.
8. **Wait up to 10 minutes** — the website's cache takes a few minutes to refresh — then reload the dashboard. Your donation will be there and all totals will have updated automatically.

### Donations not tied to a runner (e-transfers, cash, cheques)

Find `"generalDonations"` near the top of the file and increase the number by the
donation amount. It gets added to the team total automatically.

---

## Donor privacy — please read

Donor names and amounts on the dashboard are public to anyone on the internet.

- **Only list a donor's name if they've agreed to it.** When in doubt, ask.
- Default to **first name + last initial**: `"Jane D."`, not full names.
- Donor prefers no name? Use `"donor": "Anonymous"`.
- Donor is fine with their name but not the amount? Add `"hideAmount": true` to
  their entry — the amount still counts toward totals but shows as ♥.

  ```json
  { "donor": "Mike R.", "amount": 25, "hideAmount": true },
  ```

---

## Adding a runner

1. Edit `data/tough-mudder.json` the same way (pencil icon).
2. Copy this template and paste it at the **top** of the `"runners": [` list:

   ```json
   {
     "id": "firstname-lastname",
     "name": "Firstname Lastname",
     "photo": "assets/runners/firstname-lastname.jpg",
     "bio": "One or two friendly sentences about who they are.",
     "whyImRunning": "In their own words: why they're taking on the race.",
     "goal": 1000,
     "donateUrl": "",
     "donations": []
   },
   ```

3. Fill it in. Notes:
   - `"id"`: lowercase, hyphens instead of spaces. This creates their shareable link: `tough-mudder.html#firstname-lastname`.
   - `"goal"` is optional — remove the line to skip the personal progress bar.
   - `"donateUrl"`: leave `""` to use the team's main donate link, or paste a personal fundraising link.
   - No photo yet? Delete the `"photo"` line — a nice initials avatar appears automatically.
4. Commit as before.

### Adding a runner's photo

1. Get the runner's consent to publish their photo.
2. Resize to about **800px wide or less, under 150KB** (any phone's photo editor or [squoosh.app](https://squoosh.app) can do this).
3. In the repo, open **`assets/runners`** → **Add file** → **Upload files**. Name it `firstname-lastname.jpg`.
4. Make sure the runner's `"photo"` field matches: `"assets/runners/firstname-lastname.jpg"`.

---

## Fixing a mistake

**The dashboard shows "Our donation tracker is being updated":** the file has a
formatting problem (usually a missing quote or an extra comma).

- **Easiest fix:** open `data/tough-mudder.json` on GitHub → click **History**
  (clock icon) → open the last good version → **⋯ menu → Revert** (or copy its
  contents over the broken file). Then redo your edit carefully.
- **Or:** GitHub will have emailed the person who made the bad edit — the email
  links to a check that names the exact broken line.

**"Someone else edited at the same time" error when committing:** refresh the page
and redo your edit. Two people can't save at once.

**Your edit doesn't appear:** wait the full 10 minutes, then hard-refresh
(Ctrl+Shift+R / Cmd+Shift+R). The website cache is the usual culprit.

---

## Weekly reconcile (2 minutes)

Once a week, compare the dashboard total with the GoFundMe page total and the
foundation's e-transfer inbox. If money arrived that isn't on the dashboard, add
it (to a runner if the donor mentioned one, otherwise to `"generalDonations"`).
