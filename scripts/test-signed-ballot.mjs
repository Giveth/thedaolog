// End-to-end test: create a proposal + sign + post a ballot.
// Validates that the API's EIP-712 verification + QV checks + on-chain
// badge eligibility all line up. Run from inside thedaolog-vite/.
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum } from "viem/chains";
import { readDeployerKey } from "./deployer-key.mjs";

// Use the deployer wallet — it's NOT a badgeholder, so we expect the
// `not_a_badgeholder` failure path. To exercise the success path we'd
// sign with one of the addresses the team minted to.
const { privateKey } = readDeployerKey();
const account = privateKeyToAccount(privateKey);
console.log("test signer:", account.address);

const API = "http://127.0.0.1:7101/api";
const PROPOSAL_ID = "test-token-vote-2026-05-04";
const DEADLINE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

// 1. Create the proposal
const createRes = await fetch(`${API}/proposals`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    id: PROPOSAL_ID,
    title: "Which token do you want to be paid in?",
    description: "Test vote — Giveth employees pick payout token",
    votingMode: "quadratic",
    budget: 100,
    options: [
      { id: 1, label: "USDC" },
      { id: 2, label: "DAI" },
      { id: 3, label: "ETH" },
      { id: 4, label: "GIV" },
    ],
    deadline: DEADLINE,
    createdBy: "test-script",
  }),
});
console.log("create proposal:", createRes.status);
console.log(" ", JSON.stringify(await createRes.json()).slice(0, 200));

// 2. Build + sign a ballot. QV cost = sum(points²); 6²+4²+5²+5² = 36+16+25+25 = 102 (over 100, expect over_budget).
//    Tighten: 5²+4²+4²+3² = 25+16+16+9 = 66 (under 100, valid).
const allocations = [
  { issueId: 1, points: 5 },
  { issueId: 2, points: 4 },
  { issueId: 3, points: 4 },
  { issueId: 4, points: 3 },
];
const ballot = {
  voter: account.address,
  proposalId: PROPOSAL_ID,
  allocations,
  budget: 100,
  deadline: Math.floor(new Date(DEADLINE).getTime() / 1000),
  nonce: 0,
};

const signature = await account.signTypedData({
  domain: { name: "theDAOlog", version: "1", chainId: arbitrum.id },
  types: {
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
  },
  primaryType: "Ballot",
  message: {
    voter: account.address,
    proposalId: PROPOSAL_ID,
    allocations: allocations.map((a) => ({ issueId: BigInt(a.issueId), points: BigInt(a.points) })),
    budget: BigInt(100),
    deadline: BigInt(ballot.deadline),
    nonce: BigInt(0),
  },
});
console.log("signature:", signature.slice(0, 22) + "...");

// 3. Post the ballot. Expecting 403 not_a_badgeholder since deployer
//    wallet doesn't hold BUIDLER. That's the green light that the
//    signature verification + QV checks all PASSED — we got rejected
//    purely on eligibility, which is the last gate.
const voteRes = await fetch(`${API}/proposals/${PROPOSAL_ID}/vote`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ ballot, signature }),
});
console.log("vote:", voteRes.status);
const voteBody = await voteRes.json();
console.log(" ", JSON.stringify(voteBody));
if (voteBody.error === "not_a_badgeholder") {
  console.log("\n✅ All upstream checks PASSED (sig + QV + budget). Eligibility correctly blocks non-holders.");
} else if (voteBody.ok) {
  console.log("\n✅ Vote stored (this signer must hold a badge).");
} else {
  console.log("\n❌ Unexpected response — investigate.");
}

// 4. Public ballots endpoint (audit trail)
const ballotsRes = await fetch(`${API}/proposals/${PROPOSAL_ID}/ballots`);
console.log("\nballots:", ballotsRes.status);
const j = await ballotsRes.json();
console.log("count:", (j.ballots || []).length);
