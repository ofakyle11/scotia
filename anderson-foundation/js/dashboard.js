/* ============================================================
   Tough Mudder fundraising dashboard
   Reads data/tough-mudder.json and renders:
     - the full dashboard on tough-mudder.html ([data-dashboard])
     - the live total on any page with [data-campaign-total]
   Design rules: never a blank page, never innerHTML for data
   (donor names/messages are untrusted), every field optional.
   ============================================================ */
(function () {
  "use strict";

  var DATA_URL = "data/tough-mudder.json";
  var AVATAR_TINTS = [
    ["#E3F0E8", "#1E6B47"],
    ["#FBEED8", "#B27A1F"],
    ["#E2ECF5", "#2F5D8A"],
    ["#F0E4EE", "#7A4B72"],
    ["#EFEADB", "#6B6135"]
  ];

  /* ---------- helpers ---------- */

  function parseAmount(value) {
    if (typeof value === "number") return isFinite(value) ? value : 0;
    if (typeof value === "string") {
      var n = parseFloat(value.replace(/[$,\s]/g, ""));
      if (!isNaN(n)) return n;
    }
    if (value !== undefined) {
      console.warn("Could not read donation amount:", value);
    }
    return 0;
  }

  function makeFormatter(currency, cents) {
    try {
      return new Intl.NumberFormat("en-CA", {
        style: "currency",
        currency: currency,
        minimumFractionDigits: cents ? 2 : 0,
        maximumFractionDigits: cents ? 2 : 0
      });
    } catch (e) {
      return new Intl.NumberFormat("en-CA", {
        style: "currency",
        currency: "CAD",
        minimumFractionDigits: cents ? 2 : 0,
        maximumFractionDigits: cents ? 2 : 0
      });
    }
  }

  // "2026-07-01" → "Jul 1, 2026" (parsed as local date, not UTC)
  function formatDate(iso) {
    if (typeof iso !== "string") return "";
    var m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return "";
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
  }

  function slugify(text) {
    return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "runner";
  }

  function initials(name) {
    var parts = String(name).trim().split(/\s+/).slice(0, 2);
    return parts.map(function (p) { return p.charAt(0).toUpperCase(); }).join("") || "?";
  }

  function nameHash(name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return h;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function svgAvatar(name) {
    var tint = AVATAR_TINTS[nameHash(String(name)) % AVATAR_TINTS.length];
    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Portrait placeholder for " + name);
    var rect = document.createElementNS(NS, "rect");
    rect.setAttribute("width", "100");
    rect.setAttribute("height", "100");
    rect.setAttribute("fill", tint[0]);
    var txt = document.createElementNS(NS, "text");
    txt.setAttribute("x", "50");
    txt.setAttribute("y", "50");
    txt.setAttribute("text-anchor", "middle");
    txt.setAttribute("dominant-baseline", "central");
    txt.setAttribute("fill", tint[1]);
    txt.setAttribute("font-family", "Fraunces, Georgia, serif");
    txt.setAttribute("font-size", "38");
    txt.setAttribute("font-weight", "700");
    txt.textContent = initials(name);
    svg.appendChild(rect);
    svg.appendChild(txt);
    return svg;
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function countUp(node, target, format) {
    if (prefersReducedMotion() || target <= 0) {
      node.textContent = format(target);
      return;
    }
    var duration = 900;
    var start = null;
    function step(ts) {
      if (start === null) start = ts;
      var t = Math.min((ts - start) / duration, 1);
      var eased = 1 - Math.pow(1 - t, 3);
      node.textContent = format(Math.round(target * eased));
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ---------- data loading (lenient) ---------- */

  function lenientParse(text) {
    try {
      return JSON.parse(text);
    } catch (firstError) {
      // Volunteer-friendly recovery: smart quotes from Word, trailing commas.
      var repaired = text
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/,\s*([\]}])/g, "$1");
      try {
        var data = JSON.parse(repaired);
        console.warn("tough-mudder.json had a formatting problem that was auto-repaired. Please fix the file — see UPDATING.md.", firstError.message);
        return data;
      } catch (secondError) {
        console.error("tough-mudder.json could not be read:", firstError.message);
        return null;
      }
    }
  }

  function loadData() {
    return fetch(DATA_URL, { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.text();
      })
      .then(lenientParse)
      .catch(function (err) {
        console.error("Could not load donation data:", err);
        return null;
      });
  }

  /* ---------- totals ---------- */

  function runnerTotal(runner) {
    var donations = Array.isArray(runner.donations) ? runner.donations : [];
    return donations.reduce(function (sum, d) {
      return sum + parseAmount(d && d.amount);
    }, 0);
  }

  function summarize(data) {
    var event = (data && typeof data.event === "object" && data.event) || {};
    var runners = (data && Array.isArray(data.runners) ? data.runners : []).filter(function (r) {
      return r && typeof r === "object";
    });
    var donationCount = 0;
    var runnersTotal = 0;
    runners.forEach(function (r) {
      var donations = Array.isArray(r.donations) ? r.donations : [];
      donationCount += donations.length;
      runnersTotal += runnerTotal(r);
    });
    var general = parseAmount(event.generalDonations);
    return {
      event: event,
      runners: runners,
      donationCount: donationCount,
      general: general,
      grandTotal: runnersTotal + general,
      currency: typeof event.currency === "string" && event.currency ? event.currency : "CAD"
    };
  }

  /* ---------- small renderers ---------- */

  function renderCampaignTotals(summary) {
    var nodes = document.querySelectorAll("[data-campaign-total]");
    if (!nodes.length) return;
    var fmt = makeFormatter(summary.currency, false);
    nodes.forEach(function (node) {
      node.textContent = fmt.format(Math.round(summary.grandTotal));
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

  function renderErrorPanel(root, donateUrl) {
    root.textContent = "";
    var panel = el("div", "dash-panel");
    panel.appendChild(el("h2", null, "Our donation tracker is being updated"));
    panel.appendChild(el("p", null, "Totals will be back shortly — and you can still donate right now."));
    if (donateUrl) {
      var btn = el("a", "btn btn--donate", "Donate to the team");
      btn.href = donateUrl;
      btn.rel = "noopener";
      panel.appendChild(btn);
    }
    root.appendChild(panel);
  }

  function renderHero(container, summary) {
    var fmt = makeFormatter(summary.currency, false);
    var event = summary.event;
    container.textContent = "";

    var inner = el("div", "container");

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
      var pct = (summary.grandTotal / goal) * 100;
      var progress = el("div", "dash-progress");
      var track = el("div", "dash-progress-track");
      track.setAttribute("role", "progressbar");
      track.setAttribute("aria-label", "Fundraising progress");
      track.setAttribute("aria-valuemin", "0");
      track.setAttribute("aria-valuemax", String(goal));
      track.setAttribute("aria-valuenow", String(Math.round(summary.grandTotal)));
      var fill = el("div", "dash-progress-fill");
      track.appendChild(fill);
      progress.appendChild(track);
      var label = el("div", "dash-progress-label");
      label.appendChild(el("span", null, Math.round(pct) + "%" + (pct >= 100 ? " — goal smashed!" : " of goal")));
      label.appendChild(el("span", null, "Goal: " + fmt.format(goal)));
      progress.appendChild(label);
      inner.appendChild(progress);
      requestAnimationFrame(function () {
        fill.style.width = Math.min(pct, 100) + "%";
      });
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

  function renderDonation(d, currency) {
    var li = document.createElement("li");
    var donorName = (d && typeof d.donor === "string" && d.donor.trim() && d.donor.trim().toLowerCase() !== "anonymous")
      ? d.donor.trim()
      : "Anonymous";
    li.appendChild(el("span", "donor-name", donorName));

    if (d && d.hideAmount === true) {
      var heart = el("span", "donor-amount", "♥");
      heart.setAttribute("aria-label", "amount hidden");
      li.appendChild(heart);
    } else {
      var amount = parseAmount(d && d.amount);
      var cents = amount % 1 !== 0;
      li.appendChild(el("span", "donor-amount", makeFormatter(currency, cents).format(amount)));
    }

    if (d && typeof d.message === "string" && d.message.trim()) {
      li.appendChild(el("span", "donor-msg", "“" + d.message.trim() + "”"));
    }
    var dateText = formatDate(d && d.date);
    if (dateText) li.appendChild(el("span", "donor-date", dateText));
    return li;
  }

  function renderRunnerCard(runner, summary, usedIds) {
    var currency = summary.currency;
    var fmt = makeFormatter(currency, false);
    var name = (typeof runner.name === "string" && runner.name.trim()) ? runner.name.trim() : "Team member";
    var firstName = name.split(/\s+/)[0];

    var id = (typeof runner.id === "string" && runner.id.trim()) ? runner.id.trim() : slugify(name);
    while (usedIds[id]) id += "-2";
    usedIds[id] = true;

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
        avatar.appendChild(svgAvatar(name));
      });
      avatar.appendChild(img);
    } else {
      avatar.appendChild(svgAvatar(name));
    }
    head.appendChild(avatar);

    var headText = el("div");
    headText.appendChild(el("h3", null, name));
    var total = runnerTotal(runner);
    var raised = el("p", "runner-raised", fmt.format(Math.round(total)) + " ");
    raised.appendChild(el("small", null, "raised"));
    headText.appendChild(raised);
    head.appendChild(headText);
    card.appendChild(head);

    // personal goal progress
    var goal = parseAmount(runner.goal);
    if (goal > 0) {
      var wrap = el("div");
      var track = el("div", "runner-progress-track");
      track.setAttribute("role", "progressbar");
      track.setAttribute("aria-label", "Fundraising progress for " + name);
      track.setAttribute("aria-valuemin", "0");
      track.setAttribute("aria-valuemax", String(goal));
      track.setAttribute("aria-valuenow", String(Math.round(total)));
      var fill = el("div", "runner-progress-fill");
      fill.style.width = Math.min((total / goal) * 100, 100) + "%";
      track.appendChild(fill);
      wrap.appendChild(track);
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

    // donate
    var donateUrl = (typeof runner.donateUrl === "string" && runner.donateUrl.trim())
      ? runner.donateUrl.trim()
      : (typeof summary.event.donateUrl === "string" ? summary.event.donateUrl.trim() : "");
    var donateWrap = el("div", "runner-donate");
    var donations = Array.isArray(runner.donations) ? runner.donations : [];
    if (donateUrl) {
      var btn = el("a", donations.length ? "btn btn--primary" : "btn btn--donate", "Donate to " + firstName);
      btn.href = donateUrl;
      btn.rel = "noopener";
      donateWrap.appendChild(btn);
      donateWrap.appendChild(el("p", "hint", "Mention “" + firstName + "” with your donation so we can add it to their total."));
    } else {
      donateWrap.appendChild(el("p", "hint", "Contact us to donate in support of " + firstName + "."));
    }
    card.appendChild(donateWrap);

    // donor list
    if (donations.length) {
      var details = el("details", "donors");
      var summaryEl = el("summary", null,
        donations.length + " supporter" + (donations.length === 1 ? "" : "s") + " · " + fmt.format(Math.round(total)));
      details.appendChild(summaryEl);
      var list = el("ul", "donor-list");
      donations.forEach(function (d) {
        if (d && typeof d === "object") list.appendChild(renderDonation(d, currency));
      });
      details.appendChild(list);
      card.appendChild(details);
    } else {
      card.appendChild(el("p", "be-first", "Be the first to support " + firstName + "!"));
    }

    return card;
  }

  function renderDashboard(root, data) {
    var summary = summarize(data);
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
    var usedIds = Object.create(null);
    summary.runners.forEach(function (runner) {
      grid.appendChild(renderRunnerCard(runner, summary, usedIds));
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
  var wantsTotals = document.querySelector("[data-campaign-total]") || document.querySelector("[data-event-date]");
  if (!dashRoot && !wantsTotals) return;

  loadData().then(function (data) {
    if (data === null) {
      if (dashRoot) {
        // last-known donate link so visitors can still give
        renderErrorPanel(dashRoot, "https://www.gofundme.com/f/AndersonFoundationFundraiser");
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
    var summary = summarize(data);
    renderCampaignTotals(summary);
    renderEventDate(summary);
    if (dashRoot) renderDashboard(dashRoot, data);
  });
})();
