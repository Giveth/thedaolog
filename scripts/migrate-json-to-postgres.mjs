#!/usr/bin/env node
// One-shot migration from data/{proposals,ballots}.json into Postgres.
//
// Idempotent — re-running won't duplicate data because the underlying
// saveProposals / saveBallots helpers use ON CONFLICT (id) DO UPDATE.
//
// Run: DATABASE_URL=postgres://... node scripts/migrate-json-to-postgres.mjs
//      (or set DATABASE_URL in a .env you source first)
//
// Reads from ../data/ relative to this file's repo root. If a JSON file
// is missing it's silently skipped — first deploys (no prior JSON) won't
// fail here.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  saveProposals,
  saveBallots,
  loadProposals,
  loadBallots,
  pool,
} from "../server/db.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");

async function readJsonOrEmpty(file) {
  try {
    const txt = await readFile(file, "utf8");
    return JSON.parse(txt);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

async function main() {
  const proposalsFile = path.join(DATA_DIR, "proposals.json");
  const ballotsFile = path.join(DATA_DIR, "ballots.json");

  const proposals = await readJsonOrEmpty(proposalsFile);
  const ballots = await readJsonOrEmpty(ballotsFile);

  if (!proposals && !ballots) {
    console.log("[migrate] no JSON data files found — fresh DB, nothing to do.");
    await pool.end();
    return;
  }

  // Pre-state for the summary line at the end.
  const before = {
    proposals: Object.keys(await loadProposals()).length,
    ballots: countBallots(await loadBallots()),
  };

  if (proposals) {
    console.log(`[migrate] importing ${Object.keys(proposals).length} proposals…`);
    // saveProposals does a full-replace, so we merge with existing DB
    // state to avoid wiping rows that might already be in PG from a
    // previous partial migration.
    const existing = await loadProposals();
    await saveProposals({ ...existing, ...proposals });
  }

  if (ballots) {
    const ballotCount = countBallots(ballots);
    console.log(`[migrate] importing ${ballotCount} ballots across ${Object.keys(ballots).length} proposals…`);
    const existing = await loadBallots();
    // Deep-merge per (proposalId, voter).
    const merged = { ...existing };
    for (const [pid, voters] of Object.entries(ballots)) {
      merged[pid] = { ...(merged[pid] || {}), ...voters };
    }
    await saveBallots(merged);
  }

  const after = {
    proposals: Object.keys(await loadProposals()).length,
    ballots: countBallots(await loadBallots()),
  };

  console.log("[migrate] done.");
  console.log(`  proposals: ${before.proposals} → ${after.proposals}`);
  console.log(`  ballots:   ${before.ballots} → ${after.ballots}`);

  await pool.end();
}

function countBallots(map) {
  let n = 0;
  for (const voters of Object.values(map || {})) {
    n += Object.keys(voters || {}).length;
  }
  return n;
}

main().catch((e) => {
  console.error("[migrate] FAILED:", e);
  process.exit(1);
});
