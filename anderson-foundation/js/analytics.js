// Privacy-friendly traffic counting via GoatCounter (no cookies, no personal
// data, no consent banner required). Skipped on localhost so local previews
// and tests never send or attempt network calls.
(function () {
  if (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname)) return;
  var s = document.createElement("script");
  s.async = true;
  s.src = "https://gc.zgo.at/count.js";
  s.setAttribute("data-goatcounter", "https://angusanderson.goatcounter.com/count");
  document.head.appendChild(s);
})();
