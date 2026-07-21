/* ============================================================
   Individual runner giving page (give.html?runner=<id>).
   If the runner has a live Zeffy form (zeffyEmbedUrl), it's
   embedded right here so a donor never leaves this site.
   Otherwise a pledge form (amount, donor name, note to the
   runner) renders in its place — submissions are captured by
   Netlify Forms when hosted on Netlify, with a prefilled-email
   fallback on any other host. Same graceful-degradation rule
   as the rest of the site.
   ============================================================ */
(function () {
  "use strict";

  var AAF = window.AAF;
  var root = document.querySelector("[data-give]");
  if (!root || !AAF) return;

  var el = AAF.el;
  var FOUNDATION_EMAIL = "info@angusandersonfoundation.org";

  function backLink(toId) {
    var p = el("p", "give-back");
    var a = document.createElement("a");
    a.href = toId ? "tough-mudder.html#" + toId : "tough-mudder.html";
    a.textContent = "← Back to Tough Mudder Toronto";
    p.appendChild(a);
    return p;
  }

  function mailtoFallback(fields) {
    var subject = "Donation pledge for " + fields.runner;
    var body = "I'd like to donate to " + fields.runner + ".\n\n" +
      "Amount: $" + fields.amount + "\n" +
      "Name for the dashboard: " + (fields.donor || "Anonymous") + "\n" +
      (fields.email ? "Email: " + fields.email + "\n" : "") +
      (fields.message ? "Note to the runner: " + fields.message + "\n" : "");
    return "mailto:" + FOUNDATION_EMAIL +
      "?subject=" + encodeURIComponent(subject) +
      "&body=" + encodeURIComponent(body);
  }

  function renderThanks(panel, fields, viaEmail) {
    panel.textContent = "";
    panel.appendChild(el("h2", null, "Thank you" + (fields.donor ? ", " + fields.donor : "") + "!"));
    if (viaEmail) {
      panel.appendChild(el("p", null, "Your email app should have opened with your pledge — just press send. Then complete your gift:"));
    } else {
      panel.appendChild(el("p", null, "Your $" + fields.amount + " pledge for " + fields.runner + " is recorded. One last step to complete your gift:"));
    }
    var steps = el("ol", "pledge-thanks-steps");
    var li1 = el("li");
    li1.appendChild(document.createTextNode("Send an Interac e-transfer of $" + fields.amount + " to "));
    var mail = el("a", null, FOUNDATION_EMAIL);
    mail.href = "mailto:" + FOUNDATION_EMAIL;
    li1.appendChild(mail);
    li1.appendChild(document.createTextNode(" — most Canadian banking apps do this in under a minute."));
    steps.appendChild(li1);
    steps.appendChild(el("li", null, "Put “" + fields.runner + "” in the transfer message so we match it to your pledge."));
    steps.appendChild(el("li", null, "A volunteer confirms it and your name appears on the dashboard — usually within a day or two."));
    panel.appendChild(steps);
    var back = el("a", "btn btn--primary", "Back to the team dashboard");
    back.href = "tough-mudder.html";
    back.style.marginTop = "var(--space-4)";
    panel.appendChild(back);
  }

  // Clone the static template (kept in give.html so Netlify Forms detects
  // it at deploy time), personalize it, and wire up submit handling.
  function renderPledgeForm(panel, runnerLabel, firstName) {
    var tpl = document.getElementById("pledge-form-template");
    if (!tpl) return false;
    panel.appendChild(el("h2", null, "Give to " + firstName));
    panel.appendChild(el("p", "hint", "Your gift is tied to " + runnerLabel + " automatically — no need to mention a name."));

    var form = tpl.cloneNode(true);
    form.hidden = false;
    form.removeAttribute("id");
    form.querySelector('input[name="runner"]').value = runnerLabel;

    var amountInput = form.querySelector('input[name="amount"]');
    var presets = form.querySelectorAll(".pledge-presets button");
    presets.forEach(function (btn) {
      btn.addEventListener("click", function () {
        amountInput.value = btn.getAttribute("data-amount");
        presets.forEach(function (b) { b.setAttribute("aria-pressed", b === btn ? "true" : "false"); });
      });
    });
    amountInput.addEventListener("input", function () {
      presets.forEach(function (b) { b.setAttribute("aria-pressed", "false"); });
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var fields = {
        runner: runnerLabel,
        amount: amountInput.value,
        donor: form.querySelector('input[name="donor"]').value.trim(),
        email: form.querySelector('input[name="email"]').value.trim(),
        message: form.querySelector('textarea[name="message"]').value.trim()
      };
      var submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = "Sending…";
      // Netlify Forms accepts AJAX posts to any path on the same site.
      fetch("/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(new FormData(form)).toString()
      }).then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        renderThanks(panel, fields, false);
      }).catch(function () {
        // Not on Netlify (or capture failed) — hand off via prefilled email.
        window.location.href = mailtoFallback(fields);
        renderThanks(panel, fields, true);
      });
    });

    panel.appendChild(form);
    return true;
  }

  function renderGivePanel(panel, opts) {
    // opts: { runnerLabel, firstName, zeffyEmbedUrl, fullName }
    if (AAF.isHttpUrl(opts.zeffyEmbedUrl)) {
      panel.appendChild(el("h2", null, "Give to " + opts.firstName));
      var embedWrap = el("div", "give-embed");
      var iframe = document.createElement("iframe");
      iframe.src = opts.zeffyEmbedUrl.trim();
      iframe.title = "Donate to " + opts.fullName + " — secure form powered by Zeffy";
      iframe.loading = "lazy";
      embedWrap.appendChild(iframe);
      panel.appendChild(embedWrap);
      return;
    }
    if (!renderPledgeForm(panel, opts.runnerLabel, opts.firstName)) {
      // template missing — last-resort pointer that works everywhere
      panel.appendChild(el("h2", null, "Give to " + opts.firstName));
      var p = el("p", null, "See ways to give — including Interac e-transfer — on our donate page.");
      panel.appendChild(p);
      var btn = el("a", "btn btn--donate", "Ways to give");
      btn.href = "donate.html";
      panel.appendChild(btn);
    }
  }

  function renderRunnerGive(runner, summary, id, index) {
    var currency = summary.currency;
    var fmt = AAF.makeFormatter(currency, false);
    var name = (typeof runner.name === "string" && runner.name.trim()) ? runner.name.trim() : "Team member";
    var firstName = name.split(/\s+/)[0];
    var total = AAF.runnerTotal(runner);

    root.textContent = "";
    root.appendChild(backLink(id));

    var head = el("div", "give-head");
    var avatar = el("div", "runner-avatar give-avatar");
    if (typeof runner.photo === "string" && runner.photo.trim()) {
      var img = document.createElement("img");
      img.src = runner.photo.trim();
      img.alt = "Portrait of " + name;
      img.width = 96;
      img.height = 96;
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
    headText.appendChild(el("h1", null, "Support " + name));
    var raised = el("p", "runner-raised", fmt.format(Math.round(total)) + " ");
    raised.appendChild(el("small", null, "raised so far"));
    headText.appendChild(raised);
    head.appendChild(headText);
    root.appendChild(head);

    var goal = AAF.parseAmount(runner.goal);
    if (goal > 0) {
      var wrap = el("div", "give-progress-wrap");
      var pt = AAF.progressTrack("runner-progress", total, goal, "Fundraising progress for " + name);
      pt.fill.style.background = AAF.runnerColor(index, runner);
      wrap.appendChild(pt.track);
      wrap.appendChild(el("p", "runner-progress-label", fmt.format(Math.round(total)) + " of " + fmt.format(goal) + " goal"));
      root.appendChild(wrap);
    }

    if (typeof runner.bio === "string" && runner.bio.trim()) {
      root.appendChild(el("p", "runner-bio", runner.bio.trim()));
    }

    if (typeof runner.whyImRunning === "string" && runner.whyImRunning.trim()) {
      var why = el("blockquote", "runner-why");
      why.appendChild(el("span", "why-label", "Why I'm running"));
      why.appendChild(document.createTextNode(runner.whyImRunning.trim()));
      root.appendChild(why);
    }

    var givePanel = el("div", "give-panel card");
    renderGivePanel(givePanel, {
      runnerLabel: name,
      firstName: firstName,
      fullName: name,
      zeffyEmbedUrl: runner.zeffyEmbedUrl
    });
    root.appendChild(givePanel);

    var donations = Array.isArray(runner.donations) ? runner.donations : [];
    if (donations.length) {
      var details = el("details", "donors give-donors");
      details.appendChild(el("summary", null,
        donations.length + " supporter" + (donations.length === 1 ? "" : "s") + " · " + fmt.format(Math.round(total))));
      var list = el("ul", "donor-list");
      donations.forEach(function (d) {
        if (d && typeof d === "object") list.appendChild(AAF.renderDonation(d, currency));
      });
      details.appendChild(list);
      root.appendChild(details);
    } else {
      root.appendChild(el("p", "be-first", "Be the first to support " + firstName + "!"));
    }
  }

  function renderTeamGive(summary) {
    root.textContent = "";
    root.appendChild(backLink());
    root.appendChild(el("h1", null, (typeof summary.event.name === "string" && summary.event.name) || "Tough Mudder Toronto"));
    var panel = el("div", "give-panel card");
    renderGivePanel(panel, {
      runnerLabel: "the whole team",
      firstName: "the team",
      fullName: "the team",
      zeffyEmbedUrl: summary.event.zeffyEmbedUrl
    });
    root.appendChild(panel);
  }

  function renderNotFound() {
    root.textContent = "";
    root.appendChild(backLink());
    var panel = el("div", "dash-panel");
    panel.appendChild(el("h2", null, "We couldn't find that runner"));
    panel.appendChild(el("p", null, "That link may be out of date. You can see the full team, or support the team directly:"));
    var seeAll = el("a", "btn btn--ghost", "See all runners");
    seeAll.href = "tough-mudder.html";
    panel.appendChild(seeAll);
    var btn = el("a", "btn btn--donate", "Donate to the team");
    btn.href = "give.html";
    btn.rel = "noopener";
    panel.appendChild(btn);
    root.appendChild(panel);
  }

  AAF.loadData().then(function (data) {
    var wantedId = (new URLSearchParams(location.search).get("runner") || "").trim();
    if (data === null) {
      // Data file unreadable — the pledge form doesn't depend on it, so
      // still let people give (to the team, since runner info is unknown).
      root.textContent = "";
      root.appendChild(backLink());
      root.appendChild(el("h1", null, "Tough Mudder Toronto"));
      var panel = el("div", "give-panel card");
      renderGivePanel(panel, {
        runnerLabel: wantedId ? wantedId.replace(/-/g, " ") : "the whole team",
        firstName: "the team",
        fullName: "the team",
        zeffyEmbedUrl: ""
      });
      root.appendChild(panel);
      return;
    }
    var summary = AAF.summarize(data);
    if (!wantedId) {
      renderTeamGive(summary);
      return;
    }
    var ids = AAF.assignRunnerIds(summary.runners);
    var idx = ids.indexOf(wantedId);
    if (idx === -1) {
      renderNotFound();
      return;
    }
    renderRunnerGive(summary.runners[idx], summary, ids[idx], idx);
  });
})();
