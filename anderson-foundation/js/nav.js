// Mobile navigation toggle
(function () {
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("site-nav");
  if (!toggle || !nav) return;

  toggle.addEventListener("click", function () {
    var open = nav.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  });

  // Close the menu when a link is chosen (single-page anchors etc.)
  nav.addEventListener("click", function (e) {
    if (e.target.closest("a")) {
      nav.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
    }
  });
})();

// Embed mode: open any page with ?embed=1 and its own header/footer hide,
// so the page nests cleanly inside another site (e.g. an iframe on a Wix
// page). Internal links keep the flag so navigation stays frameless.
(function () {
  if (new URLSearchParams(location.search).get("embed") !== "1") return;
  document.documentElement.classList.add("is-embedded");

  document.addEventListener("click", function (e) {
    var a = e.target.closest("a");
    if (!a) return;
    var href = a.getAttribute("href") || "";
    // only touch same-site page links (not external, mail, or pure anchors)
    if (/^(https?:|mailto:|tel:|#)/.test(href)) return;
    if (a.href.indexOf("embed=1") !== -1) return;
    var url = new URL(a.href, location.href);
    url.searchParams.set("embed", "1");
    a.href = url.pathname.split("/").pop() + url.search + url.hash;
  }, true);
})();
