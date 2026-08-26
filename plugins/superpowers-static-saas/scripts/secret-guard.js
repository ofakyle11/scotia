#!/usr/bin/env node
/**
 * PreToolUse guard: pause before writing a high-confidence credential into a file.
 *
 * Tuned for this stack, where a push is a production deploy to a public repo and
 * a leaked key has to be revoked at the source, not just scrubbed from history.
 *
 * Deliberately NOT flagged: the Firebase *web* config (AIza... apiKey, authDomain,
 * projectId, appId). Those are public by design here — see the secrets-and-config
 * skill. Flagging them would train everyone to click through the prompt.
 *
 * Fails open. Any parse error, unexpected shape, or exception exits 0 silently:
 * a broken guard must never block real work.
 */
"use strict";

const PATTERNS = [
  [/\bsk-[A-Za-z0-9_-]{20,}/, "an OpenAI-style secret key (sk-...)"],
  [/\bwhsec_[A-Za-z0-9]{16,}/, "a Stripe webhook signing secret (whsec_...)"],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/, "a GitHub token (ghp_...)"],
  [/\bgithub_pat_[A-Za-z0-9_]{30,}/, "a GitHub fine-grained PAT"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, "a Slack token"],
  [/\bAKIA[0-9A-Z]{16}\b/, "an AWS access key id"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key block"],
  [
    /\b(?:FIREBASE_DB_SECRET|OWNER_TOKEN_SECRET|OWNER_PW_[A-Z0-9_]*|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|WAVESPEED_API_KEY|AIVIDEOAPI_API_KEY|SORA_API_KEY)\s*[:=]\s*["'][^"']{8,}["']/,
    "a hard-coded value for a secret this project keeps in Netlify env vars",
  ],
];

function readStdin() {
  try {
    return require("fs").readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function main() {
  const raw = readStdin();
  if (!raw.trim()) return;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }

  const input = (payload && payload.tool_input) || {};
  const path = String(input.file_path || "");

  // Ignore the plugin's own docs — they describe these patterns on purpose.
  if (/superpowers-static-saas/.test(path)) return;

  const candidates = [input.content, input.new_string]
    .concat(Array.isArray(input.edits) ? input.edits.map((e) => e && e.new_string) : [])
    .filter((v) => typeof v === "string" && v.length);

  if (!candidates.length) return;

  const hits = [];
  for (const text of candidates) {
    for (const [re, label] of PATTERNS) {
      if (re.test(text) && !hits.includes(label)) hits.push(label);
    }
  }
  if (!hits.length) return;

  const reason =
    "Possible credential in this write to " +
    (path || "a file") +
    ": " +
    hits.join("; ") +
    ". On this stack the repo is public and a push deploys immediately, so a " +
    "committed key must be revoked at the source, not just removed. Secrets " +
    "belong in Netlify environment variables, read through lib/env.js " +
    "(see the secrets-and-config skill). Confirm only if this is a placeholder " +
    "or a value that is genuinely public.";

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: reason,
      },
    })
  );
}

try {
  main();
} catch {
  /* fail open */
}
process.exit(0);
