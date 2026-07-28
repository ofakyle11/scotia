// Staff area client. Talks to the server backend (/api/*, a Netlify
// Function) for login and metrics: the password check happens server-side
// and the session lives in an HttpOnly cookie that page scripts can't read.
//
// On hosts without the backend (e.g. a plain local preview server) it falls
// back to a client-side gate so the page still works. Either way, only a
// SHA-256 digest of "username:password" ever appears in code — the password
// itself cannot be recovered from it.
(function () {
  var AAF = window.AAF;
  var AUTH_SHA256 = "04ca8a0374f0ec45b22bafe51f9ebf26ffefb88627359125bc6579e72fe2795d";
  var SESSION_KEY = "aaf-staff";

  var loginCard = document.getElementById("admin-login");
  var dash = document.getElementById("admin-dash");
  var form = document.getElementById("admin-login-form");
  if (!loginCard || !dash || !form || !AAF) return;

  var backend = false;

  function sha256Hex(text) {
    var bytes = new TextEncoder().encode(text);
    return crypto.subtle.digest("SHA-256", bytes).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) {
        return b.toString(16).padStart(2, "0");
      }).join("");
    });
  }

  function showDash() {
    loginCard.hidden = true;
    dash.hidden = false;
    loadMetrics();
  }

  function showError() {
    document.getElementById("admin-login-error").hidden = false;
  }

  // ---------- auth ----------

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var user = document.getElementById("admin-user").value.trim();
    var pass = document.getElementById("admin-pass").value;
    if (backend) {
      fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: user, password: pass })
      }).then(function (r) {
        if (r.ok) showDash(); else showError();
      }).catch(showError);
      return;
    }
    sha256Hex(user + ":" + pass).then(function (hex) {
      if (hex === AUTH_SHA256) {
        try { localStorage.setItem(SESSION_KEY, "1"); } catch (err) { /* private mode */ }
        showDash();
      } else {
        showError();
      }
    });
  });

  var logout = document.getElementById("admin-logout");
  if (logout) {
    logout.addEventListener("click", function () {
      try { localStorage.removeItem(SESSION_KEY); } catch (err) { /* ignore */ }
      var done = function () { location.reload(); };
      if (backend) fetch("/api/logout", { method: "POST" }).then(done, done);
      else done();
    });
  }

  // Discover the backend, then restore any existing session.
  fetch("/api/session", { cache: "no-store" }).then(function (r) {
    if (!r.ok) throw new Error("no backend");
    return r.json();
  }).then(function (s) {
    backend = s && s.backend === true;
    if (backend && s.authed) showDash();
    else if (!backend) restoreLocal();
  }).catch(function () {
    backend = false;
    restoreLocal();
  });

  function restoreLocal() {
    try {
      if (localStorage.getItem(SESSION_KEY) === "1") showDash();
    } catch (err) { /* private mode: just show the login */ }
  }

  // ---------- metrics ----------

  function tile(label, value, note) {
    var t = AAF.el("div", "stat-tile card");
    t.appendChild(AAF.el("span", "stat-value", value));
    t.appendChild(AAF.el("span", "stat-label", label));
    if (note) t.appendChild(AAF.el("span", "stat-note", note));
    return t;
  }

  function loadMetrics() {
    if (backend) {
      fetch("/api/metrics", { cache: "no-store" }).then(function (r) {
        if (!r.ok) throw new Error("metrics " + r.status);
        return r.json();
      }).then(function (m) {
        if (m.data) renderMoney(m.data); else renderDataUnavailable();
        if (m.forms) renderForms(m.forms);
        if (m.traffic) renderTraffic(m.traffic);
      }).catch(renderDataUnavailable);
      return;
    }
    AAF.loadData().then(renderMoney).catch(renderDataUnavailable);
  }

  function renderDataUnavailable() {
    var tiles = document.getElementById("admin-tiles");
    tiles.textContent = "";
    tiles.appendChild(tile("Data", "unavailable", "data/tough-mudder.json failed to load"));
  }

  function renderMoney(data) {
    var summary = AAF.summarize(data);
    var fmt = AAF.makeFormatter(summary.currency, false);
    var goal = AAF.parseAmount(summary.event.goal);
    var ids = AAF.assignRunnerIds(summary.runners);

    var all = [];
    summary.runners.forEach(function (r, i) {
      (Array.isArray(r.donations) ? r.donations : []).forEach(function (d) {
        if (d && typeof d === "object") all.push({ d: d, runner: r, index: i });
      });
    });

    var amounts = all.map(function (x) { return AAF.parseAmount(x.d.amount); }).filter(function (n) { return n > 0; });
    var avg = amounts.length ? amounts.reduce(function (a, b) { return a + b; }, 0) / amounts.length : 0;
    var largest = amounts.length ? Math.max.apply(null, amounts) : 0;

    var daysLeft = "";
    if (typeof summary.event.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(summary.event.date)) {
      var diff = Math.ceil((new Date(summary.event.date + "T00:00:00") - new Date()) / 86400000);
      daysLeft = diff >= 0 ? String(diff) : "done";
    }

    var tiles = document.getElementById("admin-tiles");
    tiles.textContent = "";
    tiles.appendChild(tile("Raised so far", fmt.format(Math.round(summary.grandTotal))));
    tiles.appendChild(tile("Of goal", goal > 0 ? Math.round((summary.grandTotal / goal) * 100) + "%" : "—", goal > 0 ? "goal " + fmt.format(goal) : ""));
    tiles.appendChild(tile("Donations", String(summary.donationCount)));
    tiles.appendChild(tile("Average gift", avg ? fmt.format(Math.round(avg)) : "—"));
    tiles.appendChild(tile("Largest gift", largest ? fmt.format(largest) : "—"));
    if (daysLeft !== "") tiles.appendChild(tile("Days to event", daysLeft, summary.event.date));

    var rbody = document.querySelector("#admin-runners tbody");
    rbody.textContent = "";
    summary.runners.forEach(function (r, i) {
      var total = AAF.runnerTotal(r);
      var tr = document.createElement("tr");
      var nameTd = document.createElement("td");
      var dot = AAF.el("span", "legend-dot");
      dot.style.background = AAF.runnerColor(i, r);
      nameTd.appendChild(dot);
      nameTd.appendChild(document.createTextNode(" " + ((typeof r.name === "string" && r.name) || ids[i])));
      tr.appendChild(nameTd);
      tr.appendChild(AAF.el("td", null, fmt.format(Math.round(total))));
      tr.appendChild(AAF.el("td", null, String(Array.isArray(r.donations) ? r.donations.length : 0)));
      tr.appendChild(AAF.el("td", null, summary.grandTotal > 0 ? Math.round((total / summary.grandTotal) * 100) + "%" : "—"));
      tr.appendChild(AAF.el("td", null, AAF.isHttpUrl(r.zeffyEmbedUrl) ? "live" : "not set"));
      rbody.appendChild(tr);
    });

    all.sort(function (a, b) {
      return String(b.d.date || "").localeCompare(String(a.d.date || ""));
    });
    var lbody = document.querySelector("#admin-log tbody");
    lbody.textContent = "";
    all.forEach(function (x) {
      var tr = document.createElement("tr");
      tr.appendChild(AAF.el("td", null, typeof x.d.date === "string" ? x.d.date : "—"));
      tr.appendChild(AAF.el("td", null, x.d.anonymous ? "Anonymous" : (typeof x.d.donor === "string" && x.d.donor) || "Anonymous"));
      tr.appendChild(AAF.el("td", null, (typeof x.runner.name === "string" && x.runner.name) || "—"));
      tr.appendChild(AAF.el("td", null, fmt.format(AAF.parseAmount(x.d.amount))));
      tr.appendChild(AAF.el("td", "admin-msg", typeof x.d.message === "string" ? x.d.message : ""));
      lbody.appendChild(tr);
    });
  }

  function renderForms(forms) {
    var host = document.getElementById("admin-forms");
    if (!host) return;
    host.textContent = "";
    forms.forEach(function (f) {
      var card = AAF.el("div", "card admin-card");
      card.appendChild(AAF.el("h3", null, f.name + " — " + f.count + " submission" + (f.count === 1 ? "" : "s")));
      (f.latest || []).forEach(function (s) {
        var p = AAF.el("p", "admin-muted");
        var when = typeof s.at === "string" ? s.at.slice(0, 10) : "";
        var bits = [];
        var fields = s.fields || {};
        Object.keys(fields).slice(0, 4).forEach(function (k) {
          bits.push(k + ": " + String(fields[k]).slice(0, 60));
        });
        p.textContent = when + " · " + (bits.join(" · ") || s.summary || "");
        card.appendChild(p);
      });
      host.appendChild(card);
    });
  }

  function renderTraffic(traffic) {
    var host = document.getElementById("admin-traffic-stats");
    if (!host) return;
    host.textContent = "";
    if (typeof traffic.total30d === "number") {
      host.appendChild(tile("Pageviews (30 days)", String(traffic.total30d)));
    }
    if (typeof traffic.totalUnique30d === "number") {
      host.appendChild(tile("Visitors (30 days)", String(traffic.totalUnique30d)));
    }
  }
})();
