#!/usr/bin/env node
/**
 * Validates data/tough-mudder.json so volunteer edits can't silently break
 * the dashboard. Run locally with:  node scripts/validate-data.mjs
 * The GitHub Action runs this on every push that touches data/.
 * It NEVER blocks deployment — it only emails the committer on failure.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const file = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "tough-mudder.json");
const problems = [];
const warnings = [];

let text;
try {
  text = readFileSync(file, "utf8");
} catch (e) {
  console.error(`✗ Could not read ${file}: ${e.message}`);
  process.exit(1);
}

// Common volunteer mistakes, with line numbers
const lines = text.split("\n");
lines.forEach((line, i) => {
  if (/[“”‘’]/.test(line)) {
    problems.push(`Line ${i + 1}: smart/curly quotes found (usually from pasting out of Word). Use straight quotes " instead.`);
  }
});
{
  // trailing comma before ] or } (may span lines)
  const re = /,\s*[\]}]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const line = text.slice(0, m.index).split("\n").length;
    problems.push(`Line ${line}: extra comma before a closing bracket — remove the comma after the last entry in the list.`);
  }
}

let data;
try {
  data = JSON.parse(text);
} catch (e) {
  const m = e.message.match(/position (\d+)/);
  const line = m ? text.slice(0, +m[1]).split("\n").length : "?";
  problems.push(`Line ${line}: the file is not valid JSON — ${e.message}`);
}

if (data) {
  if (typeof data.event !== "object" || data.event === null) {
    warnings.push("No \"event\" section found — the dashboard will use defaults.");
  } else {
    if (data.event.goal !== undefined && (typeof data.event.goal !== "number" || data.event.goal < 0)) {
      problems.push(`"event.goal" should be a plain number like 15000 (found: ${JSON.stringify(data.event.goal)}).`);
    }
    if (data.event.zeffyEmbedUrl && !/^https:\/\//.test(data.event.zeffyEmbedUrl)) {
      warnings.push(`"event.zeffyEmbedUrl" doesn't start with "https://" — paste just the form's link, not the full embed snippet.`);
    }
  }

  if (!Array.isArray(data.runners)) {
    warnings.push("No \"runners\" list found — the dashboard will show the team-coming-soon message.");
  } else {
    const ids = new Set();
    data.runners.forEach((r, i) => {
      const label = r && r.name ? `Runner "${r.name}"` : `Runner #${i + 1}`;
      if (!r || typeof r !== "object") {
        problems.push(`Runner #${i + 1} is not a valid entry.`);
        return;
      }
      if (typeof r.name !== "string" || !r.name.trim()) {
        problems.push(`Runner #${i + 1} has no "name".`);
      }
      if (r.id) {
        if (ids.has(r.id)) warnings.push(`${label}: duplicate id "${r.id}" — deep links will pick the first one.`);
        ids.add(r.id);
      }
      if (r.zeffyEmbedUrl && !/^https:\/\//.test(r.zeffyEmbedUrl)) {
        warnings.push(`${label}: "zeffyEmbedUrl" doesn't start with "https://" — paste just the form's link, not the full embed snippet.`);
      }
      const donations = r.donations;
      if (donations !== undefined && !Array.isArray(donations)) {
        problems.push(`${label}: "donations" should be a list wrapped in [ ].`);
        return;
      }
      (donations || []).forEach((d, j) => {
        if (!d || typeof d !== "object") {
          problems.push(`${label}, donation #${j + 1}: not a valid entry.`);
          return;
        }
        const amt = typeof d.amount === "string" ? parseFloat(d.amount.replace(/[$,\s]/g, "")) : d.amount;
        if (typeof amt !== "number" || isNaN(amt)) {
          problems.push(`${label}, donation #${j + 1} (${d.donor || "no name"}): "amount" is missing or not a number.`);
        } else if (amt < 0) {
          problems.push(`${label}, donation #${j + 1} (${d.donor || "no name"}): "amount" is negative.`);
        }
      });
    });

    const total =
      (data.runners || []).reduce((s, r) => s + (Array.isArray(r?.donations) ? r.donations : [])
        .reduce((s2, d) => {
          const amt = typeof d?.amount === "string" ? parseFloat(d.amount.replace(/[$,\s]/g, "")) : d?.amount;
          return s2 + (typeof amt === "number" && !isNaN(amt) ? amt : 0);
        }, 0), 0) +
      (typeof data.event?.generalDonations === "number" ? data.event.generalDonations : 0);
    console.log(`ℹ Grand total from this file: $${total.toLocaleString("en-CA")} across ${data.runners.length} runner(s).`);
  }
}

warnings.forEach((w) => console.warn(`⚠ ${w}`));

if (problems.length) {
  console.error(`\n✗ ${problems.length} problem(s) found in data/tough-mudder.json:\n`);
  problems.forEach((p) => console.error(`  • ${p}`));
  console.error("\nHow to fix: open the file on GitHub, click the pencil icon, and correct the line(s) above.");
  console.error("If you're stuck, open the file's History and use 'Revert' — see UPDATING.md.");
  process.exit(1);
}

console.log("✓ data/tough-mudder.json looks good.");
