// First-party, privacy-friendly analytics: page views AND clicks, sent to
// the site's own backend (/api/hit). No cookies, no third-party services,
// no consent banner needed — raw IP addresses are never stored, only a
// daily-rotating anonymous hash. Skipped on localhost so local previews
// and tests stay silent.
(function () {
  if (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname)) return;

  function send(payload) {
    try {
      var body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/hit", new Blob([body], { type: "application/json" }));
      } else {
        fetch("/api/hit", { method: "POST", headers: { "content-type": "application/json" }, body: body, keepalive: true }).catch(function () {});
      }
    } catch (err) { /* analytics must never break a page */ }
  }

  // one page view per load
  send({ path: location.pathname, ref: document.referrer || "" });

  // every click on a link or button, labeled by its text (and target for links)
  document.addEventListener("click", function (e) {
    var el = e.target.closest("a, button");
    if (!el) return;
    var label = (el.getAttribute("data-analytics") || el.getAttribute("aria-label") || el.textContent || "")
      .trim().replace(/\s+/g, " ").slice(0, 80);
    var href = el.tagName === "A" ? (el.getAttribute("href") || "").slice(0, 80) : "";
    if (!label && !href) return;
    send({
      type: "click",
      path: location.pathname,
      label: (label || "(unlabeled)") + (href ? " → " + href : "")
    });
  }, true);
})();
