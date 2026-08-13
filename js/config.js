// js/config.js
// ══════════════════════════════════════════════════════════════════════
// SHOTBREAK — Client Configuration (SINGLE SOURCE OF TRUTH)
// ══════════════════════════════════════════════════════════════════════
// This file is the ONLY place the Firebase web config and owner metadata
// live for all client pages (app.html, workflow/, editor/).
//
// The apiKey is a PUBLIC Firebase web key by design (sent to every browser).
// Real protection comes from:
//   - Firestore Security Rules (see firestore.rules)
//   - Google Cloud API key restrictions (HTTP referrers + allowed APIs)
//   - Netlify environment variables for all server-side secrets
//   - OWNER_TOKEN_SECRET + short-lived HMAC owner tokens (only the 3 owners via /verify-owner)
//
// Owners get isOwner privileges (email match after real login, or valid HMAC token).
// Current active for the 3 Shotbreak owners: original kyle/scott/steve + kyleF/steveC/scottD/steveK shorts (plain company emails not fully set up yet).
// Client bypasses, demo "any token", nuclear any-user-owner removed. Only real logins or proper 4-part owner: tokens.
// The shorts (kyleF/steveC/scottD) are used for /verify-owner (name + OWNER_PW_KYLEF etc).
// Run Shotbreak/get-owner-token.ps1 (after setting the PW envs + clear-cache deploy) to get tokens easily.
// If the actual emails for kyleF etc are on different domains, update the emails list here + the OWNER_NAME_TO_EMAIL map in the two netlify/.../verify-token.js files.
//
// ROTATION PROCEDURE (when key or owners change):
//   1. Edit ONLY this file.
//   2. Update the matching values in Netlify env if FIREBASE_* server vars change.
//   3. Commit → push → Netlify auto-deploys.
//   4. (Optional) Bump a cache-bust query param on the <script src> tags below.
//   5. Verify the three pages load and auth still works.
//
// NEVER put real PATs, Stripe keys, Anthropic keys, or owner passwords here
// or anywhere else in the client. Those belong exclusively in Netlify env vars.

(function () {
  'use strict';

  const IS_LOCAL_HOST = (function () {
    try {
      const h = location.hostname;
      return h === 'localhost' || h === '127.0.0.1' || location.protocol === 'file:';
    } catch (e) {
      return false;
    }
  })();

  const CFG = {
    firebase: {
      apiKey: "AIzaSyA5-NRXzzkWuGafQ5-EukGF9WMnQ2txFFA",
      authDomain: "shotbreak-9f342.firebaseapp.com",
      projectId: "shotbreak-9f342",
      storageBucket: "shotbreak-9f342.firebasestorage.app",
      messagingSenderId: "515766987392",
      appId: "1:515766987392:web:ac3644d952c69d11c7d465"
    },
    localOnly: IS_LOCAL_HOST,
    localGeneration: IS_LOCAL_HOST ? {
      enabled: true,
      videoProxy: 'http://localhost:3456/generate-video',
      healthUrl: 'http://localhost:3456/health',
      comfyHost: 'http://127.0.0.1:8188',
      maxPollSec: 1800
    } : {
      enabled: false
    },
    owners: {
      // The ONLY two active logins. Update the server maps
      // (netlify/functions/lib/verify-token.js, netlify/functions/auth.js)
      // together with this list if the emails ever change.
      emails: [
        'mz465@shotbreak.io',
        'kz465@shotbreak.io'
      ],
      meta: {
        mz465: { name: 'MZ465', color: '#38bdf8' },
        kz465: { name: 'KZ465', color: '#818cf8' }
      }
    }
  };

  // Freeze so nothing can mutate the config at runtime
  window.SHOTBREAK_CONFIG = Object.freeze(CFG);

  // Back-compat aliases used by existing inline code and older comments
  window.OWNER_EMAILS = new Set(CFG.owners.emails);
  window.OWNER_META = CFG.owners.meta;

  // Optional: expose a tiny helper
  window.getShotbreakFirebaseConfig = () => CFG.firebase;

  // Clean any old 3-part bypass owner tokens (only 4-part from /verify-owner valid now)
  try {
    const tk = localStorage.getItem('SB_OWNER_TOKEN');
    if (tk && tk.split(':').length !== 4) {
      localStorage.removeItem('SB_OWNER_TOKEN');
      localStorage.removeItem('SB_OWNER_NAME');
      localStorage.removeItem('SB_OWNER_EXPIRES');
    }
  } catch(e) {}
})();