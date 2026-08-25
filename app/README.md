# Chambers — the 28-room firm (reference implementation)

A private, encrypted practice platform. Zero dependencies: `node server.js`.

- **Closed by design** — no landing page, no signup. First boot prints a single-use
  founding-admin invite URL to the console; everyone else is provisioned from /admin.
- **AES-256-GCM everywhere** — envelope keys: root file key → tenant KEK → one DEK
  per matter → per-record/per-blob sealing. `node test/crypto.test.js` proves that
  matter logs and blobs on disk are ciphertext, that ethical walls deny before any
  key unwrap, and that destroying a matter's key (Closing Room / admin shred) makes
  its history unreadable everywhere, permanently.
- **Append-only** — matter state is an encrypted event log; the audit trail is a
  SHA-256 hash chain holding metadata only, never content.
- **The 28 rooms + 4 connectors** — one module each under `rooms/` (28 practice rooms
  plus CanLII, PACER/RECAP, EDGAR, and the Sources shelf), all built on the same kernel
  (`kernel/`): store, crypto, auth, ledger, rules-as-code deadline engine, UI.

Run: `node server.js` → http://localhost:8028 · Tests: `node test/harness.js` and
`node test/crypto.test.js`.

This is the working spine of the platform specified in the three planning docs at
the repo root (The 28-Room Firm, the Build Sheet, the Privilege Vault). Production
hardening path per the Build Sheet: PostgreSQL + RLS replaces the file store,
Temporal replaces in-process scheduling, Keycloak/passkeys replace password auth,
OpenSearch and the corpora light up Research/Citations — the room modules and
kernel API are shaped so those swap in behind the same interfaces.
