// theDAO/log Postgres storage layer.
//
// Schema (auto-applied on first connect — IF NOT EXISTS so safe to re-run):
//   proposals (id PK, data JSONB, updated_at)
//   ballots   (proposal_id, voter, data JSONB, signed_at; PK is (proposal_id, voter))
//
// The `data` JSONB column holds whatever shape the rest of the app already
// stores — proposals carry {title, description, votingMode, budget,
// options[], deadline, tokenId, createdAt, createdBy, ...}; ballots carry
// {ballot, signature, signedAt, badgeBalance, cid}. Schema is intentionally
// JSONB-heavy so the data model can evolve without migrations until we
// actually need to query into individual fields.
//
// Connection: DATABASE_URL env var, e.g.
//   DATABASE_URL=postgres://thedaolog:thedaolog@localhost:15432/thedaolog
//
// For local dev, run `docker compose up -d db` from the repo root to spin
// up a matching Postgres. On Kay's deploy, point at the org's Postgres.

import pg from "pg";
const { Pool } = pg;

const CONNECTION_STRING =
  process.env.DATABASE_URL ||
  "postgres://thedaolog:thedaolog@localhost:15432/thedaolog";

export const pool = new Pool({
  connectionString: CONNECTION_STRING,
  // Keep pool small — single-process API server with bursty writes during
  // a vote close. 5 connections is plenty.
  max: 5,
  idleTimeoutMillis: 30_000,
});

pool.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error("[db] idle client error", err);
});

let _bootstrapped = false;

export async function bootstrap() {
  if (_bootstrapped) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS proposals (
      id         TEXT PRIMARY KEY,
      data       JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ballots (
      proposal_id TEXT NOT NULL,
      voter       TEXT NOT NULL,
      data        JSONB NOT NULL,
      signed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (proposal_id, voter)
    );

    CREATE INDEX IF NOT EXISTS idx_ballots_proposal ON ballots(proposal_id);
  `);
  _bootstrapped = true;
}

// ---------- proposals ---------------------------------------------------

export async function loadProposals() {
  await bootstrap();
  const { rows } = await pool.query("SELECT id, data FROM proposals");
  const out = {};
  for (const r of rows) out[r.id] = r.data;
  return out;
}

// Full-replace semantics, matching the JSON file behavior. The caller
// passes the entire { id -> proposalData } map; we upsert each row and
// delete anything not present. Wrapped in a transaction for atomicity.
export async function saveProposals(map) {
  await bootstrap();
  const ids = Object.keys(map);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const id of ids) {
      await client.query(
        `INSERT INTO proposals (id, data, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (id) DO UPDATE
           SET data = EXCLUDED.data, updated_at = NOW()`,
        [id, JSON.stringify(map[id])],
      );
    }
    if (ids.length === 0) {
      await client.query("DELETE FROM proposals");
    } else {
      await client.query(
        `DELETE FROM proposals WHERE id <> ALL($1::text[])`,
        [ids],
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// ---------- ballots -----------------------------------------------------

export async function loadBallots() {
  await bootstrap();
  const { rows } = await pool.query(
    "SELECT proposal_id, voter, data FROM ballots",
  );
  // Rebuild the nested { proposalId -> { voter -> data } } shape the
  // JSON file used so the calling route handlers don't need to change.
  const out = {};
  for (const r of rows) {
    if (!out[r.proposal_id]) out[r.proposal_id] = {};
    out[r.proposal_id][r.voter] = r.data;
  }
  return out;
}

// Full-replace semantics, matching saveProposals above. The caller passes
// the entire nested map; we upsert every (proposal_id, voter) pair and
// delete anything not present. Transactional.
export async function saveBallots(map) {
  await bootstrap();
  const present = []; // [proposal_id, voter] pairs
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [proposalId, voters] of Object.entries(map || {})) {
      for (const [voter, data] of Object.entries(voters || {})) {
        present.push([proposalId, voter]);
        await client.query(
          `INSERT INTO ballots (proposal_id, voter, data, signed_at)
           VALUES ($1, $2, $3::jsonb, COALESCE($4, NOW()))
           ON CONFLICT (proposal_id, voter) DO UPDATE
             SET data = EXCLUDED.data, signed_at = COALESCE(EXCLUDED.signed_at, ballots.signed_at)`,
          [proposalId, voter, JSON.stringify(data), data?.signedAt || null],
        );
      }
    }
    // Delete any rows not in the new map. We do this in a single
    // statement using a temp set of (proposal_id, voter) tuples.
    if (present.length === 0) {
      await client.query("DELETE FROM ballots");
    } else {
      // Build VALUES clause for the NOT IN check.
      const placeholders = present
        .map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`)
        .join(", ");
      const flat = present.flat();
      await client.query(
        `DELETE FROM ballots
         WHERE (proposal_id, voter) NOT IN (${placeholders})`,
        flat,
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
