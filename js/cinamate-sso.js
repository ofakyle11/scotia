/* =========================================================================
 * CINAMATE — js/cinamate-sso.js
 * -------------------------------------------------------------------------
 * Carries the Cinamate access-gate session into the restored Studio pages so
 * an operator who already signed in at the front door is not asked to sign
 * in a second time.
 *
 * The legacy pages have two auth paths of their own:
 *
 *   1. Firebase email/password.
 *   2. An "owner session" — a token from /.netlify/functions/verify-owner,
 *      cached in localStorage under SB_OWNER_TOKEN, which the pages accept
 *      offline via their own ownerToken() check.
 *
 * This shim reuses path 2 rather than inventing a third: given a valid
 * Cinamate session it writes the owner-session keys, so the page's existing
 * initAuth() hides its own login overlay and labels the operator. Nothing in
 * the legacy code is modified.
 *
 * SCOPE — read this before assuming more than it does:
 * The value written here is a LOCAL marker, not a credential. No server
 * issues it and no server accepts it. It unlocks exactly the work that
 * already runs in the browser — script parsing, timeline, breakdown, budget,
 * schedule, incentives, pro-cut. Anything that calls the generation backend
 * still needs a real token from verify-owner or Firebase, and will fail
 * without one. This shim does not and cannot change that.
 *
 * Load it in <head>, before the page's own scripts.
 * ========================================================================= */
(function () {
  'use strict';

  var SESSION_KEY = 'cinamate.session';
  var OT_KEY = 'SB_OWNER_TOKEN';
  var ON_KEY = 'SB_OWNER_NAME';
  var OE_KEY = 'SB_OWNER_EXPIRES';
  var TTL_MS = 12 * 60 * 60 * 1000;

  /* The Cinamate gate's session record, or null. */
  function gateSession() {
    try {
      var raw = window.sessionStorage.getItem(SESSION_KEY);
      if (!raw) { return null; }
      var s = JSON.parse(raw);
      if (!s || typeof s.operator !== 'string' || s.operator === '') { return null; }
      return s;
    } catch (err) {
      return null;
    }
  }

  /* Path back to the gate, from a page at any depth. */
  function gateUrl() {
    var depth = window.location.pathname.replace(/^\/+|\/+$/g, '').split('/').length - 1;
    return (depth > 0 ? new Array(depth + 1).join('../') : '') + 'index.html';
  }

  var session = gateSession();

  if (!session) {
    /* No gate session — send them to the front door rather than showing a
       second, unrelated login they cannot satisfy. */
    try { window.location.replace(gateUrl()); } catch (err) { /* no-op */ }
    return;
  }

  var operator = String(session.operator).toLowerCase();

  /* Only write if there is no real owner token already: a genuine token from
     verify-owner must always win over this local marker. */
  try {
    var existing = window.localStorage.getItem(OT_KEY);
    var exp = parseInt(window.localStorage.getItem(OE_KEY) || '0', 10);
    var haveReal = existing && exp > Date.now() &&
                   existing.split(':').length === 4 &&
                   existing.indexOf('owner:') === 0 &&
                   existing.indexOf(':cinamate-gate') === -1;

    if (!haveReal) {
      /* Shape must match the legacy ownerToken() check: "owner:" prefix and
         exactly four colon-separated parts. The last part marks it as ours. */
      window.localStorage.setItem(OT_KEY, 'owner:' + operator + ':local:cinamate-gate');
      window.localStorage.setItem(ON_KEY, operator.toUpperCase());
      window.localStorage.setItem(OE_KEY, String(Date.now() + TTL_MS));
    }
  } catch (err) { /* storage blocked — the fallback below still runs */ }

  /* Fallback: if a page shows its overlay anyway (its own auth callback can
     fire after ours), hide it once the DOM is up and label the operator. */
  function settle() {
    var ov = document.getElementById('loginOverlay');
    if (ov) { ov.classList.add('hidden'); }
    var meta = document.getElementById('userMeta');
    if (meta && (!meta.textContent || meta.textContent.trim() === '—')) {
      meta.textContent = operator.toUpperCase();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      settle();
      /* Firebase resolves its auth state asynchronously and may re-show the
         overlay a beat later; catch that one late flip. */
      window.setTimeout(settle, 1200);
    });
  } else {
    settle();
    window.setTimeout(settle, 1200);
  }
}());
