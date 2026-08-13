// js/auth.js
// ═══════════════════════════════════════════════════════════════════════════
// SHOTBREAK — Client Auth / Token Helpers (Single Source of Truth)
// ═══════════════════════════════════════════════════════════════════════════
//
// This file centralizes all client-side token and auth helpers.
//
// Usage:
//   <script src="js/auth.js"></script>
//   const token = await window.getToken();
//   const headers = await window.hdrs();
//
// Supports both:
//   - Firebase Auth idTokens (all users; owners get isOwner if email matches authorized list)
//   - Owner tokens from /verify-owner (HMAC, name+pw from env) for convenience in shells
//
// Only the two authorized owners (mz465 / kz465) get special privileges. Client bypasses removed.

(function () {
  'use strict';

  const OWNER_TOKEN_KEY = 'SB_OWNER_TOKEN';
  const OWNER_NAME_KEY  = 'SB_OWNER_NAME';
  const OWNER_EXPIRES_KEY = 'SB_OWNER_EXPIRES';

  // ── Rehydrate owner token from localStorage (on load) ───────────────────
  function rehydrateOwnerToken() {
    try {
      const tk = localStorage.getItem(OWNER_TOKEN_KEY);
      const nm = localStorage.getItem(OWNER_NAME_KEY);
      const exp = parseInt(localStorage.getItem(OWNER_EXPIRES_KEY) || '0', 10);

      // Only accept proper 4-part HMAC owner tokens (from /verify-owner). Reject old 3-part bypass fakes.
      const parts = (tk || '').split(':');
      if (tk && nm && exp > Date.now() && parts.length === 4 && parts[0] === 'owner') {
        window.SB_OWNER_TOKEN = tk;
        window.SB_OWNER_NAME = nm;
        window.SB_OWNER_EXPIRES = exp;
      } else {
        // Clean up stale data (including old bypass fakes)
        clearOwnerToken();
      }
    } catch (e) {
      // localStorage might be blocked
    }
  }

  function clearOwnerToken() {
    try {
      localStorage.removeItem(OWNER_TOKEN_KEY);
      localStorage.removeItem(OWNER_NAME_KEY);
      localStorage.removeItem(OWNER_EXPIRES_KEY);
    } catch (e) {}
    window.SB_OWNER_TOKEN = null;
    window.SB_OWNER_NAME = null;
    window.SB_OWNER_EXPIRES = null;
  }

  // Call rehydration immediately when the script loads
  rehydrateOwnerToken();

  // Touch/extend owner token expiry on successful privileged use (keeps owners
  // logged in during heavy testing sessions without constant re-logins).
  function touchOwnerToken() {
    if (!window.SB_OWNER_TOKEN) return;
    try {
      const newExp = Date.now() + (1000 * 60 * 60 * 24 * 30); // roll to 30d
      localStorage.setItem(OWNER_EXPIRES_KEY, String(newExp));
      window.SB_OWNER_EXPIRES = newExp;
    } catch (e) {}
  }

  // ── Core getToken helper ───────────────────────────────────────────────
  async function getToken() {
    // 1. Prefer active owner token ONLY if proper 4-part HMAC (from /verify-owner). Reject old bypass fakes.
    const ot = window.SB_OWNER_TOKEN;
    if (ot && ot.split(':').length === 4 && ot.startsWith('owner:')) {
      touchOwnerToken(); // keep the session alive during active use
      return ot;
    }

    // 2. Fall back to Firebase Auth
    if (typeof firebase !== 'undefined' &&
        firebase.auth &&
        firebase.auth().currentUser) {
      try {
        return await firebase.auth().currentUser.getIdToken();
      } catch (e) {
        console.warn('[SB Auth] Failed to get Firebase ID token:', e);
        return null;
      }
    }

    return null;
  }

  // ── Convenience headers helper ──────────────────────────────────────────
  async function hdrs() {
    const t = await getToken();
    if (!t) {
      throw new Error('Not signed in. Please sign in first.');
    }
    return {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + t
    };
  }

  // ── Logout (clears both Firebase and owner token state) ─────────────────
  async function logout() {
    try {
      if (typeof firebase !== 'undefined' && firebase.auth) {
        await firebase.auth().signOut();
      }
    } catch (e) {
      console.warn('[SB Auth] Firebase signOut error:', e);
    }

    clearOwnerToken();

    // Optional: allow other parts of the app to react
    if (typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('sb:logout'));
    }
  }

  // ── Expose on window (for backward compatibility) ───────────────────────
  window.getToken = getToken;
  window.hdrs = hdrs;
  window.sbLogout = logout;           // New recommended name
  window.clearOwnerToken = clearOwnerToken;
  window.touchOwnerToken = touchOwnerToken; // for manual extension if needed

  // Also expose the raw storage keys in case someone needs them
  window.SB_AUTH_KEYS = {
    OWNER_TOKEN: OWNER_TOKEN_KEY,
    OWNER_NAME: OWNER_NAME_KEY,
    OWNER_EXPIRES: OWNER_EXPIRES_KEY
  };

  console.log('[SB Auth] Client auth helpers loaded (js/auth.js)');
})();