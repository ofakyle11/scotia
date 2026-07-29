// First-party, privacy-friendly visit counting: each page view sends one
// small beacon to the site's own backend (/api/hit). No cookies, no
// third-party services, no consent banner needed — raw IP addresses are
// never stored, only a daily-rotating anonymous hash. Skipped on localhost
// so local previews and tests stay silent.
(function () {
  if (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname)) return;
  var payload = JSON.stringify({
    path: location.pathname + location.search.replace(/([?&])(embed)=[^&]*/g, "$1$2=1"),
    ref: document.referrer || ""
  });
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/hit", new Blob([payload], { type: "application/json" }));
    } else {
      fetch("/api/hit", { method: "POST", headers: { "content-type": "application/json" }, body: payload, keepalive: true }).catch(function () {});
    }
  } catch (err) { /* analytics must never break a page */ }
})();
