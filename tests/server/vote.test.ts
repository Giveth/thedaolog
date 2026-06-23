import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeBallot, voterAccount, adminAccount, futureDeadline, pastDeadline } from "../helpers";

vi.mock("../../server/db.mjs", () => {
  let proposals: Record<string, any> = {};
  let ballots: Record<string, any> = {};
  return {
    pool: { query: vi.fn(async () => ({ rows: [] })), end: vi.fn() },
    bootstrap: vi.fn(async () => {}),
    loadProposals: vi.fn(async () => structuredClone(proposals)),
    saveProposals: vi.fn(async (m: any) => { proposals = structuredClone(m); }),
    loadBallots: vi.fn(async () => structuredClone(ballots)),
    saveBallots: vi.fn(async (m: any) => { ballots = structuredClone(m); }),
    __reset: () => { proposals = {}; ballots = {}; },
    __seedProposals: (p: any) => { proposals = structuredClone(p); },
    __seedBallots: (b: any) => { ballots = structuredClone(b); },
  };
});

vi.mock("viem", async (orig) => {
  const actual: any = await orig();
  return {
    ...actual,
    createPublicClient: () => ({
      readContract: async () => {
        if ((globalThis as any).__BADGE_THROW) throw new Error("rpc boom");
        return (globalThis as any).__BADGE_BALANCE ?? 0n;
      },
    }),
    createWalletClient: () => ({ writeContract: async () => "0xdeadbeef" }),
  };
});

import { app } from "../../server/api.mjs";
import * as db from "../../server/db.mjs";

const PID = "r-vote";
function seedProposal(over: Record<string, any> = {}) {
  (db as any).__seedProposals({
    [PID]: {
      id: PID, title: "Vote", description: "",
      votingMode: "quadratic", budget: 100,
      options: [{ id: 1, label: "A" }, { id: 2, label: "B" }],
      deadline: new Date(Date.now() + 86400000).toISOString(),
      opensAt: null, tokenId: "tok-buidler", tokenAddress: null, tokenChainId: null,
      createdAt: new Date().toISOString(), createdBy: "0x0",
      ...over,
    },
  });
}
const setBadge = (b: bigint) => { (globalThis as any).__BADGE_BALANCE = b; };
const cast = (body: any) => app.inject({ method: "POST", url: `/api/proposals/${PID}/vote`, payload: body });

beforeEach(() => {
  (db as any).__reset();
  setBadge(0n);
  (globalThis as any).__BADGE_THROW = false;
  process.env.ALLOW_ADMIN_VOTE_BYPASS = "0";
});

describe("POST /api/proposals/:id/vote", () => {
  it("404 when the proposal does not exist", async () => {
    const b = await makeBallot(voterAccount, { proposalId: PID, allocations: [{ issueId: 1, points: 5 }], budget: 100 });
    const res = await cast(b);
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("proposal_not_found");
  });

  it("400 bad_voter_address for a malformed voter", async () => {
    seedProposal();
    const b = await makeBallot(voterAccount, { proposalId: PID, allocations: [{ issueId: 1, points: 5 }], budget: 100 });
    b.ballot.voter = "not-an-address";
    const res = await cast(b);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("bad_voter_address");
  });

  it("400 voting_closed once the deadline has passed", async () => {
    seedProposal({ deadline: new Date(Date.now() - 1000).toISOString() });
    const b = await makeBallot(voterAccount, { proposalId: PID, allocations: [{ issueId: 1, points: 5 }], budget: 100 });
    const res = await cast(b);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("voting_closed");
  });

  it("400 voting_not_started when opensAt is in the future (scheduled)", async () => {
    seedProposal({ opensAt: new Date(Date.now() + 86400000).toISOString() });
    setBadge(1n);
    const b = await makeBallot(voterAccount, { proposalId: PID, allocations: [{ issueId: 1, points: 5 }], budget: 100 });
    const res = await cast(b);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("voting_not_started");
  });

  it("allows voting once opensAt is in the past", async () => {
    seedProposal({ opensAt: new Date(Date.now() - 1000).toISOString() });
    setBadge(1n);
    const b = await makeBallot(voterAccount, { proposalId: PID, allocations: [{ issueId: 1, points: 5 }], budget: 100 });
    const res = await cast(b);
    expect(res.statusCode).toBe(200);
  });

  it("401 invalid_signature when the ballot is tampered after signing", async () => {
    seedProposal(); setBadge(1n);
    const b = await makeBallot(voterAccount, { proposalId: PID, allocations: [{ issueId: 1, points: 5 }], budget: 100 });
    b.ballot.allocations[0].points = 9; // changes the message, breaks the sig
    const res = await cast(b);
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("invalid_signature");
  });

  it("400 signature_verification_threw for a malformed signature", async () => {
    seedProposal(); setBadge(1n);
    const b = await makeBallot(voterAccount, { proposalId: PID, allocations: [{ issueId: 1, points: 5 }], budget: 100 });
    const res = await cast({ ballot: b.ballot, signature: "0x1234" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("signature_verification_threw");
  });

  it("400 over_budget for a quadratic ballot exceeding the budget", async () => {
    seedProposal(); setBadge(1n);
    // cost = 8² + 7² = 113 > 100
    const b = await makeBallot(voterAccount, { proposalId: PID, allocations: [{ issueId: 1, points: 8 }, { issueId: 2, points: 7 }], budget: 100 });
    const res = await cast(b);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("over_budget");
  });

  it("400 over_budget for a token-weight ballot exceeding the budget", async () => {
    seedProposal({ votingMode: "token-weight", budget: 5 }); setBadge(1n);
    const b = await makeBallot(voterAccount, { proposalId: PID, allocations: [{ issueId: 1, points: 3 }, { issueId: 2, points: 3 }], budget: 5 });
    const res = await cast(b);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("over_budget");
  });

  it("400 budget_mismatch when claimed budget differs from the proposal", async () => {
    seedProposal(); setBadge(1n);
    const b = await makeBallot(voterAccount, { proposalId: PID, allocations: [{ issueId: 1, points: 5 }], budget: 50 });
    const res = await cast(b);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("budget_mismatch");
  });

  it("400 unknown_option when allocating to a non-existent option", async () => {
    seedProposal(); setBadge(1n);
    const b = await makeBallot(voterAccount, { proposalId: PID, allocations: [{ issueId: 99, points: 5 }], budget: 100 });
    const res = await cast(b);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("unknown_option");
  });

  it("403 no_known_eligibility_token when the token is unresolvable", async () => {
    seedProposal({ tokenId: "tok-nope", tokenAddress: null, tokenChainId: null });
    const b = await makeBallot(voterAccount, { proposalId: PID, allocations: [{ issueId: 1, points: 5 }], budget: 100 });
    const res = await cast(b);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("no_known_eligibility_token");
  });

  it("403 not_a_badgeholder when the voter holds no badge", async () => {
    seedProposal(); setBadge(0n);
    const b = await makeBallot(voterAccount, { proposalId: PID, allocations: [{ issueId: 1, points: 5 }], budget: 100 });
    const res = await cast(b);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("not_a_badgeholder");
  });

  it("503 rpc_failed when the chain read throws", async () => {
    seedProposal();
    (globalThis as any).__BADGE_THROW = true;
    const b = await makeBallot(voterAccount, { proposalId: PID, allocations: [{ issueId: 1, points: 5 }], budget: 100 });
    const res = await cast(b);
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("rpc_failed");
  });

  it("casts a valid quadratic ballot for a badgeholder", async () => {
    seedProposal(); setBadge(1n);
    const b = await makeBallot(voterAccount, { proposalId: PID, allocations: [{ issueId: 1, points: 5 }, { issueId: 2, points: 5 }], budget: 100 });
    const res = await cast(b);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.voter.toLowerCase()).toBe(voterAccount.address.toLowerCase());
    expect(body.cid).toBeNull();
  });

  it("admin can bypass eligibility when ALLOW_ADMIN_VOTE_BYPASS=1", async () => {
    seedProposal(); setBadge(0n);
    process.env.ALLOW_ADMIN_VOTE_BYPASS = "1";
    const b = await makeBallot(adminAccount, { proposalId: PID, allocations: [{ issueId: 1, points: 5 }], budget: 100 });
    const res = await cast(b);
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it("admin is NOT bypassed when the flag is off (strict gate)", async () => {
    seedProposal(); setBadge(0n);
    process.env.ALLOW_ADMIN_VOTE_BYPASS = "0";
    const b = await makeBallot(adminAccount, { proposalId: PID, allocations: [{ issueId: 1, points: 5 }], budget: 100 });
    const res = await cast(b);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("not_a_badgeholder");
  });

  it("re-voting replaces the prior ballot (one ballot per voter)", async () => {
    seedProposal(); setBadge(1n);
    await cast(await makeBallot(voterAccount, { proposalId: PID, allocations: [{ issueId: 1, points: 3 }], budget: 100 }));
    await cast(await makeBallot(voterAccount, { proposalId: PID, allocations: [{ issueId: 2, points: 6 }], budget: 100 }));
    const tally = (await app.inject({ method: "GET", url: `/api/proposals/${PID}` })).json();
    expect(tally.voterCount).toBe(1);
    expect(tally.tally["1"]).toBeUndefined();
    expect(tally.tally["2"]).toBe(6);
  });
});
