# Angus Anderson Foundation — website

The foundation's website, rebuilt as a fast, dependency-free static site with a
built-in fundraising dashboard for the **Tough Mudder Toronto** team.

> **Volunteers:** to add a donation or a runner, you only need
> **[UPDATING.md](UPDATING.md)** — a no-coding-required guide.

## Stack

Plain HTML + one CSS file + vanilla JS. **No framework, no build step, nothing to
install.** A bad edit to the data file can never take the site down — the dashboard
degrades gracefully and everything else keeps working.

```
index.html            Home
who-we-are.html       Mission, Angus's story, what we fund
events.html           Featured/upcoming/past events
tough-mudder.html     Fundraising dashboard (renders data/tough-mudder.json)
give.html             One runner's own giving page (give.html?runner=id)
resources.html        Crisis lines, support orgs, refund policy
media.html            Photo gallery (volunteers add photos to assets/media/)
donate.html           Ways to give
404.html              Not-found page (GitHub Pages serves it automatically)
css/site.css          Entire design system (tokens at the top)
js/nav.js             Mobile menu toggle
js/shared.js          Data loading, formatting, avatars — shared by dashboard.js + give.js
js/dashboard.js       Full team dashboard: totals, runner cards, graceful error handling
js/give.js            Single-runner giving page: their story, progress, and Zeffy embed
data/tough-mudder.json  THE data file volunteers edit (see UPDATING.md)
assets/               Logo, favicons, og-image, self-hosted font, runner photos
scripts/validate-data.mjs      Data checker (run: node scripts/validate-data.mjs)
.github/workflows/validate-data.yml  Runs the checker on pushes that touch data/
```

The header/footer are intentionally duplicated in each page (marked with
`<!-- SHARED HEADER -->` comments). If you edit them, make the same edit in every
page — a find-and-replace across `*.html` does it.

## Local preview

The dashboard loads its JSON with `fetch`, which browsers block on `file://` —
so use any static server:

```bash
cd anderson-foundation
python3 -m http.server 8000
# open http://localhost:8000
```

## The dashboard data contract

`js/dashboard.js` treats every field as optional and never renders a blank page:

| Situation | Behaviour |
|---|---|
| Missing/broken `photo` | Generated initials avatar |
| Missing `goal` (event or runner) | Progress bar hidden |
| Missing runner `donateUrl` | Falls back to `event.donateUrl` |
| Missing/empty `zeffyEmbedUrl` | Runner's give.html page shows the GoFundMe fallback, not broken |
| Donor empty or "anonymous" | Shown as **Anonymous** |
| `"hideAmount": true` | Counted in totals, amount shown as ♥ |
| Amount like `"$1,250.00"` | Parsed; `$`/commas stripped |
| Trailing commas / curly quotes | Auto-repaired with a console warning |
| File unreadable | Friendly "tracker being updated" panel + donate button |

Donor names/messages are inserted via `textContent` (never `innerHTML`) — donor
data can't inject markup. Totals: grand total = all donations + `event.generalDonations`.

**Caching note:** GitHub Pages' CDN caches the JSON for ~10 minutes. Edits are
live after that; hard-refresh to confirm.

## Deploying (GitHub Pages)

Repo **Settings → Pages → Deploy from a branch → `main` / `/ (root)`**. That's it.
`.nojekyll` is present so Pages serves files as-is.

## Custom-domain cutover (when ready to replace the Wix site)

1. DNS: apex `A` records → `185.199.108.153`, `185.199.109.153`,
   `185.199.110.153`, `185.199.111.153`; `www` CNAME → `<owner>.github.io`.
2. Add the domain in Settings → Pages, commit the generated `CNAME` file, tick
   **Enforce HTTPS**.
3. Find-and-replace the `https://ofakyle11.github.io/AndersonFoundation` URLs in
   canonicals/OG tags/`sitemap.xml`/`robots.txt` with the real domain.
4. Old Wix slugs (`/event-list`, `/refund-policy`, `/who-we-are`) : add stub
   folders with an `index.html` containing a meta-refresh + canonical link to the
   new pages, so old links and search results keep working.
5. Submit `sitemap.xml` in Google Search Console.

## Payments — current state and upgrade path

GitHub Pages is static hosting: it can't process cards itself. Every runner
already has their own giving page built into the site (`give.html?runner=id`,
linked from their Donate button on `tough-mudder.html`) — what happens on that
page depends on whether Phase 2 below is turned on yet.

**Phase 1 (today):** no `zeffyEmbedUrl` set → the runner's page shows a
**pledge form** (amount, donor name, note to the runner). Submissions are
captured by Netlify Forms (form name `donation-pledge`; on non-Netlify hosts
the form falls back to a prefilled email), the donor gets e-transfer
instructions to complete the gift, and a volunteer logs it in the data file.
Enable the email notification in Netlify → Forms — see the callout at the top
of UPDATING.md.

**Phase 2 (wired up, opt-in per runner):** set a runner's `zeffyEmbedUrl` (or
`event.zeffyEmbedUrl` for the team) in `data/tough-mudder.json` and their giving
page embeds a real **[Zeffy](https://www.zeffy.com/)** donation form right on
the page — name, amount, and a note to the runner, zero platform fees for
Canadian nonprofits, donor never leaves the site. Step-by-step in UPDATING.md.
(Stripe Payment Links work the same way as a paid alternative, ~2.9% + 30¢.)

**Phase 3:** payment-provider webhook → a free Cloudflare Worker → GitHub API
commit that appends the donation to `data/tough-mudder.json`. The JSON shape was
designed so automation writes the same format volunteers do.

## Content that needs foundation review

- **⚠ Pledges only work once the Netlify form email notification is enabled**
  (Site → Forms → donation-pledge → Notifications) — and the e-transfer inbox
  (`info@angusandersonfoundation.org`) must be real, since donors are told to
  send money there. See the callout at the top of UPDATING.md.
- Drafted from public sources and marked with "pending board review" notices
  where visible: mission copy, Angus's story details, refund policy wording,
  contact email (`info@angusandersonfoundation.org` — **verify this is real**),
  e-transfer instructions, event date/goal, and the example runners in
  `data/tough-mudder.json` (all five are fictional placeholders).
