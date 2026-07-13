/* ============================================================
   Individual runner giving page (give.html?runner=<id>).
   If the runner has a live Zeffy form (zeffyEmbedUrl), it's
   embedded right here so a donor never leaves this site. Until
   then, shows a friendly fallback pointing at the team donate
   link — same graceful-degradation rule as the rest of the site.
   ============================================================ */
(function () {
  "use strict";

  var AAF = window.AAF;
  var root = document.querySelector("[data-give]");
  if (!root || !AAF) return;

  var el = AAF.el;
  var TEAM_DONATE_FALLBACK = AAF.TEAM_DONATE_URL;

  function backLink(toId) {
    var p = el("p", "give-back");
    var a = document.createElement("a");
    a.href = toId ? "tough-mudder.html#" + toId : "tough-mudder.html";
    a.textContent = "← Back to Tough Mudder Toronto";
    p.appendChild(a);
    return p;
  }

  function renderComingSoon(container, firstName, donateUrl) {
    container.appendChild(el("h2", null, "Online giving for " + firstName + " is almost ready"));
    container.appendChild(el("p", null, "We're setting up a secure form right on this page. In the meantime, you can support the team directly:"));
    var btn = el("a", "btn btn--donate", "Donate to the team");
    btn.href = donateUrl || TEAM_DONATE_FALLBACK;
    btn.rel = "noopener";
    container.appendChild(btn);
    container.appendChild(el("p", "hint", "Mention “" + firstName + "” with your donation so we can add it to their total."));
  }

  function renderRunnerGive(runner, summary, id) {
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

    var donateUrl = (typeof runner.donateUrl === "string" && runner.donateUrl.trim())
      ? runner.donateUrl.trim()
      : (typeof summary.event.donateUrl === "string" ? summary.event.donateUrl.trim() : "");

    var givePanel = el("div", "give-panel card");
    if (AAF.isHttpUrl(runner.zeffyEmbedUrl)) {
      givePanel.appendChild(el("h2", null, "Give to " + firstName));
      var embedWrap = el("div", "give-embed");
      var iframe = document.createElement("iframe");
      iframe.src = runner.zeffyEmbedUrl.trim();
      iframe.title = "Donate to " + name + " — secure form powered by Zeffy";
      iframe.loading = "lazy";
      embedWrap.appendChild(iframe);
      givePanel.appendChild(embedWrap);
    } else {
      renderComingSoon(givePanel, firstName, donateUrl);
    }
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
    var panel = el("div", "dash-panel card");
    panel.appendChild(el("p", null, "Support the whole team:"));
    var btn = el("a", "btn btn--donate", "Donate to the team");
    btn.href = (typeof summary.event.donateUrl === "string" && summary.event.donateUrl.trim()) || TEAM_DONATE_FALLBACK;
    btn.rel = "noopener";
    panel.appendChild(btn);
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
    btn.href = TEAM_DONATE_FALLBACK;
    btn.rel = "noopener";
    panel.appendChild(btn);
    root.appendChild(panel);
  }

  AAF.loadData().then(function (data) {
    if (data === null) {
      root.textContent = "";
      root.appendChild(backLink());
      AAF.renderErrorPanel(root, TEAM_DONATE_FALLBACK);
      return;
    }
    var summary = AAF.summarize(data);
    var wantedId = (new URLSearchParams(location.search).get("runner") || "").trim();
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
    renderRunnerGive(summary.runners[idx], summary, ids[idx]);
  });
})();
