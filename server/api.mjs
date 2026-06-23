// theDAO/log signed-ballot API.
//
// Voters sign EIP-712 typed-data ballots in the dapp; this server verifies
// the signature, checks badgeholder eligibility on-chain, validates the
// QV cost-budget invariant (sum(points²) ≤ budget), and stores the ballot
// keyed by (proposalId, voter). Re-signing replaces the prior ballot.
//
// Storage is a single JSON file (`data/ballots.json`) — fine for the
// Giveth employee test scale (<100 ballots). Migrate to postgres if this
// scales beyond that.
//
// Run:  node server/api.mjs
// Port: 7101  (vite proxies /api/* → here)
import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import {
  createPublicClient,
  createWalletClient,
  http,
  verifyTypedData,
  getAddress,
  keccak256,
  toBytes,
  concat,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum, mainnet } from "viem/chains";
import { pathToFileURL } from "node:url";

// Ballots and proposals now live in Postgres via server/db.mjs.

// BUIDLER badge — Arbitrum test eligibility token (dev rounds). Kept
// hardcoded as the default fallback for any legacy proposal that has
// neither a tokenAddress+tokenChainId nor a known tokenId.
const BUIDLER_CONTRACT = "0x32d664ca9ea4bad60b2b8ed61dec30692df43ac9";
const BUIDLER_CHAIN = arbitrum;

const ERC721_BALANCE_OF_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ type: "address", name: "owner" }],
    outputs: [{ type: "uint256" }],
  },
];

// One viem client per eligibility-token chain — eligibility tokens can
// live on different chains (BUIDLER on Arbitrum, ETHSecurity Badge on
// mainnet), so the balanceOf read needs to route to the right RPC.
//
// Explicit RPC URLs per chain. viem's bare http() falls back to the
// chain's DEFAULT public RPC (cloudflare-eth / eth.merkle.io for
// mainnet), which is aggressively rate-limited and was returning errors
// from the server — surfacing to users as a 503 "rpc_failed" when they
// tried to submit a direction (2026-06-03: Griff hit this on prod). Use
// the same reliable providers the frontend already uses in wagmi.ts.
// Overridable via env (MAINNET_RPC_URL / ARBITRUM_RPC_URL) for ops.
const RPC_URLS = {
  1: process.env.MAINNET_RPC_URL || "https://ethereum-rpc.publicnode.com",
  42161: process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",
};
const chainClients = new Map();
function getChainClient(chain) {
  if (!chainClients.has(chain.id)) {
    const url = RPC_URLS[chain.id];
    chainClients.set(chain.id, createPublicClient({ chain, transport: url ? http(url) : http() }));
  }
  return chainClients.get(chain.id);
}
const onChainClient = getChainClient(BUIDLER_CHAIN);

// TheDAOLogTallyCommit deploy — admin = deployer wallet. Used at vote
// close to anchor a Merkle root of the ballots on-chain.
const TALLY_COMMIT_CONTRACT = "0x6b6cefa25fa3ce9623806a86a08c62e24520513c";
const TALLY_COMMIT_ABI = [
  {
    type: "function",
    name: "commit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "proposalId", type: "string" },
      { name: "root", type: "bytes32" },
      { name: "ballotCount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "roots",
    stateMutability: "view",
    inputs: [{ name: "", type: "string" }],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "ballotCounts",
    stateMutability: "view",
    inputs: [{ name: "", type: "string" }],
    outputs: [{ type: "uint256" }],
  },
];

// IPFS pinning via Pinata — pin every accepted ballot to IPFS so the
// public audit trail is censorship-resistant. Pinata JWT loaded from
// secrets at boot. If absent, pinning is skipped silently (with a log
// warning) — the rest of the API still works.
let _pinataJwt = null;
async function loadPinataJwt() {
  if (_pinataJwt !== null) return _pinataJwt;
  _pinataJwt = process.env.PINATA_JWT || "";
  return _pinataJwt;
}
async function pinToIpfs(name, contentObj) {
  const jwt = await loadPinataJwt();
  if (!jwt) return null;
  try {
    const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pinataMetadata: { name },
        pinataContent: contentObj,
      }),
    });
    if (!res.ok) {
      console.warn("[pinata] HTTP", res.status, await res.text());
      return null;
    }
    const j = await res.json();
    return j.IpfsHash || null;
  } catch (e) {
    console.warn("[pinata] threw:", e.message);
    return null;
  }
}

// GitHub issue intake — every accepted submission either creates a
// new issue in the configured repo or tags an existing one with the
// per-vote label. Token + repo loaded from secrets at boot. If absent,
// GitHub steps are skipped (server still accepts the ballot).
let _ghConfig = null;
async function loadGithubConfig() {
  if (_ghConfig !== null) return _ghConfig;
  _ghConfig = {
    token: process.env.GITHUB_TOKEN || "",
    repo: process.env.THEDAOLOG_GITHUB_REPO || "",
  };
  return _ghConfig;
}
async function ghFetch(path, init = {}) {
  const { token } = await loadGithubConfig();
  if (!token) throw new Error("github_token_missing");
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  return res;
}
// Idempotent — 422 (already exists) is treated as success.
async function ghCreateLabel(name, color = "1f6feb", description = "") {
  const { repo } = await loadGithubConfig();
  if (!repo) return null;
  const res = await ghFetch(`/repos/${repo}/labels`, {
    method: "POST",
    body: JSON.stringify({ name, color, description }),
  });
  if (res.status === 201 || res.status === 422) return name;
  console.warn("[gh] createLabel", res.status, await res.text().catch(() => ""));
  return null;
}
async function ghCreateIssue(title, body, labels = []) {
  const { repo } = await loadGithubConfig();
  if (!repo) return null;
  const res = await ghFetch(`/repos/${repo}/issues`, {
    method: "POST",
    body: JSON.stringify({ title, body, labels }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.warn("[gh] createIssue", res.status, txt);
    throw new Error(`github_create_failed_${res.status}`);
  }
  const j = await res.json();
  return { number: j.number, html_url: j.html_url, title: j.title, body: j.body || "" };
}
// Accepts https://github.com/owner/repo/issues/123 (or /pull/123).
function parseGithubIssueUrl(url) {
  if (!url || typeof url !== "string") return null;
  const m = url.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/(?:issues|pull)\/(\d+)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], number: Number(m[3]) };
}
async function ghFetchIssue(owner, repo, number) {
  const res = await ghFetch(`/repos/${owner}/${repo}/issues/${number}`);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`github_fetch_failed_${res.status}: ${txt.slice(0, 200)}`);
  }
  const j = await res.json();
  return { number: j.number, html_url: j.html_url, title: j.title, body: j.body || "", labels: (j.labels || []).map((l) => l.name) };
}
async function ghAddLabels(owner, repo, number, labels) {
  const res = await ghFetch(`/repos/${owner}/${repo}/issues/${number}/labels`, {
    method: "POST",
    body: JSON.stringify({ labels }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.warn("[gh] addLabels", res.status, txt);
  }
}

// Deployer / admin wallet — used to send the commit tx. Loaded once.
let _deployerAccount = null;
function normalizePrivateKey(privateKey) {
  if (!privateKey) return "";
  return privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
}
async function getDeployerAccount() {
  if (_deployerAccount) return _deployerAccount;
  const privateKey = normalizePrivateKey(process.env.DEPLOYER_PRIVATE_KEY);
  if (!privateKey) {
    throw new Error("DEPLOYER_PRIVATE_KEY is required to commit roots on-chain");
  }
  _deployerAccount = privateKeyToAccount(privateKey);
  return _deployerAccount;
}

// ---------- Merkle helpers (sorted-pair, OZ-compatible style) ------
// Leaf is keccak256 of a canonical "voter:signature" string. Pairs are
// hashed in sorted order so the same root is reached regardless of
// left/right ordering.
function leafHash(ballotEntry) {
  const voter = ballotEntry.ballot.voter.toLowerCase();
  const sig = ballotEntry.signature.toLowerCase();
  return keccak256(toBytes(voter + ":" + sig));
}
function hashPair(a, b) {
  // sort by raw bytes
  const left = a < b ? a : b;
  const right = a < b ? b : a;
  return keccak256(concat([left, right]));
}
function computeMerkleRoot(leaves) {
  if (leaves.length === 0) return "0x" + "00".repeat(32);
  let layer = [...leaves];
  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      if (i + 1 === layer.length) {
        // odd man out — promote to next layer unchanged (OZ-style)
        next.push(layer[i]);
      } else {
        next.push(hashPair(layer[i], layer[i + 1]));
      }
    }
    layer = next;
  }
  return layer[0];
}
// Canonical leaf set for a proposal — sorted by voter address ascending.
function canonicalLeaves(ballotsByVoter) {
  return Object.entries(ballotsByVoter)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, b]) => leafHash(b));
}

// ---------- EIP-712 schema ----------------------------------------
// chainId is Ethereum mainnet (1) — must match the frontend's domain
// so signatures verify. We use mainnet because that's the chain wagmi
// is connecting wallets to; signatures are off-chain so it's fine to
// decouple from where the badge contract lives (Arbitrum).
const DOMAIN = {
  name: "murmurations",
  version: "1",
  chainId: 1,
};

const BALLOT_TYPES = {
  Allocation: [
    { name: "issueId", type: "uint256" },
    { name: "points", type: "uint256" },
  ],
  Ballot: [
    { name: "voter", type: "address" },
    { name: "proposalId", type: "string" },
    { name: "allocations", type: "Allocation[]" },
    { name: "budget", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
};

// Admin actions are also EIP-712 signed. The signed payload locks the
// action ("create_proposal" | "delete_proposal") to a specific
// proposalId, actor, and signing window — so a captured signature
// can't be replayed against a different action.
const ADMIN_ACTION_TYPES = {
  AdminAction: [
    { name: "action", type: "string" },
    { name: "proposalId", type: "string" },
    { name: "actor", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

// Hardcoded admin allowlist — must match main.tsx's ADMIN_ADDRESSES.
// Lowercased for case-insensitive comparison.
const ADMIN_ADDRESSES = new Set([
  "0xb0bb2dafd918104c1a7761430fd51e7776749edf",
  "0x72315dddeb862cd484b9f37d37952ec9080557cd",
  "0x839395e20bbb182fa440d08f850e6c7a8f6f0780", // Griff
  // Extra per-environment admins (comma-separated), mirroring the client's
  // VITE_EXTRA_ADMIN_ADDRESSES. Unset on prod; used by the test suite.
  ...String(process.env.EXTRA_ADMIN_ADDRESSES || "")
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean),
]);

// Staging-only escape hatch: when ALLOW_ADMIN_VOTE_BYPASS=1 (set only on the
// dev/staging server, NEVER prod), admin wallets may cast ballots without
// holding the proposal's eligibility badge, so Zep can test the voter flow
// end to end. Prod leaves this unset, so the strict not_a_badgeholder gate
// (Zep 2026-06-03) stays in force. The voter address is the EIP-712 signature
// signer, so a non-admin cannot spoof their way past it. (Added 2026-06-22.)
// Read per-request (not cached at boot) so the value reflects the current
// environment — prod never sets it; the test suite toggles it per case.
function allowAdminVoteBypass() {
  return process.env.ALLOW_ADMIN_VOTE_BYPASS === "1";
}

// EIP-712 type for admin-signed option (issue) deletions. Lets admins
// remove an issue from a vote without invalidating already-cast ballots:
// the option stays in the underlying record marked deleted: true, and
// the tally / budget math just skips allocations pointing at it. Voters
// recover the points they had on the deleted issue and can re-allocate
// without needing to re-sign their original ballot (though to actually
// USE those freed points, they sign a new ballot which replaces the old).
const OPTION_DELETE_TYPES = {
  OptionDelete: [
    { name: "action", type: "string" },
    { name: "proposalId", type: "string" },
    { name: "optionId", type: "uint256" },
    { name: "actor", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

// EIP-712 type for badgeholder-signed issue submissions. Server
// verifies: signature recovers to submitter, submitter holds the
// proposal's eligibility token, signing window not expired.
const ISSUE_SUBMISSION_TYPES = {
  IssueSubmission: [
    { name: "submitter", type: "address" },
    { name: "proposalId", type: "string" },
    { name: "label", type: "string" },
    { name: "body", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

async function verifyAdminAction(req, expectedAction, expectedProposalId) {
  const adminAuth = req.body?.adminAuth;
  if (!adminAuth || !adminAuth.action || !adminAuth.signature) {
    return { ok: false, code: 401, error: "missing_admin_signature" };
  }
  if (adminAuth.action.action !== expectedAction) {
    return { ok: false, code: 400, error: "action_mismatch" };
  }
  if (adminAuth.action.proposalId !== expectedProposalId) {
    return { ok: false, code: 400, error: "proposal_id_mismatch" };
  }
  if (Number(adminAuth.action.deadline) * 1000 < Date.now()) {
    return { ok: false, code: 400, error: "signature_expired" };
  }
  let actor;
  try {
    actor = getAddress(adminAuth.action.actor);
  } catch {
    return { ok: false, code: 400, error: "bad_actor_address" };
  }
  if (!ADMIN_ADDRESSES.has(actor.toLowerCase())) {
    return { ok: false, code: 403, error: "not_an_admin" };
  }
  let valid;
  try {
    valid = await verifyTypedData({
      address: actor,
      domain: DOMAIN,
      types: ADMIN_ACTION_TYPES,
      primaryType: "AdminAction",
      message: {
        action: adminAuth.action.action,
        proposalId: adminAuth.action.proposalId,
        actor: actor,
        nonce: BigInt(adminAuth.action.nonce ?? 0),
        deadline: BigInt(adminAuth.action.deadline),
      },
      signature: adminAuth.signature,
    });
  } catch (e) {
    return { ok: false, code: 400, error: "signature_verification_threw", detail: e.message };
  }
  if (!valid) return { ok: false, code: 401, error: "invalid_signature" };
  return { ok: true, actor };
}

// Same shape as verifyAdminAction but for OptionDelete (carries optionId
// in the signed payload). Kept separate so the EIP-712 schema for plain
// AdminAction stays untouched and can't be replayed against an option.
async function verifyOptionDelete(req, expectedProposalId, expectedOptionId) {
  const auth = req.body?.optionDeleteAuth;
  if (!auth || !auth.action || !auth.signature) {
    return { ok: false, code: 401, error: "missing_admin_signature" };
  }
  if (auth.action.action !== "delete_option") {
    return { ok: false, code: 400, error: "action_mismatch" };
  }
  if (auth.action.proposalId !== expectedProposalId) {
    return { ok: false, code: 400, error: "proposal_id_mismatch" };
  }
  if (Number(auth.action.optionId) !== Number(expectedOptionId)) {
    return { ok: false, code: 400, error: "option_id_mismatch" };
  }
  if (Number(auth.action.deadline) * 1000 < Date.now()) {
    return { ok: false, code: 400, error: "signature_expired" };
  }
  let actor;
  try {
    actor = getAddress(auth.action.actor);
  } catch {
    return { ok: false, code: 400, error: "bad_actor_address" };
  }
  if (!ADMIN_ADDRESSES.has(actor.toLowerCase())) {
    return { ok: false, code: 403, error: "not_an_admin" };
  }
  let valid;
  try {
    valid = await verifyTypedData({
      address: actor,
      domain: DOMAIN,
      types: OPTION_DELETE_TYPES,
      primaryType: "OptionDelete",
      message: {
        action: auth.action.action,
        proposalId: auth.action.proposalId,
        optionId: BigInt(auth.action.optionId),
        actor: actor,
        nonce: BigInt(auth.action.nonce ?? 0),
        deadline: BigInt(auth.action.deadline),
      },
      signature: auth.signature,
    });
  } catch (e) {
    return { ok: false, code: 400, error: "signature_verification_threw", detail: e.message };
  }
  if (!valid) return { ok: false, code: 401, error: "invalid_signature" };
  return { ok: true, actor };
}

// ---------- storage helpers ---------------------------------------
//
// Storage moved from local JSON files (data/ballots.json,
// data/proposals.json) to Postgres in commit <DB-MIGRATION>. The
// loadBallots/saveBallots/loadProposals/saveProposals API surface is
// preserved exactly (same map shapes in and out) so the route handlers
// below don't need to know about the change. Set DATABASE_URL to point
// at your Postgres; see server/db.mjs and docker-compose.yml.
//
// ballots map shape (unchanged):
// {
//   "<proposalId>": {
//     "<voterAddress.toLowerCase()>": { ballot, signature, signedAt, ... }
//   }
// }
//
// proposals map shape (unchanged):
// {
//   "<proposalId>": {
//     id, title, description, votingMode, budget, options[], deadline,
//     createdAt, createdBy, ...
//   }
// }
import {
  loadBallots,
  saveBallots,
  loadProposals,
  saveProposals,
} from "./db.mjs";

// ---------- server ------------------------------------------------
export const app = Fastify({ logger: { level: process.env.LOG_LEVEL || "info" } });
await app.register(cors, { origin: true });

app.get("/api/health", async () => ({ ok: true }));

// Self-describing index of the public read API, so consumers can discover
// what's available (Netto asked "is there an API?"). Public, read-only,
// CORS-open. Returns JSON. Human docs live in the repo (API.md) rather than
// surfaced in the app — non-tech users wouldn't use a raw API, and devs read
// the repo. (Per Zep 2026-06-22.)
app.get("/api", async () => ({
  service: "theDAOlog murmuration API",
  version: 1,
  docs: "https://github.com/Giveth/thedaolog/blob/main/API.md",
  readEndpoints: {
    listProposals: "GET /api/proposals — all votes (lightweight public view)",
    getProposal: "GET /api/proposals/:id — one vote + live tally (points per option) + voterCount",
    listBallots: "GET /api/proposals/:id/ballots — the signed ballots cast on a vote",
    onchainCommit: "GET /api/proposals/:id/commit — on-chain merkle root + ballot count",
    localRoot: "GET /api/proposals/:id/local-root — locally-computed merkle root",
    health: "GET /api/health",
  },
  proposalFields: [
    "id", "title", "description", "votingMode (quadratic|token-weight)",
    "budget", "options[] ({id,title,body})", "deadline (ISO, close time)",
    "opensAt (ISO start time; null = live immediately)", "rolling",
    "tokenAddress", "tokenChainId", "createdAt", "createdBy",
  ],
  notes: "Read-only and public, no API key required. Casting a vote requires a signed EIP-712 ballot (POST, wallet). A vote is live when now is between opensAt and deadline.",
}));

// Fetch a public GitHub issue's title/body so the Import-from-GitHub
// flow can show a preview before the badgeholder signs. Pure read —
// uses our PAT only to avoid unauth rate limits, no scopes required.
app.get("/api/github/preview", async (req, reply) => {
  const url = req.query?.url;
  const target = parseGithubIssueUrl(url);
  if (!target) return reply.code(400).send({ error: "bad_github_url", detail: "expected https://github.com/owner/repo/issues/N" });
  try {
    const fetched = await ghFetchIssue(target.owner, target.repo, target.number);
    return { ok: true, ...fetched };
  } catch (e) {
    app.log.warn({ err: e.message }, "preview fetch failed");
    return reply.code(502).send({ error: "github_fetch_failed", detail: e.message });
  }
});

// Strip soft-deleted options out of the public view, but expose their
// IDs separately so the client can filter local allocations + recompute
// remaining budget for voters who had points on a now-deleted option.
function publicProposalView(p) {
  const allOpts = p.options || [];
  const deletedOptionIds = allOpts.filter((o) => o.deleted).map((o) => Number(o.id));
  return {
    ...p,
    options: allOpts.filter((o) => !o.deleted),
    deletedOptionIds,
  };
}

// List proposals (lightweight — for the dashboard)
app.get("/api/proposals", async () => {
  const proposals = await loadProposals();
  return { proposals: Object.values(proposals).map(publicProposalView) };
});

// Read one proposal, with the live tally derived from current ballots.
// Allocations pointing at soft-deleted options are skipped so the tally
// reflects only still-active issues.
app.get("/api/proposals/:id", async (req, reply) => {
  const proposals = await loadProposals();
  const p = proposals[req.params.id];
  if (!p) return reply.code(404).send({ error: "proposal_not_found" });
  const view = publicProposalView(p);
  const deletedSet = new Set(view.deletedOptionIds);
  const ballots = (await loadBallots())[req.params.id] || {};
  const tally = {};
  for (const v of Object.values(ballots)) {
    for (const a of v.ballot.allocations) {
      if (deletedSet.has(Number(a.issueId))) continue;
      tally[a.issueId] = (tally[a.issueId] || 0) + Number(a.points);
    }
  }
  return { proposal: view, tally, voterCount: Object.keys(ballots).length };
});

// Admin: create a proposal. Open-write for now (the admin's UI is
// already gated by the wallet-role check on the frontend); sign-on-create
// would be the next hardening step.
//
// `options` may be empty — the F2 flow lets admins create an empty vote
// shell that voters then submit issues into via POST /:id/options.
app.post("/api/proposals", async (req, reply) => {
  const { id, title, description, votingMode, budget, options, deadline, opensAt, tokenId, tokenAddress, tokenChainId } = req.body;
  if (!id || !title || !deadline) {
    return reply.code(400).send({ error: "missing_fields", needs: ["id", "title", "deadline"] });
  }
  // Validate the eligibility-token spec. Either form is acceptable:
  //   - tokenAddress + tokenChainId (new flow — admin-added tokens
  //     work without a server code change)
  //   - tokenId pointing at the legacy registry
  // If tokenAddress is set without tokenChainId (or vice versa), reject
  // — we never want a half-specified spec landing in the DB.
  let _tokenAddress = null;
  let _tokenChainId = null;
  if (tokenAddress || tokenChainId) {
    if (!tokenAddress || !tokenChainId) {
      return reply.code(400).send({ error: "token_spec_incomplete", detail: "tokenAddress and tokenChainId must both be set" });
    }
    try {
      _tokenAddress = getAddress(tokenAddress).toLowerCase();
    } catch {
      return reply.code(400).send({ error: "bad_token_address" });
    }
    _tokenChainId = Number(tokenChainId);
    if (!SUPPORTED_ELIGIBILITY_CHAINS[_tokenChainId]) {
      return reply.code(400).send({
        error: "unsupported_token_chain",
        detail: "tokenChainId must be one of: " + Object.keys(SUPPORTED_ELIGIBILITY_CHAINS).join(", "),
      });
    }
  }
  const verdict = await verifyAdminAction(req, "create_proposal", id);
  if (!verdict.ok) return reply.code(verdict.code).send({ error: verdict.error, detail: verdict.detail });
  const proposals = await loadProposals();
  proposals[id] = {
    id,
    title,
    description: description || "",
    votingMode: votingMode || "quadratic",
    budget: Number(budget || 100),
    options: Array.isArray(options) ? options : [],
    deadline,
    opensAt: opensAt || null,
    tokenId: tokenId || null,
    tokenAddress: _tokenAddress,
    tokenChainId: _tokenChainId,
    createdAt: new Date().toISOString(),
    createdBy: verdict.actor,
  };
  await saveProposals(proposals);
  // Best-effort: provision a per-vote label in the GitHub intake repo.
  // Failures here don't block proposal creation — issue submission will
  // still work, the label will just be auto-created on first use.
  try {
    await ghCreateLabel(`vote:${id}`, "1f6feb", `Issues for theDAOlog vote: ${title}`);
  } catch (e) {
    app.log.warn({ err: e.message }, "github label create failed (non-fatal)");
  }
  return { ok: true, proposal: proposals[id] };
});

// Add a new option (issue) to an existing proposal. Requires the
// submitter to sign an EIP-712 IssueSubmission AND hold the
// proposal's eligibility badge on-chain. The id auto-increments above
// the current max so it never collides with an existing option, even
// if some have been deleted.
//
// Token-registry → contract-address resolution is intentionally simple
// for now: the proposal's tokenId only carries weight if it matches
// our hardcoded registry (the BUIDLER badge). Once the registry is
// shared between server + client, look up via that.
// Legacy registry kept only for proposals created before the
// tokenAddress + tokenChainId fields landed. New proposals carry the
// eligibility-token address directly so admin-added tokens just work
// without a server code change.
const KNOWN_ELIGIBILITY_TOKENS = {
  "tok-buidler": { address: BUIDLER_CONTRACT, chain: BUIDLER_CHAIN },
};
const DEFAULT_ELIGIBILITY_TOKEN_ID = "tok-buidler";

// Chains we allow eligibility-token reads against. Each entry is the
// viem chain object — used both to construct the per-chain RPC client
// and to validate incoming tokenChainId at proposal-create time.
const SUPPORTED_ELIGIBILITY_CHAINS = {
  [mainnet.id]: mainnet,
  [arbitrum.id]: arbitrum,
};

// Resolve a proposal to its eligibility-token spec. Prefer the
// proposal's own tokenAddress + tokenChainId (new flow); fall back to
// the legacy KNOWN_ELIGIBILITY_TOKENS lookup by tokenId.
function resolveEligibilitySpec(p) {
  if (p.tokenAddress && p.tokenChainId) {
    const chain = SUPPORTED_ELIGIBILITY_CHAINS[Number(p.tokenChainId)];
    if (!chain) return null;
    return { address: p.tokenAddress, chain };
  }
  const tokenId = p.tokenId || DEFAULT_ELIGIBILITY_TOKEN_ID;
  return KNOWN_ELIGIBILITY_TOKENS[tokenId] || null;
}

app.post("/api/proposals/:id/options", async (req, reply) => {
  const { label, body: optBody, submission, signature, githubUrl } = req.body || {};
  if (!label || typeof label !== "string") {
    return reply.code(400).send({ error: "missing_label" });
  }
  if (!submission || !signature) {
    return reply.code(401).send({ error: "missing_signed_submission" });
  }
  // Import mode validation: if a githubUrl was passed, parse it now so
  // we can fail fast before any wallet round-trips.
  let importTarget = null;
  if (githubUrl) {
    importTarget = parseGithubIssueUrl(githubUrl);
    if (!importTarget) return reply.code(400).send({ error: "bad_github_url", detail: "expected https://github.com/owner/repo/issues/N" });
  }
  const proposals = await loadProposals();
  const p = proposals[req.params.id];
  if (!p) return reply.code(404).send({ error: "proposal_not_found" });
  if (Date.now() > new Date(p.deadline).getTime()) {
    return reply.code(400).send({ error: "voting_closed" });
  }
  // Submission consistency
  if (submission.proposalId !== req.params.id) {
    return reply.code(400).send({ error: "proposal_id_mismatch" });
  }
  if (submission.label !== label) {
    return reply.code(400).send({ error: "label_mismatch" });
  }
  if (Number(submission.deadline) * 1000 < Date.now()) {
    return reply.code(400).send({ error: "signature_expired" });
  }
  let submitter;
  try {
    submitter = getAddress(submission.submitter);
  } catch {
    return reply.code(400).send({ error: "bad_submitter_address" });
  }
  // Verify signature
  let valid;
  try {
    valid = await verifyTypedData({
      address: submitter,
      domain: DOMAIN,
      types: ISSUE_SUBMISSION_TYPES,
      primaryType: "IssueSubmission",
      message: {
        submitter: submitter,
        proposalId: submission.proposalId,
        label: submission.label,
        body: submission.body || "",
        nonce: BigInt(submission.nonce ?? 0),
        deadline: BigInt(submission.deadline),
      },
      signature,
    });
  } catch (e) {
    app.log.error(e);
    return reply.code(400).send({ error: "signature_verification_threw", detail: e.message });
  }
  if (!valid) return reply.code(401).send({ error: "invalid_signature" });

  // Badge check. Admins (in the allowlist) bypass — they can submit on
  // behalf of anyone for setup purposes. Otherwise the submitter must
  // hold the proposal's eligibility badge on whichever chain the
  // proposal specifies (mainnet for production badges, Arbitrum for
  // the dev BUIDLER badge).
  if (!ADMIN_ADDRESSES.has(submitter.toLowerCase())) {
    const tokenSpec = resolveEligibilitySpec(p);
    if (!tokenSpec) {
      return reply.code(403).send({
        error: "no_known_eligibility_token",
        detail: "proposal has no usable eligibility token (neither tokenAddress+tokenChainId nor a registered tokenId)",
      });
    }
    let badgeBalance;
    try {
      badgeBalance = await getChainClient(tokenSpec.chain).readContract({
        address: tokenSpec.address,
        abi: ERC721_BALANCE_OF_ABI,
        functionName: "balanceOf",
        args: [submitter],
      });
    } catch (e) {
      app.log.error(e);
      return reply.code(503).send({ error: "rpc_failed", detail: e.message });
    }
    if (badgeBalance === 0n) {
      return reply.code(403).send({ error: "not_a_badgeholder" });
    }
  }

  // GitHub intake: import mode tags an existing issue, compose mode
  // creates a new one. Failures here are fatal to the submit because
  // the GitHub link is the canonical record for this prototype.
  const voteLabel = `vote:${req.params.id}`;
  let githubMeta = null;
  try {
    if (importTarget) {
      // Re-fetch authoritative title/body — use what's on GitHub right
      // now (not the typed-in copy) so the option always mirrors the
      // public issue. Then attach the per-vote label.
      const fetched = await ghFetchIssue(importTarget.owner, importTarget.repo, importTarget.number);
      await ghAddLabels(importTarget.owner, importTarget.repo, importTarget.number, [voteLabel]).catch((e) => {
        // Tagging may fail on repos we don't own (no write perms). Log
        // but accept the submission — the link itself is still valid.
        app.log.warn({ err: e.message, url: githubUrl }, "could not add vote label to external issue");
      });
      githubMeta = {
        url: fetched.html_url,
        number: fetched.number,
        owner: importTarget.owner,
        repo: importTarget.repo,
        source: "import",
        fetchedTitle: fetched.title,
        fetchedBody: fetched.body,
      };
    } else {
      // Compose mode: create a brand-new issue in the configured intake
      // repo with the typed title+body and the per-vote label.
      await ghCreateLabel(voteLabel, "1f6feb", `Issues for theDAOlog vote: ${p.title}`);
      const created = await ghCreateIssue(label, optBody || "", [voteLabel]);
      if (created) {
        const cfg = await loadGithubConfig();
        const [owner, repo] = (cfg.repo || "/").split("/");
        githubMeta = {
          url: created.html_url,
          number: created.number,
          owner,
          repo,
          source: "compose",
        };
      }
    }
  } catch (e) {
    app.log.error({ err: e.message }, "github intake failed");
    return reply.code(502).send({ error: "github_intake_failed", detail: e.message });
  }

  const existingIds = (p.options || []).map((o) => Number(o.id));
  const nextId = existingIds.length === 0 ? 1 : Math.max(...existingIds) + 1;
  const newOption = {
    id: nextId,
    label,
    body: optBody || "",
    submittedBy: submitter,
    github: githubMeta,
  };
  p.options = [...(p.options || []), newOption];
  proposals[req.params.id] = p;
  await saveProposals(proposals);
  return { ok: true, proposal: p, option: newOption };
});

// Admin-soft-delete an option (issue) inside a proposal. Doesn't wipe
// the option from disk — just marks it deleted: true so already-cast
// ballots stay valid (their signature still matches their original
// allocations) while the tally + budget math skip the deleted option's
// allocations. Voters effectively recover the points they had on the
// deleted option; to actually USE those points elsewhere they sign a
// new ballot which replaces the old one (existing /vote behavior).
app.delete("/api/proposals/:id/options/:optionId", async (req, reply) => {
  const proposalId = req.params.id;
  const optionId = Number(req.params.optionId);
  if (!Number.isFinite(optionId)) {
    return reply.code(400).send({ error: "bad_option_id" });
  }
  const proposals = await loadProposals();
  const p = proposals[proposalId];
  if (!p) return reply.code(404).send({ error: "proposal_not_found" });
  const idx = (p.options || []).findIndex((o) => Number(o.id) === optionId);
  if (idx === -1) return reply.code(404).send({ error: "option_not_found" });
  if (p.options[idx].deleted) return reply.code(409).send({ error: "already_deleted" });
  const verdict = await verifyOptionDelete(req, proposalId, optionId);
  if (!verdict.ok) return reply.code(verdict.code).send({ error: verdict.error, detail: verdict.detail });
  p.options[idx] = {
    ...p.options[idx],
    deleted: true,
    deletedAt: new Date().toISOString(),
    deletedBy: verdict.actor,
  };
  proposals[proposalId] = p;
  await saveProposals(proposals);
  return { ok: true, deletedOptionId: optionId, by: verdict.actor };
});

// Delete a proposal + all its ballots. Admin-only in spirit (the UI
// gates the Delete button to the admin role); the API itself is open
// for now since we don't have a server-side admin auth pattern. Add
// signature-gated auth here when the cloud migration lands.
app.delete("/api/proposals/:id", async (req, reply) => {
  const proposalId = req.params.id;
  const proposals = await loadProposals();
  if (!proposals[proposalId]) return reply.code(404).send({ error: "proposal_not_found" });
  const verdict = await verifyAdminAction(req, "delete_proposal", proposalId);
  if (!verdict.ok) return reply.code(verdict.code).send({ error: verdict.error, detail: verdict.detail });
  delete proposals[proposalId];
  await saveProposals(proposals);
  const ballots = await loadBallots();
  if (ballots[proposalId]) {
    delete ballots[proposalId];
    await saveBallots(ballots);
  }
  return { ok: true, deleted: proposalId, by: verdict.actor };
});

// All ballots for a proposal — public, anyone can re-verify each
// signature against (DOMAIN, BALLOT_TYPES, ballot, signature) and
// recover the signer. This is the audit-trail surface.
app.get("/api/proposals/:id/ballots", async (req) => {
  const all = await loadBallots();
  return { ballots: Object.values(all[req.params.id] || {}) };
});

// Cast a vote. Body: { ballot, signature }. Validates everything; on
// success replaces any prior ballot from the same voter.
app.post("/api/proposals/:id/vote", async (req, reply) => {
  const { ballot, signature } = req.body || {};
  if (!ballot || !signature) {
    return reply.code(400).send({ error: "missing_ballot_or_signature" });
  }

  // Shape checks
  if (typeof ballot.voter !== "string" || typeof ballot.proposalId !== "string") {
    return reply.code(400).send({ error: "bad_ballot_shape" });
  }
  if (ballot.proposalId !== req.params.id) {
    return reply.code(400).send({ error: "proposal_id_mismatch" });
  }
  if (!Array.isArray(ballot.allocations)) {
    return reply.code(400).send({ error: "bad_allocations" });
  }

  // Proposal must exist + still be open
  const proposals = await loadProposals();
  const proposal = proposals[req.params.id];
  if (!proposal) return reply.code(404).send({ error: "proposal_not_found" });
  const deadlineMs = new Date(proposal.deadline).getTime();
  if (Number.isNaN(deadlineMs)) return reply.code(500).send({ error: "bad_proposal_deadline" });
  if (Date.now() > deadlineMs) return reply.code(400).send({ error: "voting_closed" });
  // Scheduled vote: reject ballots before the opens time (defense in depth;
  // the client also hides the voting UI until then). Added 2026-06-22 per Zep.
  if (proposal.opensAt) {
    const opensMs = new Date(proposal.opensAt).getTime();
    if (!Number.isNaN(opensMs) && Date.now() < opensMs) {
      return reply.code(400).send({ error: "voting_not_started", opensAt: proposal.opensAt });
    }
  }

  // EIP-712 signature verification
  let voterAddr;
  try {
    voterAddr = getAddress(ballot.voter);
  } catch {
    return reply.code(400).send({ error: "bad_voter_address" });
  }
  const message = {
    voter: voterAddr,
    proposalId: ballot.proposalId,
    allocations: ballot.allocations.map((a) => ({
      issueId: BigInt(a.issueId),
      points: BigInt(a.points),
    })),
    budget: BigInt(ballot.budget),
    deadline: BigInt(ballot.deadline),
    nonce: BigInt(ballot.nonce ?? 0),
  };
  let valid;
  try {
    valid = await verifyTypedData({
      address: voterAddr,
      domain: DOMAIN,
      types: BALLOT_TYPES,
      primaryType: "Ballot",
      message,
      signature,
    });
  } catch (e) {
    app.log.error(e);
    return reply.code(400).send({ error: "signature_verification_threw", detail: e.message });
  }
  if (!valid) return reply.code(401).send({ error: "invalid_signature" });

  // QV cost-budget check
  const claimedBudget = Number(ballot.budget);
  if (proposal.votingMode === "quadratic") {
    const cost = ballot.allocations.reduce((s, a) => s + Number(a.points) ** 2, 0);
    if (cost > claimedBudget) return reply.code(400).send({ error: "over_budget", cost, budget: claimedBudget });
  } else {
    // Token-weight: linear cost (1 point = 1 credit)
    const cost = ballot.allocations.reduce((s, a) => s + Number(a.points), 0);
    if (cost > claimedBudget) return reply.code(400).send({ error: "over_budget", cost, budget: claimedBudget });
  }
  // Budget claim must match what the proposal declared (otherwise voters
  // could lie about their budget in the signed message).
  if (claimedBudget !== Number(proposal.budget)) {
    return reply.code(400).send({ error: "budget_mismatch", expected: proposal.budget, got: claimedBudget });
  }

  // Allocations must reference real options
  const validOptionIds = new Set(proposal.options.map((o) => Number(o.id)));
  for (const a of ballot.allocations) {
    if (!validOptionIds.has(Number(a.issueId))) {
      return reply.code(400).send({ error: "unknown_option", issueId: a.issueId });
    }
    if (Number(a.points) < 0) return reply.code(400).send({ error: "negative_points" });
  }

  // Eligibility: voter must hold ≥1 of the proposal's eligibility badge,
  // on whichever chain the proposal specifies (mainnet for production
  // badges, Arbitrum for the dev BUIDLER badge). This MUST resolve the
  // badge from the proposal (same as the issue-submission path) — a
  // hardcoded BUIDLER/Arbitrum read wrongly rejects genuine holders of
  // a mainnet badge with not_a_badgeholder.
  //
  // Skipped only when an admin signs AND ALLOW_ADMIN_VOTE_BYPASS is on
  // (staging). Prod never sets the flag, so the check below always runs.
  const _voterIsAdmin = ADMIN_ADDRESSES.has(voterAddr.toLowerCase());
  // Stored with the ballot record below. Declared out here (not inside the
  // eligibility block) so the admin staging-bypass path still has a value;
  // defaults to 0n and the on-chain read overwrites it on the normal path.
  let badgeBalance = 0n;
  if (!(allowAdminVoteBypass() && _voterIsAdmin)) {
    const tokenSpec = resolveEligibilitySpec(proposal);
    if (!tokenSpec) {
      return reply.code(403).send({
        error: "no_known_eligibility_token",
        detail: "proposal has no usable eligibility token (neither tokenAddress+tokenChainId nor a registered tokenId)",
      });
    }
    try {
      badgeBalance = await getChainClient(tokenSpec.chain).readContract({
        address: tokenSpec.address,
        abi: ERC721_BALANCE_OF_ABI,
        functionName: "balanceOf",
        args: [voterAddr],
      });
    } catch (e) {
      app.log.error(e);
      return reply.code(503).send({ error: "rpc_failed", detail: e.message });
    }
    if (badgeBalance === 0n) {
      return reply.code(403).send({ error: "not_a_badgeholder" });
    }
  }

  // Pin to IPFS (best-effort; if Pinata isn't configured, cid is null).
  const cid = await pinToIpfs(
    `thedaolog-ballot-${req.params.id}-${voterAddr.toLowerCase()}.json`,
    { ballot, signature, signedAt: new Date().toISOString() },
  );

  // Store / replace
  const all = await loadBallots();
  if (!all[req.params.id]) all[req.params.id] = {};
  all[req.params.id][voterAddr.toLowerCase()] = {
    ballot,
    signature,
    signedAt: new Date().toISOString(),
    badgeBalance: badgeBalance.toString(),
    cid: cid || null,
  };
  await saveBallots(all);

  return { ok: true, voter: voterAddr, cid: cid || null };
});

// Read the on-chain Merkle commit + ballot count for a proposal
// (anyone, no auth — this is public verification).
app.get("/api/proposals/:id/commit", async (req, reply) => {
  try {
    const [root, count] = await Promise.all([
      onChainClient.readContract({
        address: TALLY_COMMIT_CONTRACT,
        abi: TALLY_COMMIT_ABI,
        functionName: "roots",
        args: [req.params.id],
      }),
      onChainClient.readContract({
        address: TALLY_COMMIT_CONTRACT,
        abi: TALLY_COMMIT_ABI,
        functionName: "ballotCounts",
        args: [req.params.id],
      }),
    ]);
    return {
      contract: TALLY_COMMIT_CONTRACT,
      chain: "arbitrum-one",
      proposalId: req.params.id,
      root,
      ballotCount: count.toString(),
      committed: root !== "0x0000000000000000000000000000000000000000000000000000000000000000",
    };
  } catch (e) {
    return reply.code(503).send({ error: "rpc_failed", detail: e.message });
  }
});

// Compute the local Merkle root for a proposal — useful as an audit
// preview before committing on-chain. Anyone can call.
app.get("/api/proposals/:id/local-root", async (req) => {
  const all = await loadBallots();
  const bs = all[req.params.id] || {};
  const leaves = canonicalLeaves(bs);
  const root = computeMerkleRoot(leaves);
  return { proposalId: req.params.id, root, ballotCount: leaves.length };
});

// Commit the Merkle root on-chain. Admin-only via wallet possession of
// the deployer key (we run the tx ourselves; no separate auth — anyone
// who knows this URL just triggers the same idempotent commit).
// The contract enforces write-once.
app.post("/api/proposals/:id/commit", async (req, reply) => {
  try {
    const proposalId = req.params.id;
    const proposals = await loadProposals();
    const p = proposals[proposalId];
    if (!p) return reply.code(404).send({ error: "proposal_not_found" });

    // Only commit after deadline (avoid premature/in-flight commits).
    if (Date.now() < new Date(p.deadline).getTime()) {
      return reply.code(400).send({ error: "deadline_not_passed", deadline: p.deadline });
    }

    const all = await loadBallots();
    const bs = all[proposalId] || {};
    const leaves = canonicalLeaves(bs);
    if (leaves.length === 0) {
      return reply.code(400).send({ error: "no_ballots_to_commit" });
    }
    const root = computeMerkleRoot(leaves);

    // Check if already committed (don't waste gas)
    const existingRoot = await onChainClient.readContract({
      address: TALLY_COMMIT_CONTRACT,
      abi: TALLY_COMMIT_ABI,
      functionName: "roots",
      args: [proposalId],
    });
    if (existingRoot !== "0x0000000000000000000000000000000000000000000000000000000000000000") {
      return {
        ok: true,
        alreadyCommitted: true,
        root: existingRoot,
        contract: TALLY_COMMIT_CONTRACT,
      };
    }

    // Send the commit tx
    const account = await getDeployerAccount();
    const wc = createWalletClient({ account, chain: BUIDLER_CHAIN, transport: http() });
    const txHash = await wc.writeContract({
      address: TALLY_COMMIT_CONTRACT,
      abi: TALLY_COMMIT_ABI,
      functionName: "commit",
      args: [proposalId, root, BigInt(leaves.length)],
    });
    const receipt = await onChainClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      return reply.code(500).send({ error: "tx_reverted", txHash });
    }
    return {
      ok: true,
      proposalId,
      root,
      ballotCount: leaves.length,
      txHash,
      contract: TALLY_COMMIT_CONTRACT,
      arbiscanUrl: `https://arbiscan.io/tx/${txHash}`,
    };
  } catch (e) {
    app.log.error(e);
    return reply.code(500).send({ error: "commit_failed", detail: e.message });
  }
});

const PORT = Number(process.env.PORT ?? 7101);
const HOST = process.env.HOST ?? "127.0.0.1";
// Only bind a port when run directly (node server/api.mjs). When imported
// (e.g. by the test suite) the app is exercised via app.inject() instead, so
// importing must not start a listener or require an open port.
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`thedaolog ballot api on :${PORT}`);
}
