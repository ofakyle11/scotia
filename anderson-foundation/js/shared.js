/* ============================================================
   Shared helpers for the Tough Mudder dashboard and the
   individual runner giving pages (js/dashboard.js, js/give.js).
   Load this before either of those two scripts.
   ============================================================ */
(function () {
  "use strict";

  var DATA_URL = "data/tough-mudder.json";
  // Last-resort team donate link when no other destination is configured:
  // the on-site giving page (pledge form / Zeffy embed — see UPDATING.md).
  var TEAM_DONATE_URL = "give.html";
  var AVATAR_TINTS = [
    ["#E1EEF7", "#17629B"],
    ["#FBEED8", "#B27A1F"],
    ["#E2ECF5", "#2F5D8A"],
    ["#F0E4EE", "#7A4B72"],
    ["#EFEADB", "#6B6135"]
  ];

  // One signature color per runner (by their order in the data file) —
  // used for their segment in the team progress bar, their personal
  // progress bar, and the dot beside their name. Bright enough to read
  // on both the navy hero and white cards.
  var RUNNER_COLORS = ["#E8A33D", "#5CB8E4", "#6FCF97", "#EE8AAE", "#B39DDB", "#E4785C", "#7FD4C1", "#D9C25A"];
  function runnerColor(index, runner) {
    if (runner && typeof runner.color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(runner.color.trim())) {
      return runner.color.trim();
    }
    var n = RUNNER_COLORS.length;
    return RUNNER_COLORS[((index % n) + n) % n];
  }

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

  // a track+fill progress bar; className is the shared prefix, e.g.
  // "runner-progress" → ".runner-progress-track" / ".runner-progress-fill"
  function progressTrack(className, current, goal, ariaLabel) {
    var track = el("div", className + "-track");
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-label", ariaLabel);
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", String(goal));
    track.setAttribute("aria-valuenow", String(Math.round(current)));
    var pct = goal > 0 ? (current / goal) * 100 : 0;
    var fill = el("div", className + "-fill");
    fill.style.width = Math.min(pct, 100) + "%";
    track.appendChild(fill);
    return { track: track, fill: fill, pct: pct };
  }

  function isHttpUrl(value) {
    return typeof value === "string" && /^https:\/\//i.test(value.trim());
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

  // Same id a runner gets on its dashboard card (explicit "id" field, else a
  // slug of its name, deduped with "-2" suffixes) — shared so give.html can
  // look a runner up by the same id the card links to.
  function assignRunnerIds(runners) {
    var used = Object.create(null);
    return runners.map(function (r) {
      var name = (typeof r.name === "string" && r.name.trim()) ? r.name.trim() : "Team member";
      var id = (typeof r.id === "string" && r.id.trim()) ? r.id.trim() : slugify(name);
      while (used[id]) id += "-2";
      used[id] = true;
      return id;
    });
  }

  /* ---------- shared renderers ---------- */

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

  window.AAF = {
    DATA_URL: DATA_URL,
    TEAM_DONATE_URL: TEAM_DONATE_URL,
    runnerColor: runnerColor,
    parseAmount: parseAmount,
    makeFormatter: makeFormatter,
    formatDate: formatDate,
    slugify: slugify,
    initials: initials,
    el: el,
    svgAvatar: svgAvatar,
    prefersReducedMotion: prefersReducedMotion,
    countUp: countUp,
    progressTrack: progressTrack,
    isHttpUrl: isHttpUrl,
    loadData: loadData,
    runnerTotal: runnerTotal,
    summarize: summarize,
    assignRunnerIds: assignRunnerIds,
    renderErrorPanel: renderErrorPanel,
    renderDonation: renderDonation
  };
})();
