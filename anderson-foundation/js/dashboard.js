/* ============================================================
   Tough Mudder fundraising dashboard
   Reads data/tough-mudder.json and renders:
     - the full dashboard on tough-mudder.html ([data-dashboard])
     - the live total on any page with [data-campaign-total]
   Design rules: never a blank page, never innerHTML for data
   (donor names/messages are untrusted), every field optional.
   Shared helpers (data loading, formatting, avatars) live in
   js/shared.js — load that before this file.
   ============================================================ */
(function () {
  "use strict";

  var AAF = window.AAF;
  if (!AAF) return;
  var el = AAF.el;
  var parseAmount = AAF.parseAmount;
  var makeFormatter = AAF.makeFormatter;
  var formatDate = AAF.formatDate;
  var countUp = AAF.countUp;
  var prefersReducedMotion = AAF.prefersReducedMotion;

  /* ---------- small renderers ---------- */

  function renderCampaignTotals(summary) {
    var nodes = document.querySelectorAll("[data-campaign-total]");
    if (!nodes.length) return;
    var fmt = makeFormatter(summary.currency, false);
    nodes.forEach(function (node) {
      node.textContent = fmt.format(Math.round(summary.grandTotal));
    });
  }

  function renderTeamDonateButtons(summary) {
    var nodes = document.querySelectorAll("[data-team-donate-btn]");
    if (!nodes.length) return;
    var url = (typeof summary.event.donateUrl === "string" && summary.event.donateUrl.trim())
      ? summary.event.donateUrl.trim()
      : AAF.TEAM_DONATE_URL;
    nodes.forEach(function (node) {
      node.href = url;
    });
  }

  function renderEventDate(summary) {
    var box = document.querySelector("[data-event-date]");
    if (!box || typeof summary.event.date !== "string") return;
    var m = summary.event.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return;
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    if (isNaN(d.getTime())) return;
    box.textContent = "";
    var month = el("span", "month", d.toLocaleDateString("en-CA", { month: "short" }));
    var day = el("span", "day", String(d.getDate()));
    var year = el("span", null, String(d.getFullYear()));
    box.appendChild(month);
    box.appendChild(day);
    box.appendChild(year);
  }

  /* ---------- dashboard renderers ---------- */

  function renderHero(container, summary) {
    var fmt = makeFormatter(summary.currency, false);
    var event = summary.event;
    container.textContent = "";

    var inner = el("div", "container");

    // official Tough Mudder logo (hides itself until the file is uploaded)
    var tmLogo = document.createElement("img");
    tmLogo.src = "assets/tough-mudder-logo.png";
    tmLogo.alt = "Tough Mudder";
    tmLogo.className = "dash-event-logo";
    tmLogo.addEventListener("error", function () { tmLogo.hidden = true; });
    inner.appendChild(tmLogo);

    inner.appendChild(el("h1", null, typeof event.name === "string" && event.name ? event.name : "Team fundraising dashboard"));

    var metaBits = [];
    var dateText = formatDate(event.date);
    if (dateText) metaBits.push(dateText);
    if (typeof event.location === "string" && event.location) metaBits.push(event.location);
    if (metaBits.length) inner.appendChild(el("p", "dash-event-meta", metaBits.join(" · ")));

    var totalNode = el("p", "dash-total", fmt.format(0));
    inner.appendChild(totalNode);
    inner.appendChild(el("p", "dash-total-label", "raised for the foundation"));
    countUp(totalNode, Math.round(summary.grandTotal), function (n) { return fmt.format(n); });

    var goal = parseAmount(event.goal);
    if (goal > 0) {
      var progress = el("div", "dash-progress");

      // stacked bar: one colored segment per runner + one for offline gifts,
      // so the team total visibly adds up from everyone's piece
      var track = el("div", "dash-progress-track dash-progress-track--stacked");
      track.setAttribute("role", "progressbar");
      track.setAttribute("aria-label", "Fundraising progress");
      track.setAttribute("aria-valuemin", "0");
      track.setAttribute("aria-valuemax", String(goal));
      track.setAttribute("aria-valuenow", String(Math.min(Math.round(summary.grandTotal), goal)));

      var segs = [];
      summary.runners.forEach(function (r, i) {
        var t = AAF.runnerTotal(r);
        var name = (typeof r.name === "string" && r.name.trim()) ? r.name.trim() : "Team member";
        segs.push({ label: name.split(/\s+/)[0], amount: t, color: AAF.runnerColor(i, r) });
      });
      if (summary.general > 0) {
        segs.push({ label: "E-transfer & offline", amount: summary.general, color: "rgba(255, 255, 255, .6)" });
      }

      // Scale against whichever is larger, goal or total raised: under goal
      // this is identical to percent-of-goal; over goal every runner's piece
      // shrinks proportionally so the last-listed runners aren't squeezed
      // to zero width while earlier ones keep full size.
      var denom = Math.max(goal, summary.grandTotal);
      segs.forEach(function (s) {
        s.pct = s.amount > 0 ? (s.amount / denom) * 100 : 0;
        if (s.pct <= 0) return;
        var seg = el("span", "dash-progress-seg");
        seg.style.width = "0%";
        seg.style.background = s.color;
        seg.title = s.label + ": " + fmt.format(Math.round(s.amount));
        s.node = seg;
        track.appendChild(seg);
      });
      progress.appendChild(track);
      requestAnimationFrame(function () {
        segs.forEach(function (s) { if (s.node) s.node.style.width = s.pct + "%"; });
      });

      var pct = (summary.grandTotal / goal) * 100;
      var label = el("div", "dash-progress-label");
      label.appendChild(el("span", null, Math.round(pct) + "%" + (pct >= 100 ? " — goal smashed!" : " of goal")));
      label.appendChild(el("span", null, "Goal: " + fmt.format(goal)));
      progress.appendChild(label);

      // legend: who raised what, in their color
      var legend = el("ul", "dash-legend");
      segs.forEach(function (s) {
        var li = document.createElement("li");
        var dot = el("span", "legend-dot");
        dot.style.background = s.color;
        li.appendChild(dot);
        li.appendChild(document.createTextNode(s.label + " · " + fmt.format(Math.round(s.amount))));
        legend.appendChild(li);
      });
      progress.appendChild(legend);

      inner.appendChild(progress);
    }

    var metaRow = summary.donationCount + " donation" + (summary.donationCount === 1 ? "" : "s") +
      " · " + summary.runners.length + " runner" + (summary.runners.length === 1 ? "" : "s");
    var updated = formatDate(summary.updated);
    if (updated) metaRow += " · Updated " + updated;
    inner.appendChild(el("p", "dash-meta-row", metaRow));

    if (summary.general > 0) {
      inner.appendChild(el("p", "dash-offline-note", "Includes " + fmt.format(summary.general) + " in e-transfer and offline donations."));
    }

    if (typeof event.donateUrl === "string" && event.donateUrl) {
      var donate = el("a", "btn btn--donate", "Donate to the team");
      donate.href = event.donateUrl;
      donate.rel = "noopener";
      inner.appendChild(donate);
    }

    container.appendChild(inner);
  }

  function renderRunnerCard(runner, summary, id, index) {
    var currency = summary.currency;
    var fmt = makeFormatter(currency, false);
    var name = (typeof runner.name === "string" && runner.name.trim()) ? runner.name.trim() : "Team member";
    var firstName = name.split(/\s+/)[0];

    var card = el("article", "card runner-card");
    card.id = id;

    // head: avatar + name + raised
    var head = el("div", "runner-head");
    var avatar = el("div", "runner-avatar");
    if (typeof runner.photo === "string" && runner.photo.trim()) {
      var img = document.createElement("img");
      img.src = runner.photo.trim();
      img.alt = "Portrait of " + name;
      img.width = 84;
      img.height = 84;
      img.loading = "lazy";
      img.addEventListener("error", function () {
        avatar.textContent = "";
        avatar.appendChild(AAF.svgAvatar(name));
      });
      avatar.appendChild(img);
    } else {
      avatar.appendChild(AAF.svgAvatar(name));
    }
    head.appendChild(avatar);

    var headText = el("div");
    var nameRow = el("h3", null, name + " ");
    var dot = el("span", "runner-color-dot");
    dot.style.background = AAF.runnerColor(index, runner);
    dot.setAttribute("aria-hidden", "true");
    nameRow.appendChild(dot);
    headText.appendChild(nameRow);
    var total = AAF.runnerTotal(runner);
    var raised = el("p", "runner-raised", fmt.format(Math.round(total)) + " ");
    raised.appendChild(el("small", null, "raised"));
    headText.appendChild(raised);
    head.appendChild(headText);
    card.appendChild(head);

    // personal goal progress
    var goal = parseAmount(runner.goal);
    if (goal > 0) {
      var wrap = el("div");
      var pt = AAF.progressTrack("runner-progress", total, goal, "Fundraising progress for " + name);
      pt.fill.style.background = AAF.runnerColor(index, runner);
      wrap.appendChild(pt.track);
      wrap.appendChild(el("p", "runner-progress-label", fmt.format(Math.round(total)) + " of " + fmt.format(goal) + " goal"));
      card.appendChild(wrap);
    }

    if (typeof runner.bio === "string" && runner.bio.trim()) {
      card.appendChild(el("p", "runner-bio", runner.bio.trim()));
    }

    if (typeof runner.whyImRunning === "string" && runner.whyImRunning.trim()) {
      var why = el("blockquote", "runner-why");
      why.appendChild(el("span", "why-label", "Why I'm running"));
      why.appendChild(document.createTextNode(runner.whyImRunning.trim()));
      card.appendChild(why);
    }

    // donate — opens this runner's own giving page on this site
    var donateWrap = el("div", "runner-donate");
    var donations = Array.isArray(runner.donations) ? runner.donations : [];
    var btn = el("a", donations.length ? "btn btn--primary" : "btn btn--donate", "Donate to " + firstName);
    btn.href = "give.html?runner=" + encodeURIComponent(id);
    donateWrap.appendChild(btn);
    card.appendChild(donateWrap);

    // donor list
    if (donations.length) {
      var details = el("details", "donors");
      var summaryEl = el("summary", null,
        donations.length + " supporter" + (donations.length === 1 ? "" : "s") + " · " + fmt.format(Math.round(total)));
      details.appendChild(summaryEl);
      var list = el("ul", "donor-list");
      donations.forEach(function (d) {
        if (d && typeof d === "object") list.appendChild(AAF.renderDonation(d, currency));
      });
      details.appendChild(list);
      card.appendChild(details);
    } else {
      card.appendChild(el("p", "be-first", "Be the first to support " + firstName + "!"));
    }

    return card;
  }

  function renderDashboard(root, data) {
    var summary = AAF.summarize(data);
    summary.updated = data && data.updated;

    var hero = document.querySelector("[data-dash-hero]");
    if (hero) renderHero(hero, summary);

    root.textContent = "";

    if (typeof summary.event.placeholderNote === "string" && summary.event.placeholderNote.trim()) {
      var note = el("p", "notice", summary.event.placeholderNote.trim());
      note.style.marginBottom = "var(--space-5)";
      root.appendChild(note);
    }

    if (!summary.runners.length) {
      var panel = el("div", "dash-panel");
      panel.appendChild(el("h2", null, "Our team is lacing up"));
      panel.appendChild(el("p", null, "Runner profiles are coming soon — you can already donate to the team."));
      if (typeof summary.event.donateUrl === "string" && summary.event.donateUrl) {
        var btn = el("a", "btn btn--donate", "Donate to the team");
        btn.href = summary.event.donateUrl;
        btn.rel = "noopener";
        panel.appendChild(btn);
      }
      root.appendChild(panel);
      return;
    }

    var grid = el("div", "runner-grid");
    var ids = AAF.assignRunnerIds(summary.runners);
    summary.runners.forEach(function (runner, i) {
      grid.appendChild(renderRunnerCard(runner, summary, ids[i], i));
    });
    root.appendChild(grid);

    // deep link: tough-mudder.html#runner-id
    if (location.hash.length > 1) {
      var target = document.getElementById(location.hash.slice(1));
      if (target && target.classList.contains("runner-card")) {
        target.classList.add("is-highlighted");
        target.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
        var open = target.querySelector("details");
        if (open) open.open = true;
      }
    }
  }

  /* ---------- boot ---------- */

  var dashRoot = document.querySelector("[data-dashboard]");
  var wantsTotals = document.querySelector("[data-campaign-total]") || document.querySelector("[data-event-date]") || document.querySelector("[data-team-donate-btn]");
  if (!dashRoot && !wantsTotals) return;

  AAF.loadData().then(function (data) {
    if (data === null) {
      if (dashRoot) {
        // last-known donate link so visitors can still give
        AAF.renderErrorPanel(dashRoot, AAF.TEAM_DONATE_URL);
        var hero = document.querySelector("[data-dash-hero]");
        if (hero) {
          var inner = el("div", "container");
          inner.appendChild(el("h1", null, "Tough Mudder Toronto"));
          inner.appendChild(el("p", "dash-event-meta", "Team fundraising dashboard"));
          hero.textContent = "";
          hero.appendChild(inner);
        }
      }
      return;
    }
    var summary = AAF.summarize(data);
    renderCampaignTotals(summary);
    renderEventDate(summary);
    renderTeamDonateButtons(summary);
    if (dashRoot) renderDashboard(dashRoot, data);
  });
})();
